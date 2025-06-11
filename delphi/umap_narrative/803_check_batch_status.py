#!/usr/bin/env python3
"""
Check and process Anthropic Batch API results for Polis narrative reports.

This script:
1. Checks the status of submitted batches in the job queue
2. Retrieves results for completed batches
3. Processes the results and stores them in the report database
4. Updates job status when processing is complete

Usage:
    python 803_check_batch_status.py [--job-id JOB_ID] [--polling-interval SECONDS] [--log-level LEVEL]

Args:
    --job-id: Optional specific job ID to check
    --polling-interval: Seconds to wait between checks (default: 60)
    --log-level: Logging level (default: INFO)
"""

import os
import sys
import json
import time
import boto3
import logging
import argparse
import asyncio
import traceback  # For detailed error tracking
import requests  # For HTTP error handling
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union, Any
from pathlib import Path
from datetime import datetime, timedelta, timezone
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Anthropic Batch API Statuses
ANTHROPIC_BATCH_PREPARING = "preparing"
ANTHROPIC_BATCH_IN_PROGRESS = "in_progress"
ANTHROPIC_BATCH_COMPLETED = "completed"
ANTHROPIC_BATCH_ENDED = "ended"  # Anthropic API returns "ended" for completed batches
ANTHROPIC_BATCH_FAILED = "failed"
ANTHROPIC_BATCH_CANCELLED = "cancelled"

TERMINAL_BATCH_STATES = [ANTHROPIC_BATCH_COMPLETED, ANTHROPIC_BATCH_ENDED, ANTHROPIC_BATCH_FAILED, ANTHROPIC_BATCH_CANCELLED]
NON_TERMINAL_BATCH_STATES = [ANTHROPIC_BATCH_PREPARING, ANTHROPIC_BATCH_IN_PROGRESS]

# Script Exit Codes (when --job-id is used)
EXIT_CODE_TERMINAL_STATE = 0      # Batch is done (completed/failed/cancelled), script handled it.
EXIT_CODE_SCRIPT_ERROR = 1        # The script itself had an issue processing the specified job.
EXIT_CODE_PROCESSING_CONTINUES = 3 # Batch is still processing, poller should wait and re-check.

class BatchStatusChecker:
    """Check and process Anthropic Batch API results."""

    EXIT_CODE_TERMINAL_STATE = 0
    EXIT_CODE_SCRIPT_ERROR = 1
    EXIT_CODE_PROCESSING_CONTINUES = 3

    def __init__(self, log_level=logging.INFO):
        """Initialize the batch status checker."""
        logger.setLevel(log_level)

        endpoint_url = os.environ.get('DYNAMODB_ENDPOINT') or None
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=endpoint_url,
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )

        self.job_table = self.dynamodb.Table('Delphi_JobQueue')
        self.report_table = self.dynamodb.Table('Delphi_NarrativeReports')

        try:
            from anthropic import Anthropic
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                logger.error("ANTHROPIC_API_KEY environment variable is not set.")
                self.anthropic = None
            else:
                self.anthropic = Anthropic(api_key=api_key)
        except ImportError:
            logger.error("The 'anthropic' package is not installed. Please install it.")
            self.anthropic = None
        except Exception as e:
            logger.error(f"Failed to initialize Anthropic client: {e}")
            self.anthropic = None

    def find_pending_jobs(self, specific_job_id: Optional[str] = None) -> List[Dict]:
        """
        Finds jobs ready for processing, including new jobs and those with expired locks,
        with full support for pagination.
        """
        if specific_job_id:
            try:
                response = self.job_table.get_item(Key={'job_id': specific_job_id})
                item = response.get('Item')
                if item and item.get('status') in ['PROCESSING', 'LOCKED_FOR_CHECKING']:
                    return [item]
                return []
            except Exception as e:
                logger.error(f"Error fetching specific job {specific_job_id}: {e}")
                return []

        try:
            found_jobs = {}
            def execute_paginated_query(status):
                paginated_items = []
                last_evaluated_key = None
                while True:
                    query_kwargs = {
                        'IndexName': 'StatusCreatedIndex',
                        'KeyConditionExpression': '#s = :status',
                        'ExpressionAttributeNames': {'#s': 'status'},
                        'ExpressionAttributeValues': {':status': status}
                    }
                    if last_evaluated_key:
                        query_kwargs['ExclusiveStartKey'] = last_evaluated_key
                    
                    response = self.job_table.query(**query_kwargs)
                    paginated_items.extend(response.get('Items', []))
                    
                    last_evaluated_key = response.get('LastEvaluatedKey')
                    if not last_evaluated_key:
                        break
                return paginated_items

            # 1. Find all 'PROCESSING' jobs
            logger.info("Querying for all pages of jobs with status 'PROCESSING'...")
            processing_jobs = execute_paginated_query('PROCESSING')
            for item in processing_jobs:
                found_jobs[item['job_id']] = item
            logger.info(f"Found {len(processing_jobs)} 'PROCESSING' jobs.")

            # 2. Find all 'LOCKED_FOR_CHECKING' jobs to check for expired locks
            logger.info("Querying for all pages of jobs with status 'LOCKED_FOR_CHECKING'...")
            locked_jobs = execute_paginated_query('LOCKED_FOR_CHECKING')
            now_iso = datetime.now(timezone.utc).isoformat()
            
            expired_job_count = 0
            for item in locked_jobs:
                lock_time_str = item.get('lock_expires_at')
                if lock_time_str and lock_time_str < now_iso:
                    logger.warning(f"Found expired lock for job {item['job_id']}. Adding to queue.")
                    found_jobs[item['job_id']] = item
                    expired_job_count += 1
            
            if expired_job_count > 0:
                logger.info(f"Identified {expired_job_count} jobs with expired locks.")

            return list(found_jobs.values())

        except Exception as e:
            logger.error(f"Error finding pending jobs: {e}", exc_info=True)
            return []
        
    async def check_batch_status(self, job_item: Dict) -> Optional[str]:
        """Checks the status of a single Anthropic batch job."""
        job_id = job_item.get('job_id', 'unknown')
        batch_id = job_item.get('batch_id')

        if not self.anthropic:
            logger.error(f"Job {job_id}: Anthropic client not initialized, cannot check status.")
            return None
        
        if not batch_id:
            logger.error(f"Job {job_id}: Missing 'batch_id', cannot check status.")
            return "BATCH_NOT_FOUND" # Treat as a terminal failure

        try:
            logger.info(f"Job {job_id}: Checking status for Anthropic batch {batch_id}...")
            batch = self.anthropic.beta.messages.batches.retrieve(batch_id)
            status = batch.processing_status
            logger.info(f"Job {job_id}: Anthropic batch status is '{status}'.")
            
            # Update the job item in DynamoDB with the latest status for observability
            self.job_table.update_item(
                Key={'job_id': job_id},
                UpdateExpression="SET batch_status = :status, last_checked = :time",
                ExpressionAttributeValues={
                    ':status': status,
                    ':time': datetime.now(timezone.utc).isoformat()
                }
            )
            return status
        except Exception as e:
            error_str = str(e)
            if "404" in error_str or "not_found" in error_str:
                logger.error(f"Job {job_id}: Batch {batch_id} not found in Anthropic API (404). This is a terminal error.")
                return "BATCH_NOT_FOUND"
            
            logger.error(f"Job {job_id}: An API error occurred while checking batch {batch_id}: {e}")
            return None # Return None to indicate a transient error, allowing a retry after the lock expires

    async def process_batch_results(self, job_item: Dict) -> bool:
        """Downloads, parses, and stores results for a completed batch job."""
        job_id = job_item.get('job_id', 'unknown')
        batch_id = job_item.get('batch_id')
        report_id = job_item.get('report_id')

        if not all([job_id, batch_id, report_id, self.anthropic]):
            logger.error(f"Job {job_id}: Missing required info (job_id, batch_id, report_id, or client) for processing.")
            return False

        try:
            logger.info(f"Job {job_id}: Retrieving results for completed batch {batch_id}...")
            # Anthropic's SDK can stream results which is memory efficient
            results_stream = self.anthropic.beta.messages.batches.results(batch_id)

            processed_count = 0
            failed_count = 0
            
            for entry in results_stream:
                if entry.result.type == "succeeded":
                    custom_id = entry.custom_id
                    response_message = entry.result.message
                    model = response_message.model
                    content = response_message.content[0].text if response_message.content else "{}"

                    # Reconstruct the section name from the custom_id
                    parts = custom_id.split('_', 1)
                    if len(parts) < 2:
                        logger.error(f"Job {job_id}: Invalid custom_id format '{custom_id}'. Skipping result.")
                        failed_count += 1
                        continue
                    section_name = parts[1]

                    # Store the report
                    rid_section_model = f"{report_id}#{section_name}#{model}"
                    self.report_table.put_item(Item={
                        'rid_section_model': rid_section_model,
                        'timestamp': datetime.now(timezone.utc).isoformat(),
                        'report_id': report_id,
                        'section': section_name,
                        'model': model,
                        'report_data': content,
                        'job_id': job_id,
                        'batch_id': batch_id,
                    })
                    logger.info(f"Job {job_id}: Successfully stored report for section '{section_name}'.")
                    processed_count += 1

                elif entry.result.type == "failed":
                    failed_count += 1
                    logger.error(f"Job {job_id}: A request in batch {batch_id} failed. Custom ID: {entry.custom_id}, Error: {entry.result.error}")

            # Finalize the job status
            final_status = 'COMPLETED' if processed_count > 0 else 'FAILED'
            update_expression = "SET #s = :status, completed_at = :time"
            expression_values = {':status': final_status, ':time': datetime.now(timezone.utc).isoformat()}
            
            if failed_count > 0:
                update_expression += ", error_message = :error"
                expression_values[':error'] = f"{failed_count} of {failed_count + processed_count} batch requests failed."

            self.job_table.update_item(
                Key={'job_id': job_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues=expression_values
            )
            logger.info(f"Job {job_id}: Final status set to '{final_status}'. Processed: {processed_count}, Failed: {failed_count}.")
            
            return processed_count > 0
        
        except Exception as e:
            logger.error(f"Job {job_id}: A critical error occurred during result processing for batch {batch_id}: {e}", exc_info=True)
            # Mark the job as FAILED
            self.job_table.update_item(Key={'job_id': job_id}, UpdateExpression="SET #s = :s, error_message = :e", ExpressionAttributeNames={'#s':'status'}, ExpressionAttributeValues={':s':'FAILED', ':e': f"Result processing error: {str(e)}"})
            return False

    async def check_and_process_jobs(self, specific_job_id: Optional[str] = None) -> Optional[int]:
        jobs_to_check = self.find_pending_jobs(specific_job_id)

        if not jobs_to_check:
            if specific_job_id:
                logger.error(f"Job {specific_job_id} not found or no longer in a processable state.")
                return self.EXIT_CODE_TERMINAL_STATE
            logger.info("No pending batch jobs found in this polling cycle.")
            return None

        for job_item in jobs_to_check:
            job_id = job_item.get('job_id')
            if not job_id: continue

            current_status = job_item.get('status')
            now_iso = datetime.now(timezone.utc).isoformat()
            new_expiry_iso = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

            try:
                logger.info(f"Attempting to lock job {job_id} (current status: {current_status})...")
                condition_expr = "(#s = :processing_status) OR (#s = :locked_status AND lock_expires_at < :now)"
                self.job_table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="SET #s = :new_locked_status, lock_expires_at = :new_expiry, last_checked = :now",
                    ConditionExpression=condition_expr,
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={
                        ':processing_status': 'PROCESSING',
                        ':locked_status': 'LOCKED_FOR_CHECKING',
                        ':new_locked_status': 'LOCKED_FOR_CHECKING',
                        ':now': now_iso,
                        ':new_expiry': new_expiry_iso
                    }
                )
                logger.info(f"Successfully locked job {job_id}. Lock expires at {new_expiry_iso}.")
            
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    logger.warning(f"Job {job_id} was locked or processed by another worker. Skipping.")
                    continue
                else:
                    logger.error(f"Error locking job {job_id}: {e}")
                    continue

            current_job_processing_signal = self.EXIT_CODE_SCRIPT_ERROR
            try:
                batch_api_status = await self.check_batch_status(job_item)

                if batch_api_status in [ANTHROPIC_BATCH_COMPLETED, ANTHROPIC_BATCH_ENDED]:
                    await self.process_batch_results(job_item)
                    current_job_processing_signal = self.EXIT_CODE_TERMINAL_STATE
                
                elif batch_api_status in [ANTHROPIC_BATCH_FAILED, ANTHROPIC_BATCH_CANCELLED, "BATCH_NOT_FOUND"]:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET #s = :final_status, completed_at = :time, error_message = :error",
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues={
                            ':final_status': 'FAILED',
                            ':time': now_iso,
                            ':error': f"Batch terminal status: {batch_api_status}"
                        }
                    )
                    current_job_processing_signal = self.EXIT_CODE_TERMINAL_STATE

                elif batch_api_status in NON_TERMINAL_BATCH_STATES:
                    logger.info(f"Job {job_id}: Batch still {batch_api_status}. Lock will time out if worker fails.")
                    current_job_processing_signal = self.EXIT_CODE_PROCESSING_CONTINUES

                else:
                    logger.error(f"Job {job_id}: Could not determine batch status. Lock will time out.")
                    current_job_processing_signal = self.EXIT_CODE_SCRIPT_ERROR
            
            except Exception as processing_error:
                logger.error(f"Critical error processing locked job {job_id}: {processing_error}", exc_info=True)
                try:
                    self.job_table.update_item(Key={'job_id': job_id}, UpdateExpression="SET #s = :s, error_message = :e", ExpressionAttributeNames={'#s':'status'}, ExpressionAttributeValues={':s':'FAILED', ':e': str(processing_error)})
                except Exception as final_error:
                    logger.critical(f"FATAL: Could not mark job {job_id} as FAILED. It is now a zombie: {final_error}")
                current_job_processing_signal = self.EXIT_CODE_SCRIPT_ERROR

            if specific_job_id:
                return current_job_processing_signal
        
        return None

async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Check and process Anthropic Batch API results')
    parser.add_argument('--job-id', type=str, help='Specific job ID to check')
    parser.add_argument('--polling-interval', type=int, default=60, help='Seconds to wait between checks')
    parser.add_argument('--log-level', type=str, default='INFO', help='Logging level')
    args = parser.parse_args()

    # Set log level
    log_level_val = getattr(logging, args.log_level.upper(), logging.INFO)
    logger.setLevel(log_level_val)
    # Ensure subordinate loggers also get the level if they don't propagate or have their own handlers
    # For this script, the main logger setup should suffice.

    # Create batch status checker
    checker = BatchStatusChecker(log_level=log_level_val)

    if args.job_id:
        # Check specific job once and exit with appropriate code
        logger.info(f"Running in single-check mode for job ID: {args.job_id}")
        exit_signal = await checker.check_and_process_jobs(args.job_id)
        
        if exit_signal is None:
            # This case should ideally be covered by check_and_process_jobs returning a specific code
            # (e.g., TERMINAL_STATE if job not found/actionable, or SCRIPT_ERROR).
            logger.error(f"check_and_process_jobs did not return an explicit exit signal for job {args.job_id}. Defaulting to script error exit code.")
            sys.exit(EXIT_CODE_SCRIPT_ERROR) # Using module-level constant
        else:
            sys.exit(exit_signal)
    else:
        # Polling loop for continuous operation
        logger.info("Running in polling mode.")
        try:
            while True:
                await checker.check_and_process_jobs() # In polling mode, this processes all found pending jobs.
                                                       # The return value is not used for sys.exit here.
                await asyncio.sleep(args.polling_interval)
        except KeyboardInterrupt:
            logger.info("Batch status checker (polling mode) stopped by user.")
            sys.exit(0) # Clean exit for Ctrl+C
        except Exception as e:
            logger.error(f"Critical error in polling loop: {str(e)}")
            logger.error(traceback.format_exc())
            sys.exit(EXIT_CODE_SCRIPT_ERROR) # Error in the polling mechanism itself

if __name__ == "__main__":
    # Module-level constants are accessible here
    asyncio.run(main())