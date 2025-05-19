"""
Base job handler for the Delphi job system.
"""

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