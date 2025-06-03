#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the Delphi_JobQueue for pending jobs
and execute them using run_delphi.py.

Usage:
    python job_poller.py [options]

Options:
    --endpoint-url=URL  DynamoDB endpoint URL
    --region=REGION     AWS region (default: us-east-1)
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

# Exit code from 803_check_batch_status.py script if batch is still processing
EXIT_CODE_PROCESSING_CONTINUES = 3

class JobProcessor:
    """Process jobs from the Delphi_JobQueue."""
    
    def __init__(self, endpoint_url=None, region='us-east-1'):
        """Initialize the job processor."""
        self.endpoint_url = endpoint_url or os.environ.get('DYNAMODB_ENDPOINT')
        self.region = region
        self.worker_id = str(uuid.uuid4())
        
        # Set up DynamoDB client
        if 'localhost' in self.endpoint_url or 'host.docker.internal' in self.endpoint_url:
            # For local development
            os.environ.setdefault('AWS_ACCESS_KEY_ID', 'fakeMyKeyId')
            os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')

        if self.endpoint_url == "":
            logger.info("DynamoDB: DYNAMODB_ENDPOINT was an empty string, treating as None for AWS default endpoint.")
            self.endpoint_url = None
        
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
        """Find a pending or processing job to process."""
        try:
            # First, query the secondary index for PENDING jobs
            pending_response = self.table.query(
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

            pending_items = pending_response.get('Items', [])
            if pending_items:
                # Found a pending job - get full item with consistent read
                job_id = pending_items[0]['job_id']
                pending_full_item = self.table.get_item(
                    Key={
                        'job_id': job_id
                    },
                    ConsistentRead=True  # Important for distributed systems
                )

                if 'Item' in pending_full_item:
                    return pending_full_item['Item']

            # If no PENDING jobs, look for PROCESSING jobs with batch_id for batch status checking
            processing_response = self.table.query(
                IndexName='StatusCreatedIndex',
                KeyConditionExpression='#s = :status',
                ExpressionAttributeNames={
                    '#s': 'status'
                },
                ExpressionAttributeValues={
                    ':status': 'PROCESSING'
                },
                Limit=10,  # Check more processing jobs since they might not all have batch_id
                ScanIndexForward=True  # Get oldest jobs first
            )

            processing_items = processing_response.get('Items', [])

            # Filter for jobs with batch_id field
            batch_jobs = []
            
            for item in processing_items:
                job_id = item['job_id']
                # Get full item with consistent read
                try:
                    processing_full_item = self.table.get_item(
                        Key={
                            'job_id': job_id
                        },
                        ConsistentRead=True
                    )
                except Exception as e:
                    logger.error(f"Error getting item {job_id}: {e}")
                    continue

                if 'Item' in processing_full_item:
                    full_item = processing_full_item['Item']
                    # Consider jobs that have batch_id and are in PROCESSING status
                    # This includes AWAITING_NARRATIVE_BATCH, CREATE_NARRATIVE_BATCH, etc.
                    if 'batch_id' in full_item and full_item.get('status') == 'PROCESSING':
                        batch_jobs.append(full_item)

            # Return the oldest batch job if any found
            if batch_jobs:
                # Sort by created_at timestamp (oldest first)
                batch_jobs.sort(key=lambda x: x.get('created_at', ''))
                return batch_jobs[0]

            return None
        except Exception as e:
            logger.error(f"Error finding pending job: {e}")
            return None
    
    def claim_job(self, job):
        """Attempt to claim a job for processing using optimistic locking."""
        job_id = job['job_id']
        current_version = job.get('version', 1)
        current_status = job.get('status')

        # If job already has a PROCESSING status and has a batch_id, treat it as a batch check
        is_batch_check = (current_status == 'PROCESSING' and
                          'batch_id' in job)

        try:
            # Update the job using optimistic locking with conditional update
            now = datetime.now().isoformat()

            # Try to atomically update the job
            try:
                # For batch status checking (NARRATIVE_BATCH jobs with PROCESSING status)
                if is_batch_check:
                    response = self.table.update_item(
                        Key={
                            'job_id': job_id
                        },
                        UpdateExpression='''
                            SET #updated_at = :now,
                                #worker_id = :worker_id,
                                #version = :new_version,
                                batch_check_time = :now
                        ''',
                        ConditionExpression='#version = :current_version',
                        ExpressionAttributeNames={
                            '#updated_at': 'updated_at',
                            '#worker_id': 'worker_id',
                            '#version': 'version'
                        },
                        ExpressionAttributeValues={
                            ':now': now,
                            ':worker_id': self.worker_id,
                            ':current_version': current_version,
                            ':new_version': current_version + 1
                        },
                        ReturnValues='ALL_NEW'  # Get the updated item
                    )
                # For normal PENDING jobs
                else:
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
                return updated_job

            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    if is_batch_check:
                        logger.warning(f"Batch status check job {job_id} was already claimed or modified by another worker")
                    else:
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
        """Process a job using run_delphi.py."""
        job_id = job['job_id']
        conversation_id = job['conversation_id']
        
        # Set a default timeout if not specified in the job
        timeout_seconds = job.get('timeout_seconds', 3600)  # Default 1 hour timeout
        
        
        # Update log with processing start
        self.update_job_logs(job, {
            'level': 'INFO',
            'message': f'Grabbed {conversation_id}'
        })
        
        try:
            # Get job configuration
            job_config = json.loads(job.get('job_config', '{}'))
            
            # Determine which script to run based on job type
            job_type = job.get('job_type')

            if job_type == 'CREATE_NARRATIVE_BATCH':
                # This is a new batch submission
                self.update_job_logs(job, {
                    'level': 'INFO',
                    'message': f'Creating narrative batch for conversation {conversation_id}'
                })

                # Extract batch configuration
                model = os.environ.get("ANTHROPIC_MODEL")  # No fallback - must be set
                if not model:
                    raise ValueError("ANTHROPIC_MODEL environment variable must be set")
                max_batch_size = 20  # Default batch size
                no_cache = False  # Default cache behavior

                # Look for stage configuration
                if 'stages' in job_config:
                    for stage in job_config['stages']:
                        if stage['stage'] == 'NARRATIVE_BATCH' and 'config' in stage:
                            config = stage['config']
                            model = config.get('model', model)
                            max_batch_size = config.get('max_batch_size', max_batch_size)
                            no_cache = config.get('no_cache', no_cache)

                # Build command for the batch report script
                cmd = ['python', '/app/umap_narrative/801_narrative_report_batch.py',
                        f'--conversation_id={conversation_id}',
                        f'--model={model}',
                        f'--max-batch-size={max_batch_size}']

                if no_cache:
                    cmd.append('--no-cache')


            elif job_type == 'AWAITING_NARRATIVE_BATCH':
                # This is a job that needs to check batch status
                batch_id = job.get('batch_id')
                batch_job_id = job.get('batch_job_id')

                if batch_id:
                    self.update_job_logs(job, {
                        'level': 'INFO',
                        'message': f'Narrative batch id: {batch_id} for job: {batch_job_id or job_id}'
                    })
                else:
                    self.update_job_logs(job, {
                        'level': 'INFO',
                        'message': f'Running batch status checker for job {batch_job_id or job_id}'
                    })

                # Build command for the batch status checker script
                cmd = ['python', '/app/umap_narrative/803_check_batch_status.py']

                # Use batch_job_id if available, otherwise use current job_id
                cmd_job_id = batch_job_id if batch_job_id else job_id
                cmd.append(f'--job-id={cmd_job_id}')


            elif job_type == 'FULL_PIPELINE':
                # Default: run the standard pipeline
                script_path = '/app/run_delphi.py'  # Absolute path
                cmd = ['python', script_path, f'--zid={conversation_id}']

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
            else:
                error_message = f"Unrecognized or missing job_type: '{job_type}' for job {job_id}. Expected one of 'CREATE_NARRATIVE_BATCH', 'AWAITING_NARRATIVE_BATCH', 'FULL_PIPELINE'."
                logger.error(error_message)
                self.update_job_logs(job, {
                    'level': 'ERROR',
                    'message': error_message
                })
                self.complete_job(job, False, error=error_message)
                return False
            
            # Log the command
            self.update_job_logs(job, {
                'level': 'INFO',
                'message': f'Executing command: {" ".join(cmd)}'
            })
            
            # Change directory to delphi folder
            # os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) # REMOVED
            
            # Change directory to the root of the repository
            # script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # REMOVED
            # os.chdir(script_dir) # REMOVED
            
            # Ensure we have execute permissions on the script
            # os.chmod('./run_delphi.py', 0o755) # REMOVED - Handled in FULL_PIPELINE block
            
            
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
                            
                            # Default level for significant stdout lines
                            level = 'INFO'
                            clean_message = line
                            log_line = False
                            
                            # Log significant lines and determine appropriate level
                            log_level_patterns = {
                                "CRITICAL": [" - CRITICAL - ", "CRITICAL:"],
                                "ERROR": [" - ERROR - ", "ERROR:", "Error:", "error:"],
                                "WARNING": [" - WARNING - ", "WARN:", "WARNING:", "Warning:", "warning:"],
                                "INFO": [" - INFO - ", "INFO:", "pipeline completed"],
                                "DEBUG": [" - DEBUG - ", "DEBUG:"]
                            }
                            
                            # First check if this is a line we want to log at all
                            should_log = False
                            for patterns in log_level_patterns.values():
                                for pattern in patterns:
                                    if pattern in line:
                                        should_log = True
                                        break
                                if should_log:
                                    break
                            
                            if should_log:
                                # Determine the appropriate level
                                for detected_level, patterns in log_level_patterns.items():
                                    for pattern in patterns:
                                        if pattern in line:
                                            level = detected_level
                                            # Try to clean the message by removing the timestamp and level prefix
                                            parts = line.split(pattern, 1)
                                            if len(parts) > 1:
                                                clean_message = parts[1].strip()
                                            break
                                    if level != 'INFO':  # Stop once we find a non-default match
                                        break
                                
                                # Log the cleaned message with the appropriate level
                                self.update_job_logs(job, {
                                    'level': level,
                                    'message': clean_message
                                })
                    
                    if process.stderr in readable:
                        line = process.stderr.readline().strip()
                        if line:
                            stderr_lines.append(line)
                            
                            # First check for special cases that should be INFO despite coming from stderr
                            level = "ERROR"  # Default level for stderr
                            clean_message = line
                            
                            # Check for pip notices and other informational stderr messages
                            info_patterns = [
                                "[notice]",          # pip notices
                                "Requirement already satisfied",  # pip install messages
                                "Collecting ",       # pip collecting packages
                                "Downloading ",      # pip downloading packages
                                "Installing "        # pip installing packages
                            ]
                            
                            # Set level to INFO for special cases
                            for pattern in info_patterns:
                                if pattern in line:
                                    level = "INFO"
                                    break
                            
                            # Next, check for explicit log levels in the message
                            log_level_patterns = {
                                "CRITICAL": [" - CRITICAL - ", "CRITICAL:"],
                                "ERROR": [" - ERROR - ", "ERROR:"],
                                "WARNING": [" - WARNING - ", "WARN:", "WARNING:"],
                                "INFO": [" - INFO - ", "INFO:"],
                                "DEBUG": [" - DEBUG - ", "DEBUG:"]
                            }
                            
                            # Detect explicit log level from the message (overrides special case detection)
                            for detected_level, patterns in log_level_patterns.items():
                                for pattern in patterns:
                                    if pattern in line:
                                        level = detected_level
                                        break
                                if level != "ERROR":  # Stop once we find a non-ERROR match
                                    break
                            
                            self.update_job_logs(job, {
                                'level': level,
                                'message': clean_message
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
                                
                                # Default level for significant stdout lines
                                level = 'INFO'
                                clean_message = line
                                log_line = False
                                
                                # Log significant lines and determine appropriate level
                                log_level_patterns = {
                                    "CRITICAL": [" - CRITICAL - ", "CRITICAL:"],
                                    "ERROR": [" - ERROR - ", "ERROR:", "Error:", "error:"],
                                    "WARNING": [" - WARNING - ", "WARN:", "WARNING:", "Warning:", "warning:"],
                                    "INFO": [" - INFO - ", "INFO:", "pipeline completed"],
                                    "DEBUG": [" - DEBUG - ", "DEBUG:"]
                                }
                                
                                # First check if this is a line we want to log at all
                                should_log = False
                                for patterns in log_level_patterns.values():
                                    for pattern in patterns:
                                        if pattern in line:
                                            should_log = True
                                            break
                                    if should_log:
                                        break
                                
                                if should_log:
                                    # Determine the appropriate level
                                    for detected_level, patterns in log_level_patterns.items():
                                        for pattern in patterns:
                                            if pattern in line:
                                                level = detected_level
                                                # Try to clean the message by removing the timestamp and level prefix
                                                parts = line.split(pattern, 1)
                                                if len(parts) > 1:
                                                    clean_message = parts[1].strip()
                                                break
                                        if level != 'INFO':  # Stop once we find a non-default match
                                            break
                                    
                                    # Log the cleaned message with the appropriate level
                                    self.update_job_logs(job, {
                                        'level': level,
                                        'message': clean_message
                                    })
                    
                    # Process remaining stderr
                    if remaining_stderr:
                        for line in remaining_stderr.splitlines():
                            line = line.strip()
                            if line:
                                stderr_lines.append(line)
                                
                                # First check for special cases that should be INFO despite coming from stderr
                                level = "ERROR"  # Default level for stderr
                                clean_message = line
                                
                                # Check for pip notices and other informational stderr messages
                                info_patterns = [
                                    "[notice]",          # pip notices
                                    "Requirement already satisfied",  # pip install messages
                                    "Collecting ",       # pip collecting packages
                                    "Downloading ",      # pip downloading packages
                                    "Installing "        # pip installing packages
                                ]
                                
                                # Set level to INFO for special cases
                                for pattern in info_patterns:
                                    if pattern in line:
                                        level = "INFO"
                                        break
                                
                                # Next, check for explicit log levels in the message
                                log_level_patterns = {
                                    "CRITICAL": [" - CRITICAL - ", "CRITICAL:"],
                                    "ERROR": [" - ERROR - ", "ERROR:"],
                                    "WARNING": [" - WARNING - ", "WARN:", "WARNING:"],
                                    "INFO": [" - INFO - ", "INFO:"],
                                    "DEBUG": [" - DEBUG - ", "DEBUG:"]
                                }
                                
                                # Detect explicit log level from the message (overrides special case detection)
                                for detected_level, patterns in log_level_patterns.items():
                                    for pattern in patterns:
                                        if pattern in line:
                                            level = detected_level
                                            break
                                    if level != "ERROR":  # Stop once we find a non-ERROR match
                                        break
                                
                                self.update_job_logs(job, {
                                    'level': level,
                                    'message': clean_message
                                })
            
            # Determine success/failure based on return code
            success = return_code == 0

            # Get the report ID that was used
            report_id = env.get('DELPHI_REPORT_ID', conversation_id)

            # Prepare result with visualization URLs and execution info
            result = {
                'return_code': return_code,
                'output_summary': '\n'.join(stdout_lines[-10:]) if stdout_lines else 'No output',
                'visualization_path': f'visualizations/{report_id}/{job_id}',
                'report_id': report_id,
                'visualization_urls': {
                    'interactive': f"{os.environ.get('AWS_S3_ENDPOINT', '')}/{os.environ.get('AWS_S3_BUCKET_NAME', 'polis-delphi')}/visualizations/{report_id}/{job_id}/layer_0_datamapplot.html"
                },
                'execution_finished_at': datetime.now().isoformat()
            }

            # Specific handling for AWAITING_NARRATIVE_BATCH jobs based on new exit codes
            if job_type == 'AWAITING_NARRATIVE_BATCH':
                if return_code == EXIT_CODE_PROCESSING_CONTINUES:
                    # Update job's last checked time or similar, but don't complete it.
                    # The job remains in PROCESSING status. Update 'updated_at' and 'version'.
                    try:
                        current_job_details = self.table.get_item(Key={'job_id': job_id}).get('Item', {})
                        current_version = current_job_details.get('version', job.get('version', 1)) # Use latest known version

                        self.table.update_item(
                            Key={'job_id': job_id},
                            UpdateExpression='SET updated_at = :now, version = :new_version, batch_check_script_exit_code = :exit_code',
                            ConditionExpression='attribute_exists(job_id)', # Ensure job still exists
                            ExpressionAttributeValues={
                                ':now': datetime.now().isoformat(),
                                ':new_version': current_version + 1,
                                ':exit_code': return_code
                            }
                        )
                    except Exception as e:
                        logger.error(f"Failed to update timestamp for job {job_id} after script exit code 3: {e}")
                    return True # Indicate poller handled this, job processing for this cycle is "done" but job itself is not final

                elif return_code == 0: # Script 803 indicated terminal state (completed/failed) and handled it
                    logger.info(f"Job {job_id} (AWAITING_NARRATIVE_BATCH): Script 803 indicated terminal state for batch (exit code 0). Marking check job COMPLETED.")
                    self.complete_job(job, True, result=result) # Mark the AWAITING_NARRATIVE_BATCH job as COMPLETED
                elif return_code == -1: # Timeout
                    logger.error(f"Job {job_id} (AWAITING_NARRATIVE_BATCH): Script 803 timed out.")
                    result['error'] = f"Batch status check script timed out after {timeout_seconds} seconds"
                    self.complete_job(job, False, result=result, error=result['error'])
                else: # Script 803 itself failed or reported an issue (e.g. exit 1)
                    logger.error(f"Job {job_id} (AWAITING_NARRATIVE_BATCH): Script 803 failed or reported error (exit code {return_code}). Marking check job FAILED.")
                    error_msg = f"Batch status check script 803 exited with code {return_code}"
                    self.complete_job(job, False, result=result, error=error_msg)
                
                return success # Which will be True if return_code was 0, False otherwise for AWAITING_NARRATIVE_BATCH

            # General handling for other job types or if specific AWAITING_NARRATIVE_BATCH logic wasn't hit
            if return_code == -1: # Timeout
                result['error'] = f"Job timed out after {timeout_seconds} seconds"
                self.complete_job(job, False, result=result, error=result['error'])
            elif not success: # Script failed (non-zero exit code) for other job types
                error_msg = f"Process exited with code {return_code}"
                self.complete_job(job, False, result=result, error=error_msg)
            else: # Script succeeded (exit code 0) for other job types
                logger.info(f"Job {job_id} process completed successfully with exit code 0 for job_type {job_type}")
                # For successful completion, check if the job status was changed by the script
                # This logic primarily applies if the script itself can update the job status to COMPLETED/FAILED
                # For AWAITING_NARRATIVE_BATCH, we've handled completion above based on 803's exit code.
                try:
                    current_job = self.table.get_item(Key={'job_id': job_id}).get('Item')
                    if current_job:
                        current_status = current_job.get('status')
                        original_status = job.get('status') # Status when job was claimed for processing
                        current_version = current_job.get('version', job.get('version', 1))

                        # If the script itself marked the job as COMPLETED or FAILED
                        if current_status in ['COMPLETED', 'FAILED'] and current_status != original_status:
                            logger.info(f"Job {job_id} status was changed by script from {original_status} to {current_status}. Updating results.")
                            self.table.update_item(
                                Key={'job_id': job_id},
                                UpdateExpression='SET job_results = :results, updated_at = :now, version = :new_version',
                                ConditionExpression='version = :current_version',
                                ExpressionAttributeValues={
                                    ':results': json.dumps(result),
                                    ':now': datetime.now().isoformat(),
                                    ':current_version': current_version, # Use the version from the freshly read job
                                    ':new_version': current_version + 1
                                }
                            )
                        else:
                            # Script exited with 0, but didn't change status to a final one.
                            # The poller should mark it COMPLETED.
                            logger.info(f"Job {job_id} (type {job_type}) script exited 0, poller marking COMPLETED.")
                            self.complete_job(job, True, result=result) # Pass original claimed job for version consistency
                    else:
                        logger.error(f"Job {job_id} not found after script execution, cannot finalize.")
                        # This is an edge case; the job should exist.
                except Exception as e:
                    logger.error(f"Failed to finalize job {job_id} after successful script execution: {e}")
                    # As a fallback, try to mark original job as FAILED to avoid it getting stuck
                    self.complete_job(job, False, error=f"Post-processing error after successful script: {str(e)}")
            
            return success
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            self.update_job_logs(job, {
                'level': 'ERROR',
                'message': str(e)
            })
            # Mark job as failed if there was an error starting/running the process
            self.complete_job(job, False, error=f"Error running job process: {str(e)}")
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
    parser.add_argument('--region', type=str, default='us-east-1',
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
    logger.info(f"Endpoint URL: {args.endpoint_url or os.environ.get('DYNAMODB_ENDPOINT')}")
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