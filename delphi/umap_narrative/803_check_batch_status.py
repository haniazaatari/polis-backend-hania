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

class BatchStatusChecker:
    """Check and process Anthropic Batch API results."""

    def __init__(self, log_level=logging.INFO):
        """Initialize the batch status checker."""
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

        # Try to import Anthropic client with comprehensive error handling
        try:
            logger.info("Attempting to import Anthropic SDK...")
            try:
                from anthropic import Anthropic, APIError, APIConnectionError, APIResponseValidationError, APIStatusError
                logger.info("Successfully imported Anthropic SDK")
            except ImportError as e:
                logger.error(f"Failed to import Anthropic SDK: {str(e)}")
                logger.error(f"System paths: {sys.path}")
                logger.error("Attempting to install Anthropic SDK...")
                try:
                    import subprocess
                    subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic"])
                    from anthropic import Anthropic, APIError, APIConnectionError, APIResponseValidationError, APIStatusError
                    logger.info("Successfully installed and imported Anthropic SDK")
                except Exception as e:
                    logger.error(f"Failed to install Anthropic SDK: {str(e)}")
                    logger.error(traceback.format_exc())
                    self.anthropic = None
                    return

            # Initialize Anthropic client
            logger.info("Initializing Anthropic client...")
            anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                logger.error("ANTHROPIC_API_KEY environment variable is not set - cannot check batch status")
                # Print all available environment variables (without values) to help debug
                logger.info("Available environment variables:")
                for key in sorted(os.environ.keys()):
                    if not key.startswith(('AWS_', 'PATH', 'PYTHONPATH', 'HOME', 'USER')):
                        logger.info(f"- {key}")
                self.anthropic = None
            else:
                logger.info("API key found, initializing Anthropic client")
                try:
                    self.anthropic = Anthropic(api_key=anthropic_api_key)
                    logger.info("Anthropic client initialized successfully")
                except Exception as e:
                    logger.error(f"Failed to initialize Anthropic client: {str(e)}")
                    logger.error(traceback.format_exc())
                    self.anthropic = None
        except Exception as e:
            logger.error(f"Unexpected error initializing Anthropic client: {str(e)}")
            logger.error(traceback.format_exc())
            self.anthropic = None

    def find_pending_jobs(self, specific_job_id=None) -> List[Dict]:
        """Find jobs with pending batch requests.

        Args:
            specific_job_id: Optional specific job ID to check

        Returns:
            List of job items with batch information
        """
        try:
            if specific_job_id:
                # Get specific job
                response = self.job_table.get_item(Key={'job_id': specific_job_id})
                items = [response.get('Item')] if 'Item' in response else []
            else:
                # Scan for jobs with batch_id and status not completed
                # Using ExpressionAttributeNames to avoid the 'status' reserved keyword
                response = self.job_table.scan(
                    FilterExpression='attribute_exists(batch_id) AND (attribute_not_exists(#s) OR #s <> :completed_status)',
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={':completed_status': 'COMPLETED'}
                )
                items = response.get('Items', [])

                # Continue scan if there are more results
                while 'LastEvaluatedKey' in response:
                    response = self.job_table.scan(
                        FilterExpression='attribute_exists(batch_id) AND (attribute_not_exists(#s) OR #s <> :completed_status)',
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues={':completed_status': 'COMPLETED'},
                        ExclusiveStartKey=response['LastEvaluatedKey']
                    )
                    items.extend(response.get('Items', []))

            # Filter for jobs with batch information
            result = []
            for item in items:
                if 'batch_id' in item:
                    result.append(item)

            logger.info(f"Found {len(result)} pending batch jobs")
            return result
        except Exception as e:
            logger.error(f"Error finding pending jobs: {str(e)}")
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
            logger.info(f"Job {job_id}: Retrieving batch {batch_id} status from Anthropic API")
            try:
                batch = self.anthropic.beta.messages.batches.retrieve(batch_id)

                # Log batch status
                logger.info(f"Job {job_id}: Batch {batch_id} status: {batch.processing_status}")
                logger.info(f"Job {job_id}: Batch {batch_id} details: {batch}")

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
                    logger.info(f"Job {job_id}: Successfully updated job with batch status: {batch.processing_status}")
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
                    # This could be a serious error - the batch ID is invalid or doesn't exist
                    error_detail = "Batch ID not found in Anthropic API - may have been deleted or never created properly"
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

                                # Extract metadata from custom_id
                                custom_id = entry.get('request', {}).get('custom_id')
                                logger.info(f"Job {job_id}: Processing successful result for custom_id: {custom_id}")

                                # Handle missing custom_id by using a fallback based on entry index
                                if custom_id:
                                    parts = custom_id.split('_')

                                    # Try to determine section name from custom_id
                                    section_name = None
                                    if len(parts) > 2:
                                        # Skip conversation_id and cluster_id
                                        section_name = '_'.join(parts[2:])
                                else:
                                    # If custom_id is None, we need to create a fallback
                                    parts = []
                                    section_name = None

                                # If section_name couldn't be determined, use a default
                                if not section_name:
                                    section_name = f"topic_{len(results)}"

                                logger.info(f"Job {job_id}: Extracted section name: {section_name}")

                                # Get the model name
                                model = entry.get('request', {}).get('params', {}).get('model')
                                logger.info(f"Job {job_id}: Using model: {model}")

                                # Get the response content
                                message = entry.get('result', {}).get('message', {})
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
                                custom_id = entry.get('request', {}).get('custom_id')
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
                                custom_id = entry.get('request', {}).get('custom_id', 'unknown')
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

    async def check_and_process_jobs(self, specific_job_id=None):
        """Check and process batch jobs.

        Args:
            specific_job_id: Optional specific job ID to check
        """
        # Find pending jobs
        jobs = self.find_pending_jobs(specific_job_id)

        if not jobs:
            logger.info("No pending batch jobs found")
            return

        # Process each job
        for job in jobs:
            job_id = job.get('job_id')
            batch_id = job.get('batch_id')

            logger.info(f"Checking job {job_id} with batch {batch_id}")

            # Check batch status
            status = await self.check_batch_status(job)

            if status == 'ended':
                # Batch has completed, process results
                logger.info(f"Batch {batch_id} has completed, processing results")
                success = await self.process_batch_results(job)

                if success:
                    logger.info(f"Successfully processed results for job {job_id}")
                else:
                    logger.error(f"Failed to process results for job {job_id}")
            elif status == 'processing':
                # Batch is still processing
                logger.info(f"Batch {batch_id} is still processing")
            elif status == 'failed':
                # Batch failed
                logger.error(f"Batch {batch_id} failed")

                # Mark job as failed with detailed error
                try:
                    error_msg = f"Anthropic Batch API reported failure for batch {batch_id}"
                    self.job_table.update_item(
                        Key={'job_id': job_id},
                        UpdateExpression="SET status = :status, completed_at = :time, error_message = :error",
                        ExpressionAttributeValues={
                            ':status': 'FAILED',
                            ':time': datetime.now().isoformat(),
                            ':error': error_msg
                        }
                    )
                    logger.info(f"Job {job_id} marked as FAILED due to batch failure")
                except Exception as e:
                    logger.error(f"Error updating job status for failed batch: {str(e)}")
            else:
                # Unknown or null status
                logger.warning(f"Unknown batch status {status} for job {job_id}")

async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Check and process Anthropic Batch API results')
    parser.add_argument('--job-id', type=str, help='Specific job ID to check')
    parser.add_argument('--polling-interval', type=int, default=60, help='Seconds to wait between checks')
    parser.add_argument('--log-level', type=str, default='INFO', help='Logging level')
    args = parser.parse_args()

    # Set log level
    log_level = getattr(logging, args.log_level.upper(), logging.INFO)
    logger.setLevel(log_level)

    # Create batch status checker
    checker = BatchStatusChecker(log_level=log_level)

    if args.job_id:
        # Check specific job once
        await checker.check_and_process_jobs(args.job_id)
    else:
        # Polling loop
        try:
            while True:
                logger.info(f"Checking for pending batch jobs...")
                await checker.check_and_process_jobs()
                logger.info(f"Waiting {args.polling_interval} seconds before next check...")
                await asyncio.sleep(args.polling_interval)
        except KeyboardInterrupt:
            logger.info("Batch status checker stopped by user")
        except Exception as e:
            logger.error(f"Error in polling loop: {str(e)}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())