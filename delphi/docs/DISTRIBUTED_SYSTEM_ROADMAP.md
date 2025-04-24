# Delphi Distributed System Roadmap

## Overview

This document outlines the roadmap for evolving Delphi from its current state as a manually-executed system to a fully distributed, scalable processing architecture that integrates seamlessly with the Polis platform.

## Current State

- **Execution Model**: Job queue system with manual submission and poller service
- **DynamoDB**: Single shared instance with robust job queue schema
- **Orchestration**: Poller service (job_poller.py) plus run_delphi.sh for execution
- **Integration**: CLI interface (delphi_cli.py) for job management
- **Scalability**: Improved, supports concurrent worker processes

## Target Architecture

- **Execution Model**: Event-driven, job-based processing system
- **DynamoDB**: Single shared instance with robust schema design
- **Orchestration**: Automated poller service that scales with instance resources
- **Integration**: Tight integration with main Polis platform through job queue
- **Scalability**: Horizontal scaling through multiple worker instances

## Action Items

### Phase 1: Infrastructure Consolidation ✅
- [x] Merge DynamoDB instances into a single shared resource
- [x] Update documentation to reflect new shared database approach
- [x] Ensure Docker networking allows proper communication between services
- [ ] Fix Delphi container CMD to keep it running stably

### Phase 2: Job Queue System ✅
- [x] Design comprehensive job table schema
  - [x] Support for various job types (PCA, UMAP, report generation)
  - [x] Rich metadata fields for tracking state, progress, and results
  - [x] Comprehensive logging capabilities
  - [x] Priority and scheduling mechanisms
- [x] Create the jobs table in DynamoDB
- [x] Implement strongly consistent read patterns for distributed safety
- [x] Implement optimistic locking for reliable status updates
- [x] Create a CLI tool for job submission and monitoring
- [ ] Add integration tests for table operations

### Phase 3: Worker Implementation ✅
- [x] Develop a Python poller service
  - [x] Configurable polling interval
  - [x] Graceful error handling
  - [x] Comprehensive logging
  - [ ] Resource-aware scaling (based on EC2 instance size)
- [x] Integrate with run_delphi.sh for job execution
- [x] Implement job status updates with versioning
- [ ] Create monitoring endpoints for health/status checks

### Phase 4: Producer Integration
- [ ] Develop Node.js client for the job system
- [ ] Add API endpoints for job submission
- [ ] Create job templates for common processing needs
- [ ] Implement callback mechanisms for job completion
- [ ] Build admin interfaces for monitoring job queue

### Phase 5: Testing and Deployment
- [ ] Create comprehensive test suite for distributed operation
- [ ] Develop load testing scenarios
- [ ] Setup staging environment with scaled-down infrastructure
- [ ] Document deployment procedures
- [ ] Create runbooks for common operational tasks

## Implementation Notes

### Strongly Consistent Reads
For DynamoDB operations in a distributed system, we must use strongly consistent reads:

```python
# Example of strongly consistent read
response = table.get_item(
    Key={'job_id': 'job123'},
    ConsistentRead=True
)
```

This ensures we get the most up-to-date data, reflecting all prior successful write operations.

### Resource-Aware Scaling
The worker should adjust its behavior based on the available resources:

```python
# Example of resource-aware configuration
import os
import multiprocessing

# Get EC2 instance size from environment
instance_type = os.environ.get('EC2_INSTANCE_TYPE', 't2.micro')

# Map instance types to resource configurations
instance_resources = {
    't2.micro': {'max_workers': 1, 'max_memory_gb': 1},
    't2.small': {'max_workers': 1, 'max_memory_gb': 2},
    't2.medium': {'max_workers': 2, 'max_memory_gb': 4},
    # Add other instance types as needed
}

# Use available CPU cores as a fallback
default_workers = max(1, multiprocessing.cpu_count() - 1)
resources = instance_resources.get(
    instance_type, 
    {'max_workers': default_workers, 'max_memory_gb': 8}
)
```

### Docker Integration

The Docker container should be configured to start the poller service automatically:

```dockerfile
# Example Dockerfile update
CMD ["python", "-m", "delphi.poller.service"]
```

## Next Steps

The immediate focus should be on:

1. **Node.js Integration** - Develop a helper for the server to enqueue jobs
2. **Production Hardening** - Create systemd service files for the poller
3. **Operational Tools** - Implement job archiving and cleanup mechanisms
4. **Monitoring** - Set up CloudWatch metrics for job processing

These steps will complete the journey from a manual execution model to a fully distributed, scalable system integrated with the main Polis application.