#!/bin/bash
# Delphi Job Poller Service Starter

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Path to the Python poller script
POLLER_SCRIPT="$SCRIPT_DIR/scripts/job_poller.py"

# Default options
ENDPOINT_URL="${DYNAMODB_ENDPOINT}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"
LOG_LEVEL="${LOG_LEVEL:-INFO}"
MAX_WORKERS="${MAX_WORKERS:-1}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Delphi Job Poller Service${NC}"
echo -e "${YELLOW}DynamoDB Endpoint:${NC} $ENDPOINT_URL"
echo -e "${YELLOW}Poll Interval:${NC} $POLL_INTERVAL seconds"
echo -e "${YELLOW}Log Level:${NC} $LOG_LEVEL"
echo -e "${YELLOW}Max Workers:${NC} $MAX_WORKERS"
echo ""

# Execute the poller script
python3 "$POLLER_SCRIPT" \
  --endpoint-url="$ENDPOINT_URL" \
  --interval="$POLL_INTERVAL" \
  --log-level="$LOG_LEVEL" \
  --max-workers="$MAX_WORKERS" \
  "$@"