"""
Process execution utilities for the Delphi job system.
"""

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