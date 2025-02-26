#!/bin/bash
set -e
set -x

cd /opt/polis
sudo yum install -y git
GIT_REPO_URL="https://github.com/compdemocracy/polis.git"
GIT_BRANCH="te-cdk-replatform"

if [ ! -d "polis" ]; then
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
  exit 1
fi

echo "Retrieved Secret ARN from SSM Parameter: $SECRET_ARN"

# 2. Retrieve Secret Value from Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text --region us-east-1)

if [ -z "$SECRET_JSON" ]; then
  echo "Error: Could not retrieve DB Secret from Secrets Manager using ARN: $SECRET_ARN"
  exit 1
fi

echo "Retrieved Secret JSON from Secrets Manager"

# 3. Parse secrets JSON using jq
SECRETS_VARS=$(echo "$SECRET_JSON" | jq -r 'to_entries[] | .key + "=" + (.value | tostring)')

# 4. Read existing .env file into an associative array (Not needed for replacement logic)
# declare -A ENV_VARS
# while IFS='=' read -r key value; do
#   ENV_VARS["$key"]="$value"
# done < .env
# echo "Existing .env file content read into ENV_VARS array"

echo "--- .env file content BEFORE replacement ---"
cat .env

# 5. Iterate through Secrets Manager variables and REPLACE in .env using sed
while IFS= read -r secret_key_value; do
  IFS='=' read -r secret_key secret_value <<< "$secret_key_value"

  # Use sed to replace the line starting with SECRET_KEY= in .env
  if grep -q "^${secret_key}=" .env; then
    echo "Replacing variable '$secret_key' in .env with value from Secrets Manager."
    sed -i "s|^${secret_key}=.*|${secret_key}=${secret_value}|" .env
  else
    echo "Variable '$secret_key' not found in .env, adding it." # If key not found, ADD it (for robustness)
    echo "$secret_key=$secret_value" >> .env
  fi
done < <(echo "$SECRETS_VARS")


echo "--- .env file content AFTER replacement ---"
cat .env # Display the final .env file content for debugging

SERVICE_FROM_FILE=$(cat /tmp/service_type.txt)

echo "DEBUG: Service type read from /tmp/service_type.txt: [$SERVICE_FROM_FILE]"
/usr/local/bin/docker-compose config

if [ "$SERVICE_FROM_FILE" == "server" ]; then
  echo "Starting docker-compose up for 'server' and 'nginx-proxy' services"
  /usr/local/bin/docker-compose up -d server nginx-proxy
elif [ "$SERVICE_FROM_FILE" == "math" ]; then
  echo "Starting docker-compose up for 'math' service"
  /usr/local/bin/docker-compose up -d math
else
  echo "Error: Unknown service type: [$SERVICE_FROM_FILE]. Starting all services (default docker-compose up -d)"
  /usr/local/bin/docker-compose up -d # Fallback
fi