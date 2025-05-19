"""
DynamoDB client for the Delphi job system.
"""

import boto3
import json
import logging
import os
import time
from botocore.exceptions import ClientError
from datetime import datetime
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