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

    # Define exit codes as class attributes for clarity and access in main
    EXIT_CODE_TERMINAL_STATE = EXIT_CODE_TERMINAL_STATE
    EXIT_CODE_SCRIPT_ERROR = EXIT_CODE_SCRIPT_ERROR
    EXIT_CODE_PROCESSING_CONTINUES = EXIT_CODE_PROCESSING_CONTINUES

    def __init__(self, log_level=logging.INFO):
        """Initialize the batch status checker."""
        # Set log level
        logger.setLevel(log_level)

        # Set up DynamoDB connection
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
        )

        # Get job queue table
        self.job_table = self.dynamodb.Table('Delphi_JobQueue')

        # Get report storage table
        self.report_table = self.dynamodb.Table('Delphi_NarrativeReports')

        # Try to import Anthropic client with comprehensive error handling
        try:
            try:
                from anthropic import Anthropic, APIError, APIConnectionError, APIResponseValidationError, APIStatusError
            except ImportError as e:
                logger.error(f"Failed to import Anthropic SDK: {str(e)}")
                logger.error(f"System paths: {sys.path}")
                logger.error("Attempting to install Anthropic SDK...")
                try:
                    import subprocess
                    subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic"])
                    from anthropic import Anthropic, APIError, APIConnectionError, APIResponseValidationError, APIStatusError
                except Exception as e:
                    logger.error(f"Failed to install Anthropic SDK: {str(e)}")
                    logger.error(traceback.format_exc())
                    self.anthropic = None
                    return

            # Initialize Anthropic client
            anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                logger.error("ANTHROPIC_API_KEY environment variable is not set - cannot check batch status")
                self.anthropic = None
            else:
                try:
                    self.anthropic = Anthropic(api_key=anthropic_api_key)
                except Exception as e:
                    logger.error(f"Failed to initialize Anthropic client: {str(e)}")
                    logger.error(traceback.format_exc())
                    self.anthropic = None
        except Exception as e:
            logger.error(f"Unexpected error initializing Anthropic client: {str(e)}")
            logger.error(traceback.format_exc())
            self.anthropic = None

    def find_pending_jobs(self, specific_job_id: Optional[str] = None) -> List[Dict]:
        """
        Find jobs with pending batch requests, with full pagination support.

        Args:
            specific_job_id: Optional specific job ID to check

        Returns:
            List of job items with batch information.
        """
        try:
            if specific_job_id:
                response = self.job_table.get_item(Key={'job_id': specific_job_id})
                items_to_process = [response.get('Item')] if 'Item' in response else []
            else:
                # Polling mode: Query the GSI to get all 'PROCESSING' jobs.
                logger.info("Querying GSI 'StatusCreatedIndex' for all pages of jobs with status 'PROCESSING'")
                
                items_to_process = []
                last_evaluated_key = None

                while True:
                    query_kwargs = {
                        'IndexName': 'StatusCreatedIndex',
                        'KeyConditionExpression': '#s = :status',
                        'ExpressionAttributeNames': {'#s': 'status'},
                        'ExpressionAttributeValues': {':status': 'PROCESSING'}
                    }
                    
                    # If there's a key from the last response, add it to start the next query from there.
                    if last_evaluated_key:
                        query_kwargs['ExclusiveStartKey'] = last_evaluated_key
                    
                    response = self.job_table.query(**query_kwargs)
                    items_to_process.extend(response.get('Items', []))
                    
                    # Get the key for the next page. If it's not present, we're done.
                    last_evaluated_key = response.get('LastEvaluatedKey')
                    if not last_evaluated_key:
                        break
                
                logger.info(f"Found {len(items_to_process)} total jobs in 'PROCESSING' state across all pages.")

            # Post-query filtering: only return jobs that have a batch_id.
            result = [item for item in items_to_process if item and 'batch_id' in item]
            return result
            
        except Exception as e:
            logger.error(f"Error finding pending jobs: {str(e)}")
            logger.error(traceback.format_exc())
            return []

    async def check_batch_status(self, job_item: Dict) -> Optional[str]:
        """Check status of a batch job.

        Args:
            job_item: Job item with batch information

        Returns:
            Batch status or None if checking failed
        """
        job_id = job_item.get('job_id', 'unknown')

        try:
            # First verify the Anthropic client is initialized
            if not self.anthropic:
                logger.error(f"Job {job_id}: Anthropic client not initialized. Cannot check batch status.")

                # Update job with error
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET error_message = :error, last_checked = :time",
                        ExpressionAttributeValues={
                            ':error': "Anthropic client not initialized - missing API key or SDK",
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return None

            # Get batch ID
            batch_id = job_item.get('batch_id')
            if not batch_id:
                error_msg = f"No batch_id found for job {job_id}"
                logger.error(error_msg)
                logger.error(f"Job fields available: {list(job_item.keys())}")

                # Update job with error since we can't proceed without a batch_id
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET error_message = :error, last_checked = :time, #s = :status",
                        ExpressionAttributeNames={
                            '#s': 'status'  # Use ExpressionAttributeNames for reserved keyword
                        },
                        ExpressionAttributeValues={
                            ':error': error_msg,
                            ':time': datetime.now().isoformat(),
                            ':status': 'FAILED'
                        }
                    )
                    logger.error(f"Job {job_id}: Marked as FAILED - no batch_id found")
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return None

            # Get batch details from Anthropic with detailed error handling
            try:
                batch = self.anthropic.beta.messages.batches.retrieve(batch_id)

                # Update job with current batch status
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET batch_status = :status, last_checked = :time",
                        ExpressionAttributeValues={
                            ':status': batch.processing_status,
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with batch status: {str(update_error)}")
                    logger.error(traceback.format_exc())

                return batch.processing_status

            except Exception as api_error:
                error_msg = f"Error retrieving batch status from Anthropic API: {str(api_error)}"
                logger.error(f"Job {job_id}: {error_msg}")
                logger.error(traceback.format_exc())

                # Check for specific error types
                if "404" in str(api_error) or "not found" in str(api_error).lower():
                    logger.error(f"Job {job_id}: Batch {batch_id} not found in Anthropic API")
                    # This is a terminal error - the batch ID is invalid or doesn't exist
                    error_detail = "Batch ID not found in Anthropic API - may have been deleted or never created properly"
                    
                    # Mark the job as FAILED since this is unrecoverable
                    try:
                        self.job_table.update_item(
                            Key={'job_id': job_id},
                            UpdateExpression="SET #s = :status, error_message = :error, completed_at = :time",
                            ExpressionAttributeNames={'#s': 'status'},
                            ExpressionAttributeValues={
                                ':status': 'FAILED',
                                ':error': error_detail,
                                ':time': datetime.now().isoformat()
                            }
                        )
                        logger.info(f"Job {job_id}: Marked as FAILED due to batch not found")
                    except Exception as update_error:
                        logger.error(f"Job {job_id}: Failed to mark job as FAILED: {str(update_error)}")
                    
                    # Return a special status to indicate terminal failure
                    return "BATCH_NOT_FOUND"
                elif "401" in str(api_error) or "unauthorized" in str(api_error).lower():
                    logger.error(f"Job {job_id}: Authentication failed with Anthropic API")
                    error_detail = "Anthropic API authentication failed - check API key"
                else:
                    error_detail = f"API error: {str(api_error)}"

                # Update job with error
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET error_message = :error, last_checked = :time",
                        ExpressionAttributeValues={
                            ':error': error_detail,
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return None

        except Exception as e:
            error_msg = f"Unhandled error checking batch status: {str(e)}"
            logger.error(f"Job {job_id}: {error_msg}")
            logger.error(traceback.format_exc())

            # Update job with error
            try:
                self.job_table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="SET error_message = :error, last_checked = :time",
                    ExpressionAttributeValues={
                        ':error': error_msg,
                        ':time': datetime.now().isoformat()
                    }
                )
            except Exception as update_error:
                logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

            return None

    async def process_batch_results(self, job_item: Dict) -> bool:
        """Process results from a completed batch.

        Args:
            job_item: Job item with batch information

        Returns:
            True if processing was successful, False otherwise
        """
        job_id = job_item.get('job_id', 'unknown')

        try:
            # Verify Anthropic client is initialized
            if not self.anthropic:
                error_msg = "Anthropic client not initialized. Cannot process batch results."
                logger.error(f"Job {job_id}: {error_msg}")

                # Update job with error
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET error_message = :error, last_checked = :time",
                        ExpressionAttributeValues={
                            ':error': error_msg,
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return False

            # Get required fields
            batch_id = job_item.get('batch_id')
            report_id = job_item.get('report_id')

            if not all([job_id, batch_id, report_id]):
                missing_fields = []
                if not job_id: missing_fields.append("job_id")
                if not batch_id: missing_fields.append("batch_id")
                if not report_id: missing_fields.append("report_id")

                error_msg = f"Missing required information for job: {', '.join(missing_fields)}"
                logger.error(f"Job {job_id}: {error_msg}")

                # Update job with error
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET error_message = :error, last_checked = :time",
                        ExpressionAttributeValues={
                            ':error': error_msg,
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return False

            logger.info(f"Job {job_id}: Processing results for batch {batch_id}, report {report_id}")

            # Get batch results from Anthropic with detailed error handling
            try:
                logger.info(f"Job {job_id}: Retrieving batch results from Anthropic API")
                results_stream = self.anthropic.beta.messages.batches.results(batch_id)
                results = []
                processed_count = 0
                failed_count = 0

                # Process results
                logger.info(f"Job {job_id}: Starting to process results")
                try:
                    # Get batch details to get the requests data
                    batch_details = self.anthropic.beta.messages.batches.retrieve(batch_id)
                    logger.info(f"Job {job_id}: Retrieved batch details, getting results")

                    # Get results data directly using requests
                    import requests

                    headers = {
                        'x-api-key': self.anthropic.api_key,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    }

                    response = requests.get(
                        f'https://api.anthropic.com/v1/messages/batches/{batch_id}/results?beta=true',
                        headers=headers
                    )
                    response.raise_for_status()

                    # Process response text as a series of JSON objects
                    # Each line of the response is a JSON object
                    import json

                    entries = []
                    for line in response.text.strip().split('\n'):
                        if line.strip():
                            try:
                                entry = json.loads(line)
                                entries.append(entry)
                            except json.JSONDecodeError as e:
                                logger.error(f"Job {job_id}: Error parsing JSON line: {str(e)}")
                                logger.error(f"Job {job_id}: Line content: {line}")

                    logger.info(f"Job {job_id}: Found {len(entries)} result entries")

                    # Process each entry
                    for entry in entries:
                        try:
                            # Log each entry for debugging
                            logger.info(f"Job {job_id}: Processing result entry: {entry}")

                            # Check if this is a successful result
                            if entry.get('result', {}).get('type') == 'succeeded':
                                processed_count += 1

                                # Extract metadata from custom_id - it's at the top level of the entry
                                custom_id = entry.get('custom_id')
                                logger.info(f"Job {job_id}: Processing successful result for custom_id: {custom_id}")

                                # Extract section name from custom_id - this is critical for proper mapping
                                if not custom_id:
                                    logger.error(f"Job {job_id}: Missing custom_id in batch result entry - cannot process this result")
                                    logger.error(f"Job {job_id}: Entry data: {json.dumps(entry, indent=2)}")
                                    failed_count += 1
                                    results.append({
                                        'custom_id': None,
                                        'status': 'failed',
                                        'error': 'Missing custom_id in batch response',
                                        'timestamp': datetime.now().isoformat()
                                    })
                                    continue
                                
                                # Parse section name from custom_id format: conversation_id_section_name
                                parts = custom_id.split('_', 1)
                                if len(parts) != 2:
                                    logger.error(f"Job {job_id}: Invalid custom_id format: {custom_id} - expected format: conversationId_sectionName")
                                    failed_count += 1
                                    results.append({
                                        'custom_id': custom_id,
                                        'status': 'failed',
                                        'error': f'Invalid custom_id format: {custom_id}',
                                        'timestamp': datetime.now().isoformat()
                                    })
                                    continue
                                
                                section_name = parts[1]

                                logger.info(f"Job {job_id}: Extracted section name: {section_name}")

                                # Get the message from the result
                                message = entry.get('result', {}).get('message', {})
                                
                                # Get the model name
                                model = message.get('model', 'unknown')
                                logger.info(f"Job {job_id}: Using model: {model}")

                                # Get the response content
                                content_items = message.get('content', [])

                                if content_items and len(content_items) > 0:
                                    content = content_items[0].get('text', '')
                                    content_preview = content[:100] + "..." if len(content) > 100 else content
                                    logger.info(f"Job {job_id}: Received content (preview): {content_preview}")
                                else:
                                    logger.error(f"Job {job_id}: No content found in message")
                                    content = "{}"

                                # Store in report table
                                try:
                                    # Format the key with # delimiters to match server query expectations
                                    rid_section_model = f"{report_id}#{section_name}#{model}"
                                    timestamp = datetime.now().isoformat()

                                    item = {
                                        'rid_section_model': rid_section_model,
                                        'timestamp': timestamp,
                                        'report_id': report_id,
                                        'section': section_name,
                                        'model': model,
                                        'report_data': content,
                                        'job_id': job_id,
                                        'batch_id': batch_id,
                                        'custom_id': custom_id
                                    }

                                    logger.info(f"Job {job_id}: Storing report for {rid_section_model}")
                                    self.report_table.put_item(Item=item)
                                    logger.info(f"Job {job_id}: Successfully stored report for {rid_section_model}")

                                    results.append({
                                        'custom_id': custom_id,
                                        'section': section_name,
                                        'status': 'succeeded',
                                        'timestamp': timestamp
                                    })
                                except Exception as store_error:
                                    logger.error(f"Job {job_id}: Error storing report for {custom_id}: {str(store_error)}")
                                    logger.error(traceback.format_exc())
                                    results.append({
                                        'custom_id': custom_id,
                                        'section': section_name,
                                        'status': 'failed',
                                        'error': f"Error storing report: {str(store_error)}",
                                        'timestamp': datetime.now().isoformat()
                                    })

                            elif entry.get('result', {}).get('type') == "failed":
                                # Log failed requests
                                failed_count += 1
                                custom_id = entry.get('custom_id')
                                error_message = entry.get('result', {}).get('error', {}).get('message', 'Unknown error')
                                logger.error(f"Job {job_id}: Request failed for {custom_id}: {error_message}")

                                results.append({
                                    'custom_id': custom_id,
                                    'status': 'failed',
                                    'error': error_message,
                                    'timestamp': datetime.now().isoformat()
                                })
                            else:
                                # Unknown result type
                                result_type = entry.get('result', {}).get('type', 'unknown')
                                custom_id = entry.get('custom_id', 'unknown')
                                logger.warning(f"Job {job_id}: Unknown result type: {result_type} for {custom_id}")
                                results.append({
                                    'custom_id': custom_id,
                                    'status': 'unknown',
                                    'detail': f"Unknown result type: {result_type}",
                                    'timestamp': datetime.now().isoformat()
                                })
                        except Exception as entry_error:
                            logger.error(f"Job {job_id}: Error processing result entry: {str(entry_error)}")
                            logger.error(traceback.format_exc())
                            # Continue processing other entries despite this error
                            continue
                except Exception as stream_error:
                    logger.error(f"Job {job_id}: Error processing results stream: {str(stream_error)}")
                    logger.error(traceback.format_exc())
                    # We'll still update the job with any results we processed so far

                logger.info(f"Job {job_id}: Processed {processed_count} successful results and {failed_count} failed results")

                # Update job with results summary
                try:
                    update_expression = "SET batch_results = :results, completed_at = :time, #s = :status"
                    expression_values = {
                        ':results': json.dumps(results),
                        ':time': datetime.now().isoformat()
                    }

                    # Always mark job as COMPLETED or FAILED after batch processing, consistent with the
                    # architecture where scripts manage their own lifecycle
                    if processed_count > 0:
                        expression_values[':status'] = 'COMPLETED'

                        # If we had some failures, add a warning
                        if failed_count > 0:
                            update_expression += ", warnings = :warning"
                            expression_values[':warning'] = f"Completed with {failed_count} failed requests out of {processed_count + failed_count} total"
                    else:
                        # All results failed
                        expression_values[':status'] = 'FAILED'
                        update_expression += ", error_message = :error"
                        expression_values[':error'] = f"All {failed_count} batch requests failed"

                    logger.info(f"Job {job_id}: Updating job with results summary and setting status to {expression_values[':status']}")
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression=update_expression,
                        ExpressionAttributeNames={
                            '#s': 'status'  # Use ExpressionAttributeNames to avoid 'status' reserved keyword
                        },
                        ExpressionAttributeValues=expression_values
                    )

                    logger.info(f"Job {job_id}: Successfully updated job with results summary")
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with results: {str(update_error)}")
                    logger.error(traceback.format_exc())
                    # Continue despite update failure - we've already stored the reports

                if processed_count > 0:
                    logger.info(f"Job {job_id}: Successfully processed {processed_count} results for batch {batch_id}")
                    return True
                else:
                    logger.error(f"Job {job_id}: No successful results processed for batch {batch_id}")
                    return False

            except Exception as api_error:
                error_msg = f"Error retrieving batch results from Anthropic API: {str(api_error)}"
                logger.error(f"Job {job_id}: {error_msg}")
                logger.error(traceback.format_exc())

                # Update job with error and always mark as FAILED when there's an API error
                try:
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET #s = :status, error_message = :error, last_checked = :time, completed_at = :time",
                        ExpressionAttributeNames={
                            '#s': 'status'  # Use ExpressionAttributeNames to avoid 'status' reserved keyword
                        },
                        ExpressionAttributeValues={
                            ':status': 'FAILED',
                            ':error': error_msg,
                            ':time': datetime.now().isoformat()
                        }
                    )
                except Exception as update_error:
                    logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

                return False

        except Exception as e:
            error_msg = f"Unhandled error processing batch results: {str(e)}"
            logger.error(f"Job {job_id}: {error_msg}")
            logger.error(traceback.format_exc())

            # Update job with error and mark as FAILED
            try:
                self.job_table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="SET #s = :status, error_message = :error, last_checked = :time, completed_at = :time",
                    ExpressionAttributeNames={
                        '#s': 'status'  # Use ExpressionAttributeNames to avoid 'status' reserved keyword
                    },
                    ExpressionAttributeValues={
                        ':status': 'FAILED',
                        ':error': error_msg,
                        ':time': datetime.now().isoformat()
                    }
                )
            except Exception as update_error:
                logger.error(f"Job {job_id}: Failed to update job with error: {str(update_error)}")

            return False

    async def check_and_process_jobs(self, specific_job_id: Optional[str] = None) -> Optional[int]:
        """
        Check and process batch jobs.
        If specific_job_id is provided, returns an exit code for the poller:
        - EXIT_CODE_TERMINAL_STATE: Batch reached a terminal state.
        - EXIT_CODE_PROCESSING_CONTINUES: Batch is still processing.
        - EXIT_CODE_SCRIPT_ERROR: Error in this script's handling of the job.
        If specific_job_id is None (polling mode), returns None.
        """
        jobs_to_check = self.find_pending_jobs(specific_job_id)

        if not jobs_to_check:
            if specific_job_id:
                logger.error(f"Job {specific_job_id} not found or no longer pending for batch checking (batch_id missing or status is COMPLETED).")
                # This means the specific job isn't in a state we can act on here for batch checking.
                # It could be already completed, or never had a batch_id.
                # For the purpose of a single check, this means the "check" task is "done" for this ID.
                return self.EXIT_CODE_TERMINAL_STATE
            logger.info("No pending batch jobs found in general poll.")
            return None # In polling mode, signifies no jobs to process now.

        # If specific_job_id is given, we only care about the first job in jobs_to_check (should be only one)
        job_item = jobs_to_check[0]
        job_id = job_item.get('job_id')
        batch_id = job_item.get('batch_id')
        current_job_processing_signal = self.EXIT_CODE_SCRIPT_ERROR  # Default to error for this job

        # This log is useful for both modes
        logger.info(f"Processing job {job_id} with batch {batch_id}")

        batch_api_status = await self.check_batch_status(job_item)  # Returns Anthropic status string or None

        if batch_api_status in [ANTHROPIC_BATCH_COMPLETED, ANTHROPIC_BATCH_ENDED]:
            logger.info(f"Batch {batch_id} for job {job_id} reported status '{batch_api_status}'. Processing results.")
            # process_batch_results will update the original job (job_id) to COMPLETED or FAILED in DB
            await self.process_batch_results(job_item)
            # The task of checking and processing this specific job is now complete.
            current_job_processing_signal = self.EXIT_CODE_TERMINAL_STATE
        elif batch_api_status in [ANTHROPIC_BATCH_FAILED, ANTHROPIC_BATCH_CANCELLED, "BATCH_NOT_FOUND"]:
            logger.error(f"Batch {batch_id} for job {job_id} reported terminal status: {batch_api_status}.")
            # Ensure the original job (job_id) in Delphi_JobQueue is marked as FAILED.
            # check_batch_status might log API errors but doesn't always set the job to FAILED.
            try:
                self.job_table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression="SET #s = :final_status, completed_at = :time, batch_status = :batch_api_status, error_message = COALESCE(error_message, :default_error)",
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={
                        ':final_status': 'FAILED', # Mark the job itself as FAILED
                        ':time': datetime.now().isoformat(),
                        ':batch_api_status': batch_api_status,
                        ':default_error': f"Batch {batch_id} processed with Anthropic status: {batch_api_status}"
                    }
                )
                logger.info(f"Job {job_id} in Delphi_JobQueue marked as FAILED due to batch status {batch_api_status}.")
            except Exception as e:
                logger.error(f"Error updating job {job_id} for batch status {batch_api_status}: {str(e)}")
                logger.error(traceback.format_exc())
            # The task of checking and recognizing this terminal state is complete.
            current_job_processing_signal = self.EXIT_CODE_TERMINAL_STATE
        elif batch_api_status in NON_TERMINAL_BATCH_STATES:  # 'preparing', 'in_progress'
            logger.info(f"Job {job_id}: Batch still {batch_api_status}")
            current_job_processing_signal = self.EXIT_CODE_PROCESSING_CONTINUES
        else:  # batch_api_status is None (error during check_batch_status) or an unexpected value
            logger.error(f"Batch {batch_id} for job {job_id}: check_batch_status returned '{batch_api_status}'. This indicates an issue with retrieving status or an unexpected status.")
            # check_batch_status should have logged an error and updated the job with an error_message.
            # This script considers its attempt to process this job as errored.
            current_job_processing_signal = self.EXIT_CODE_SCRIPT_ERROR
        
        if specific_job_id:
            return current_job_processing_signal

        # Fallback for polling mode (should not be reached if specific_job_id logic is exhaustive for single job)
        # The loop for polling mode would be outside this part of the logic if refactored.
        # For now, the original script had a loop in main, this function processes one found job at a time.
        # If in polling mode, this return is not used for sys.exit directly by main's loop.
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