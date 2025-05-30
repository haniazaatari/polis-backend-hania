#!/usr/bin/env python3
"""
Check and process Anthropic Batch API results for participant cluster narrative reports.

This script:
1. Checks the status of submitted participant cluster batches in the job queue
2. Retrieves results for completed batches
3. Processes the results and stores them in the report database
4. Updates job status when processing is complete

Usage:
    python 812_check_participant_batch_status.py [--job-id JOB_ID] [--batch-id BATCH_ID] [--polling-interval SECONDS]

Args:
    --job-id: Optional specific job ID to check
    --batch-id: Optional specific batch ID to check
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
import traceback
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union, Any
from pathlib import Path

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

# Script Exit Codes
EXIT_CODE_TERMINAL_STATE = 0      # Batch is done (completed/failed/cancelled), script handled it.
EXIT_CODE_SCRIPT_ERROR = 1        # The script itself had an issue processing the specified job.
EXIT_CODE_PROCESSING_CONTINUES = 3 # Batch is still processing, poller should wait and re-check.

class ParticipantBatchStatusChecker:
    """Check and process Anthropic Batch API results for participant clusters."""

    # Define exit codes as class attributes
    EXIT_CODE_TERMINAL_STATE = EXIT_CODE_TERMINAL_STATE
    EXIT_CODE_SCRIPT_ERROR = EXIT_CODE_SCRIPT_ERROR
    EXIT_CODE_PROCESSING_CONTINUES = EXIT_CODE_PROCESSING_CONTINUES

    def __init__(self, log_level=logging.INFO):
        """Initialize the participant batch status checker."""
        # Set log level
        logger.setLevel(log_level)

        # Set up DynamoDB connection
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
            region_name=os.environ.get('AWS_REGION', 'us-west-2'),
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
        )

        # Get job queue table
        self.job_table = self.dynamodb.Table('Delphi_JobQueue')

        # Get report storage table
        self.report_table = self.dynamodb.Table('Delphi_NarrativeReports')

        # Initialize Anthropic client
        try:
            from anthropic import Anthropic, APIError, APIConnectionError, APIResponseValidationError, APIStatusError
            
            api_key = os.environ.get('ANTHROPIC_API_KEY')
            if not api_key:
                logger.error("ANTHROPIC_API_KEY environment variable not found")
                self.anthropic = None
                return
                
            self.anthropic = Anthropic(api_key=api_key)
            logger.info("Successfully initialized Anthropic client for participant batch status checking")
            
        except ImportError as e:
            logger.error(f"Failed to import Anthropic SDK: {e}")
            self.anthropic = None
        except Exception as e:
            logger.error(f"Failed to initialize Anthropic client: {e}")
            self.anthropic = None

    def get_jobs_with_batches(self, job_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get jobs that have batch_id set and are not yet completed."""
        try:
            if job_id:
                # Check specific job
                response = self.job_table.get_item(Key={'job_id': job_id})
                if 'Item' in response:
                    job = response['Item']
                    if job.get('batch_id') and job.get('status') not in ['COMPLETED', 'FAILED']:
                        return [job]
                return []
            else:
                # Scan for jobs with batch_id
                response = self.job_table.scan(
                    FilterExpression='attribute_exists(batch_id) AND #status <> :completed AND #status <> :failed',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':completed': 'COMPLETED',
                        ':failed': 'FAILED'
                    }
                )
                return response.get('Items', [])
                
        except Exception as e:
            logger.error(f"Error getting jobs with batches: {e}")
            return []

    def check_batch_status(self, batch_id: str) -> Dict[str, Any]:
        """Check the status of a batch with Anthropic API."""
        try:
            if not self.anthropic:
                logger.error("Anthropic client not initialized")
                return {'status': 'unknown', 'error': 'Anthropic client not available'}

            batch = self.anthropic.batches.retrieve(batch_id)
            
            status_info = {
                'status': batch.processing_status,
                'request_counts': batch.request_counts.__dict__ if batch.request_counts else {},
                'ended_at': batch.ended_at,
                'created_at': batch.created_at,
                'results_url': batch.results_url if hasattr(batch, 'results_url') else None
            }
            
            logger.info(f"Batch {batch_id} status: {batch.processing_status}")
            if batch.request_counts:
                logger.info(f"Request counts: {batch.request_counts.__dict__}")
            
            return status_info
            
        except Exception as e:
            logger.error(f"Error checking batch {batch_id}: {e}")
            return {'status': 'error', 'error': str(e)}

    def process_completed_batch(self, job: Dict[str, Any], batch_status: Dict[str, Any]) -> bool:
        """Process a completed batch and store results."""
        try:
            batch_id = job['batch_id']
            job_id = job['job_id']
            
            logger.info(f"Processing completed participant batch {batch_id} for job {job_id}")
            
            # Get batch results from Anthropic
            batch_results = self.anthropic.batches.list_results(batch_id)
            
            successful_reports = 0
            failed_reports = 0
            
            for result in batch_results:
                try:
                    # Extract metadata from custom_id
                    custom_id = result.custom_id
                    if not custom_id.startswith('participant_cluster_'):
                        logger.warning(f"Unexpected custom_id format: {custom_id}")
                        continue
                    
                    # Parse custom_id: participant_cluster_{cluster_id}_{conversation_id}
                    parts = custom_id.split('_')
                    if len(parts) >= 4:
                        cluster_id = parts[2]
                        conversation_id = parts[3]
                    else:
                        logger.warning(f"Could not parse custom_id: {custom_id}")
                        continue
                    
                    # Check if request was successful
                    if hasattr(result, 'result') and result.result:
                        if hasattr(result.result, 'type') and result.result.type == 'message':
                            # Extract the content
                            if hasattr(result.result, 'message') and result.result.message.content:
                                content = result.result.message.content[0].text
                                
                                # Store the report
                                self.store_participant_report(
                                    job_id=job_id,
                                    conversation_id=conversation_id,
                                    cluster_id=cluster_id,
                                    report_content=content,
                                    batch_id=batch_id
                                )
                                
                                successful_reports += 1
                                logger.info(f"Successfully stored report for participant cluster {cluster_id}")
                            else:
                                logger.error(f"No content in result for {custom_id}")
                                failed_reports += 1
                        else:
                            logger.error(f"Unexpected result type for {custom_id}: {result.result.type if hasattr(result.result, 'type') else 'unknown'}")
                            failed_reports += 1
                    else:
                        # Handle error case
                        if hasattr(result, 'result') and hasattr(result.result, 'error'):
                            logger.error(f"API error for {custom_id}: {result.result.error}")
                        else:
                            logger.error(f"Unknown error for {custom_id}")
                        failed_reports += 1
                        
                except Exception as e:
                    logger.error(f"Error processing result for {custom_id}: {e}")
                    failed_reports += 1
                    continue
            
            # Update job status
            self.update_job_completion_status(
                job_id=job_id,
                status='COMPLETED' if failed_reports == 0 else 'COMPLETED_WITH_ERRORS',
                results_summary={
                    'successful_reports': successful_reports,
                    'failed_reports': failed_reports,
                    'batch_id': batch_id,
                    'batch_status': batch_status.get('status'),
                    'completion_time': datetime.now().isoformat()
                }
            )
            
            logger.info(f"Batch processing complete: {successful_reports} successful, {failed_reports} failed")
            return True
            
        except Exception as e:
            logger.error(f"Error processing completed batch: {e}")
            logger.error(traceback.format_exc())
            
            # Update job with error status
            try:
                self.update_job_completion_status(
                    job_id=job['job_id'],
                    status='FAILED',
                    results_summary={
                        'error': str(e),
                        'batch_id': job['batch_id'],
                        'completion_time': datetime.now().isoformat()
                    }
                )
            except:
                pass
            
            return False

    def store_participant_report(self, job_id: str, conversation_id: str, cluster_id: str, 
                               report_content: str, batch_id: str):
        """Store a participant cluster report in DynamoDB."""
        try:
            # Create section name for participant cluster
            section_name = f"participant_cluster_{cluster_id}"
            
            # Get model from environment or use default
            model = os.environ.get('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022')
            
            # Create report ID from conversation ID
            report_id = f"conversation_{conversation_id}"
            
            # Create composite key
            rid_section_model = f"{report_id}#{section_name}#{model}"
            
            # Store report
            self.report_table.put_item(
                Item={
                    'rid_section_model': rid_section_model,
                    'timestamp': datetime.now().isoformat(),
                    'report_id': report_id,
                    'section': section_name,
                    'model': model,
                    'report_data': report_content,
                    'job_id': job_id,
                    'batch_id': batch_id,
                    'cluster_id': int(cluster_id),
                    'conversation_id': conversation_id,
                    'report_type': 'participant_cluster'
                }
            )
            
            logger.info(f"Stored participant cluster report: {rid_section_model}")
            
        except Exception as e:
            logger.error(f"Error storing participant report: {e}")
            raise

    def update_job_completion_status(self, job_id: str, status: str, results_summary: Dict[str, Any]):
        """Update job completion status in DynamoDB."""
        try:
            self.job_table.update_item(
                Key={'job_id': job_id},
                UpdateExpression='SET #status = :status, results_summary = :summary, completed_at = :timestamp',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': status,
                    ':summary': json.dumps(results_summary),
                    ':timestamp': datetime.now().isoformat()
                }
            )
            
            logger.info(f"Updated job {job_id} status to {status}")
            
        except Exception as e:
            logger.error(f"Error updating job status: {e}")
            raise

    def check_specific_batch(self, batch_id: str) -> int:
        """Check a specific batch ID and return appropriate exit code."""
        try:
            # Check batch status
            batch_status = self.check_batch_status(batch_id)
            
            if batch_status['status'] in TERMINAL_BATCH_STATES:
                logger.info(f"Batch {batch_id} is in terminal state: {batch_status['status']}")
                
                # Find job with this batch_id
                response = self.job_table.scan(
                    FilterExpression='batch_id = :batch_id',
                    ExpressionAttributeValues={':batch_id': batch_id}
                )
                
                jobs = response.get('Items', [])
                if not jobs:
                    logger.warning(f"No job found for batch {batch_id}")
                    return self.EXIT_CODE_TERMINAL_STATE
                
                job = jobs[0]  # Take first match
                
                if batch_status['status'] in [ANTHROPIC_BATCH_COMPLETED, ANTHROPIC_BATCH_ENDED]:
                    # Process completed batch
                    success = self.process_completed_batch(job, batch_status)
                    return self.EXIT_CODE_TERMINAL_STATE
                else:
                    # Failed or cancelled
                    self.update_job_completion_status(
                        job_id=job['job_id'],
                        status='FAILED',
                        results_summary={
                            'batch_status': batch_status['status'],
                            'error': batch_status.get('error', 'Batch failed or was cancelled'),
                            'completion_time': datetime.now().isoformat()
                        }
                    )
                    return self.EXIT_CODE_TERMINAL_STATE
            else:
                logger.info(f"Batch {batch_id} still processing: {batch_status['status']}")
                return self.EXIT_CODE_PROCESSING_CONTINUES
                
        except Exception as e:
            logger.error(f"Error checking specific batch {batch_id}: {e}")
            logger.error(traceback.format_exc())
            return self.EXIT_CODE_SCRIPT_ERROR

    def check_and_process_batches(self, job_id: Optional[str] = None) -> int:
        """Check and process all pending batches."""
        try:
            jobs = self.get_jobs_with_batches(job_id)
            
            if not jobs:
                if job_id:
                    logger.info(f"No pending batch found for job {job_id}")
                else:
                    logger.info("No pending participant cluster batches found")
                return self.EXIT_CODE_TERMINAL_STATE
            
            logger.info(f"Checking {len(jobs)} participant cluster jobs with pending batches")
            
            for job in jobs:
                try:
                    batch_id = job['batch_id']
                    job_id = job['job_id']
                    
                    logger.info(f"Checking batch {batch_id} for job {job_id}")
                    
                    # Check batch status
                    batch_status = self.check_batch_status(batch_id)
                    
                    if batch_status['status'] in TERMINAL_BATCH_STATES:
                        if batch_status['status'] in [ANTHROPIC_BATCH_COMPLETED, ANTHROPIC_BATCH_ENDED]:
                            # Process completed batch
                            self.process_completed_batch(job, batch_status)
                        else:
                            # Failed or cancelled
                            self.update_job_completion_status(
                                job_id=job_id,
                                status='FAILED',
                                results_summary={
                                    'batch_status': batch_status['status'],
                                    'error': batch_status.get('error', 'Batch failed or was cancelled'),
                                    'completion_time': datetime.now().isoformat()
                                }
                            )
                    else:
                        logger.info(f"Batch {batch_id} still processing: {batch_status['status']}")
                        # Update batch status in job
                        self.job_table.update_item(
                            Key={'job_id': job_id},
                            UpdateExpression='SET batch_status = :status, last_checked = :timestamp',
                            ExpressionAttributeValues={
                                ':status': batch_status['status'],
                                ':timestamp': datetime.now().isoformat()
                            }
                        )
                        
                except Exception as e:
                    logger.error(f"Error processing job {job.get('job_id', 'unknown')}: {e}")
                    continue
            
            return self.EXIT_CODE_TERMINAL_STATE
            
        except Exception as e:
            logger.error(f"Error checking and processing batches: {e}")
            logger.error(traceback.format_exc())
            return self.EXIT_CODE_SCRIPT_ERROR

def main():
    """Main function to parse arguments and check batch status."""
    parser = argparse.ArgumentParser(description="Check participant cluster batch status and process results")
    parser.add_argument("--job-id", type=str, help="Specific job ID to check")
    parser.add_argument("--batch-id", type=str, help="Specific batch ID to check")
    parser.add_argument("--polling-interval", type=int, default=60, help="Polling interval in seconds")
    parser.add_argument("--log-level", type=str, default="INFO", 
                       choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                       help="Logging level")
    
    args = parser.parse_args()
    
    # Set log level
    log_level = getattr(logging, args.log_level.upper())
    
    try:
        checker = ParticipantBatchStatusChecker(log_level=log_level)
        
        if not checker.anthropic:
            logger.error("Failed to initialize Anthropic client")
            return 1
        
        if args.batch_id:
            # Check specific batch
            return checker.check_specific_batch(args.batch_id)
        else:
            # Check all batches or specific job
            return checker.check_and_process_batches(args.job_id)
            
    except Exception as e:
        logger.error(f"Error in main: {e}")
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)