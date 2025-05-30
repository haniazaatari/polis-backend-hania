#!/usr/bin/env python3
"""
Process participant cluster batch narrative report results from Anthropic Batch API.

This script:
1. Retrieves participant cluster batch job metadata from DynamoDB
2. Checks the status of Anthropic batch jobs
3. Processes completed requests and stores results
4. Handles sequential fallback processing when batch API is unavailable

Usage:
    python 813_process_participant_batch_results.py --batch_id BATCH_ID [--force]

Args:
    --batch_id: ID of the batch job to process
    --force: Force processing even if the job is not marked as completed
"""

import os
import sys
import json
import time
import logging
import asyncio
import argparse
import boto3
import requests
from datetime import datetime
from typing import Dict, List, Any, Optional

# Import from local modules (set the path first)
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from umap_narrative.llm_factory_constructor import get_model_provider
from umap_narrative.llm_factory_constructor.model_provider import AnthropicProvider

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ParticipantReportStorageService:
    """Storage service for participant cluster report data in DynamoDB."""
    
    def __init__(self, table_name="Delphi_ParticipantNarrativeReports", disable_cache=False):
        """Initialize the participant report storage service.
        
        Args:
            table_name: Name of the DynamoDB table to use
            disable_cache: Whether to disable cache usage
        """
        # Set up DynamoDB connection
        self.table_name = table_name
        self.disable_cache = disable_cache
        
        # Set up DynamoDB client
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
        )
        
        # Get the table
        self.table = self.dynamodb.Table(self.table_name)
    
    def init_table(self):
        """Check if the table exists, and create it if it doesn't."""
        try:
            self.table.table_status
            logger.info(f"Table {self.table_name} exists and is accessible.")
        except Exception as e:
            logger.error(f"Error checking table {self.table_name}: {str(e)}")
            logger.info(f"Creating table {self.table_name}...")
            
            # Create the table
            self.dynamodb.create_table(
                TableName=self.table_name,
                KeySchema=[
                    {'AttributeName': 'rid_section_model', 'KeyType': 'HASH'},
                    {'AttributeName': 'timestamp', 'KeyType': 'RANGE'}
                ],
                AttributeDefinitions=[
                    {'AttributeName': 'rid_section_model', 'AttributeType': 'S'},
                    {'AttributeName': 'timestamp', 'AttributeType': 'S'}
                ],
                ProvisionedThroughput={
                    'ReadCapacityUnits': 5,
                    'WriteCapacityUnits': 5
                }
            )
            
            # Wait for the table to be created
            client = boto3.client(
                'dynamodb',
                endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
            )
            waiter = client.get_waiter('table_exists')
            waiter.wait(TableName=self.table_name)
            
            logger.info(f"Table {self.table_name} created successfully.")
    
    def put_item(self, item):
        """Store an item in DynamoDB.
        
        Args:
            item: Dictionary with the item data
        """
        try:
            response = self.table.put_item(Item=item)
            logger.info(f"Participant report item stored successfully: {response}")
            return response
        except Exception as e:
            logger.error(f"Error storing participant report item: {str(e)}")
            return None

class ParticipantBatchReportStorageService:
    """Storage service for participant cluster batch job metadata in DynamoDB."""
    
    def __init__(self, table_name="Delphi_ParticipantBatchJobs"):
        """Initialize the participant batch job storage service.
        
        Args:
            table_name: Name of the DynamoDB table to use
        """
        # Set up DynamoDB connection
        self.table_name = table_name
        
        # Set up DynamoDB client
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
        )
        
        # Get the table
        self.table = self.dynamodb.Table(self.table_name)
    
    def get_item(self, batch_id):
        """Get a participant batch job by ID.
        
        Args:
            batch_id: ID of the batch job
        
        Returns:
            Dictionary with the batch job metadata
        """
        try:
            response = self.table.get_item(Key={'batch_id': batch_id})
            return response.get('Item')
        except Exception as e:
            logger.error(f"Error getting participant batch job: {str(e)}")
            return None
    
    def update_item(self, batch_id, updates):
        """Update a participant batch job.
        
        Args:
            batch_id: ID of the batch job
            updates: Dictionary with updates to apply
        """
        try:
            # Build update expression with proper handling of reserved keywords
            update_expression = "SET "
            expression_attribute_values = {}
            expression_attribute_names = {}
            
            for key, value in updates.items():
                # Handle reserved keywords like 'status'
                if key in ['status', 'timestamp', 'name', 'size']:
                    attr_name = f"#{key}"
                    expression_attribute_names[attr_name] = key
                    value_name = f":{key.replace('.', '_')}"
                    update_expression += f"{attr_name} = {value_name}, "
                else:
                    value_name = f":{key.replace('.', '_')}"
                    update_expression += f"{key} = {value_name}, "
                
                expression_attribute_values[value_name] = value
            
            # Remove trailing comma and space
            update_expression = update_expression[:-2]
            
            update_params = {
                'Key': {'batch_id': batch_id},
                'UpdateExpression': update_expression,
                'ExpressionAttributeValues': expression_attribute_values
            }
            
            if expression_attribute_names:
                update_params['ExpressionAttributeNames'] = expression_attribute_names
            
            response = self.table.update_item(**update_params)
            logger.info(f"Participant batch job updated successfully: {response}")
            return response
        except Exception as e:
            logger.error(f"Error updating participant batch job: {str(e)}")
            return None

class AnthropicBatchChecker:
    """Check the status of Anthropic batch jobs."""
    
    def __init__(self, api_key=None):
        """Initialize the Anthropic batch checker.
        
        Args:
            api_key: Anthropic API key
        """
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        
        if not self.api_key:
            logger.warning("No Anthropic API key provided. Set ANTHROPIC_API_KEY env var or pass api_key parameter.")
    
    def check_batch_status(self, batch_id):
        """Check the status of an Anthropic batch job.
        
        Args:
            batch_id: ID of the Anthropic batch job
            
        Returns:
            Dictionary with batch job status
        """
        if not self.api_key:
            logger.error("No Anthropic API key provided for checking batch status")
            return {"error": "API key missing"}
        
        try:
            logger.info(f"Checking status of Anthropic batch job: {batch_id}")
            
            # Use Anthropic API to check batch status
            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            response = requests.get(
                f"https://api.anthropic.com/v1/messages/batch/{batch_id}",
                headers=headers
            )
            
            # Check if the batch endpoint is available
            if response.status_code == 404:
                logger.warning("Anthropic Batch API endpoint not found (404)")
                return {"error": "Batch API not available"}
            
            # Raise for other errors
            response.raise_for_status()
            
            # Get response data
            response_data = response.json()
            logger.info(f"Batch status: {response_data.get('status', 'unknown')}")
            
            return response_data
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.warning("Anthropic Batch API endpoint not found (404)")
                return {"error": "Batch API not available"}
            else:
                logger.error(f"HTTP error checking Anthropic batch status: {str(e)}")
                return {"error": f"HTTP error: {str(e)}"}
                
        except Exception as e:
            logger.error(f"Error checking Anthropic batch status: {str(e)}")
            return {"error": str(e)}

class ParticipantBatchResultProcessor:
    """Process participant cluster batch narrative report results."""
    
    def __init__(self, batch_id, force=False):
        """Initialize the participant batch result processor.
        
        Args:
            batch_id: ID of the batch job to process
            force: Force processing even if the job is not marked as completed
        """
        self.batch_id = batch_id
        self.force = force
        
        # Initialize storage services
        self.batch_storage = ParticipantBatchReportStorageService()
        self.report_storage = ParticipantReportStorageService()
        self.report_storage.init_table()
        
        # Initialize batch job data
        self.batch_job = None
        self.anthropic_checker = AnthropicBatchChecker()
    
    async def process_batch_results(self):
        """Process the participant batch job results.
        
        Returns:
            True if processing is successful, False otherwise
        """
        # Get batch job from DynamoDB
        self.batch_job = self.batch_storage.get_item(self.batch_id)
        
        if not self.batch_job:
            logger.error(f"Participant batch job {self.batch_id} not found")
            return False
        
        # Check if we can process this job
        if not self.can_process_job():
            return False
        
        # Determine processing approach
        if self.batch_job.get('status') in ['sequential_fallback', 'partially_processed']:
            # Process with sequential fallback
            logger.info(f"Processing participant batch job {self.batch_id} with sequential fallback")
            return await self.process_sequential_fallback()
        elif self.batch_job.get('status') in ['submitted', 'completed']:
            # Process with Anthropic Batch API
            logger.info(f"Processing participant batch job {self.batch_id} with Anthropic Batch API")
            return await self.process_anthropic_batch()
        else:
            logger.error(f"Participant batch job {self.batch_id} has unsupported status: {self.batch_job.get('status')}")
            return False
    
    def can_process_job(self):
        """Check if we can process this participant batch job.
        
        Returns:
            True if we can process this job, False otherwise
        """
        # Check if batch job exists
        if not self.batch_job:
            logger.error(f"Participant batch job {self.batch_id} not found")
            return False
        
        # Check if we're in a valid state for processing
        valid_states = ['submitted', 'completed', 'sequential_fallback', 'partially_processed']
        if self.batch_job.get('status') not in valid_states and not self.force:
            logger.error(f"Participant batch job {self.batch_id} is not in a valid state for processing: {self.batch_job.get('status')}")
            logger.error(f"Valid states are: {valid_states}. Use --force to process anyway.")
            return False
        
        return True
    
    async def process_anthropic_batch(self):
        """Process participant batch job results from Anthropic Batch API.
        
        Returns:
            True if processing is successful, False otherwise
        """
        # Get batch status from Anthropic
        anthropic_batch_id = self.batch_job.get('anthropic_batch_id')
        if not anthropic_batch_id:
            logger.error(f"Participant batch job {self.batch_id} does not have an Anthropic batch ID")
            return False
        
        # Get batch status
        batch_status = self.anthropic_checker.check_batch_status(anthropic_batch_id)
        
        # Check if we got a valid status
        if isinstance(batch_status.get('error'), str):
            logger.error(f"Error checking Anthropic batch status: {batch_status.get('error')}")
            return False
        
        # Check if batch is completed
        if batch_status.get('status') != 'completed' and not self.force:
            logger.error(f"Anthropic batch job {anthropic_batch_id} is not completed: {batch_status.get('status')}")
            logger.error("Use --force to process anyway.")
            return False
        
        # Process each request in the batch
        logger.info(f"Processing {len(batch_status.get('requests', []))} participant cluster requests")
        
        # Get request metadata mapping
        request_metadata = {}
        if 'request_map' in self.batch_job:
            for req_id, metadata in self.batch_job['request_map'].items():
                request_metadata[req_id] = metadata
        
        # Process each request
        successful_requests = 0
        for req in batch_status.get('requests', []):
            req_id = req.get('request_id')
            status = req.get('status')
            
            # Skip requests that are not completed
            if status != 'completed' and not self.force:
                logger.warning(f"Skipping participant cluster request {req_id} with status {status}")
                continue
            
            # Get metadata for this request
            metadata = request_metadata.get(req_id, {})
            if not metadata:
                logger.warning(f"No metadata found for participant cluster request {req_id}")
                continue
            
            # Get cluster info
            cluster_name = metadata.get('cluster_name', 'Unknown Group')
            section_name = metadata.get('section_name', 'Unknown')
            conversation_id = metadata.get('conversation_id', 'Unknown')
            
            logger.info(f"Processing participant cluster request {req_id} for group '{cluster_name}'")
            
            # Get response content
            if 'message' not in req:
                logger.warning(f"No message found in participant cluster request {req_id}")
                continue
            
            message = req.get('message', {})
            if 'content' not in message or not message.get('content'):
                logger.warning(f"No content found in message for participant cluster request {req_id}")
                continue
            
            # Extract content text
            content = message.get('content', [])
            if not content or not isinstance(content, list) or 'text' not in content[0]:
                logger.warning(f"Invalid content format for participant cluster request {req_id}")
                continue
            
            response_text = content[0].get('text', '')
            
            # Store in Delphi_ParticipantNarrativeReports
            rid_section_model = f"{conversation_id}#{section_name}#{self.batch_job.get('model')}"
            
            report_item = {
                "rid_section_model": rid_section_model,
                "timestamp": datetime.now().isoformat(),
                "report_data": response_text,
                "model": self.batch_job.get('model'),
                "errors": None,
                "batch_id": self.batch_id,
                "request_id": req_id,
                "metadata": {
                    "cluster_name": cluster_name,
                    "cluster_id": metadata.get('cluster_id'),
                    "participant_count": metadata.get('participant_count'),
                    "distinctive_comments_count": metadata.get('distinctive_comments_count')
                }
            }
            
            self.report_storage.put_item(report_item)
            
            logger.info(f"Stored participant cluster report for group '{cluster_name}'")
            successful_requests += 1
        
        # Update batch job status
        updates = {
            "updated_at": datetime.now().isoformat(),
            "completed_requests": successful_requests,
            "processing_completed": True,
            "processing_timestamp": datetime.now().isoformat()
        }
        
        if successful_requests == len(batch_status.get('requests', [])):
            updates["status"] = "results_processed"
        
        self.batch_storage.update_item(self.batch_id, updates)
        
        logger.info(f"Processed {successful_requests} of {len(batch_status.get('requests', []))} participant cluster requests")
        return True
    
    async def process_sequential_fallback(self):
        """Process participant batch job with sequential fallback.
        
        This is used when the Anthropic Batch API is not available.
        
        Returns:
            True if processing is successful, False otherwise
        """
        # Get request data
        if 'batch_data' not in self.batch_job and 'request_map' not in self.batch_job:
            logger.error(f"Participant batch job {self.batch_id} does not have request data")
            return False
        
        # Get model provider
        model_name = self.batch_job.get('model', 'claude-3-5-sonnet-20241022')
        model_provider = get_model_provider('anthropic', model_name)
        
        # Process each request sequentially
        total_requests = len(self.batch_job.get('request_map', {}))
        successful_requests = 0
        
        logger.info(f"Processing {total_requests} participant cluster requests sequentially")
        
        # Update batch job status
        self.batch_storage.update_item(self.batch_id, {
            "status": "sequential_processing",
            "updated_at": datetime.now().isoformat()
        })
        
        # Process each request
        for req_id, metadata in self.batch_job.get('request_map', {}).items():
            # Get cluster info
            cluster_name = metadata.get('cluster_name', 'Unknown Group')
            section_name = metadata.get('section_name', 'Unknown')
            conversation_id = metadata.get('conversation_id', 'Unknown')
            
            logger.info(f"Processing participant cluster request {req_id} for group '{cluster_name}'")
            
            # Check if we already have a report for this cluster
            rid_section_model = f"{conversation_id}#{section_name}#{model_name}"
            
            # Skip if we already have a report (but not if force is enabled)
            if not self.force:
                response = self.report_storage.table.query(
                    KeyConditionExpression=boto3.dynamodb.conditions.Key('rid_section_model').eq(rid_section_model)
                )
                
                if response.get('Items'):
                    logger.info(f"Participant cluster report already exists for group '{cluster_name}', skipping")
                    successful_requests += 1
                    continue
            
            try:
                # Get the original request data
                if 'batch_data' in self.batch_job and 'requests' in self.batch_job['batch_data']:
                    # Find the request data by matching custom_id with cluster info
                    target_cluster_id = metadata.get('cluster_id', '')
                    conversation_id = metadata.get('conversation_id', self.batch_job.get('conversation_id', ''))
                    expected_custom_id = f"participant_cluster_{target_cluster_id}_{conversation_id}"
                    
                    for req in self.batch_job['batch_data']['requests']:
                        if req.get('custom_id') == expected_custom_id:
                            # Get system and messages from the body
                            body = req.get('body', {})
                            system = body.get('system', '')
                            messages = body.get('messages', [])
                            
                            # Process only if we have both
                            if system and messages and len(messages) > 0:
                                user_message = messages[0].get('content', '')
                                
                                # Generate response
                                logger.info(f"Generating participant cluster response for group '{cluster_name}'")
                                
                                # Add a short delay to avoid rate limiting
                                await asyncio.sleep(1)
                                
                                # Get response
                                response_text = model_provider.get_response(system, user_message)
                                
                                # Store in Delphi_ParticipantNarrativeReports
                                report_item = {
                                    "rid_section_model": rid_section_model,
                                    "timestamp": datetime.now().isoformat(),
                                    "report_data": response_text,
                                    "model": model_name,
                                    "errors": None,
                                    "batch_id": self.batch_id,
                                    "request_id": req_id,
                                    "sequential_fallback": True,
                                    "metadata": {
                                        "cluster_name": cluster_name,
                                        "cluster_id": metadata.get('cluster_id'),
                                        "participant_count": metadata.get('participant_count'),
                                        "distinctive_comments_count": metadata.get('distinctive_comments_count')
                                    }
                                }
                                
                                self.report_storage.put_item(report_item)
                                
                                logger.info(f"Stored participant cluster report for group '{cluster_name}'")
                                successful_requests += 1
                                
                                # Update batch job with progress
                                self.batch_storage.update_item(self.batch_id, {
                                    "completed_requests": successful_requests,
                                    "updated_at": datetime.now().isoformat()
                                })
                                
                                break
                            else:
                                logger.warning(f"Missing system or messages for participant cluster request {req_id}")
                        
                else:
                    logger.warning(f"No batch_data.requests found for participant cluster request {req_id}")
            
            except Exception as e:
                logger.error(f"Error processing participant cluster request {req_id} for group '{cluster_name}': {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Update batch job status
        updates = {
            "updated_at": datetime.now().isoformat(),
            "completed_requests": successful_requests,
            "processing_completed": True,
            "processing_timestamp": datetime.now().isoformat()
        }
        
        if successful_requests == total_requests:
            updates["status"] = "results_processed"
        else:
            updates["status"] = "partially_processed"
        
        self.batch_storage.update_item(self.batch_id, updates)
        
        logger.info(f"Processed {successful_requests} of {total_requests} participant cluster requests sequentially")
        return True

async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Process participant cluster batch narrative report results')
    parser.add_argument('--batch_id', type=str, required=True,
                       help='ID of the batch job to process')
    parser.add_argument('--force', action='store_true',
                       help='Force processing even if the job is not marked as completed')
    args = parser.parse_args()
    
    # Process participant batch results
    processor = ParticipantBatchResultProcessor(args.batch_id, args.force)
    success = await processor.process_batch_results()
    
    if success:
        logger.info(f"Successfully processed participant cluster batch job {args.batch_id}")
        print(f"Successfully processed participant cluster batch job {args.batch_id}")
    else:
        logger.error(f"Failed to process participant cluster batch job {args.batch_id}")
        print(f"Failed to process participant cluster batch job {args.batch_id}. See logs for details.")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())