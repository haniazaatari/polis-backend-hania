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

# --- Database Configuration ---

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

# 3. Parse username and password from JSON using jq
DB_USER=$(echo "$SECRET_JSON" | jq -r '.username')
DB_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.password')

if [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
  echo "Error: Could not parse username or password from Secret JSON"
  exit 1 # Exit if parsing fails
fi

echo "Parsed DB_USER and DB_PASSWORD from Secret JSON"

# 4. Get DB Host and Port from SSM Parameters (already present, but ensure correct parameter names)
DB_HOST=$(aws ssm get-parameter --name /polis/db-host --query 'Parameter.Value' --output text --region us-east-1)
DB_PORT=$(aws ssm get-parameter --name /polis/db-port --query 'Parameter.Value' --output text --region us-east-1)

if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ]; then
  echo "Error: Could not retrieve DB_HOST or DB_PORT from SSM Parameters"
  exit 1 # Exit if host or port not found
fi

echo "Retrieved DB_HOST and DB_PORT from SSM Parameters"

# 5. Update DATABASE_URL in .env file
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/polisdb|" .env

echo "Updated DATABASE_URL in .env file"

# --- Docker Compose ---

# Get the image tag from SSM (already present, but might be updated later for image tags)
# IMAGE_TAG=$(aws ssm get-parameter --name /polis/image-tag --query 'Parameter.Value' --output text --with-decryption)
ECR_REPO_URI=$(aws ecr describe-repositories --repository-names polis --query 'repositories[0].repositoryUri' --output text --region us-east-1)

# Set environment variable for docker-compose (already present)
# export IMAGE_TAG
/usr/local/bin/docker-compose config # Validate
/usr/local/bin/docker-compose up -d $SERVICE # Start Docker Compose service