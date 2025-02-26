#!/bin/bash
set -e
set -x

cd /opt/polis
sudo yum install -y git # Still needed, but consider moving to UserData if used by other services
GIT_REPO_URL="https://github.com/compdemocracy/polis.git" # Standard HTTPS URL - PUBLIC REPO
GIT_BRANCH="te-cdk-replatform"

if [ ! -d "polis" ]; then # Check if 'polis' directory already exists
  echo "Cloning public repository from $GIT_REPO_URL, branch: $GIT_BRANCH (HTTPS - Public Repo)"
  git clone -b "$GIT_BRANCH" "$GIT_REPO_URL" polis
else
  echo "Polis directory already exists, skipping cloning."
fi

cd polis

if [ -f "example.env" ]; then
  echo "Copying example.env to .env"
  cp example.env .env
else
  echo "Warning: example.env not found in repository root."
fi

# --- Database Configuration and Environment Variables from Secrets Manager ---

# 1. Get Secret ARN from SSM Parameter
SECRET_ARN=$(aws ssm get-parameter --name /polis/db-secret-arn --query 'Parameter.Value' --output text --region us-east-1)

if [ -z "$SECRET_ARN" ]; then
  echo "Error: Could not retrieve DB Secret ARN from SSM Parameter /polis/db-secret-arn"
  exit 1 # Exit if Secret ARN is not found
fi

echo "Retrieved Secret ARN from SSM Parameter: $SECRET_ARN"

# 2. Retrieve Secret Value from Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text --region us-east-1)

if [ -z "$SECRET_JSON" ]; then
  echo "Error: Could not retrieve DB Secret from Secrets Manager using ARN: $SECRET_ARN"
  exit 1 # Exit if Secret Value cannot be retrieved
fi

echo "Retrieved Secret JSON from Secrets Manager"

# 3. Parse secrets JSON using jq - **Corrected jq command to handle number values**
SECRETS_VARS=$(echo "$SECRET_JSON" | jq -r 'to_entries[] | .key + "=" + (.value | tostring)')

# 4. Read existing .env file into an associative array - **Robust Reading and Debugging**
declare -A ENV_VARS
echo "--- .env file content before reading into array ---"
cat .env # Print the content of .env for debugging
echo "--- End of .env file content ---"

while IFS='=' read -r key value; do
  echo "DEBUG: Reading .env line - Key: [$key], Value: [$value]" # Debug output
  if [[ -n "$key" ]]; then # Check if key is NOT empty
    ENV_VARS["$key"]="$value"
  else
    echo "DEBUG: Skipping line with empty key in .env" # Debug output for empty key lines
  fi
done < .env

echo "Existing .env file content read into ENV_VARS array"

# 5. Iterate through Secrets Manager variables and update/add to .env
while IFS= read -r secret_key_value; do
  IFS='=' read -r secret_key secret_value <<< "$secret_key_value"

  if [[ -z "${ENV_VARS[$secret_key]}" ]]; then
    echo "Adding new variable from Secrets Manager to .env: $secret_key=$secret_value"
    echo "$secret_key=$secret_value" >> .env
  elif [[ -z "${ENV_VARS[$secret_key]}" ]]; then
    echo "Updating empty variable in .env from Secrets Manager: $secret_key=$secret_value"
    sed -i "s|^${secret_key}=.*|${secret_key}=${secret_value}|" .env
  else
    echo "Variable '$secret_key' already has a value in .env, skipping update from Secrets Manager."
  fi
done < <(echo "$SECRETS_VARS")

echo ".env file updated with Secrets Manager variables."
cat .env # Display the final .env file content for debugging

SERVICE_FROM_FILE=$(cat /tmp/service_type.txt) # Read file content into variable

echo "DEBUG: Service type read from /tmp/service_type.txt: [$SERVICE_FROM_FILE]"

# export IMAGE_TAG
/usr/local/bin/docker-compose config # Validate

if [ "$SERVICE_FROM_FILE" == "server" ]; then
  echo "Starting docker-compose up for 'server' and 'nginx-proxy' services"
  /usr/local/bin/docker-compose up -d server nginx-proxy  # <-----  START BOTH server AND nginx-proxy
elif [ "$SERVICE_FROM_FILE" == "math" ]; then
  echo "Starting docker-compose up for 'math' service"
  /usr/local/bin/docker-compose up -d math
else
  echo "Error: Unknown service type: [$SERVICE_FROM_FILE]. Starting all services (default docker-compose up -d)"
  /usr/local/bin/docker-compose up -d # Fallback - start all if service type is unknown
fi