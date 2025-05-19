"""
Worker implementation for the Delphi job system.
"""

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