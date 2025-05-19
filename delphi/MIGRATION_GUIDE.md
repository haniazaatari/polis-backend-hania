# Delphi Job System Migration Guide

This document provides instructions for migrating from the old monolithic job poller to the new modular job system.

## Overview

The new job system offers several advantages:
- Modular architecture with clear separation of concerns
- Enhanced error handling with retries for transient errors
- Better security with environment variable validation
- Support for multiple job types through a handler registry
- Efficient resource management
- Improved logging and monitoring

## Migration Steps

### 1. Install the New System

The new system is organized in a Python package structure:

```
delphi/
├── job_system/       # Core components
└── scripts/
    └── job_poller_new.py  # New entry point
```

No additional dependencies are required - the new system uses the same libraries as the original implementation.

### 2. Testing in Parallel

During migration, both systems can run in parallel:

1. Keep the existing job poller running with its current configuration
2. Run the new poller with a different worker ID prefix:

```bash
# Run the new poller with a distinct worker ID
DELPHI_WORKER_PREFIX=new_system python scripts/job_poller_new.py 
```

This allows verifying that the new system works correctly without disrupting existing operations.

### 3. Switching Over

Once you're confident in the new system:

1. Stop the old job poller
2. Rename `job_poller_new.py` to `job_poller.py` to replace the old one
3. Start the new system

```bash
# Assuming you're in the delphi directory
mv scripts/job_poller_new.py scripts/job_poller.py
```

### 4. Update Deployment Scripts

Update any deployment, monitoring, or management scripts to use the new system.

If you're using systemd, update your service file:

```ini
[Unit]
Description=Delphi Job Poller Service
After=network.target

[Service]
User=delphi
WorkingDirectory=/path/to/delphi
ExecStart=/path/to/python /path/to/delphi/scripts/job_poller.py --max-workers=4 --log-level=INFO
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

## Configuration Options

The new system supports all the original command-line arguments plus additional options:

| Option | Description | Default |
|--------|-------------|---------|
| `--endpoint-url` | DynamoDB endpoint URL | http://localhost:8000 |
| `--region` | AWS region | us-west-2 |
| `--interval` | Polling interval in seconds | 10 |
| `--max-workers` | Maximum concurrent workers | 1 |
| `--log-level` | Logging level | INFO |
| `--log-file` | Optional log file path | None |

## Environment Variables

The new system respects all the original environment variables and adds new ones:

| Variable | Description | Default |
|----------|-------------|---------|
| `DYNAMODB_ENDPOINT` | DynamoDB endpoint URL | http://localhost:8000 |
| `DELPHI_POLLING_INTERVAL` | Polling interval in seconds | 10 |
| `DELPHI_MAX_WORKERS` | Maximum concurrent workers | 1 |
| `DELPHI_DEFAULT_TIMEOUT` | Default job timeout in seconds | 3600 |
| `DELPHI_MAX_OUTPUT_LINES` | Maximum output lines to store | 1000 |
| `DELPHI_DEFAULT_MODEL` | Default LLM model for batch jobs | claude-3-5-sonnet-20241022 |
| `DELPHI_DEFAULT_BATCH_SIZE` | Default batch size for batch jobs | 20 |

## Monitoring

The new system includes improved logging for easier monitoring. Consider adding log aggregation to capture these logs:

1. Set up a log file:
```bash
python scripts/job_poller.py --log-file=/var/log/delphi/job_poller.log --log-level=INFO
```

2. Monitor logs for errors:
```bash
grep ERROR /var/log/delphi/job_poller.log
```

## Troubleshooting

### Common Issues

1. **Job poller can't connect to DynamoDB**
   - Check your endpoint URL and credentials
   - Ensure the DynamoDB table exists

2. **Jobs remain in PROCESSING state**
   - Check for command errors in the job logs
   - Verify script permissions

3. **Command errors**
   - Ensure file paths are correct in handlers
   - Check script permissions

### Logs

All logs now include the following information:
- Timestamp
- Module name (e.g., `delphi.db`, `delphi.handlers`)
- Log level (DEBUG, INFO, WARNING, ERROR)
- Message

### Debug Mode

For detailed troubleshooting, enable DEBUG level logging:

```bash
python scripts/job_poller.py --log-level=DEBUG
```

## Support

If you encounter issues during migration, please:
1. Check the logs for specific error messages
2. Ensure the DynamoDB table has the correct structure
3. Verify that all scripts have the necessary permissions
4. Report issues through the project issue tracker