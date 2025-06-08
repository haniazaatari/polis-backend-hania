#!/bin/bash
# Script to start the Polis Delphi development environment

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Polis Delphi Development Environment${NC}"
echo "This script will start DynamoDB Local and the Delphi application."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running.${NC} Please start Docker and try again."
    exit 1
fi

# Check if dynamodb-local is already running
if docker ps | grep -q delphi-dynamodb-local; then
    echo -e "${YELLOW}DynamoDB Local is already running.${NC} Using existing container."
else
    echo -e "Starting DynamoDB Local..."
    docker-compose up -d dynamodb-local
    
    # Wait for DynamoDB to be ready
    echo "Waiting for DynamoDB Local to be ready..."
    sleep 3
fi

# Option to create tables only
if [ "$1" == "--tables-only" ]; then
    echo "Creating DynamoDB tables..."
    python create_dynamodb_tables.py --endpoint-url http://localhost:8000
    echo -e "${GREEN}Tables created.${NC} You can now start the full application with:"
    echo "./polis-delphi-dev.sh"
    exit 0
fi

# Start the Delphi application
echo "Starting Delphi application..."
docker-compose up -d delphi-app

echo -e "${GREEN}Polis Delphi Development Environment is now running:${NC}"
echo "- DynamoDB Local: http://localhost:8000"
echo "- Delphi Application: http://localhost:8080"
echo ""
echo "To stop the environment, run: docker-compose down"
echo "To create tables only, run: ./polis-delphi-dev.sh --tables-only"
echo "To view logs, run: docker-compose logs -f"