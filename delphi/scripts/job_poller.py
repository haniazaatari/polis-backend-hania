#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the DelphiJobQueue for pending jobs
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
    """Process jobs from the DelphiJobQueue."""
    
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
        self.table = self.dynamodb.Table('DelphiJobQueue')
        
        # Ensure we can connect to the table
        try:
            self.table.table_status
            logger.info("Successfully connected to DelphiJobQueue table")
        except Exception as e:
            logger.error(f"Failed to connect to DelphiJobQueue table: {e}")
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
    
    def update_job_logs(self, job, log_entry):
        """Add a log entry to the job logs with optimistic locking."""
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
            current_logs['entries'].append({
                'timestamp': datetime.now().isoformat(),
                'level': log_entry.get('level', 'INFO'),
                'message': log_entry.get('message', '')
            })
            
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
        
        logger.info(f"Processing job {job_id} for conversation {conversation_id}")
        
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
            
            # Process stdout
            for line in process.stdout:
                stdout_lines.append(line.strip())
                # Log significant lines
                if 'ERROR' in line or 'WARNING' in line or 'pipeline completed' in line:
                    level = 'ERROR' if 'ERROR' in line else 'WARNING' if 'WARNING' in line else 'INFO'
                    self.update_job_logs(job, {
                        'level': level,
                        'message': line.strip()
                    })
            
            # Process stderr
            for line in process.stderr:
                stderr_lines.append(line.strip())
                self.update_job_logs(job, {
                    'level': 'ERROR',
                    'message': line.strip()
                })
            
            # Wait for process to complete
            return_code = process.wait()
            
            # Determine success/failure based on return code
            success = return_code == 0
            
            # Prepare result
            result = {
                'return_code': return_code,
                'output_summary': '\n'.join(stdout_lines[-10:]) if stdout_lines else 'No output',
                'visualization_folder': f'visualizations/{conversation_id}'
            }
            
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