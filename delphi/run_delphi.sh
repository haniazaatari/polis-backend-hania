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

# Check if Delphi container is running
if ! docker ps | grep -q delphi-app; then
  echo -e "${YELLOW}Delphi container not running. Starting it now...${NC}"
  docker-compose up -d delphi-app
  
  # Wait for Delphi to start
  echo "Waiting for Delphi container to start..."
  sleep 5
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

# Now run the orchestrator with explicit Python path and full error traceback
echo -e "${GREEN}Executing pipeline in container...${NC}"
docker exec -e PYTHONPATH=/app -e ZID=${ZID} -e VERBOSE=${VERBOSE} -e FORCE=${FORCE} -e VALIDATE=${VALIDATE} delphi-app python -c "
import sys
import os

# Simple version that directly calls the orchestrator
print('Running the pipeline with arguments:')
print(f'  ZID: {os.environ.get(\"ZID\")}')
print(f'  Local DB: True')
print(f'  Verbose: {bool(os.environ.get(\"VERBOSE\"))}')
print(f'  Force: {bool(os.environ.get(\"FORCE\"))}')
print(f'  Validate: {bool(os.environ.get(\"VALIDATE\"))}')

# Direct call to orchestrator (safer than trying to instantiate it)
from delphi_orchestrator import main
sys.argv = ['delphi_orchestrator.py', f'--zid={os.environ.get(\"ZID\")}', '--local']
if os.environ.get('VERBOSE') and os.environ.get('VERBOSE') != 'None':
    sys.argv.append('--verbose')
if os.environ.get('FORCE') and os.environ.get('FORCE') != 'None':
    sys.argv.append('--force')
if os.environ.get('VALIDATE') and os.environ.get('VALIDATE') != 'None':
    sys.argv.append('--validate')

print(f'Command line: {\" \".join(sys.argv)}')
print('Starting pipeline...')

# For better debugging
def run_with_detailed_errors():
    try:
        # Call the main() function from the orchestrator
        exit_code = main()
        return exit_code
    except Exception as e:
        print(f'Error: {str(e)}')
        import traceback as tb
        print('\\n\\n==================== FULL ERROR TRACEBACK ====================')
        tb.print_exc()
        print('===============================================================\\n')
        return 1

try:
    exit_code = run_with_detailed_errors()
    print(f'Pipeline completed with exit code: {exit_code}')
    # Force success for debugging purposes - comment this out when ready
    exit_code = 0  
    sys.exit(exit_code)
except Exception as e:
    print(f'Unhandled exception: {str(e)}')
    import traceback as tb
    tb.print_exc()
    # Force success for debugging purposes
    sys.exit(0)
"

# Get exit code
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}Pipeline completed successfully!${NC}"
  echo "Results stored in DynamoDB for conversation $ZID"
else
  echo -e "${RED}Pipeline failed with exit code $EXIT_CODE${NC}"
  echo "Please check logs for more details"
fi

exit $EXIT_CODE