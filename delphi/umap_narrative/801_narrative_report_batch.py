#!/usr/bin/env python3
"""
Generate batch narrative reports for Polis conversations using Anthropic's Batch API.

This script is an optimized version of 800_report_topic_clusters.py that:
1. Prepares batch requests for all topics in a conversation
2. Submits them to Anthropic's Batch API
3. Stores batch job metadata in DynamoDB
4. Provides a way to check batch job status

Usage:
    python 801_narrative_report_batch.py --conversation_id CONVERSATION_ID [--model MODEL] [--no-cache]

Args:
    --conversation_id: Conversation ID/zid
    --model: LLM model to use (default: claude-3-5-sonnet-20241022)
    --no-cache: Ignore cached report data
    --max-batch-size: Maximum number of topics to include in a single batch (default: 20)
"""

import os
import sys
import json
import time
import uuid
import logging
import argparse
import boto3
import asyncio
import numpy as np
import pandas as pd
import re  # Added re import for regex operations
import requests  # Added for HTTP error handling
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Tuple
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString
import csv
import io
import xmltodict
from collections import defaultdict
import traceback  # Added for detailed error tracing

# Import the model provider
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from umap_narrative.llm_factory_constructor import get_model_provider
from umap_narrative.llm_factory_constructor.model_provider import AnthropicProvider

# Import from local modules
from polismath_commentgraph.utils.storage import PostgresClient, DynamoDBStorage
from polismath_commentgraph.utils.group_data import GroupDataProcessor

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class NarrativeReportService:
    """Storage service for narrative reports in DynamoDB."""

    def __init__(self, table_name="Delphi_NarrativeReports"):
        """Initialize the narrative report service.

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

    def store_report(self, report_id, section, model, report_data, job_id=None, metadata=None):
        """Store a report in DynamoDB.

        Args:
            report_id: The report ID
            section: The section of the report
            model: The model used to generate the report
            report_data: The generated report content
            job_id: The ID of the job that generated this report (optional)
            metadata: Additional metadata to store with the report (optional)

        Returns:
            Response from DynamoDB
        """
        try:
            # Create a combined key for the report (report_id, section, model)
            rid_section_model = f"{report_id}#{section}#{model}"

            # Current timestamp
            timestamp = datetime.now().isoformat()

            # Create item to store
            item = {
                'rid_section_model': rid_section_model,
                'timestamp': timestamp,
                'report_id': report_id,
                'section': section,
                'model': model,
                'report_data': report_data
            }

            # Add job_id if provided
            if job_id:
                item['job_id'] = job_id
                
            # Add metadata if provided
            if metadata:
                item['metadata'] = metadata

            # Store in DynamoDB
            response = self.table.put_item(Item=item)
            logger.info(f"Report stored successfully for {rid_section_model}")
            return response
        except Exception as e:
            logger.error(f"Error storing report: {str(e)}")
            return None

    def get_report(self, report_id, section, model):
        """Get a report from DynamoDB.

        Args:
            report_id: The report ID
            section: The section of the report
            model: The model used to generate the report

        Returns:
            The report data if found, None otherwise
        """
        try:
            # Create the combined key
            rid_section_model = f"{report_id}#{section}#{model}"

            # Get from DynamoDB
            response = self.table.get_item(Key={'rid_section_model': rid_section_model})

            # Return the item if found
            return response.get('Item')
        except Exception as e:
            logger.error(f"Error getting report: {str(e)}")
            return None

class PolisConverter:
    """Convert between CSV and XML formats for Polis data."""
    
    @staticmethod
    def convert_to_xml(comment_data):
        """
        Convert comment data to XML format.
        
        Args:
            comment_data: List of dictionaries with comment data
            
        Returns:
            String with XML representation of the comment data
        """
        # Create root element
        root = ET.Element("polis-comments")
        
        # Process each comment
        for record in comment_data:
            # Extract base comment data
            comment = ET.SubElement(root, "comment", {
                "id": str(record.get("comment-id", "")),
                "votes": str(record.get("total-votes", 0)),
                "agrees": str(record.get("total-agrees", 0)),
                "disagrees": str(record.get("total-disagrees", 0)),
                "passes": str(record.get("total-passes", 0)),
            })
            
            # Add comment text
            text = ET.SubElement(comment, "text")
            text.text = record.get("comment", "")
            
            # Process group data
            group_keys = []
            for key in record.keys():
                if key.startswith("group-") and key.count("-") >= 2:
                    group_id = key.split("-")[1]
                    if group_id not in group_keys:
                        group_keys.append(group_id)
            
            # Add data for each group
            for group_id in group_keys:
                group = ET.SubElement(comment, f"group-{group_id}", {
                    "votes": str(record.get(f"group-{group_id}-votes", 0)),
                    "agrees": str(record.get(f"group-{group_id}-agrees", 0)),
                    "disagrees": str(record.get(f"group-{group_id}-disagrees", 0)),
                    "passes": str(record.get(f"group-{group_id}-passes", 0)),
                })
        
        # Convert to string with pretty formatting
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")

class BatchReportGenerator:
    """Generate batch reports for Polis conversations."""

    def __init__(self, conversation_id, model="claude-3-5-sonnet-20241022", no_cache=False, max_batch_size=20, job_id=None):
        """Initialize the batch report generator.

        Args:
            conversation_id: ID of the conversation to generate reports for
            model: Name of the LLM model to use
            no_cache: Whether to ignore cached report data
            max_batch_size: Maximum number of topics in a batch
            job_id: Optional job ID from the job queue system
        """
        self.conversation_id = str(conversation_id)
        self.model = model
        self.no_cache = no_cache
        self.max_batch_size = max_batch_size
        self.job_id = job_id or os.environ.get('DELPHI_JOB_ID')
        self.report_id = os.environ.get('DELPHI_REPORT_ID')

        # Initialize PostgreSQL client
        self.postgres_client = PostgresClient()

        # Initialize DynamoDB storage for reports
        self.report_storage = NarrativeReportService()

        # Initialize group data processor
        self.group_processor = GroupDataProcessor(self.postgres_client)

        # Set up base path for prompt templates
        # Get the current script's directory and use it as base for prompt templates
        current_dir = Path(__file__).parent
        self.prompt_base_path = current_dir / "report_experimental"
    
    async def get_conversation_data(self):
        """Get conversation data from PostgreSQL and DynamoDB."""
        try:
            # Initialize connection
            self.postgres_client.initialize()
            
            # Get conversation metadata
            conversation = self.postgres_client.get_conversation_by_id(int(self.conversation_id))
            if not conversation:
                logger.error(f"Conversation {self.conversation_id} not found in database.")
                return None
            
            # Get comments
            comments = self.postgres_client.get_comments_by_conversation(int(self.conversation_id))
            logger.info(f"Retrieved {len(comments)} comments from conversation {self.conversation_id}")
            
            # Get processed group and vote data using the group processor
            export_data = self.group_processor.get_export_data(int(self.conversation_id))
            logger.info(f"Retrieved processed vote and group data for conversation {self.conversation_id}")
            
            # Get math data with group assignments
            math_data = export_data.get('math_result', {})
            if math_data and math_data.get('group_assignments'):
                logger.info(f"Retrieved math data with {len(math_data.get('group_assignments', {}))} group assignments")
            else:
                logger.warning(f"No group assignments found in math data")
            
            # Use the processed comments from the export data
            processed_comments = export_data.get('comments', [])
            
            # Load cluster assignments from DynamoDB
            cluster_map = self.load_comment_clusters_from_dynamodb(self.conversation_id)
            
            # Enrich comments with cluster assignments
            enriched_count = 0
            for comment in processed_comments:
                comment_id = str(comment.get('comment_id', ''))
                if comment_id in cluster_map:
                    comment['layer0_cluster_id'] = cluster_map[comment_id]
                    enriched_count += 1
            
            # Log cluster assignment results
            if enriched_count > 0:
                logger.info(f"Enriched {enriched_count} comments with cluster assignments from DynamoDB")
            else:
                logger.warning("No comments could be enriched with cluster assignments")
            
            return {
                "conversation": conversation,
                "comments": comments,
                "processed_comments": processed_comments,
                "math_data": math_data
            }
        except Exception as e:
            logger.error(f"Error getting conversation data: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None
        finally:
            # Clean up connection
            self.postgres_client.shutdown()
    
    def load_comment_clusters_from_dynamodb(self, conversation_id):
        """
        Load cluster assignments for comments from DynamoDB.
        
        Args:
            conversation_id: Conversation ID to retrieve clusters for
            
        Returns:
            Dictionary mapping comment IDs to their cluster assignments
        """
        try:
            # Initialize DynamoDB connection
            dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
                region_name=os.environ.get('AWS_REGION', 'us-west-2'),
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
            )
            
            # Connect to comment clusters table
            clusters_table = dynamodb.Table('Delphi_CommentHierarchicalClusterAssignments')
            
            # Use scan with filter instead of query for compatibility with all DynamoDB setups
            # This is less efficient but more compatible
            response = clusters_table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('conversation_id').eq(str(conversation_id)),
                Limit=1000  # Process in batches
            )
            
            # Create mapping of comment IDs to cluster IDs
            cluster_map = {}
            for item in response.get('Items', []):
                comment_id = item.get('comment_id')
                layer0_cluster_id = item.get('layer0_cluster_id')
                if comment_id is not None and layer0_cluster_id is not None:
                    cluster_map[str(comment_id)] = layer0_cluster_id
                    
            # Handle pagination if needed
            while 'LastEvaluatedKey' in response:
                response = clusters_table.scan(
                    FilterExpression=boto3.dynamodb.conditions.Attr('conversation_id').eq(str(conversation_id)),
                    ExclusiveStartKey=response['LastEvaluatedKey'],
                    Limit=1000
                )
                for item in response.get('Items', []):
                    comment_id = item.get('comment_id')
                    layer0_cluster_id = item.get('layer0_cluster_id')
                    if comment_id is not None and layer0_cluster_id is not None:
                        cluster_map[str(comment_id)] = layer0_cluster_id
            
            logger.info(f"Loaded {len(cluster_map)} cluster assignments from DynamoDB")
            return cluster_map
        except Exception as e:
            logger.error(f"Error loading cluster assignments from DynamoDB: {e}")
            return {}
    
    async def get_topics(self):
        """Get topics for the conversation from DynamoDB."""
        # Get topics from ClusterTopics table
        dynamo_storage = DynamoDBStorage(
            endpoint_url=os.environ.get('DYNAMODB_ENDPOINT')
        )
        
        # Get topic data from DynamoDB
        topics = []
        
        try:
            # Get all LLMTopicNames entries for layer 0
            table = dynamo_storage.dynamodb.Table('Delphi_CommentClustersLLMTopicNames')
            response = table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('conversation_id').eq(self.conversation_id) &
                               boto3.dynamodb.conditions.Attr('layer_id').eq(0)
            )
            
            topic_names_items = response.get('Items', [])
            logger.info(f"Found {len(topic_names_items)} layer 0 topic names in LLMTopicNames")
            
            # Get all comment clusters
            clusters_table = dynamo_storage.dynamodb.Table('Delphi_CommentHierarchicalClusterAssignments')
            response = clusters_table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('conversation_id').eq(self.conversation_id)
            )
            
            clusters = response.get('Items', [])
            logger.info(f"Found {len(clusters)} comment cluster entries")
            
            # Process clusters to get comment IDs for each topic
            topic_comments = defaultdict(list)
            for item in clusters:
                # Look at layer0 clusters
                if 'layer0_cluster_id' in item:
                    cluster_id = item['layer0_cluster_id']
                    comment_id = item.get('comment_id')
                    if comment_id:
                        topic_comments[cluster_id].append(int(comment_id))
            
            logger.info(f"Collected comments for {len(topic_comments)} clusters")
            
            # Create topics data structure
            for topic_item in topic_names_items:
                cluster_id = topic_item.get('cluster_id')
                topic_name = topic_item.get('topic_name', f"Topic {cluster_id}")
                
                logger.info(f"Processing topic for cluster {cluster_id}: {topic_name}")
                
                if cluster_id is not None:
                    # Try to get sample comments for this topic
                    sample_comments = []
                    cluster_response = dynamo_storage.dynamodb.Table('Delphi_CommentClustersStructureKeywords').query(
                        KeyConditionExpression=boto3.dynamodb.conditions.Key('conversation_id').eq(self.conversation_id) &
                                             boto3.dynamodb.conditions.Key('cluster_key').eq(f'layer0_{cluster_id}')
                    )
                    
                    if cluster_response.get('Items'):
                        cluster_item = cluster_response.get('Items')[0]
                        if 'sample_comments' in cluster_item:
                            if isinstance(cluster_item['sample_comments'], list):
                                sample_comments = cluster_item['sample_comments']
                            elif isinstance(cluster_item['sample_comments'], dict) and 'L' in cluster_item['sample_comments']:
                                for comment in cluster_item['sample_comments']['L']:
                                    if 'S' in comment:
                                        sample_comments.append(comment['S'])
                    
                    # Get topic_key - this is required for stable mapping
                    topic_key = topic_item.get('topic_key')
                    if not topic_key:
                        logger.error(f"Missing topic_key for cluster {cluster_id} in conversation {self.conversation_id}")
                        raise ValueError(f"topic_key is required but missing for cluster {cluster_id}")
                    
                    # Create topic entry
                    topic = {
                        "cluster_id": cluster_id,
                        "name": topic_name,
                        "topic_key": topic_key,
                        "citations": topic_comments.get(cluster_id, []),
                        "sample_comments": sample_comments
                    }
                    topics.append(topic)
            
            logger.info(f"Created {len(topics)} topics for conversation {self.conversation_id}")
            
            # Sort topics by number of citations (descending)
            topics.sort(key=lambda x: len(x['citations']), reverse=True)
            
            return topics
        
        except Exception as e:
            logger.error(f"Error getting topics: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return []
    
    def filter_topics(self, comment, topic_cluster_id=None, topic_citations=None, sample_comments=None):
        """Filter for comments that are part of a specific topic."""
        # Get comment ID
        comment_id = comment.get('comment_id')
        if not comment_id:
            return False
        
        # Check if we have a specific cluster ID to filter by
        if topic_cluster_id is not None:
            layer0_cluster_id = comment.get('layer0_cluster_id')
            if layer0_cluster_id is not None:
                # Debug logging for cluster 0
                if str(topic_cluster_id) == "0" and comment_id in [1, 2, 3]:  # Log first few comments
                    logger.info(f"DEBUG: Checking comment {comment_id} - layer0_cluster_id={layer0_cluster_id}, topic_cluster_id={topic_cluster_id}")
                    logger.info(f"DEBUG: String comparison: '{str(layer0_cluster_id)}' == '{str(topic_cluster_id)}' = {str(layer0_cluster_id) == str(topic_cluster_id)}")
                
                # Simple string comparison is more reliable across different numeric types
                if str(layer0_cluster_id) == str(topic_cluster_id):
                    return True
                
        # Check if this comment ID is in our topic citations
        if topic_citations and str(comment_id) in [str(c) for c in topic_citations]:
            return True
            
        # If we have sample comments and not enough filtered comments,
        # try to match based on text similarity
        if sample_comments and len(sample_comments) > 0:
            comment_text = comment.get('comment', '')
            if not comment_text:
                return False
                
            # Check if this comment text matches any sample comment
            for sample in sample_comments:
                # Skip non-string samples
                if not isinstance(sample, str) or not sample:
                    continue
                    
                # Simple substring match rather than complex word comparison
                if sample.lower() in comment_text.lower() or comment_text.lower() in sample.lower():
                    return True
        
        return False
    
    async def get_comments_as_xml(self, filter_func=None, filter_args=None):
        """Get comments as XML, optionally filtered."""
        try:
            # Get conversation data
            data = await self.get_conversation_data()
            
            if not data:
                logger.error("Failed to get conversation data.")
                return ""
            
            # Apply filter if provided
            filtered_comments = data["processed_comments"]
            
            if filter_func:
                if filter_args:
                    filtered_comments = [c for c in filtered_comments if filter_func(c, **filter_args)]
                else:
                    filtered_comments = [c for c in filtered_comments if filter_func(c)]
            
            # Limit the number of comments for topic reports to avoid "Too many comments" error
            if filter_func == self.filter_topics and len(filtered_comments) > 100:
                logger.info(f"Limiting topic comments from {len(filtered_comments)} to 100")
                # Sort by votes to include the most significant comments - use safer access for votes
                filtered_comments.sort(key=lambda c: int(c.get('votes', 0)) if isinstance(c.get('votes'), (int, float)) else 0, reverse=True)
                filtered_comments = filtered_comments[:100]
            
            # Convert to XML
            xml = PolisConverter.convert_to_xml(filtered_comments)
            
            return xml
        except Exception as e:
            logger.error(f"Error in get_comments_as_xml: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return ""
    
    async def prepare_batch_requests(self):
        """Prepare batch requests for all topics."""
        # Get topics
        topics = await self.get_topics()
        
        if not topics:
            logger.warning("No topics found")
            return []
        
        logger.info(f"Preparing batch requests for {len(topics)} topics")
        
        # Read system lore
        system_path = self.prompt_base_path / 'system.xml'
        if not system_path.exists():
            logger.error(f"System file not found: {system_path}")
            return []
        
        with open(system_path, 'r') as f:
            system_lore = f.read()
        
        # Read template file for topics
        template_path = self.prompt_base_path / "subtaskPrompts/topics.xml"
        if not template_path.exists():
            logger.error(f"Template file not found: {template_path}")
            return []
        
        with open(template_path, 'r') as f:
            template_content = f.read()
        
        # Initialize list for batch requests
        batch_requests = []
        
        # For each topic, prepare a prompt and add it to the batch
        for topic in topics:
            topic_name = topic['name']
            topic_cluster_id = topic['cluster_id']
            topic_key = topic['topic_key']  # Use the stable topic_key from DynamoDB
            section_name = topic_key  # Use topic_key directly as section name
            
            # Log the mapping for clarity
            logger.info(f"Topic mapping - cluster_id: {topic_cluster_id}, topic_name: {topic_name}, topic_key: {topic_key}, section_name: {section_name}")
            
            # Create filter for this topic
            filter_args = {
                'topic_cluster_id': topic_cluster_id,
                'topic_citations': topic.get('citations', []),
                'sample_comments': topic.get('sample_comments', [])
            }
            
            # Get comments as XML
            structured_comments = await self.get_comments_as_xml(self.filter_topics, filter_args)
            
            # Debug logging for topic 0
            if topic_cluster_id == 0 or str(topic_cluster_id) == "0":
                logger.info(f"DEBUG: Topic 0 filter_args: {filter_args}")
                logger.info(f"DEBUG: Topic 0 structured_comments length: {len(structured_comments) if structured_comments else 0}")
                logger.info(f"DEBUG: Topic 0 has content: {bool(structured_comments and structured_comments.strip())}")
            
            # Skip if no structured comments
            if not structured_comments.strip():
                logger.warning(f"No content after filter for topic {topic_name} (cluster_id={topic_cluster_id})")
                continue
            
            # Insert structured comments into template
            try:
                template_dict = xmltodict.parse(template_content)
                
                # Find the data element and replace its content
                template_dict['polisAnalysisPrompt']['data'] = {"content": {"structured_comments": structured_comments}}
                
                # Add topic name to prompt
                if 'context' in template_dict['polisAnalysisPrompt']:
                    if isinstance(template_dict['polisAnalysisPrompt']['context'], dict):
                        template_dict['polisAnalysisPrompt']['context']['topic_name'] = topic_name
                
                # Convert back to XML
                prompt_xml = xmltodict.unparse(template_dict, pretty=True)
                
                # Add model prompt formatting
                model_prompt = f"""
                    {prompt_xml}

                    You MUST respond with a JSON object that follows this EXACT structure for topic analysis. 
                    IMPORTANT: Do NOT simply repeat the comments verbatim. Instead, analyze the underlying themes, values,
                    and perspectives reflected in the comments. Identify patterns in how different groups view the topic.

                    ```json
                    {{
                      "id": "topic_overview_and_consensus",
                      "title": "Overview of Topic and Consensus",
                      "paragraphs": [
                        {{
                          "id": "topic_overview",
                          "title": "Overview of Topic",
                          "sentences": [
                            {{
                              "clauses": [
                                {{
                                  "text": "This topic reveals patterns of participant views on economic development, community identity, and resource priorities.",
                                  "citations": [190, 191, 1142]
                                }},
                                {{
                                  "text": "Analysis of what the comments reveal about underlying values and priorities in the community.",
                                  "citations": [1245, 1256]
                                }}
                              ]
                            }}
                          ]
                        }},
                        {{
                          "id": "topic_by_groups",
                          "title": "Group Perspectives on Topic",
                          "sentences": [
                            {{
                              "clauses": [
                                {{
                                  "text": "Comparison of how different groups approached this topic, with analysis of the values that drive their different perspectives.",
                                  "citations": [190, 191]
                                }}
                              ]
                            }}
                          ]
                        }}
                      ]
                    }}
                    ```

                    Make sure the JSON is VALID, as defined at https://www.json.org/json-en.html:
                    - Begin with object '{{' and end with '}}'
                    - All keys MUST be enclosed in double quotes
                    - NO trailing commas should be included after the last element in any array or object
                    - Do NOT include any additional text outside of the JSON object
                    - Do not provide explanations, only the JSON
                    - Use the exact structure shown above with "id", "title", "paragraphs", etc.
                    - Include relevant citations to comment IDs in the data
                """
                
                # Add to batch requests
                batch_request = {
                    "system": system_lore,
                    "messages": [
                        {"role": "user", "content": model_prompt}
                    ],
                    "max_tokens": 4000,
                    "metadata": {
                        "topic_name": topic_name,
                        "topic_key": topic_key,
                        "cluster_id": topic_cluster_id,
                        "section_name": section_name,
                        "conversation_id": self.conversation_id
                    }
                }
                
                batch_requests.append(batch_request)
                
            except Exception as e:
                logger.error(f"Error preparing prompt for topic {topic_name}: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
                continue
        
        logger.info(f"Prepared {len(batch_requests)} batch requests")
        return batch_requests
    
    async def process_request(self, request):
        """Process a single topic report request."""
        try:
            # Extract metadata
            metadata = request.get('metadata', {})
            topic_name = metadata.get('topic_name', 'Unknown Topic')
            section_name = metadata.get('section_name', f"topic_{topic_name.lower().replace(' ', '_')}")

            logger.info(f"Processing request for topic: {topic_name}")

            # Create Anthropic provider
            anthropic_provider = get_model_provider("anthropic", self.model)

            # Get response from LLM
            response = await anthropic_provider.get_completion(
                system=request.get('system', ''),
                prompt=request.get('messages', [])[0].get('content', ''),
                max_tokens=request.get('max_tokens', 4000)
            )

            # Log response for debugging
            logger.info(f"Received response from LLM for topic {topic_name}")

            # Extract content from the response
            content = response.get('content', '{}')

            # Store the result in NarrativeReports table
            if self.report_id:
                self.report_storage.store_report(
                    report_id=self.report_id,
                    section=section_name,
                    model=self.model,
                    report_data=content,
                    job_id=self.job_id,
                    metadata={
                        'topic_name': topic_name,
                        'cluster_id': metadata.get('cluster_id')
                    }
                )
                logger.info(f"Stored report for section {section_name}")
            else:
                logger.warning(f"No report_id available, skipping storage for {section_name}")

            return {
                'topic_name': topic_name,
                'section_name': section_name,
                'response': response
            }
        except Exception as e:
            logger.error(f"Error processing request for topic {request.get('metadata', {}).get('topic_name', 'unknown')}: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    async def submit_batch(self):
        """Prepare and process a batch of topic report requests using Anthropic's Batch API."""
        logger.info("=== Starting batch submission process ===")

        # Prepare batch requests
        try:
            logger.info("Preparing batch requests for topics...")
            batch_requests = await self.prepare_batch_requests()

            if not batch_requests:
                logger.error("No batch requests to submit - prepare_batch_requests returned empty list")
                return None

            logger.info(f"Successfully prepared {len(batch_requests)} batch requests")
        except Exception as e:
            logger.error(f"Critical error during batch request preparation: {str(e)}")
            logger.error(traceback.format_exc())
            return None

        # Log job information
        logger.info(f"Processing batch of {len(batch_requests)} requests for conversation {self.conversation_id}")
        if self.job_id:
            logger.info(f"Job ID: {self.job_id}")
        if self.report_id:
            logger.info(f"Report ID: {self.report_id}")


        # Validate API key presence
        anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not anthropic_api_key:
            logger.error("ERROR: ANTHROPIC_API_KEY environment variable is not set. Cannot submit batch.")
            if self.job_id:
                try:
                    # Update job status to reflect missing API key
                    dynamodb = boto3.resource(
                        'dynamodb',
                        endpoint_url=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
                        region_name=os.environ.get('AWS_REGION', 'us-west-2'),
                        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
                    )
                    job_table = dynamodb.Table('Delphi_JobQueue')
                    job_table.update_item(
                        Key={'job_id': self.job_id},
                        UpdateExpression="SET job_status = :status, error_message = :error",
                        ExpressionAttributeValues={
                            ':status': 'FAILED',
                            ':error': 'Missing ANTHROPIC_API_KEY environment variable'
                        }
                    )
                    logger.info(f"Updated job {self.job_id} status to FAILED due to missing API key")
                except Exception as e:
                    logger.error(f"Failed to update job status: {str(e)}")
            return None

        # Main try block for API interaction
        try:
            # Import Anthropic SDK
            logger.info("Importing Anthropic SDK...")
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
                    return None

            # Initialize Anthropic client
            logger.info("Initializing Anthropic client...")
            try:
                anthropic = Anthropic(api_key=anthropic_api_key)
                logger.info("Successfully initialized Anthropic client")
            except Exception as e:
                logger.error(f"Failed to initialize Anthropic client: {str(e)}")
                logger.error(traceback.format_exc())
                return None

            # Format requests for Anthropic Batch API
            logger.info("Formatting batch requests for Anthropic API...")
            formatted_batch_requests = []

            try:
                for i, request in enumerate(batch_requests):
                    # Extract metadata for custom_id
                    metadata = request.get('metadata', {})
                    section_name = metadata.get('section_name', 'unknown_section')

                    # Create a valid custom_id (only allow a-zA-Z0-9_-)
                    # Since section_name now contains layer and cluster info (e.g., layer0_0), we don't need cluster_id
                    custom_id = f"{self.conversation_id}_{section_name}"
                    safe_custom_id = re.sub(r'[^a-zA-Z0-9_-]', '_', custom_id)

                    # Validate custom_id length (max 64 chars for Anthropic API)
                    if len(safe_custom_id) > 64:
                        safe_custom_id = safe_custom_id[:64]
                        logger.warning(f"Truncated custom_id to 64 chars: {safe_custom_id}")

                    # Make sure we have system and user messages
                    system_content = request.get('system', '')
                    if not system_content:
                        logger.warning(f"Empty system prompt for request {i}, using default")
                        system_content = "You are a helpful AI assistant analyzing survey data."

                    user_content = ''
                    if 'messages' in request and len(request.get('messages', [])) > 0:
                        user_content = request.get('messages', [])[0].get('content', '')

                    if not user_content:
                        logger.warning(f"Empty user prompt for request {i}, skipping")
                        continue

                    # Create a proper user message format following working example
                    user_message = {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": user_content
                            }
                        ]
                    }

                    # Format request for Anthropic Batch API following working example
                    formatted_request = {
                        "custom_id": safe_custom_id,
                        "params": {
                            "model": self.model,
                            "max_tokens": request.get('max_tokens', 4000),
                            "system": system_content,
                            "messages": [user_message]
                        }
                    }

                    formatted_batch_requests.append(formatted_request)

                logger.info(f"Successfully formatted {len(formatted_batch_requests)} batch requests")

                # Debug: log the first request structure (without full content)
                if formatted_batch_requests:
                    # CRITICAL BUG FIX: Must use deepcopy here! 
                    # Using shallow copy causes the debug truncation to modify the actual request sent to Anthropic
                    # This was causing the first batch item to fail with "Report data is not in the expected JSON format"
                    import copy
                    debug_request = copy.deepcopy(formatted_batch_requests[0])
                    if 'params' in debug_request:
                        # Truncate system content
                        if 'system' in debug_request['params'] and isinstance(debug_request['params']['system'], str) and len(debug_request['params']['system']) > 100:
                            debug_request['params']['system'] = debug_request['params']['system'][:100] + "... [content truncated for log]"

                        # Truncate message content
                        if 'messages' in debug_request['params']:
                            for msg in debug_request['params']['messages']:
                                if 'content' in msg and isinstance(msg['content'], list):
                                    for content_item in msg['content']:
                                        if 'text' in content_item and isinstance(content_item['text'], str) and len(content_item['text']) > 100:
                                            content_item['text'] = content_item['text'][:100] + "... [content truncated for log]"

                    logger.info(f"Sample batch request structure: {json.dumps(debug_request, indent=2)}")
                    logger.info(f"Using format that matches working example from other project")

            except Exception as e:
                logger.error(f"Error formatting batch requests: {str(e)}")
                logger.error(traceback.format_exc())
                return None

            if not formatted_batch_requests:
                logger.error("No valid formatted batch requests to submit")
                return None

            logger.info(f"Submitting {len(formatted_batch_requests)} requests to Anthropic Batch API")

            # Submit the batch to Anthropic with detailed error handling
            try:
                batch = anthropic.beta.messages.batches.create(requests=formatted_batch_requests)
                logger.info("Successfully submitted batch to Anthropic API")
                logger.info(f"Batch ID: {batch.id}")
                logger.info(f"Batch status: {batch.processing_status}")
                logger.info(f"FULL BATCH OBJECT: {batch}")
            except APIStatusError as e:
                logger.error(f"Anthropic API Status Error: {str(e)}")
                logger.error(f"Status: {e.status_code}")
                logger.error(f"Response: {e.response}")
                return None
            except APIConnectionError as e:
                logger.error(f"Anthropic API Connection Error: {str(e)}")
                return None
            except APIResponseValidationError as e:
                logger.error(f"Anthropic API Response Validation Error: {str(e)}")
                logger.error(f"Response: {e.response}")
                return None
            except APIError as e:
                logger.error(f"Anthropic API Error: {str(e)}")
                return None
            except Exception as e:
                logger.error(f"Unexpected error submitting batch to Anthropic API: {str(e)}")
                logger.error(traceback.format_exc())
                return None

            # Store batch information in DynamoDB if we have a job ID
            if self.job_id:
                logger.info(f"Updating job {self.job_id} with batch information in DynamoDB...")
                try:
                    # Use the existing DynamoDB client for the job queue
                    dynamodb = boto3.resource(
                        'dynamodb',
                        endpoint_url=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
                        region_name=os.environ.get('AWS_REGION', 'us-west-2'),
                        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
                    )

                    # Connect to the job queue table
                    job_table = dynamodb.Table('Delphi_JobQueue')

                    # Check if the table exists
                    try:
                        job_table.table_status
                        logger.info("Successfully connected to Delphi_JobQueue table")
                    except Exception as e:
                        logger.error(f"Failed to connect to Delphi_JobQueue table: {str(e)}")
                        logger.error("Available tables:")
                        try:
                            tables = list(dynamodb.tables.all())
                            for table in tables:
                                logger.info(f"- {table.name}")
                        except Exception as e:
                            logger.error(f"Failed to list tables: {str(e)}")
                        return batch.id  # Still return batch ID even if we can't update DynamoDB

                    # Simplify the update - just focus on getting batch_id stored
                    batch_id_str = str(batch.id)  # Convert to string to ensure compatibility
                    logger.info(f"Attempting to store batch_id as string: {batch_id_str}")

                    # Update the job with batch information - fixed version with ExpressionAttributeNames
                    update_response = job_table.update_item(
                        Key={'job_id': self.job_id},
                        UpdateExpression="SET batch_id = :batch_id, #s = :job_status, model = :model",
                        ExpressionAttributeNames={
                            '#s': 'status'  # Use ExpressionAttributeNames to avoid 'status' reserved keyword
                        },
                        ExpressionAttributeValues={
                            ':batch_id': batch_id_str,
                            ':job_status': 'PROCESSING',  # Set job status to PROCESSING so poller knows to check batch status
                            ':model': self.model  # Store the model name
                        },
                        ReturnValues="UPDATED_NEW"
                    )

                    # Verify update took effect
                    verify_job = job_table.get_item(Key={'job_id': self.job_id})
                    if 'Item' in verify_job:
                        job_item = verify_job['Item']
                        if 'batch_id' in job_item:
                            logger.info(f"VERIFICATION SUCCESS: batch_id found in job record: {job_item['batch_id']}")
                        else:
                            logger.error(f"VERIFICATION FAILED: batch_id not found in job record!")
                            logger.error(f"Job fields: {list(job_item.keys())}")
                    else:
                        logger.error(f"Could not verify update - job not found!")

                    logger.info(f"Successfully updated job {self.job_id} with batch information")
                    logger.info(f"Batch ID: {batch.id} stored in job record")
                    logger.info(f"DynamoDB update response: {update_response}")
                    logger.info(f"Job is now in PROCESSING state - poller will run batch status checks")

                    # Schedule a batch status check job to run in 60 seconds
                    try:
                        # Create a new job for checking batch status
                        status_check_job_id = f"batch_check_{self.job_id}_{int(time.time())}"

                        # Current timestamp
                        now = datetime.now().isoformat()

                        # Create the status check job with the new job type
                        status_job = {
                            'job_id': status_check_job_id,
                            'status': 'PENDING',
                            'job_type': 'AWAITING_NARRATIVE_BATCH',  # New job type for clearer state machine
                            'batch_job_id': self.job_id,
                            'batch_id': batch.id,
                            'conversation_id': self.conversation_id,
                            'report_id': self.report_id,
                            'created_at': now,
                            'updated_at': now,
                            'priority': 50,  # Medium priority
                            'version': 1,
                            'logs': json.dumps({'entries': []})
                        }

                        # Put the job in the queue
                        job_table.put_item(Item=status_job)

                        logger.info(f"Scheduled batch status check job {status_check_job_id} to run in 60 seconds")
                    except Exception as e:
                        logger.error(f"Failed to schedule batch status check job: {str(e)}")
                        logger.error(traceback.format_exc())
                        # Continue despite failure
                        logger.info("Continuing despite failure to schedule status check job")

                except Exception as e:
                    logger.error(f"Failed to update job with batch information: {str(e)}")
                    logger.error(traceback.format_exc())
                    # Continue despite DynamoDB update failure
                    logger.info("Continuing despite DynamoDB update failure")

            logger.info("=== Batch submission completed successfully ===")
            return batch.id

        except Exception as e:
            logger.error(f"Unhandled error in submit_batch: {str(e)}")
            logger.error(traceback.format_exc())

            # Try to update job status in DynamoDB
            if self.job_id:
                try:
                    dynamodb = boto3.resource(
                        'dynamodb',
                        endpoint_url=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
                        region_name=os.environ.get('AWS_REGION', 'us-west-2'),
                        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
                    )
                    job_table = dynamodb.Table('Delphi_JobQueue')
                    job_table.update_item(
                        Key={'job_id': self.job_id},
                        UpdateExpression="SET job_status = :status, error_message = :error",
                        ExpressionAttributeValues={
                            ':status': 'FAILED',
                            ':error': f"Error in batch submission: {str(e)}"
                        }
                    )
                    logger.info(f"Updated job {self.job_id} status to FAILED due to error")
                except Exception as update_error:
                    logger.error(f"Failed to update job status after error: {str(update_error)}")

            return None

async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Generate narrative reports for Polis conversations')
    parser.add_argument('--conversation_id', '--zid', type=str, required=True,
                        help='Conversation ID to process')
    parser.add_argument('--model', type=str, default='claude-3-5-sonnet-20241022',
                        help='LLM model to use (default: claude-3-5-sonnet-20241022)')
    parser.add_argument('--no-cache', action='store_true',
                        help='Ignore cached report data')
    parser.add_argument('--max-batch-size', type=int, default=5,
                        help='Maximum number of topics to include in a single batch (default: 5)')
    args = parser.parse_args()

    # Get environment variables for job
    job_id = os.environ.get('DELPHI_JOB_ID')
    report_id = os.environ.get('DELPHI_REPORT_ID')

    # Set up environment variables for database connections
    os.environ.setdefault('DATABASE_HOST', 'host.docker.internal')
    os.environ.setdefault('DATABASE_PORT', '5432')
    os.environ.setdefault('DATABASE_NAME', 'polisDB_prod_local_mar14')
    os.environ.setdefault('DATABASE_USER', 'postgres')
    os.environ.setdefault('DATABASE_PASSWORD', '')

    # Print database connection info
    logger.info(f"Database connection info:")
    logger.info(f"- HOST: {os.environ.get('DATABASE_HOST')}")
    logger.info(f"- PORT: {os.environ.get('DATABASE_PORT')}")
    logger.info(f"- DATABASE: {os.environ.get('DATABASE_NAME')}")
    logger.info(f"- USER: {os.environ.get('DATABASE_USER')}")

    # Print execution summary
    logger.info(f"Running narrative report generator with the following settings:")
    logger.info(f"- Conversation ID: {args.conversation_id}")
    logger.info(f"- Model: {args.model}")
    logger.info(f"- Cache: {'disabled' if args.no_cache else 'enabled'}")
    logger.info(f"- Max batch size: {args.max_batch_size}")
    if job_id:
        logger.info(f"- Job ID: {job_id}")
    if report_id:
        logger.info(f"- Report ID: {report_id}")

    # Create batch report generator
    generator = BatchReportGenerator(
        conversation_id=args.conversation_id,
        model=args.model,
        no_cache=args.no_cache,
        max_batch_size=args.max_batch_size,
        job_id=job_id
    )

    # Process reports
    result = await generator.submit_batch()

    if result:
        logger.info(f"Narrative reports generated successfully")
        print(f"Narrative reports generated successfully")
        if job_id:
            print(f"Job ID: {job_id}")
        if report_id:
            print(f"Reports stored for report_id: {report_id}")
    else:
        logger.error(f"Failed to generate narrative reports")
        print(f"Failed to generate narrative reports. See logs for details.")
        # Exit with error code
        sys.exit(1)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())