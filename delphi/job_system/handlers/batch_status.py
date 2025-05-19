"""
Batch status job handler for the Delphi job system.
"""

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