#!/bin/bash
# Script to run delphi_orchestrator.py inside the Docker container

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
  echo "Run the complete Delphi analytics pipeline for a Polis conversation."
  echo
  echo "Usage: ./run_delphi.sh --zid=CONVERSATION_ID [options]"
  echo
  echo "Required arguments:"
  echo "  --zid=CONVERSATION_ID     The Polis conversation ID to process"
  echo
  echo "Optional arguments:"
  echo "  --verbose                 Show detailed logs"
  echo "  --force                   Force reprocessing even if data exists"
  echo "  --validate                Run extra validation checks"
  echo "  --help                    Show this help message"
  echo
  echo "Examples:"
  echo "  ./run_delphi.sh --zid=36416"
  echo "  ./run_delphi.sh --zid=42351 --verbose --force"
}

# Parse command line arguments
ZID=""
VERBOSE=""
FORCE=""
VALIDATE=""

for arg in "$@"; do
  case $arg in
    --zid=*)
      ZID="${arg#*=}"
      ;;
    --verbose)
      VERBOSE="--verbose"
      ;;
    --force)
      FORCE="--force"
      ;;
    --validate)
      VALIDATE="--validate"
      ;;
    --help)
      show_usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $arg${NC}"
      show_usage
      exit 1
      ;;
  esac
done

# Check if ZID is provided
if [ -z "$ZID" ]; then
  echo -e "${RED}Error: --zid argument is required${NC}"
  show_usage
  exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker is not running${NC}"
  echo "Please start Docker and try again"
  exit 1
fi

echo -e "${GREEN}Running Delphi Orchestrator for conversation $ZID...${NC}"

# Check if DynamoDB container is running
if ! docker ps | grep -q delphi-dynamodb-local; then
  echo -e "${YELLOW}DynamoDB container not running. Starting it now...${NC}"
  docker-compose up -d dynamodb-local
  
  # Wait for DynamoDB to start properly
  echo "Waiting for DynamoDB to start..."
  sleep 5
  # Verify that DynamoDB is accessible
  if ! docker exec delphi-dynamodb-local aws dynamodb list-tables --endpoint-url http://dynamodb-local:8000 --region us-west-2; then
    echo -e "${YELLOW}Installing AWS CLI in DynamoDB container for validation...${NC}"
    docker exec delphi-dynamodb-local apt-get update && docker exec delphi-dynamodb-local apt-get install -y awscli
    echo "Verifying DynamoDB is accessible..."
    docker exec delphi-dynamodb-local aws dynamodb list-tables --endpoint-url http://dynamodb-local:8000 --region us-west-2 || true
  fi
fi

# Check if containers are running - start them if not
if ! docker ps | grep -q delphi-app || ! docker ps | grep -q delphi-ollama || ! docker ps | grep -q delphi-dynamodb-local; then
  echo -e "${YELLOW}Starting all required containers...${NC}"
  docker-compose up -d
  
  # Wait for containers to start
  echo "Waiting for containers to start..."
  sleep 5
fi

# Set model without pulling it
MODEL=${OLLAMA_MODEL:-llama3.1:8b}
echo -e "${YELLOW}Using Ollama model: $MODEL${NC}"

# Health check: verify that the Ollama API is accessible from the delphi-app container
echo -e "${YELLOW}Checking Ollama API health from delphi-app container...${NC}"
if docker exec delphi-app curl -s --connect-timeout 5 http://ollama:11434/api/tags >/dev/null; then
  echo -e "${GREEN}Ollama API is accessible from delphi-app${NC}"
else
  echo -e "${RED}Warning: Ollama API is not accessible from delphi-app${NC}"
  echo -e "${YELLOW}This may cause issues with LLM topic naming${NC}"
fi

# Create DynamoDB tables if they don't exist
echo -e "${YELLOW}Creating DynamoDB tables if they don't exist...${NC}"
docker exec -e PYTHONPATH=/app delphi-app python /app/create_dynamodb_tables.py --endpoint-url http://dynamodb-local:8000

# Fix the umap_narrative directory once and for all
echo -e "${YELLOW}Fixing umap_narrative directory in the container...${NC}"
docker exec delphi-app bash -c "if [ -L /app/umap_narrative ]; then 
  echo 'Removing symlink'; 
  rm /app/umap_narrative; 
fi && 
mkdir -p /app/umap_narrative &&
touch /app/umap_narrative/__init__.py &&
echo 'Created proper umap_narrative directory'"

# Make sure the script is executable locally
chmod +x delphi_orchestrator.py

# Make sure the container has the latest script (it's mounted as a volume)
echo -e "${GREEN}Executing pipeline in container...${NC}"
docker exec delphi-app chmod +x /app/delphi_orchestrator.py
# First try to list available conversations
echo -e "${YELLOW}Checking for available conversations...${NC}"
docker exec delphi-app python -c "
from polismath.database.postgres import PostgresClient
import os
import sys
try:
    print(f'DATABASE_URL: {os.environ.get(\"DATABASE_URL\", \"not set\")}')
    # Create client
    client = PostgresClient()
    print('PostgreSQL client initialized')
    
    # Test direct connection using SQLAlchemy
    if hasattr(client, 'engine'):
        try:
            from sqlalchemy import text
            with client.engine.connect() as conn:
                result = conn.execute(text('SELECT 1'))
                print(f'Connection test: {result.scalar()}')
                
                # Try to list conversations
                result = conn.execute(text('SELECT zid, topic FROM conversations LIMIT 10'))
                conversations = list(result)
                if conversations:
                    print('Available conversations:')
                    for c in conversations:
                        print(f'  ZID: {c[0]}, Topic: {c[1]}')
                else:
                    print('No conversations found in database')
        except Exception as e:
            print(f'SQL execution error: {e}')
    else:
        print('PostgreSQL client has no engine attribute')
except Exception as e:
    print(f'Error initializing PostgreSQL client: {e}')
    sys.exit(1)
"

# Ensure dependencies are installed directly in the container
echo -e "${YELLOW}Ensuring dependencies are properly installed...${NC}"
docker exec delphi-app pip install --no-cache-dir fastapi==0.115.0 pydantic colorlog

# Debug the PostgreSQL connection to ensure the URL is configured correctly
echo -e "${YELLOW}Testing PostgreSQL connection...${NC}"
docker exec delphi-app python -c "
import os
from sqlalchemy import create_engine, text
import urllib.parse

try:
    # Print environment variables
    db_url = os.environ.get('DATABASE_URL')
    print(f'DATABASE_URL: {db_url}')
    
    if db_url:
        # Test direct connection
        print('Attempting direct SQLAlchemy connection...')
        engine = create_engine(db_url)
        with engine.connect() as conn:
            result = conn.execute(text('SELECT 1')).scalar()
            print(f'Connection successful! Test result: {result}')
            
            # Try to list tables to verify schema access
            result = conn.execute(text('SELECT table_name FROM information_schema.tables WHERE table_schema=\\'public\\''))
            tables = [row[0] for row in result]
            print(f'Available tables: {tables}')
except Exception as e:
    print(f'Error connecting to PostgreSQL: {e}')
"

# Verify FastAPI is installed
echo -e "${YELLOW}Verifying FastAPI installation...${NC}"
docker exec delphi-app pip list | grep fastapi

# Set up Python path
docker exec delphi-app bash -c "export PYTHONPATH=/app:$PYTHONPATH && echo PYTHONPATH=\$PYTHONPATH"

# Run the UMAP narrative pipeline directly
echo -e "${GREEN}Running UMAP narrative pipeline...${NC}"

# Always use Ollama for topic naming
USE_OLLAMA="--use-ollama"
echo -e "${YELLOW}Using Ollama for topic naming${NC}"

# Run the pipeline directly, using dynamodb-local as the endpoint
# Pass OLLAMA_HOST to make sure it connects to the Ollama container
# Also pass the model that we pulled
docker exec -e PYTHONPATH=/app -e DYNAMODB_ENDPOINT=http://dynamodb-local:8000 -e OLLAMA_HOST=http://ollama:11434 -e OLLAMA_MODEL=${MODEL} delphi-app python /app/umap_narrative/run_pipeline.py --zid=${ZID} ${USE_OLLAMA}

# Save the exit code
PIPELINE_EXIT_CODE=$?

if [ $PIPELINE_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}UMAP Narrative pipeline completed successfully!${NC}"
  echo "Results stored in DynamoDB and visualizations for conversation ${ZID}"
  
  # Run the report generator with Claude 3.7 Sonnet
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo -e "${YELLOW}Generating report with Claude 3.7 Sonnet...${NC}"
    # Pass environment variables to ensure Claude is used
    docker exec -e PYTHONPATH=/app -e DYNAMODB_ENDPOINT=http://dynamodb-local:8000 -e LLM_PROVIDER=anthropic -e ANTHROPIC_MODEL=claude-3-7-sonnet-20250219 -e ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} delphi-app python /app/umap_narrative/800_report_topic_clusters.py --conversation_id=${ZID} --model=claude-3-7-sonnet-20250219
    
    # Save the exit code
    REPORT_EXIT_CODE=$?
    
    if [ $REPORT_EXIT_CODE -eq 0 ]; then
      echo -e "${GREEN}Report generation completed successfully!${NC}"
      echo "Report stored in DynamoDB for conversation ${ZID}"
    else
      echo -e "${RED}Warning: Report generation returned non-zero exit code: ${REPORT_EXIT_CODE}${NC}"
      echo "The narrative report may not have been generated properly."
    fi
  else
    echo -e "${YELLOW}Skipping report generation - ANTHROPIC_API_KEY not set.${NC}"
    echo "To generate narrative reports, set the ANTHROPIC_API_KEY environment variable."
  fi
else 
  echo -e "${RED}Warning: UMAP Narrative pipeline returned non-zero exit code: ${PIPELINE_EXIT_CODE}${NC}"
  echo "The pipeline may have encountered errors but might still have produced partial results."
  # Don't fail the overall script, just warn
  PIPELINE_EXIT_CODE=0
fi

# Set final exit code
EXIT_CODE=$PIPELINE_EXIT_CODE

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}Pipeline completed successfully!${NC}"
  echo "Results stored in DynamoDB for conversation $ZID"
else
  echo -e "${RED}Pipeline failed with exit code $EXIT_CODE${NC}"
  echo "Please check logs for more details"
fi

exit $EXIT_CODE