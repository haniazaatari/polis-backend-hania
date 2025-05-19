"""
Narrative batch job handler for the Delphi job system.
"""

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