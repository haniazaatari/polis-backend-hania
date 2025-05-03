#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the Delphi_JobQueue for pending jobs
and execute them using run_delphi.sh.

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
import boto3
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('delphi_poller')

# Global flag for graceful shutdown
running = True

class JobProcessor:
    """Process jobs from the Delphi_JobQueue."""
    
    def __init__(self, endpoint_url=None, region='us-west-2'):
        """Initialize the job processor."""
        self.endpoint_url = endpoint_url or os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')
        self.region = region
        self.worker_id = str(uuid.uuid4())
        
        # Set up DynamoDB client
        if 'localhost' in self.endpoint_url or 'host.docker.internal' in self.endpoint_url:
            # For local development
            os.environ.setdefault('AWS_ACCESS_KEY_ID', 'fakeMyKeyId')
            os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
        
        logger.info(f"Connecting to DynamoDB at {self.endpoint_url}")
        self.dynamodb = boto3.resource('dynamodb', 
                                     endpoint_url=self.endpoint_url, 
                                     region_name=self.region)
        self.table = self.dynamodb.Table('Delphi_JobQueue')
        
        # Ensure we can connect to the table
        try:
            self.table.table_status
            logger.info("Successfully connected to Delphi_JobQueue table")
        except Exception as e:
            logger.error(f"Failed to connect to Delphi_JobQueue table: {e}")
            raise
    
    def find_pending_job(self):
        """Find a pending job to process."""
        try:
            # Query the secondary index for PENDING jobs
            response = self.table.query(
                IndexName='StatusCreatedIndex',
                KeyConditionExpression='#s = :status',
                ExpressionAttributeNames={
                    '#s': 'status'
                },
                ExpressionAttributeValues={
                    ':status': 'PENDING'
                },
                Limit=1,
                ScanIndexForward=True  # Get oldest jobs first
            )
            
            items = response.get('Items', [])
            if items:
                # Now do a consistent read to get the full item
                job_id = items[0]['job_id']
                full_item = self.table.get_item(
                    Key={
                        'job_id': job_id
                    },
                    ConsistentRead=True  # Important for distributed systems
                )
                
                if 'Item' in full_item:
                    return full_item['Item']
                    
            return None
        except Exception as e:
            logger.error(f"Error finding pending job: {e}")
            return None
    
    def claim_job(self, job):
        """Attempt to claim a job for processing using optimistic locking."""
        job_id = job['job_id']
        current_version = job.get('version', 1)
        
        try:
            # Update the job status using optimistic locking with conditional update
            now = datetime.now().isoformat()
            
            # Try to atomically update the job status
            try:
                response = self.table.update_item(
                    Key={
                        'job_id': job_id
                    },
                    UpdateExpression='''
                        SET #status = :new_status, 
                            #updated_at = :now, 
                            #started_at = :now,
                            #worker_id = :worker_id,
                            #version = :new_version,
                            completed_at = :empty_str
                    ''',
                    ConditionExpression='#status = :old_status AND #version = :current_version',
                    ExpressionAttributeNames={
                        '#status': 'status',
                        '#updated_at': 'updated_at',
                        '#started_at': 'started_at',
                        '#worker_id': 'worker_id',
                        '#version': 'version'
                    },
                    ExpressionAttributeValues={
                        ':old_status': 'PENDING',
                        ':new_status': 'PROCESSING',
                        ':now': now,
                        ':worker_id': self.worker_id,
                        ':current_version': current_version,
                        ':new_version': current_version + 1,
                        ':empty_str': ""
                    },
                    ReturnValues='ALL_NEW'  # Get the updated item
                )
                
                if 'Attributes' not in response:
                    logger.warning(f"Failed to claim job {job_id}")
                    return None
                
                # Get the updated job with the new status
                updated_job = response['Attributes']
                logger.info(f"Successfully claimed job {job_id}")
                return updated_job
                
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    logger.warning(f"Job {job_id} was already claimed or modified by another worker")
                else:
                    logger.error(f"Error claiming job {job_id}: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Unexpected error claiming job {job_id}: {e}")
            return None
    
    def update_job_logs(self, job, log_entry, mirror_to_console=True):
        """
        Add a log entry to the job logs with optimistic locking.
        
        Args:
            job: The job dictionary
            log_entry: Dictionary with level and message
            mirror_to_console: Whether to also print the log to console (default: True)
        """
        try:
            # Get current logs and version
            current_logs = json.loads(job.get('logs', '{}'))
            current_version = job.get('version', 1)
            
            if not current_logs:
                current_logs = {'entries': []}
            
            # Ensure entries exists
            if 'entries' not in current_logs:
                current_logs['entries'] = []
            
            # Add new entry
            level = log_entry.get('level', 'INFO')
            message = log_entry.get('message', '')
            timestamp = datetime.now().isoformat()
            
            current_logs['entries'].append({
                'timestamp': timestamp,
                'level': level,
                'message': message
            })
            
            # Mirror to console if requested
            if mirror_to_console:
                # ANSI color codes for different log levels
                colors = {
                    'DEBUG': '\033[36m',    # Cyan
                    'INFO': '\033[32m',     # Green
                    'WARNING': '\033[33m',  # Yellow
                    'ERROR': '\033[31m',    # Red
                    'CRITICAL': '\033[31;1m'  # Bright Red
                }
                reset = '\033[0m'  # Reset color
                
                # Use color for the level if available
                color = colors.get(level, '')
                
                # Create a short job ID for easier reading (first 8 chars)
                short_job_id = job['job_id'][:8] if len(job['job_id']) > 8 else job['job_id']
                
                # Print to console with color and short job ID
                print(f"{color}[DELPHI JOB {short_job_id}] {level}{reset}: {message}")
            
            # Keep only last 50 entries
            if len(current_logs['entries']) > 50:
                current_logs['entries'] = current_logs['entries'][-50:]
            
            # Update DynamoDB with optimistic locking
            try:
                response = self.table.update_item(
                    Key={
                        'job_id': job['job_id']
                    },
                    UpdateExpression='SET logs = :logs, updated_at = :updated_at, version = :new_version',
                    ConditionExpression='version = :current_version',
                    ExpressionAttributeValues={
                        ':logs': json.dumps(current_logs),
                        ':updated_at': datetime.now().isoformat(),
                        ':current_version': current_version,
                        ':new_version': current_version + 1
                    },
                    ReturnValues='ALL_NEW'
                )
                
                # Update the job reference with the new version
                if 'Attributes' in response:
                    job.update(response['Attributes'])
                
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    logger.warning(f"Job {job['job_id']} was modified by another process, log update skipped")
                else:
                    raise
        except Exception as e:
            logger.error(f"Error updating job logs: {e}")
    
    def complete_job(self, job, success, result=None, error=None):
        """Mark a job as completed or failed using optimistic locking."""
        job_id = job['job_id']
        current_version = job.get('version', 1)
        new_status = 'COMPLETED' if success else 'FAILED'
        now = datetime.now().isoformat()
        
        try:
            # Prepare results
            job_results = {
                'result_type': 'SUCCESS' if success else 'FAILURE',
                'completed_at': now
            }
            
            if result:
                job_results.update(result)
            
            if error:
                job_results['error'] = str(error)
            
            # Update the job with the new status using optimistic locking
            try:
                response = self.table.update_item(
                    Key={
                        'job_id': job_id
                    },
                    UpdateExpression='''
                        SET #status = :new_status, 
                            updated_at = :now, 
                            completed_at = :now,
                            job_results = :job_results,
                            version = :new_version
                    ''',
                    ConditionExpression='version = :current_version',
                    ExpressionAttributeNames={
                        '#status': 'status'
                    },
                    ExpressionAttributeValues={
                        ':new_status': new_status,
                        ':now': now,
                        ':job_results': json.dumps(job_results),
                        ':current_version': current_version,
                        ':new_version': current_version + 1
                    },
                    ReturnValues='ALL_NEW'
                )
                
                logger.info(f"Job {job_id} marked as {new_status}")
                return response.get('Attributes')
                
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    logger.warning(f"Job {job_id} was modified by another process, completion state may not be accurate")
                else:
                    raise
        except Exception as e:
            logger.error(f"Error completing job {job_id}: {e}")
    
    def process_job(self, job):
        """Process a job using run_delphi.sh."""
        job_id = job['job_id']
        conversation_id = job['conversation_id']
        
        # Set a default timeout if not specified in the job
        timeout_seconds = job.get('timeout_seconds', 3600)  # Default 1 hour timeout
        
        logger.info(f"Processing job {job_id} for conversation {conversation_id} with timeout {timeout_seconds}s")
        
        # Update log with processing start
        self.update_job_logs(job, {
            'level': 'INFO',
            'message': f'Starting processing of conversation {conversation_id}'
        })
        
        try:
            # Get job configuration
            job_config = json.loads(job.get('job_config', '{}'))
            
            # Build command for run_delphi.sh
            cmd = ['./run_delphi.sh', f'--zid={conversation_id}']
            
            # Add any additional arguments from job_config
            if job_config:
                # Full pipeline configuration
                if 'stages' in job_config:
                    for stage in job_config['stages']:
                        if stage['stage'] == 'PCA' and 'config' in stage:
                            pca_config = stage['config']
                            if 'max_votes' in pca_config:
                                cmd.append(f"--max-votes={pca_config['max_votes']}")
                            if 'batch_size' in pca_config:
                                cmd.append(f"--batch-size={pca_config['batch_size']}")
                
                # Direct configuration
                if 'max_votes' in job_config:
                    cmd.append(f"--max-votes={job_config['max_votes']}")
                if 'batch_size' in job_config:
                    cmd.append(f"--batch-size={job_config['batch_size']}")
            
            # Log the command
            self.update_job_logs(job, {
                'level': 'INFO',
                'message': f'Executing command: {" ".join(cmd)}'
            })
            
            # Change directory to delphi folder
            os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            
            # Change directory to the root of the repository
            script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            os.chdir(script_dir)
            
            # Ensure we have execute permissions on the script
            os.chmod('./run_delphi.sh', 0o755)
            
            logger.info(f"Running command from {os.getcwd()}: {' '.join(cmd)}")
            
            # Add environment variables for Docker to work
            env = os.environ.copy()
            
            # Add job ID to environment
            env['DELPHI_JOB_ID'] = job_id
            
            # Add report ID to environment if available, otherwise use conversation ID
            report_id = job.get('report_id', conversation_id)
            env['DELPHI_REPORT_ID'] = str(report_id)
            
            self.update_job_logs(job, {
                'level': 'INFO',
                'message': f'Setting DELPHI_JOB_ID={job_id}, DELPHI_REPORT_ID={report_id}'
            })
            
            # Add any environment variables from the job
            if 'environment' in job and isinstance(job['environment'], dict):
                for key, value in job['environment'].items():
                    env[key] = value
                    self.update_job_logs(job, {
                        'level': 'INFO',
                        'message': f'Setting environment variable: {key}={value}'
                    })
            
            # Execute run_delphi.sh
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env
            )
            
            # Read output lines as they are produced
            stdout_lines = []
            stderr_lines = []
            
            # Set up timeout mechanism using a thread-safe approach
            start_time = time.time()
            
            try:
                # Use a simple polling approach for reading output and checking timeout
                import select
                import io
                
                # Set process stdout and stderr to non-blocking mode
                process.stdout.fileno()
                process.stderr.fileno()
                
                # Keep reading until process completes or timeout occurs
                while process.poll() is None:
                    # Check for timeout
                    elapsed_time = time.time() - start_time
                    if elapsed_time > timeout_seconds:
                        raise TimeoutError(f"Job processing timed out after {timeout_seconds} seconds")
                    
                    # Try to read from stdout and stderr without blocking
                    readable, _, _ = select.select([process.stdout, process.stderr], [], [], 1.0)
                    
                    if process.stdout in readable:
                        line = process.stdout.readline().strip()
                        if line:
                            stdout_lines.append(line)
                            # Log significant lines
                            if 'ERROR' in line or 'WARNING' in line or 'pipeline completed' in line:
                                level = 'ERROR' if 'ERROR' in line else 'WARNING' if 'WARNING' in line else 'INFO'
                                self.update_job_logs(job, {
                                    'level': level,
                                    'message': line
                                })
                    
                    if process.stderr in readable:
                        line = process.stderr.readline().strip()
                        if line:
                            stderr_lines.append(line)
                            self.update_job_logs(job, {
                                'level': 'ERROR',
                                'message': line
                            })
                
                # Process completed before timeout
                return_code = process.poll()
                
            except TimeoutError as e:
                logger.error(f"Job {job_id} timed out after {timeout_seconds} seconds. Terminating.")
                self.update_job_logs(job, {
                    'level': 'ERROR',
                    'message': f"Job timed out after {timeout_seconds} seconds. Terminating."
                })
                
                # Kill the process
                process.terminate()
                try:
                    process.wait(timeout=10)  # Wait for up to 10 seconds for process to terminate
                except subprocess.TimeoutExpired:
                    process.kill()  # Force kill if it doesn't terminate
                
                return_code = -1  # Special code for timeout
                
            finally:
                # Ensure we read any remaining output if process exited normally
                if return_code is not None and return_code != -1:
                    # Read any remaining output
                    remaining_stdout, remaining_stderr = process.communicate()
                    
                    # Process remaining stdout
                    if remaining_stdout:
                        for line in remaining_stdout.splitlines():
                            line = line.strip()
                            if line:
                                stdout_lines.append(line)
                    
                    # Process remaining stderr
                    if remaining_stderr:
                        for line in remaining_stderr.splitlines():
                            line = line.strip()
                            if line:
                                stderr_lines.append(line)
            
            # Determine success/failure based on return code
            success = return_code == 0
            
            # Get the report ID that was used
            report_id = env.get('DELPHI_REPORT_ID', conversation_id)
            
            # Prepare result with visualization URLs
            result = {
                'return_code': return_code,
                'output_summary': '\n'.join(stdout_lines[-10:]) if stdout_lines else 'No output',
                'visualization_path': f'visualizations/{report_id}/{job_id}',
                'report_id': report_id,
                'visualization_urls': {
                    'interactive': f"{os.environ.get('AWS_S3_ENDPOINT', '')}/{os.environ.get('AWS_S3_BUCKET_NAME', 'delphi')}/visualizations/{report_id}/{job_id}/layer_0_datamapplot.html"
                }
            }
            
            # Add timeout message if applicable
            if return_code == -1:
                result['error'] = f"Job timed out after {timeout_seconds} seconds"
            
            # Complete job
            self.complete_job(job, success, result=result)
            
            return success
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            self.update_job_logs(job, {
                'level': 'ERROR',
                'message': str(e)
            })
            self.complete_job(job, False, error=str(e))
            return False

def signal_handler(sig, frame):
    """Handle exit signals gracefully."""
    global running
    running = False
    logger.info("Shutting down gracefully...")

def poll_and_process(processor, interval=10):
    """Poll for jobs and process them."""
    logger.info("Starting job polling...")
    
    while running:
        try:
            # Find a job
            job = processor.find_pending_job()
            
            if job:
                # Try to claim it
                claimed_job = processor.claim_job(job)
                
                if claimed_job:
                    try:
                        # Process the job
                        processor.process_job(claimed_job)
                    except KeyError as ke:
                        logger.error(f"Missing key in job data: {ke}")
                        logger.error(f"Job keys available: {list(claimed_job.keys())}")
                    except Exception as e:
                        logger.error(f"Error processing job: {e}")
            
            # Wait for next poll
            if running:
                time.sleep(interval)
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            logger.error(f"Error in polling loop: {e}\nTraceback: {error_details}")
            if running:
                time.sleep(interval)

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
    
    # Set logging level
    logger.setLevel(getattr(logging, args.log_level))
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("Starting Delphi Job Poller Service")
    logger.info(f"Endpoint URL: {args.endpoint_url or os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')}")
    logger.info(f"Region: {args.region}")
    logger.info(f"Polling interval: {args.interval} seconds")
    logger.info(f"Maximum workers: {args.max_workers}")
    
    try:
        # Initialize job processor
        processor = JobProcessor(
            endpoint_url=args.endpoint_url,
            region=args.region
        )
        
        # Start polling threads
        threads = []
        for i in range(args.max_workers):
            t = threading.Thread(
                target=poll_and_process,
                args=(processor, args.interval),
                daemon=True
            )
            t.start()
            threads.append(t)
            logger.info(f"Started worker thread {i+1}")
        
        # Keep main thread alive
        while running and any(t.is_alive() for t in threads):
            time.sleep(1)
        
        logger.info("All workers have stopped. Exiting.")
    except Exception as e:
        logger.error(f"Error in main function: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()