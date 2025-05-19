# Delphi Job System Refactoring Plan

This document outlines a comprehensive refactoring plan for the Delphi job poller system, transforming it from a monolithic script into a modular, maintainable system.

## 1. Architecture Overview

The new architecture follows these design principles:
- **Separation of concerns**: Clear boundaries between components
- **Single responsibility**: Each module does one thing well
- **Extensibility**: Easy to add new job types without modifying core code
- **Testability**: Components can be tested in isolation
- **Security**: Explicit constraints on capabilities

### High-Level Components

```
delphi/
├── job_system/
│   ├── __init__.py
│   ├── config.py               # Configuration management
│   ├── db/                     # Database interactions
│   │   ├── __init__.py
│   │   ├── dynamodb.py         # DynamoDB client/operations
│   │   └── models.py           # Job data models
│   ├── poller/                 # Job polling mechanism
│   │   ├── __init__.py
│   │   ├── worker.py           # Worker thread implementation
│   │   └── scheduler.py        # Job scheduling and assignment
│   ├── handlers/               # Job type handlers
│   │   ├── __init__.py         # Registry of handlers
│   │   ├── base.py             # Base handler class
│   │   ├── pipeline.py         # Standard pipeline handler
│   │   ├── narrative.py        # Narrative batch handler
│   │   └── batch_status.py     # Batch status checker
│   ├── utils/                  # Utilities
│   │   ├── __init__.py
│   │   ├── logging.py          # Enhanced logging
│   │   ├── security.py         # Security utilities
│   │   └── process.py          # Process management
│   └── cli.py                  # Command-line interface
└── scripts/
    └── job_poller.py           # Entry point script (much smaller now)
```

## 2. Core Components

### 2.1. Job Models (db/models.py)

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any

class JobStatus(Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class JobType(Enum):
    FULL_PIPELINE = "FULL_PIPELINE"
    NARRATIVE_BATCH = "NARRATIVE_BATCH"
    BATCH_STATUS_CHECK = "BATCH_STATUS_CHECK"
    
    @classmethod
    def from_string(cls, job_type_str: str) -> "JobType":
        """Convert string to JobType, with fallback to FULL_PIPELINE."""
        try:
            return cls(job_type_str)
        except ValueError:
            return cls.FULL_PIPELINE

@dataclass
class JobLog:
    entries: List[Dict[str, str]] = field(default_factory=list)
    
    def add_entry(self, level: str, message: str):
        """Add a log entry with timestamp."""
        self.entries.append({
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "message": message
        })
    
    def get_latest(self, count: int = 10) -> List[Dict[str, str]]:
        """Get the latest N log entries."""
        return self.entries[-count:] if self.entries else []

@dataclass
class Job:
    job_id: str
    conversation_id: str
    status: JobStatus = JobStatus.PENDING
    job_type: JobType = JobType.FULL_PIPELINE
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    worker_id: Optional[str] = None
    version: int = 1
    logs: JobLog = field(default_factory=JobLog)
    job_config: Dict[str, Any] = field(default_factory=dict)
    job_results: Dict[str, Any] = field(default_factory=dict)
    
    # For batch jobs
    batch_id: Optional[str] = None
    batch_job_id: Optional[str] = None
    batch_check_time: Optional[str] = None
    
    # Additional fields
    report_id: Optional[str] = None
    timeout_seconds: int = 3600
    environment: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert job to DynamoDB format dictionary."""
        result = {
            "job_id": self.job_id,
            "conversation_id": self.conversation_id,
            "status": self.status.value,
            "job_type": self.job_type.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "version": self.version,
            "logs": json.dumps({"entries": self.logs.entries}),
            "job_config": json.dumps(self.job_config)
        }
        
        # Add optional fields if they exist
        if self.started_at:
            result["started_at"] = self.started_at
        if self.completed_at:
            result["completed_at"] = self.completed_at
        if self.worker_id:
            result["worker_id"] = self.worker_id
        if self.job_results:
            result["job_results"] = json.dumps(self.job_results)
        if self.batch_id:
            result["batch_id"] = self.batch_id
        if self.batch_job_id:
            result["batch_job_id"] = self.batch_job_id
        if self.batch_check_time:
            result["batch_check_time"] = self.batch_check_time
        if self.report_id:
            result["report_id"] = self.report_id
        if self.environment:
            result["environment"] = self.environment
        
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Job":
        """Create a Job from a DynamoDB item dictionary."""
        # Extract basic fields
        job = cls(
            job_id=data["job_id"],
            conversation_id=data["conversation_id"],
            status=JobStatus(data.get("status", "PENDING")),
            job_type=JobType.from_string(data.get("job_type", "FULL_PIPELINE")),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            worker_id=data.get("worker_id"),
            version=int(data.get("version", 1)),
            report_id=data.get("report_id"),
            timeout_seconds=int(data.get("timeout_seconds", 3600))
        )
        
        # Parse logs
        if "logs" in data:
            try:
                logs_data = json.loads(data["logs"])
                job.logs.entries = logs_data.get("entries", [])
            except (json.JSONDecodeError, TypeError):
                job.logs = JobLog()
        
        # Parse job_config
        if "job_config" in data:
            try:
                job.job_config = json.loads(data["job_config"])
            except (json.JSONDecodeError, TypeError):
                job.job_config = {}
                
        # Parse job_results
        if "job_results" in data:
            try:
                job.job_results = json.loads(data["job_results"])
            except (json.JSONDecodeError, TypeError):
                job.job_results = {}
        
        # Parse batch fields
        job.batch_id = data.get("batch_id")
        job.batch_job_id = data.get("batch_job_id")
        job.batch_check_time = data.get("batch_check_time")
        
        # Parse environment variables
        if "environment" in data and isinstance(data["environment"], dict):
            job.environment = data["environment"]
        
        return job
```

### 2.2. Database Access (db/dynamodb.py)

```python
import boto3
import json
import logging
import os
import time
from botocore.exceptions import ClientError
from typing import Dict, List, Optional, Any, Tuple

from .models import Job, JobStatus

logger = logging.getLogger("delphi.db")

class DynamoDBJobStore:
    """Interface to DynamoDB for job operations."""
    
    # Maximum number of retries for transient errors
    MAX_RETRIES = 3
    # Base delay for exponential backoff in seconds
    BASE_DELAY = 0.5
    
    def __init__(self, endpoint_url=None, region="us-west-2", table_name="Delphi_JobQueue"):
        """Initialize the DynamoDB job store."""
        self.endpoint_url = endpoint_url or os.environ.get("DYNAMODB_ENDPOINT", "http://localhost:8000")
        self.region = region
        self.table_name = table_name
        
        # Set up local development credentials if needed
        if "localhost" in self.endpoint_url or "host.docker.internal" in self.endpoint_url:
            os.environ.setdefault("AWS_ACCESS_KEY_ID", "fakeMyKeyId")
            os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "fakeSecretAccessKey")
        
        # Create DynamoDB resource and table reference
        self.dynamodb = boto3.resource(
            "dynamodb",
            endpoint_url=self.endpoint_url,
            region_name=self.region
        )
        self.table = self.dynamodb.Table(self.table_name)
        
        # Test connection
        try:
            self.table.table_status
            logger.info(f"Connected to DynamoDB table {self.table_name}")
        except Exception as e:
            logger.error(f"Failed to connect to DynamoDB table {self.table_name}: {e}")
            raise
    
    def find_pending_job(self) -> Optional[Job]:
        """Find the oldest pending job."""
        try:
            # First, look for PENDING jobs
            response = self.table.query(
                IndexName="StatusCreatedIndex",
                KeyConditionExpression="#s = :status",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":status": JobStatus.PENDING.value},
                Limit=1,
                ScanIndexForward=True  # Get oldest jobs first
            )
            
            items = response.get("Items", [])
            if items:
                # Get the full item with a consistent read
                job_id = items[0]["job_id"]
                full_item = self.table.get_item(
                    Key={"job_id": job_id},
                    ConsistentRead=True
                )
                
                if "Item" in full_item:
                    return Job.from_dict(full_item["Item"])
            
            return None
        except Exception as e:
            logger.error(f"Error finding pending job: {e}")
            return None
    
    def find_batch_status_jobs(self, limit=5) -> List[Job]:
        """Find NARRATIVE_BATCH jobs in PROCESSING state that need status checks."""
        try:
            # Find PROCESSING jobs
            response = self.table.query(
                IndexName="StatusCreatedIndex",
                KeyConditionExpression="#s = :status",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":status": JobStatus.PROCESSING.value},
                Limit=limit,
                ScanIndexForward=True  # Get oldest jobs first
            )
            
            batch_jobs = []
            for item in response.get("Items", []):
                # Get full item with consistent read
                job_id = item["job_id"]
                full_item = self.table.get_item(
                    Key={"job_id": job_id},
                    ConsistentRead=True
                )
                
                if "Item" in full_item:
                    job_data = full_item["Item"]
                    
                    # Check if this is a NARRATIVE_BATCH job
                    if job_data.get("job_type") == "NARRATIVE_BATCH" and job_data.get("status") == "PROCESSING":
                        batch_jobs.append(Job.from_dict(job_data))
            
            # Sort by created_at
            batch_jobs.sort(key=lambda job: job.created_at)
            return batch_jobs
        
        except Exception as e:
            logger.error(f"Error finding batch status jobs: {e}")
            return []
    
    def claim_job(self, job: Job, worker_id: str, is_batch_check: bool = False) -> Optional[Job]:
        """
        Claim a job for processing using optimistic locking.
        
        Args:
            job: The job to claim
            worker_id: ID of the worker claiming the job
            is_batch_check: Whether this is a batch status check
            
        Returns:
            Updated job if claim successful, None otherwise
        """
        job_id = job.job_id
        current_version = job.version
        
        logger.info(f"Attempting to claim job {job_id}")
        
        for attempt in range(self.MAX_RETRIES):
            try:
                now = datetime.now().isoformat()
                
                # Different update based on job type
                if is_batch_check:
                    # For batch status checks, just update the worker ID and batch_check_time
                    response = self.table.update_item(
                        Key={"job_id": job_id},
                        UpdateExpression="""
                            SET #updated_at = :now,
                                #worker_id = :worker_id,
                                #version = :new_version,
                                batch_check_time = :now
                        """,
                        ConditionExpression="#version = :current_version",
                        ExpressionAttributeNames={
                            "#updated_at": "updated_at",
                            "#worker_id": "worker_id",
                            "#version": "version"
                        },
                        ExpressionAttributeValues={
                            ":now": now,
                            ":worker_id": worker_id,
                            ":current_version": current_version,
                            ":new_version": current_version + 1
                        },
                        ReturnValues="ALL_NEW"
                    )
                else:
                    # For regular pending jobs, change status to PROCESSING
                    response = self.table.update_item(
                        Key={"job_id": job_id},
                        UpdateExpression="""
                            SET #status = :new_status,
                                #updated_at = :now,
                                #started_at = :now,
                                #worker_id = :worker_id,
                                #version = :new_version,
                                completed_at = :empty_str
                        """,
                        ConditionExpression="#status = :old_status AND #version = :current_version",
                        ExpressionAttributeNames={
                            "#status": "status",
                            "#updated_at": "updated_at",
                            "#started_at": "started_at",
                            "#worker_id": "worker_id",
                            "#version": "version"
                        },
                        ExpressionAttributeValues={
                            ":old_status": JobStatus.PENDING.value,
                            ":new_status": JobStatus.PROCESSING.value,
                            ":now": now,
                            ":worker_id": worker_id,
                            ":current_version": current_version,
                            ":new_version": current_version + 1,
                            ":empty_str": ""
                        },
                        ReturnValues="ALL_NEW"
                    )
                
                # Return the updated job if successful
                if "Attributes" in response:
                    logger.info(f"Successfully claimed job {job_id}")
                    return Job.from_dict(response["Attributes"])
                return None
                
            except ClientError as e:
                if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    logger.warning(f"Job {job_id} was already claimed or modified by another worker")
                    return None
                elif attempt < self.MAX_RETRIES - 1:
                    # Retry with exponential backoff for transient errors
                    delay = self.BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Transient error claiming job {job_id}, retrying in {delay}s: {e}")
                    time.sleep(delay)
                else:
                    logger.error(f"Failed to claim job {job_id} after {self.MAX_RETRIES} attempts: {e}")
                    return None
            except Exception as e:
                logger.error(f"Unexpected error claiming job {job_id}: {e}")
                return None
        
        return None
    
    def update_job_logs(self, job: Job, level: str, message: str) -> Tuple[bool, Optional[Job]]:
        """
        Add a log entry to a job and update the database.
        
        Args:
            job: The job to update
            level: Log level (INFO, WARNING, ERROR, etc.)
            message: Log message
            
        Returns:
            (success, updated_job) tuple
        """
        # Add the log entry locally
        job.logs.add_entry(level, message)
        job.updated_at = datetime.now().isoformat()
        
        # Create a new version
        new_version = job.version + 1
        
        # Update in DynamoDB with retries
        for attempt in range(self.MAX_RETRIES):
            try:
                response = self.table.update_item(
                    Key={"job_id": job.job_id},
                    UpdateExpression="SET logs = :logs, updated_at = :updated_at, version = :new_version",
                    ConditionExpression="version = :current_version",
                    ExpressionAttributeValues={
                        ":logs": json.dumps({"entries": job.logs.entries}),
                        ":updated_at": job.updated_at,
                        ":current_version": job.version,
                        ":new_version": new_version
                    },
                    ReturnValues="ALL_NEW"
                )
                
                # Update succeeded
                if "Attributes" in response:
                    updated_job = Job.from_dict(response["Attributes"])
                    return True, updated_job
                
                return False, None
                
            except ClientError as e:
                if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    logger.warning(f"Job {job.job_id} was modified by another process, log update skipped")
                    return False, None
                elif attempt < self.MAX_RETRIES - 1:
                    # Retry with exponential backoff for transient errors
                    delay = self.BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Transient error updating logs for job {job.job_id}, retrying in {delay}s: {e}")
                    time.sleep(delay)
                else:
                    logger.error(f"Failed to update logs for job {job.job_id} after {self.MAX_RETRIES} attempts: {e}")
                    return False, None
            except Exception as e:
                logger.error(f"Unexpected error updating logs for job {job.job_id}: {e}")
                return False, None
        
        return False, None
    
    def complete_job(self, job: Job, success: bool, result: Optional[Dict[str, Any]] = None, 
                    error: Optional[str] = None) -> Tuple[bool, Optional[Job]]:
        """
        Mark a job as completed or failed.
        
        Args:
            job: The job to complete
            success: Whether the job succeeded
            result: Optional result data
            error: Optional error message
            
        Returns:
            (success, updated_job) tuple
        """
        job_id = job.job_id
        current_version = job.version
        new_status = JobStatus.COMPLETED if success else JobStatus.FAILED
        now = datetime.now().isoformat()
        
        # Prepare results
        job_results = {
            "result_type": "SUCCESS" if success else "FAILURE",
            "completed_at": now
        }
        
        if result:
            job_results.update(result)
        
        if error:
            job_results["error"] = str(error)
        
        # Update in DynamoDB with retries
        for attempt in range(self.MAX_RETRIES):
            try:
                response = self.table.update_item(
                    Key={"job_id": job_id},
                    UpdateExpression="""
                        SET #status = :new_status, 
                            updated_at = :now, 
                            completed_at = :now,
                            job_results = :job_results,
                            version = :new_version
                    """,
                    ConditionExpression="version = :current_version",
                    ExpressionAttributeNames={
                        "#status": "status"
                    },
                    ExpressionAttributeValues={
                        ":new_status": new_status.value,
                        ":now": now,
                        ":job_results": json.dumps(job_results),
                        ":current_version": current_version,
                        ":new_version": current_version + 1
                    },
                    ReturnValues="ALL_NEW"
                )
                
                logger.info(f"Job {job_id} marked as {new_status.value}")
                
                if "Attributes" in response:
                    return True, Job.from_dict(response["Attributes"])
                
                return False, None
                
            except ClientError as e:
                if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    logger.warning(f"Job {job_id} was modified by another process, completion state may not be accurate")
                    return False, None
                elif attempt < self.MAX_RETRIES - 1:
                    # Retry with exponential backoff for transient errors
                    delay = self.BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Transient error completing job {job_id}, retrying in {delay}s: {e}")
                    time.sleep(delay)
                else:
                    logger.error(f"Failed to complete job {job_id} after {self.MAX_RETRIES} attempts: {e}")
                    return False, None
            except Exception as e:
                logger.error(f"Unexpected error completing job {job_id}: {e}")
                return False, None
        
        return False, None
    
    def preserve_job_status(self, job: Job, results: Dict[str, Any]) -> Tuple[bool, Optional[Job]]:
        """
        Update job results without changing status (used when scripts modify job status directly).
        
        Args:
            job: The job to update
            results: Result data
            
        Returns:
            (success, updated_job) tuple
        """
        job_id = job.job_id
        
        # First get current job state
        try:
            current_job_response = self.table.get_item(
                Key={"job_id": job_id},
                ConsistentRead=True
            )
            
            if "Item" not in current_job_response:
                logger.error(f"Job {job_id} not found when trying to preserve status")
                return False, None
            
            current_job = Job.from_dict(current_job_response["Item"])
            now = datetime.now().isoformat()
            
            # Only update if we can get the current version
            for attempt in range(self.MAX_RETRIES):
                try:
                    response = self.table.update_item(
                        Key={"job_id": job_id},
                        UpdateExpression="SET job_results = :results, updated_at = :now, version = :new_version",
                        ConditionExpression="version = :current_version",
                        ExpressionAttributeValues={
                            ":results": json.dumps(results),
                            ":now": now,
                            ":current_version": current_job.version,
                            ":new_version": current_job.version + 1
                        },
                        ReturnValues="ALL_NEW"
                    )
                    
                    logger.info(f"Updated job {job_id} with results while preserving status")
                    
                    if "Attributes" in response:
                        return True, Job.from_dict(response["Attributes"])
                    
                    return False, None
                    
                except ClientError as e:
                    if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                        logger.warning(f"Job {job_id} was modified by another process, update skipped")
                        return False, None
                    elif attempt < self.MAX_RETRIES - 1:
                        # Retry with exponential backoff for transient errors
                        delay = self.BASE_DELAY * (2 ** attempt)
                        logger.warning(f"Transient error updating job {job_id}, retrying in {delay}s: {e}")
                        time.sleep(delay)
                    else:
                        logger.error(f"Failed to update job {job_id} after {self.MAX_RETRIES} attempts: {e}")
                        return False, None
                except Exception as e:
                    logger.error(f"Unexpected error updating job {job_id}: {e}")
                    return False, None
            
            return False, None
            
        except Exception as e:
            logger.error(f"Error retrieving current job {job_id} state: {e}")
            return False, None
```

### 2.3. Base Job Handler (handlers/base.py)

```python
import abc
import logging
import os
import subprocess
from typing import Dict, List, Optional, Any, Tuple

from ..db.models import Job
from ..db.dynamodb import DynamoDBJobStore
from ..utils.process import SubprocessExecutor
from ..utils.security import validate_environment_variables

logger = logging.getLogger("delphi.handlers")

class JobHandler(abc.ABC):
    """Base class for job handlers."""
    
    def __init__(self, db_store: DynamoDBJobStore):
        """Initialize the job handler."""
        self.db_store = db_store
    
    @abc.abstractmethod
    def can_handle(self, job: Job) -> bool:
        """Determine if this handler can process the given job."""
        pass
    
    @abc.abstractmethod
    def build_command(self, job: Job) -> List[str]:
        """Build the command to execute for this job."""
        pass
    
    def prepare_environment(self, job: Job) -> Dict[str, str]:
        """Prepare the environment variables for the job."""
        # Start with a copy of the current environment
        env = os.environ.copy()
        
        # Add job-specific environment variables
        env["DELPHI_JOB_ID"] = job.job_id
        report_id = job.report_id or job.conversation_id
        env["DELPHI_REPORT_ID"] = str(report_id)
        
        # Add custom environment variables from the job, if they pass validation
        if job.environment:
            safe_env = validate_environment_variables(job.environment)
            env.update(safe_env)
        
        return env
    
    def process(self, job: Job) -> bool:
        """
        Process the job.
        
        Returns:
            bool: True if processing was successful, False otherwise
        """
        job_id = job.job_id
        conversation_id = job.conversation_id
        
        # Log the start of processing
        success, updated_job = self.db_store.update_job_logs(
            job, "INFO", f"Starting processing of job {job_id} for conversation {conversation_id}"
        )
        
        # Use the updated job if available
        if success and updated_job:
            job = updated_job
        
        try:
            # Build the command
            cmd = self.build_command(job)
            
            # Log the command
            self.db_store.update_job_logs(job, "INFO", f"Executing command: {' '.join(cmd)}")
            
            # Change to the delphi directory
            script_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            os.chdir(script_dir)
            
            # Ensure script permissions if needed
            if os.path.exists("./run_delphi.sh"):
                os.chmod("./run_delphi.sh", 0o755)
            
            # Prepare environment
            env = self.prepare_environment(job)
            
            # Execute the command
            executor = SubprocessExecutor(
                cmd=cmd,
                env=env,
                timeout_seconds=job.timeout_seconds,
                max_output_lines=1000,  # Limit output collection
                job=job,
                db_store=self.db_store
            )
            
            success, result = executor.execute()
            
            # Process completion
            if success:
                # Check if the job status was changed by the script
                try:
                    current_job_response = self.db_store.table.get_item(
                        Key={"job_id": job_id},
                        ConsistentRead=True
                    )
                    
                    if "Item" in current_job_response:
                        current_status = current_job_response["Item"].get("status")
                        original_status = job.status.value
                        
                        if current_status != original_status:
                            # Status was changed by the script, just update results
                            self.db_store.preserve_job_status(job, result)
                        else:
                            # Status not changed, complete normally
                            self.db_store.complete_job(job, True, result=result)
                    else:
                        logger.error(f"Job {job_id} not found after execution")
                except Exception as e:
                    logger.error(f"Error checking job status: {e}")
                    # Try to complete anyway
                    self.db_store.complete_job(job, True, result=result)
            else:
                # Job failed
                error_message = result.get("error", "Unknown error")
                self.db_store.complete_job(job, False, result=result, error=error_message)
            
            return success
            
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            self.db_store.update_job_logs(job, "ERROR", str(e))
            self.db_store.complete_job(job, False, error=f"Error running job process: {str(e)}")
            return False
```

### 2.4. Process Execution Utility (utils/process.py)

```python
import logging
import os
import select
import subprocess
import time
from typing import Dict, List, Optional, Any, Tuple

from ..db.models import Job
from ..db.dynamodb import DynamoDBJobStore

logger = logging.getLogger("delphi.process")

class SubprocessExecutor:
    """Safely execute and monitor subprocesses for jobs."""
    
    def __init__(self, cmd: List[str], env: Dict[str, str], timeout_seconds: int,
                 max_output_lines: int, job: Job, db_store: DynamoDBJobStore):
        """Initialize the subprocess executor."""
        self.cmd = cmd
        self.env = env
        self.timeout_seconds = timeout_seconds
        self.max_output_lines = max_output_lines
        self.job = job
        self.db_store = db_store
        
        # Initialize output collections with size limits
        self.stdout_lines = []
        self.stderr_lines = []
    
    def add_stdout_line(self, line: str):
        """Add a line to stdout collection with size limit."""
        if line:
            self.stdout_lines.append(line)
            # Keep only the last N lines
            if len(self.stdout_lines) > self.max_output_lines:
                self.stdout_lines = self.stdout_lines[-self.max_output_lines:]
            
            # Log significant lines
            if any(keyword in line for keyword in ["ERROR", "WARNING", "pipeline completed"]):
                level = "ERROR" if "ERROR" in line else "WARNING" if "WARNING" in line else "INFO"
                self.db_store.update_job_logs(self.job, level, line)
    
    def add_stderr_line(self, line: str):
        """Add a line to stderr collection with size limit."""
        if line:
            self.stderr_lines.append(line)
            # Keep only the last N lines
            if len(self.stderr_lines) > self.max_output_lines:
                self.stderr_lines = self.stderr_lines[-self.max_output_lines:]
            
            # Log all stderr as errors
            self.db_store.update_job_logs(self.job, "ERROR", line)
    
    def execute(self) -> Tuple[bool, Dict[str, Any]]:
        """
        Execute the subprocess with monitoring.
        
        Returns:
            (success, result) tuple
        """
        logger.info(f"Running command: {' '.join(self.cmd)}")
        
        try:
            # Start the process
            process = subprocess.Popen(
                self.cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=self.env,
                cwd=os.getcwd()  # Ensure we use the current directory
            )
            
            # Track start time for timeout
            start_time = time.time()
            return_code = None
            
            try:
                # Use select for non-blocking reads from stdout/stderr
                while process.poll() is None:
                    # Check for timeout
                    elapsed_time = time.time() - start_time
                    if elapsed_time > self.timeout_seconds:
                        raise TimeoutError(f"Process timed out after {self.timeout_seconds} seconds")
                    
                    # Try to read output without blocking
                    readable, _, _ = select.select([process.stdout, process.stderr], [], [], 1.0)
                    
                    if process.stdout in readable:
                        line = process.stdout.readline().strip()
                        self.add_stdout_line(line)
                    
                    if process.stderr in readable:
                        line = process.stderr.readline().strip()
                        self.add_stderr_line(line)
                
                # Process completed before timeout
                return_code = process.poll()
                
            except TimeoutError as e:
                logger.error(f"Process timed out after {self.timeout_seconds} seconds")
                self.db_store.update_job_logs(
                    self.job, "ERROR", 
                    f"Process timed out after {self.timeout_seconds} seconds, terminating"
                )
                
                # Try to terminate gracefully, then forcefully
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                
                return_code = -1  # Special code for timeout
                
            finally:
                # Collect any remaining output if the process exited normally
                if return_code is not None and return_code != -1:
                    # Read any remaining output
                    remaining_stdout, remaining_stderr = process.communicate()
                    
                    # Process remaining lines
                    if remaining_stdout:
                        for line in remaining_stdout.splitlines():
                            self.add_stdout_line(line.strip())
                    
                    if remaining_stderr:
                        for line in remaining_stderr.splitlines():
                            self.add_stderr_line(line.strip())
            
            # Determine success and prepare result
            success = return_code == 0
            
            # Get the report ID that was used
            report_id = self.env.get("DELPHI_REPORT_ID", self.job.conversation_id)
            
            # Build the result dictionary
            result = {
                "return_code": return_code,
                "output_summary": "\n".join(self.stdout_lines[-10:]) if self.stdout_lines else "No output",
                "visualization_path": f"visualizations/{report_id}/{self.job.job_id}",
                "report_id": report_id,
                "visualization_urls": {
                    "interactive": f"{os.environ.get('AWS_S3_ENDPOINT', '')}/{os.environ.get('AWS_S3_BUCKET_NAME', 'delphi')}/visualizations/{report_id}/{self.job.job_id}/layer_0_datamapplot.html"
                },
                "execution_finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")
            }
            
            # Add error message for timeout
            if return_code == -1:
                result["error"] = f"Process timed out after {self.timeout_seconds} seconds"
            elif not success:
                result["error"] = f"Process exited with code {return_code}"
            
            return success, result
            
        except Exception as e:
            logger.error(f"Error executing process: {e}")
            return False, {"error": str(e), "return_code": -2}
```

### 2.5. Security Utility (utils/security.py)

```python
import logging
import re
from typing import Dict, List, Set

logger = logging.getLogger("delphi.security")

# List of allowed environment variable prefixes
ALLOWED_ENV_PREFIXES = [
    "DELPHI_",
    "AWS_",
    "ANTHROPIC_",
    "OPENAI_",
    "OLLAMA_",
    "PYTHONPATH"
]

# Regular expression for validating environment variable names
ENV_NAME_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

# Maximum environment variable value length
MAX_ENV_VALUE_LENGTH = 1024

def validate_environment_variables(env_vars: Dict[str, str]) -> Dict[str, str]:
    """
    Validate and sanitize environment variables.
    
    Args:
        env_vars: Dictionary of environment variables
        
    Returns:
        Dictionary of validated variables
    """
    valid_vars = {}
    
    for name, value in env_vars.items():
        # Check if name is valid
        if not ENV_NAME_PATTERN.match(name):
            logger.warning(f"Invalid environment variable name: {name}")
            continue
        
        # Check if name has an allowed prefix
        if not any(name.startswith(prefix) for prefix in ALLOWED_ENV_PREFIXES):
            logger.warning(f"Environment variable {name} does not have an allowed prefix")
            continue
        
        # Check value length
        if len(str(value)) > MAX_ENV_VALUE_LENGTH:
            logger.warning(f"Environment variable {name} value exceeds maximum length")
            continue
        
        # Variable passed all checks
        valid_vars[name] = str(value)
    
    return valid_vars
```

### 2.6. Specific Job Handlers

#### Pipeline Handler (handlers/pipeline.py)

```python
import logging
import json
from typing import List

from .base import JobHandler
from ..db.models import Job, JobType

logger = logging.getLogger("delphi.handlers.pipeline")

class PipelineJobHandler(JobHandler):
    """Handler for standard pipeline jobs."""
    
    def can_handle(self, job: Job) -> bool:
        """Determine if this handler can process the given job."""
        return job.job_type == JobType.FULL_PIPELINE
    
    def build_command(self, job: Job) -> List[str]:
        """Build the command to execute for this job."""
        cmd = ["./run_delphi.sh", f"--zid={job.conversation_id}"]
        
        # Add arguments from job_config
        if job.job_config:
            # Process nested configuration
            if "stages" in job.job_config:
                for stage in job.job_config["stages"]:
                    if stage["stage"] == "PCA" and "config" in stage:
                        pca_config = stage["config"]
                        if "max_votes" in pca_config:
                            cmd.append(f"--max-votes={pca_config['max_votes']}")
                        if "batch_size" in pca_config:
                            cmd.append(f"--batch-size={pca_config['batch_size']}")
            
            # Process direct configuration
            if "max_votes" in job.job_config:
                cmd.append(f"--max-votes={job.job_config['max_votes']}")
            if "batch_size" in job.job_config:
                cmd.append(f"--batch-size={job.job_config['batch_size']}")
        
        return cmd
```

#### Narrative Batch Handler (handlers/narrative.py)

```python
import logging
from typing import List

from .base import JobHandler
from ..db.models import Job, JobType, JobStatus

logger = logging.getLogger("delphi.handlers.narrative")

class NarrativeBatchHandler(JobHandler):
    """Handler for narrative batch jobs."""
    
    def can_handle(self, job: Job) -> bool:
        """Determine if this handler can process the given job."""
        # Handle both the new style (CREATE_NARRATIVE_BATCH) and 
        # old style (NARRATIVE_BATCH) job types
        if job.job_type == JobType.NARRATIVE_BATCH:
            # Old style, needs to be in PENDING state
            return job.status == JobStatus.PENDING
        elif job.job_type.value == "CREATE_NARRATIVE_BATCH":
            # New style explicit batch creation
            return True
        return False
    
    def build_command(self, job: Job) -> List[str]:
        """Build the command to execute for this job."""
        # Extract batch configuration
        model = "claude-3-5-sonnet-20241022"  # Default model
        max_batch_size = 20  # Default batch size
        no_cache = False  # Default cache behavior
        
        # Look for configuration in job_config
        if job.job_config and "stages" in job.job_config:
            for stage in job.job_config["stages"]:
                if stage["stage"] == "NARRATIVE_BATCH" and "config" in stage:
                    config = stage["config"]
                    model = config.get("model", model)
                    max_batch_size = config.get("max_batch_size", max_batch_size)
                    no_cache = config.get("no_cache", no_cache)
        
        # Build the command
        cmd = [
            "python", 
            "/app/umap_narrative/801_narrative_report_batch.py",
            f"--conversation_id={job.conversation_id}",
            f"--model={model}",
            f"--max-batch-size={max_batch_size}"
        ]
        
        if no_cache:
            cmd.append("--no-cache")
        
        return cmd
```

#### Batch Status Handler (handlers/batch_status.py)

```python
import logging
from typing import List

from .base import JobHandler
from ..db.models import Job, JobType, JobStatus

logger = logging.getLogger("delphi.handlers.batch_status")

class BatchStatusHandler(JobHandler):
    """Handler for checking batch status."""
    
    def can_handle(self, job: Job) -> bool:
        """Determine if this handler can process the given job."""
        # Handle both the new style (AWAITING_NARRATIVE_BATCH) and
        # old style (NARRATIVE_BATCH in PROCESSING status) job types
        if job.job_type == JobType.NARRATIVE_BATCH and job.status == JobStatus.PROCESSING:
            # Old style batch status check
            return True
        elif job.job_type.value == "AWAITING_NARRATIVE_BATCH":
            # New style explicit batch status check
            return True
        return False
    
    def build_command(self, job: Job) -> List[str]:
        """Build the command to execute for this job."""
        # Build the command for checking batch status
        cmd = ["python", "/app/umap_narrative/803_check_batch_status.py"]
        
        # Use batch_job_id if available, otherwise use current job_id
        job_id = job.batch_job_id if job.batch_job_id else job.job_id
        cmd.append(f"--job-id={job_id}")
        
        return cmd
```

### 2.7. Job Handler Registry (handlers/__init__.py)

```python
import logging
from typing import List, Optional

from ..db.models import Job
from ..db.dynamodb import DynamoDBJobStore
from .base import JobHandler
from .pipeline import PipelineJobHandler
from .narrative import NarrativeBatchHandler
from .batch_status import BatchStatusHandler

logger = logging.getLogger("delphi.handlers")

class JobHandlerRegistry:
    """Registry of job handlers."""
    
    def __init__(self, db_store: DynamoDBJobStore):
        """Initialize the job handler registry."""
        self.db_store = db_store
        self.handlers = [
            PipelineJobHandler(db_store),
            NarrativeBatchHandler(db_store),
            BatchStatusHandler(db_store)
        ]
    
    def get_handler(self, job: Job) -> Optional[JobHandler]:
        """Get the appropriate handler for a job."""
        for handler in self.handlers:
            if handler.can_handle(job):
                return handler
        
        logger.warning(f"No handler found for job type {job.job_type}")
        return None
```

### 2.8. Worker Implementation (poller/worker.py)

```python
import logging
import time
import uuid
from typing import Optional

from ..db.dynamodb import DynamoDBJobStore
from ..handlers import JobHandlerRegistry

logger = logging.getLogger("delphi.worker")

class Worker:
    """Worker process that claims and processes jobs."""
    
    def __init__(self, db_store: DynamoDBJobStore, interval: int = 10):
        """
        Initialize a worker.
        
        Args:
            db_store: DynamoDB job store
            interval: Polling interval in seconds
        """
        self.db_store = db_store
        self.interval = interval
        self.worker_id = str(uuid.uuid4())
        self.running = True
        self.handler_registry = JobHandlerRegistry(db_store)
    
    def process_batch_status_jobs(self) -> bool:
        """
        Find and process a batch status job.
        
        Returns:
            bool: True if a job was processed, False otherwise
        """
        # Find batch status jobs
        batch_jobs = self.db_store.find_batch_status_jobs(limit=3)
        
        if not batch_jobs:
            return False
        
        # Try to claim the oldest job
        job = batch_jobs[0]
        claimed_job = self.db_store.claim_job(job, self.worker_id, is_batch_check=True)
        
        if not claimed_job:
            return False
        
        # Get the appropriate handler
        handler = self.handler_registry.get_handler(claimed_job)
        
        if not handler:
            logger.warning(f"No handler available for batch status job {claimed_job.job_id}")
            return False
        
        # Process the job
        try:
            handler.process(claimed_job)
            return True
        except Exception as e:
            logger.error(f"Error processing batch status job {claimed_job.job_id}: {e}")
            return False
    
    def process_pending_job(self) -> bool:
        """
        Find and process a pending job.
        
        Returns:
            bool: True if a job was processed, False otherwise
        """
        # Find a pending job
        job = self.db_store.find_pending_job()
        
        if not job:
            return False
        
        # Try to claim it
        claimed_job = self.db_store.claim_job(job, self.worker_id)
        
        if not claimed_job:
            return False
        
        # Get the appropriate handler
        handler = self.handler_registry.get_handler(claimed_job)
        
        if not handler:
            logger.warning(f"No handler available for job {claimed_job.job_id}")
            # Mark the job as failed
            self.db_store.complete_job(
                claimed_job, 
                False, 
                error=f"No handler available for job type {claimed_job.job_type}"
            )
            return False
        
        # Process the job
        try:
            handler.process(claimed_job)
            return True
        except Exception as e:
            logger.error(f"Error processing job {claimed_job.job_id}: {e}")
            return False
    
    def run(self):
        """Run the worker loop."""
        logger.info(f"Starting worker with ID {self.worker_id}")
        
        while self.running:
            try:
                # First check for batch status jobs
                if self.process_batch_status_jobs():
                    # Found and processed a batch status job
                    continue
                
                # Then check for pending jobs
                if self.process_pending_job():
                    # Found and processed a pending job
                    continue
                
                # No jobs found, wait before polling again
                time.sleep(self.interval)
                
            except Exception as e:
                logger.error(f"Error in worker loop: {e}")
                time.sleep(self.interval)
    
    def stop(self):
        """Stop the worker."""
        logger.info(f"Stopping worker {self.worker_id}")
        self.running = False
```

### 2.9. Main Poller Script (scripts/job_poller.py)

```python
#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the Delphi_JobQueue for pending jobs
and execute them.

Usage:
    python job_poller.py [options]

Options:
    --endpoint-url=URL  DynamoDB endpoint URL (default: http://localhost:8000)
    --region=REGION     AWS region (default: us-west-2)
    --interval=SECONDS  Polling interval in seconds (default: 10)
    --max-workers=N     Maximum number of concurrent workers (default: 1)
    --log-level=LEVEL   Logging level (default: INFO)
"""

import argparse
import logging
import os
import signal
import sys
import threading
import time

from job_system.db.dynamodb import DynamoDBJobStore
from job_system.poller.worker import Worker
from job_system.utils.logging import configure_logging

# Global flag for graceful shutdown
running = True

def signal_handler(sig, frame):
    """Handle exit signals gracefully."""
    global running
    running = False
    logging.info("Shutting down gracefully...")

def main():
    """Main entry point for the job poller."""
    # Parse arguments
    parser = argparse.ArgumentParser(description='Delphi Job Poller Service')
    parser.add_argument('--endpoint-url', type=str, default=None,
                       help='DynamoDB endpoint URL')
    parser.add_argument('--region', type=str, default='us-west-2',
                       help='AWS region')
    parser.add_argument('--interval', type=int, default=10,
                       help='Polling interval in seconds')
    parser.add_argument('--max-workers', type=int, default=1,
                       help='Maximum number of concurrent workers')
    parser.add_argument('--log-level', type=str, default='INFO',
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                       help='Logging level')
    
    args = parser.parse_args()
    
    # Configure logging
    configure_logging(args.log_level)
    logger = logging.getLogger("delphi.poller")
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("Starting Delphi Job Poller Service")
    logger.info(f"Endpoint URL: {args.endpoint_url or os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')}")
    logger.info(f"Region: {args.region}")
    logger.info(f"Polling interval: {args.interval} seconds")
    logger.info(f"Maximum workers: {args.max_workers}")
    
    try:
        # Initialize job store
        db_store = DynamoDBJobStore(
            endpoint_url=args.endpoint_url,
            region=args.region
        )
        
        # Create workers
        workers = []
        for i in range(args.max_workers):
            worker = Worker(db_store, interval=args.interval)
            thread = threading.Thread(
                target=worker.run,
                daemon=True
            )
            thread.start()
            workers.append((worker, thread))
            logger.info(f"Started worker {i+1}")
        
        # Keep main thread alive until signaled to stop
        while running and any(thread.is_alive() for _, thread in workers):
            time.sleep(1)
        
        # Stop all workers
        for worker, _ in workers:
            worker.stop()
        
        logger.info("All workers have stopped. Exiting.")
    except Exception as e:
        logger.error(f"Error in main function: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

## 3. Configuration and Utilities

### 3.1. Configuration (config.py)

```python
import os
from typing import Dict, Any, Optional

class Config:
    """Configuration management for the job system."""
    
    def __init__(self):
        """Initialize default configuration."""
        self.settings = {
            # Database settings
            "dynamodb_endpoint": os.environ.get("DYNAMODB_ENDPOINT", "http://localhost:8000"),
            "dynamodb_region": os.environ.get("AWS_REGION", "us-west-2"),
            "table_name": "Delphi_JobQueue",
            
            # Worker settings
            "polling_interval": int(os.environ.get("DELPHI_POLLING_INTERVAL", "10")),
            "max_workers": int(os.environ.get("DELPHI_MAX_WORKERS", "1")),
            
            # Process settings
            "default_timeout": int(os.environ.get("DELPHI_DEFAULT_TIMEOUT", "3600")),
            "max_output_lines": int(os.environ.get("DELPHI_MAX_OUTPUT_LINES", "1000")),
            
            # Path settings
            "run_delphi_path": os.environ.get("DELPHI_RUN_SCRIPT", "./run_delphi.sh"),
            "narrative_batch_script": os.environ.get(
                "DELPHI_NARRATIVE_BATCH_SCRIPT", 
                "/app/umap_narrative/801_narrative_report_batch.py"
            ),
            "batch_status_script": os.environ.get(
                "DELPHI_BATCH_STATUS_SCRIPT", 
                "/app/umap_narrative/803_check_batch_status.py"
            ),
            
            # Default job settings
            "default_model": os.environ.get("DELPHI_DEFAULT_MODEL", "claude-3-5-sonnet-20241022"),
            "default_batch_size": int(os.environ.get("DELPHI_DEFAULT_BATCH_SIZE", "20")),
        }
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.settings.get(key, default)
    
    def update(self, settings: Dict[str, Any]):
        """Update configuration with new settings."""
        self.settings.update(settings)
    
    def from_env(self, prefix: str = "DELPHI_"):
        """Load configuration from environment variables with a given prefix."""
        for key, value in os.environ.items():
            if key.startswith(prefix):
                # Convert to lower case and remove prefix
                config_key = key[len(prefix):].lower()
                
                # Convert numeric values
                if value.isdigit():
                    value = int(value)
                elif value.lower() in ("true", "false"):
                    value = value.lower() == "true"
                
                self.settings[config_key] = value

# Global configuration instance
config = Config()
```

### 3.2. Enhanced Logging (utils/logging.py)

```python
import logging
import sys
from typing import Optional

def configure_logging(level: str = "INFO", log_file: Optional[str] = None):
    """
    Configure logging for the job system.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional path to log file
    """
    # Set numeric level
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    # Clear existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create formatter
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Create file handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(numeric_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    
    # Configure specific loggers
    for logger_name in [
        "delphi", 
        "delphi.db", 
        "delphi.handlers", 
        "delphi.poller", 
        "delphi.worker",
        "delphi.process",
        "delphi.security"
    ]:
        logger = logging.getLogger(logger_name)
        logger.setLevel(numeric_level)
```

## 4. Implementation Plan

1. **Phase 1: Create Directory Structure and Core Components**
   - Create directory structure
   - Implement db/models.py
   - Implement db/dynamodb.py
   - Implement utils/logging.py
   - Implement utils/security.py
   - Write basic tests for core components

2. **Phase 2: Implement Handlers and Process Management**
   - Implement handlers/base.py
   - Implement utils/process.py
   - Implement job type handlers
   - Implement handlers registry
   - Write tests for handlers

3. **Phase 3: Implement Worker and Poller**
   - Implement poller/worker.py
   - Implement config.py
   - Create new job_poller.py entry point
   - Write integration tests

4. **Phase 4: Migration and Deployment**
   - Create migration script to move from old to new system
   - Update documentation
   - Create new startup scripts
   - Monitor performance

## 5. Key Improvements

1. **Separation of Concerns**:
   - Database operations are isolated in a dedicated module
   - Each job type has its own handler
   - Process management is in a dedicated utility

2. **Enhanced Security**:
   - Environment variables are validated and sanitized
   - Subprocess execution is more carefully managed
   - Hard-coded credentials are now configurable

3. **Improved Error Handling**:
   - Retry mechanisms for transient errors
   - Better exception handling
   - More detailed error logging

4. **Better Resource Management**:
   - Limited output collection to prevent memory issues
   - Configurable timeouts and limits
   - Cleaner process termination

5. **Extensibility**:
   - Adding new job types only requires creating a new handler
   - Configuration is centralized and extensible
   - Common utilities are reusable across components

6. **Code Quality**:
   - More consistent coding style
   - Better documentation
   - Type hints for better IDE support and validation

## 6. Testing Strategy

1. **Unit Tests**:
   - Test each component in isolation
   - Mock external dependencies
   - Test error handling paths

2. **Integration Tests**:
   - Test interactions between components
   - Test job processing workflow
   - Test concurrency with multiple workers

3. **System Tests**:
   - End-to-end tests with real DynamoDB
   - Test job submission and processing

## 7. Deployment and Rollout

1. **Parallel Deployment**:
   - Deploy new system alongside old system
   - Process jobs with both systems during transition
   - Compare results for consistency

2. **Gradual Migration**:
   - First migrate low-priority job types
   - Then migrate critical job types
   - Finally switch to new system completely

3. **Monitoring**:
   - Add metrics for job processing time
   - Monitor worker utilization
   - Track error rates and failures

## Conclusion

This refactoring transforms the monolithic job poller into a modular, maintainable system that addresses the issues with the current implementation. The new architecture provides better separation of concerns, improved security, and enhanced extensibility while maintaining backward compatibility with existing job types and workflows.