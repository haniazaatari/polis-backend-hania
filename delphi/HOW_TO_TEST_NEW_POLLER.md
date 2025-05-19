# Testing the New Job Poller System

This guide explains how to test the new Delphi job poller system without modifying your existing setup.

## Overview

The new job poller system has been implemented with a modular architecture that improves maintainability, error handling, and security. To facilitate testing, we've created:

1. A modified startup script that can switch between old and new pollers
2. A dedicated Docker Compose configuration for testing
3. A test script that automates the Docker setup and log viewing

## Option 1: Quick Test with Docker

The easiest way to test the new system is with the provided test script:

```bash
./test_new_poller.sh
```

This script will:
1. Start a test environment with all necessary services (DynamoDB, Ollama, MinIO)
2. Run the container with the new job poller
3. Display logs from the container

When you're done testing, press Ctrl+C to stop watching logs. The containers will continue to run but will be automatically stopped when you exit the script.

## Option 2: Run Directly with Modified Start Script

If you prefer to run the poller directly:

```bash
# Use the new poller
USE_NEW_POLLER=true ./start_poller.sh.new

# Or run with specific settings
USE_NEW_POLLER=true POLL_INTERVAL=5 MAX_WORKERS=2 LOG_LEVEL=DEBUG ./start_poller.sh.new
```

## Option 3: Integrate with Existing Docker Compose

To test with your existing Docker Compose setup, modify the environment variables:

```yaml
services:
  delphi-app:
    # ... existing configuration ...
    environment:
      # ... existing environment variables ...
      - USE_NEW_POLLER=true
    volumes:
      - .:/app
    command: ./start_poller.sh.new
```

## Testing Process

1. Set up the test environment
2. Submit some test jobs to the queue
3. Observe the poller's behavior
4. Check job statuses and results

### Submitting Test Jobs

You can use the existing Delphi CLI to submit test jobs:

```bash
./delphi submit --zid=12345 --job-type=FULL_PIPELINE
./delphi submit --zid=12345 --job-type=NARRATIVE_BATCH
```

### Verifying Proper Handling

The logs will show which handler is processing each job and how the system manages job status changes, retries, and completions.

## Switching Between Old and New Pollers

The `start_poller.sh.new` script allows you to easily switch between the old and new pollers:

```bash
# Use the old poller
USE_NEW_POLLER=false ./start_poller.sh.new

# Use the new poller
USE_NEW_POLLER=true ./start_poller.sh.new
```

## Full Integration

Once you're satisfied with the test results, you can fully integrate the new system:

1. Replace the old `start_poller.sh` with `start_poller.sh.new`:
   ```bash
   mv start_poller.sh.new start_poller.sh
   ```

2. Update your Docker Compose file to use the new startup script (it's compatible with both systems)

3. Set `USE_NEW_POLLER=true` in your environment to start using the new poller