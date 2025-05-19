#!/bin/bash
# Test script for the new job poller system

# Colors for nice output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Testing New Delphi Job Poller System ===${NC}"
echo -e "${YELLOW}This script will start a test environment with the new job poller system.${NC}"
echo

# Make sure we're in the right directory
cd "$(dirname "$0")"

# Set up cleanup function
function cleanup {
  echo -e "${YELLOW}Stopping test environment...${NC}"
  docker-compose -f docker-compose.test.yml down
  echo -e "${GREEN}Test environment stopped.${NC}"
}

# Register the cleanup function to run when the script exits
trap cleanup EXIT

# Start the test environment
echo -e "${BLUE}Starting test environment...${NC}"
docker-compose -f docker-compose.test.yml up -d

# Tail the logs for the new poller container
echo -e "${BLUE}Tailing logs from the new poller container:${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop watching logs (this won't stop the containers)${NC}"
docker-compose -f docker-compose.test.yml logs -f delphi-new-poller