#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the Delphi_JobQueue for pending jobs
and execute them.
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
from datetime import datetime, timedelta, timezone
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('delphi_poller')

# Global flag for graceful shutdown
running = True

# Exit code from 803_check_batch_status.py script if batch is still processing
EXIT_CODE_PROCESSING_CONTINUES = 3

def signal_handler(sig, frame):
    """Handle exit signals gracefully."""
    global running
    logger.info("Shutdown signal received. Stopping workers...")
    running = False

class JobProcessor:
    """Process jobs from the Delphi_JobQueue."""
    
    def __init__(self, endpoint_url=None, region='us-east-1'):
        """Initialize the job processor."""
        self.worker_id = str(uuid.uuid4())
        raw_endpoint = endpoint_url or os.environ.get('DYNAMODB_ENDPOINT')
        self.endpoint_url = raw_endpoint if raw_endpoint and raw_endpoint.strip() else None
        
        logger.info(f"Connecting to DynamoDB at {self.endpoint_url or 'default AWS endpoint'}")
        self.dynamodb = boto3.resource('dynamodb', 
                                     endpoint_url=self.endpoint_url, 
                                     region_name=region)
        self.table = self.dynamodb.Table('Delphi_JobQueue')
        
        try:
            self.table.table_status
            logger.info("Successfully connected to Delphi_JobQueue table")
        except Exception as e:
            logger.error(f"Failed to connect to Delphi_JobQueue table: {e}")
            raise
        
    def find_pending_job(self):
        """
        Finds the highest-priority actionable job. This includes PENDING jobs, jobs
        awaiting a re-check, and jobs with expired locks ("zombie" jobs).
        """
        try:
            # Helper to query the index with pagination
            def execute_paginated_query(status):
                items = []
                last_key = None
                while True:
                    query_kwargs = {
                        'IndexName': 'StatusCreatedIndex',
                        'KeyConditionExpression': '#s = :status',
                        'ExpressionAttributeNames': {'#s': 'status'},
                        'ExpressionAttributeValues': {':status': status},
                        'ScanIndexForward': True
                    }
                    if last_key:
                        query_kwargs['ExclusiveStartKey'] = last_key
                    
                    response = self.table.query(**query_kwargs)
                    items.extend(response.get('Items', []))
                    last_key = response.get('LastEvaluatedKey')
                    if not last_key:
                        break
                return items

            # 1. Fetch all potentially actionable jobs from different states
            pending_jobs = execute_paginated_query('PENDING')
            awaiting_jobs = execute_paginated_query('AWAITING_RECHECK')
            
            actionable_jobs = pending_jobs + awaiting_jobs

            # 2. Add any jobs that are stuck in PROCESSING with an expired lock (zombies)
            processing_jobs = execute_paginated_query('PROCESSING')
            now_iso = datetime.now(timezone.utc).isoformat()
            for job in processing_jobs:
                if job.get('lock_expires_at', 'z') < now_iso:
                    logger.warning(f"Found zombie job {job['job_id']} with expired lock. Re-queueing.")
                    actionable_jobs.append(job)

            if not actionable_jobs:
                return None

            # 3. Sort all actionable jobs by priority and then by creation date
            actionable_jobs.sort(key=lambda x: (
                0 if x.get('status') == 'PENDING' else 1, # PENDING jobs are highest priority
                x.get('created_at', '')
            ))
            
            logger.info(f"Found {len(actionable_jobs)} actionable job(s). Highest priority is {actionable_jobs[0]['job_id']}")
            return actionable_jobs[0]

        except Exception as e:
            logger.error(f"Error finding pending job: {e}", exc_info=True)
            return None

    def claim_job(self, job):
        """
        Atomically claims a job by setting its status to PROCESSING
        and applying a lock timeout, using optimistic locking.
        """
        job_id = job['job_id']
        current_version = job.get('version', 1)
        current_status = job.get('status')
        now = datetime.now(timezone.utc)
        new_expiry_iso = (now + timedelta(minutes=15)).isoformat()

        # This condition handles all actionable states found by find_pending_job.
        # It allows claiming a PENDING job, an AWAITING_RECHECK job, or an expired job.
        condition_expr = "(#s = :pending OR #s = :awaiting_recheck OR (attribute_exists(lock_expires_at) AND lock_expires_at < :now)) AND #v = :current_version"
        
        try:
            response = self.table.update_item(
                Key={'job_id': job_id},
                UpdateExpression='SET #s = :processing, started_at = :now, lock_expires_at = :expiry, #v = :new_version, #w = :worker_id',
                ConditionExpression=condition_expr,
                ExpressionAttributeNames={
                    '#s': 'status',
                    '#v': 'version',
                    '#w': 'worker_id'
                },
                ExpressionAttributeValues={
                    ':pending': 'PENDING',
                    ':awaiting_recheck': 'AWAITING_RECHECK',
                    ':now': now.isoformat(),
                    ':processing': 'PROCESSING',
                    ':expiry': new_expiry_iso,
                    ':current_version': current_version,
                    ':new_version': current_version + 1,
                    ':worker_id': self.worker_id
                },
                ReturnValues='ALL_NEW'
            )
            logger.info(f"Successfully claimed job {job_id}. Lock expires at {new_expiry_iso}.")
            return response.get('Attributes')
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                logger.warning(f"Job {job_id} was claimed by another worker in a race condition. Skipping.")
            else:
                logger.error(f"DynamoDB error claiming job {job_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error claiming job {job_id}: {e}", exc_info=True)
            return None
        
    def release_lock(self, job, is_still_processing=False):
        """Releases the lock on a job, optionally setting it to be re-checked."""
        job_id = job['job_id']
        logger.info(f"Releasing lock for job {job_id}.")
        try:
            if is_still_processing:
                # Set status to AWAITING_RECHECK so find_pending_job can pick it up again.
                self.table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="SET #s = :recheck_status REMOVE lock_expires_at",
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={':recheck_status': 'AWAITING_RECHECK'}
                )
            else:
                # For jobs that are finished (completed/failed), just remove the lock.
                self.table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="REMOVE lock_expires_at"
                )
        except Exception as e:
            logger.error(f"Failed to release lock for job {job_id}: {e}")
            
    def update_job_logs(self, job, log_entry, mirror_to_console=True):
        """
        Add a log entry to the job logs with optimistic locking.
        """
        try:
            # Get current logs and version
            current_logs = json.loads(job.get('logs', '{"entries":[]}'))
            if 'entries' not in current_logs:
                current_logs['entries'] = []
            
            # Add new entry
            current_logs['entries'].append({
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'level': log_entry.get('level', 'INFO'),
                'message': log_entry.get('message', '')
            })
            
            # Mirror to console if requested
            if mirror_to_console:
                colors = {'INFO': '\033[32m', 'WARNING': '\033[33m', 'ERROR': '\033[31m', 'CRITICAL': '\033[31;1m'}
                reset = '\033[0m'
                level = log_entry.get('level', 'INFO')
                color = colors.get(level, '')
                short_job_id = job['job_id'][:8]
                print(f"{color}[DELPHI JOB {short_job_id}] {level}{reset}: {log_entry.get('message', '')}")
            
            # Keep only the most recent log entries
            current_logs['entries'] = current_logs['entries'][-50:]
            
            # Update DynamoDB
            self.table.update_item(
                Key={'job_id': job['job_id']},
                UpdateExpression='SET logs = :logs, updated_at = :updated_at',
                ExpressionAttributeValues={
                    ':logs': json.dumps(current_logs),
                    ':updated_at': datetime.now(timezone.utc).isoformat()
                }
            )
        except Exception as e:
            # Log failure but do not crash the worker
            logger.error(f"Error updating job logs for {job['job_id']}: {e}")

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
            
            # This 'if' block correctly handles the 'result' argument
            if result:
                job_results.update(result)
            
            if error:
                job_results['error'] = str(error)
            
            # Update the job with the new status using optimistic locking
            try:
                self.table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression='''
                        SET #status = :new_status, 
                            updated_at = :now, 
                            completed_at = :now,
                            job_results = :job_results,
                            version = :new_version
                    ''',
                    ConditionExpression='version = :current_version',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':new_status': new_status,
                        ':now': now,
                        ':job_results': json.dumps(job_results),
                        ':current_version': current_version,
                        ':new_version': current_version + 1
                    }
                )
                
                logger.info(f"Job {job_id} marked as {new_status}")
                
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    logger.warning(f"Job {job_id} was modified by another process, completion state may not be accurate")
                else:
                    raise
        except Exception as e:
            logger.error(f"Error completing job {job_id}: {e}")

    def process_job(self, job):
        """Processes a claimed job by executing the correct script with real-time log handling."""
        job_id = job['job_id']
        job_type = job.get('job_type')
        conversation_id = job.get('conversation_id')
        timeout_seconds = int(job.get('timeout_seconds', 3600))

        self.update_job_logs(job, {'level': 'INFO', 'message': f'Worker {self.worker_id} starting job {job_id}'})
        
        try:
            # 1. Build the command
            job_config = json.loads(job.get('job_config', '{}'))
            if job_type == 'CREATE_NARRATIVE_BATCH':
                model = os.environ.get("ANTHROPIC_MODEL")
                if not model: raise ValueError("ANTHROPIC_MODEL must be set")
                max_batch_size = job_config.get('max_batch_size', 20)
                cmd = ['python', '/app/umap_narrative/801_narrative_report_batch.py', f'--conversation_id={conversation_id}', f'--model={model}', f'--max-batch-size={str(max_batch_size)}']
                if job_config.get('no_cache'): cmd.append('--no-cache')
            elif job_type == 'AWAITING_NARRATIVE_BATCH':
                cmd_job_id = job.get('batch_job_id', job_id)
                cmd = ['python', '/app/umap_narrative/803_check_batch_status.py', f'--job-id={cmd_job_id}']
            else: # FULL_PIPELINE
                cmd = ['python', '/app/run_delphi.py', f'--zid={conversation_id}']

            # 2. Execute the command and stream logs to prevent deadlocks
            self.update_job_logs(job, {'level': 'INFO', 'message': f'Executing command: {" ".join(cmd)}'})
            
            env = os.environ.copy()
            env['DELPHI_JOB_ID'] = job_id
            env['DELPHI_REPORT_ID'] = str(job.get('report_id', conversation_id))
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True, env=env)

            start_time = time.time()
            for line in iter(process.stdout.readline, ''):
                # Log each line of output as it arrives
                self.update_job_logs(job, {'level': 'INFO', 'message': f"[stdout] {line.strip()}"})
                if time.time() - start_time > timeout_seconds:
                    raise subprocess.TimeoutExpired(cmd, timeout_seconds)
            
            process.stdout.close()
            return_code = process.wait()
            
            # 3. Handle the results
            success = (return_code == 0)
            if job_type == 'AWAITING_NARRATIVE_BATCH':
                if return_code == EXIT_CODE_PROCESSING_CONTINUES:
                    self.release_lock(job, is_still_processing=True)
                else:
                    self.complete_job(job, success, error=f"Script failed with exit code {return_code}" if not success else None)
            
            elif job_type == 'CREATE_NARRATIVE_BATCH':
                if success:
                    logger.info(f"Job {job_id}: Async trigger successful. Status remains 'PROCESSING'.")
                else:
                    self.complete_job(job, False, error=f"CREATE_NARRATIVE_BATCH script failed with exit code {return_code}")

            else: # Handle all other synchronous job types
                self.complete_job(job, success, error=f"Process exited with code {return_code}" if not success else None)

        except subprocess.TimeoutExpired:
            logger.error(f"Job {job_id} timed out after {timeout_seconds} seconds.")
            self.complete_job(job, False, error=f"Job process timed out after {timeout_seconds}s.")
        except Exception as e:
            logger.error(f"Critical error processing job {job_id}: {e}", exc_info=True)
            self.complete_job(job, False, error=f"Critical poller error: {str(e)}")


def poll_and_process(processor, interval=10):
    """The main loop for a worker thread."""
    logger.info(f"Worker {processor.worker_id} starting job polling...")
    while running:
        claimed_job = None
        try:
            # Step 1: Find the next available job.
            job_to_process = processor.find_pending_job()
            
            if job_to_process:
                # Step 2: Attempt to claim the job we found.
                claimed_job = processor.claim_job(job_to_process)
                
                # Step 3: Only process the job if the claim was successful.
                if claimed_job:
                    processor.process_job(claimed_job)
            else:
                # If no jobs are found, wait for the full interval.
                time.sleep(interval)
                
        except Exception as e:
            logger.error(f"Critical error in polling loop for worker {processor.worker_id}: {e}", exc_info=True)
            if claimed_job:
                # If an error happened after a job was claimed, mark it as FAILED to prevent a zombie job.
                processor.complete_job(claimed_job, False, error="Polling loop crashed during processing")
            # On error, wait longer before retrying to prevent rapid failure loops.
            time.sleep(interval * 6)
def main():
    # This function is correct.
    parser = argparse.ArgumentParser(description='Delphi Job Poller Service')
    parser.add_argument('--endpoint-url', type=str, default=None)
    parser.add_argument('--region', type=str, default='us-east-1')
    parser.add_argument('--interval', type=int, default=10)
    parser.add_argument('--max-workers', type=int, default=1)
    parser.add_argument('--log-level', type=str, default='INFO', choices=['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])
    args = parser.parse_args()
    
    logger.setLevel(getattr(logging, args.log_level))
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("Starting Delphi Job Poller Service...")
    
    try:
        processor = JobProcessor(endpoint_url=args.endpoint_url, region=args.region)
        threads = []
        for i in range(args.max_workers):
            t = threading.Thread(target=poll_and_process, args=(processor, args.interval), daemon=True)
            t.start()
            threads.append(t)
            logger.info(f"Started worker thread {i+1}")
        
        while running and any(t.is_alive() for t in threads):
            time.sleep(1)
        
        logger.info("All workers have stopped. Exiting.")
    except Exception as e:
        logger.error(f"Error in main function: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()