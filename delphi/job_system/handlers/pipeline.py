"""
Pipeline job handler for the Delphi job system.
"""

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