"""
Job handlers for the Delphi job system.
"""

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