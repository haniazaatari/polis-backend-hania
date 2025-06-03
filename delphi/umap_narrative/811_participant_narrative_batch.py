#!/usr/bin/env python3
"""
Generate batch narrative reports for participant clusters using Anthropic's Batch API.

This script creates LLM-based narrative analysis of participant groups from UMAP clustering:
1. Loads participant cluster assignments from 703 UMAP clustering
2. Analyzes distinctive voting patterns using 704 analysis
3. Converts participant data to XML format for LLM analysis
4. Submits batch requests to Anthropic's Batch API
5. Stores batch job metadata in DynamoDB

Usage:
    python 811_participant_narrative_batch.py --conversation_id CONVERSATION_ID [--model MODEL] [--no-cache]

Args:
    --conversation_id: Conversation ID/zid
    --model: LLM model to use (defaults to ANTHROPIC_MODEL env var)
    --no-cache: Ignore cached report data
    --max-batch-size: Maximum number of participant groups to include in a single batch (default: 10)
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
import re
import requests
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Tuple
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString
import traceback
from decimal import Decimal

# Import the model provider
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from umap_narrative.llm_factory_constructor import get_model_provider
from umap_narrative.llm_factory_constructor.model_provider import AnthropicProvider

# Import from local modules
from polismath_commentgraph.utils.storage import PostgresClient, DynamoDBStorage
from polismath_commentgraph.utils.group_data import GroupDataProcessor

# Import existing narrative report infrastructure  
import importlib.util
spec = importlib.util.spec_from_file_location("narrative_batch", 
    "/home/christian-weilbach/Development/polis/delphi/umap_narrative/801_narrative_report_batch.py")
narrative_batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(narrative_batch)
NarrativeReportService = narrative_batch.NarrativeReportService

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ParticipantClusterConverter:
    """Convert participant cluster data to XML format for LLM analysis."""
    
    def __init__(self, group_processor: GroupDataProcessor):
        self.group_processor = group_processor
    
    def convert_participant_cluster_to_xml(self, cluster_data: Dict[str, Any]) -> str:
        """
        Convert participant cluster data to XML format for LLM analysis.
        
        Args:
            cluster_data: Dictionary containing cluster information and distinctive voting patterns
            
        Returns:
            XML string formatted for LLM analysis
        """
        # Create root element
        root = ET.Element("participant_cluster_analysis")
        
        # Add cluster metadata
        cluster_meta = ET.SubElement(root, "cluster", {
            "id": str(cluster_data['cluster_id']),
            "name": cluster_data.get('cluster_name', f"Group {cluster_data['cluster_id']}"),
            "size": str(cluster_data['participant_count']),
            "total_distinctive_positions": str(
                len(cluster_data.get('distinctive_agrees', [])) + 
                len(cluster_data.get('distinctive_disagrees', [])) + 
                len(cluster_data.get('consensus_breaks', []))
            )
        })
        
        # Add distinctive agreements section
        if cluster_data.get('distinctive_agrees'):
            agrees_section = ET.SubElement(cluster_meta, "distinctive_agreements", {
                "count": str(len(cluster_data['distinctive_agrees']))
            })
            
            for item in cluster_data['distinctive_agrees']:
                position = ET.SubElement(agrees_section, "position", {
                    "comment_id": str(item['comment_id']),
                    "group_support": f"{item['group_agree_pct']:.1%}",
                    "others_support": f"{item['others_agree_pct']:.1%}",
                    "difference": f"{item['difference']:.1%}",
                    "group_votes": str(item['group_votes'])
                })
                
                text_elem = ET.SubElement(position, "text")
                text_elem.text = item['comment_text']
                
                voting_breakdown = ET.SubElement(position, "voting_breakdown")
                agree_elem = ET.SubElement(voting_breakdown, "agree")
                agree_elem.text = f"{int(item['group_agree_pct'] * item['group_votes'])} participants"
        
        # Add distinctive disagreements section
        if cluster_data.get('distinctive_disagrees'):
            disagrees_section = ET.SubElement(cluster_meta, "distinctive_disagreements", {
                "count": str(len(cluster_data['distinctive_disagrees']))
            })
            
            for item in cluster_data['distinctive_disagrees']:
                position = ET.SubElement(disagrees_section, "position", {
                    "comment_id": str(item['comment_id']),
                    "group_oppose": f"{item['group_disagree_pct']:.1%}",
                    "others_oppose": f"{item['others_disagree_pct']:.1%}",
                    "difference": f"{item['difference']:.1%}",
                    "group_votes": str(item['group_votes'])
                })
                
                text_elem = ET.SubElement(position, "text")
                text_elem.text = item['comment_text']
        
        # Add consensus breaks section
        if cluster_data.get('consensus_breaks'):
            consensus_section = ET.SubElement(cluster_meta, "group_consensus_breaks", {
                "count": str(len(cluster_data['consensus_breaks']))
            })
            
            for item in cluster_data['consensus_breaks']:
                position = ET.SubElement(consensus_section, "position", {
                    "comment_id": str(item['comment_id']),
                    "group_support": f"{item['group_agree_pct']:.1%}",
                    "overall_support": f"{item['overall_agree_pct']:.1%}",
                    "difference": f"{item['difference']:.1%}",
                    "group_votes": str(item['group_votes'])
                })
                
                text_elem = ET.SubElement(position, "text")
                text_elem.text = item['comment_text']
        
        # Convert to string with pretty formatting
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")

class ParticipantBatchReportGenerator:
    """Generate batch reports for participant clusters in Polis conversations."""

    def __init__(self, conversation_id, model=None, no_cache=False, max_batch_size=10, job_id=None):
        """Initialize the participant batch report generator.

        Args:
            conversation_id: ID of the conversation to generate reports for
            model: Name of the LLM model to use
            no_cache: Whether to ignore cached report data
            max_batch_size: Maximum number of participant groups in a batch
            job_id: Optional job ID from the job queue system
        """
        self.conversation_id = str(conversation_id)
        if not model:
            model = os.environ.get("ANTHROPIC_MODEL")
            if not model:
                raise ValueError("Model must be specified via --model argument or ANTHROPIC_MODEL environment variable")
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
        
        # Initialize participant cluster converter
        self.converter = ParticipantClusterConverter(self.group_processor)

        # Set up base path for prompt templates
        current_dir = Path(__file__).parent
        self.prompt_base_path = current_dir / "participant_prompts"
    
    def load_participant_clusters_from_dynamodb(self, conversation_id: str) -> Dict[int, Dict[str, Any]]:
        """Load participant cluster assignments and names from DynamoDB."""
        try:
            # Initialize DynamoDB client
            dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
            )
            
            clusters = {}
            
            # Load cluster assignments from 703 UMAP clustering
            try:
                cluster_table = dynamodb.Table('Delphi_UMAPParticipantClusters')
                response = cluster_table.query(
                    KeyConditionExpression=boto3.dynamodb.conditions.Key('conversation_id').eq(conversation_id)
                )
                
                participant_assignments = {}
                for item in response['Items']:
                    participant_id = int(item['participant_id'])
                    cluster_id = int(item['cluster_id'])
                    participant_assignments[participant_id] = cluster_id
                
                # Group participants by cluster
                cluster_participants = {}
                for pid, cluster_id in participant_assignments.items():
                    if cluster_id not in cluster_participants:
                        cluster_participants[cluster_id] = []
                    cluster_participants[cluster_id].append(pid)
                
                logger.info(f"Loaded {len(participant_assignments)} participant assignments into {len(cluster_participants)} clusters")
                
                # Create cluster data structure
                for cluster_id, participants in cluster_participants.items():
                    clusters[cluster_id] = {
                        'cluster_id': cluster_id,
                        'participants': participants,
                        'participant_count': len(participants),
                        'cluster_name': f"Group {cluster_id}"  # Always use neutral numbered names
                    }
                
            except Exception as e:
                logger.warning(f"Could not load participant cluster assignments: {e}")
                return {}
            
            # Note: LLM cluster naming table removed - using simple numbered groups only
            
            return clusters
            
        except Exception as e:
            logger.error(f"Error loading participant clusters from DynamoDB: {e}")
            return {}
    
    def get_participant_cluster_voting_patterns(self, cluster_id: int, participants: List[int]) -> Dict[str, Any]:
        """Get distinctive voting patterns for a participant cluster using 704 analysis."""
        try:
            # Get the complete participant groups mapping from DynamoDB for one-vs-all analysis
            complete_clusters = self.load_participant_clusters_from_dynamodb(str(self.conversation_id))
            
            # Create complete participant groups mapping for all participants
            participant_groups = {}
            for cid, cluster_data in complete_clusters.items():
                for pid in cluster_data['participants']:
                    participant_groups[pid] = cid
            
            logger.info(f"Using complete participant mapping: {len(participant_groups)} participants across {len(complete_clusters)} groups")
            
            # Use the existing 704 analysis to get distinctive voting patterns (one-vs-all)
            distinctive_data = self.group_processor.filter_participant_group_distinctive_comments(
                int(self.conversation_id), participant_groups, cluster_id, threshold=0.3
            )
            
            logger.info(f"Cluster {cluster_id}: {len(distinctive_data['distinctive_agrees'])} agreements, "
                       f"{len(distinctive_data['distinctive_disagrees'])} disagreements, "
                       f"{len(distinctive_data['consensus_breaks'])} consensus breaks")
            
            return distinctive_data
            
        except Exception as e:
            logger.error(f"Error getting voting patterns for cluster {cluster_id}: {e}")
            return {'distinctive_agrees': [], 'distinctive_disagrees': [], 'consensus_breaks': []}
    
    async def get_participant_clusters_data(self):
        """Get participant cluster data for the conversation."""
        try:
            # Initialize PostgreSQL connection
            self.postgres_client.initialize()
            
            # Load participant clusters from DynamoDB
            clusters = self.load_participant_clusters_from_dynamodb(self.conversation_id)
            if not clusters:
                logger.error(f"No participant clusters found for conversation {self.conversation_id}")
                return None
            
            # Enrich clusters with voting pattern analysis
            enriched_clusters = {}
            for cluster_id, cluster_data in clusters.items():
                logger.info(f"Analyzing voting patterns for cluster {cluster_id} ({cluster_data['participant_count']} participants)")
                
                # Get distinctive voting patterns
                voting_patterns = self.get_participant_cluster_voting_patterns(
                    cluster_id, cluster_data['participants']
                )
                
                # Combine cluster metadata with voting patterns
                enriched_cluster = {
                    **cluster_data,
                    **voting_patterns
                }
                
                enriched_clusters[cluster_id] = enriched_cluster
            
            logger.info(f"Successfully enriched {len(enriched_clusters)} participant clusters with voting patterns")
            return enriched_clusters
            
        except Exception as e:
            logger.error(f"Error getting participant clusters data: {e}")
            return None
    
    def get_prompt_template(self, template_name: str) -> str:
        """Load a prompt template from the experimental prompts directory."""
        try:
            template_path = self.prompt_base_path / "subtaskPrompts" / f"{template_name}.xml"
            if template_path.exists():
                return template_path.read_text()
            else:
                # Fallback to basic template if file not found
                logger.warning(f"Template {template_name}.xml not found, using basic template")
                return self.get_basic_participant_template()
        except Exception as e:
            logger.error(f"Error loading template {template_name}: {e}")
            return self.get_basic_participant_template()
    
    def get_basic_participant_template(self) -> str:
        """Basic participant analysis template."""
        return """<?xml version="1.0" encoding="UTF-8"?>
<participantAnalysisPrompt>
    <task>Analyze this participant group's distinctive voting patterns and political characteristics.</task>
    <instructions>
        <instruction>Identify what makes this group unique compared to other groups</instruction>
        <instruction>Analyze their underlying values and priorities based on voting patterns</instruction>
        <instruction>Describe their political profile and ideological positioning</instruction>
        <instruction>Every claim must be supported by citations to specific comment IDs</instruction>
    </instructions>
    <responseFormat>
        {
            "id": "participant_group_analysis",
            "title": "Participant Group Analysis",
            "paragraphs": [
                {
                    "id": "group_characteristics",
                    "title": "Group Political Profile",
                    "sentences": [
                        {
                            "clauses": [
                                {
                                    "text": "Analysis text with specific claims",
                                    "citations": [123, 456]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    </responseFormat>
    <data>
        INSERT_DATA_HERE
    </data>
</participantAnalysisPrompt>"""
    
    async def prepare_batch_requests(self, clusters_data: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Prepare batch requests for participant cluster analysis."""
        batch_requests = []
        
        # Load prompt templates
        system_prompt = self.get_prompt_template("system")
        if not system_prompt or "INSERT_DATA_HERE" not in system_prompt:
            # Use basic system prompt
            system_prompt = "You are a political analyst specializing in democratic opinion group analysis. Analyze participant voting coalitions and characterize group behavior patterns."
        
        task_prompt_template = self.get_prompt_template("participant_groups")
        if not task_prompt_template or "INSERT_DATA_HERE" not in task_prompt_template:
            task_prompt_template = self.get_basic_participant_template()
        
        for cluster_id, cluster_data in clusters_data.items():
            try:
                # Convert cluster data to XML
                cluster_xml = self.converter.convert_participant_cluster_to_xml(cluster_data)
                
                # Create task prompt with XML data
                task_prompt = task_prompt_template.replace("INSERT_DATA_HERE", cluster_xml)
                
                # Create batch request
                batch_request = {
                    "custom_id": f"participant_cluster_{cluster_id}_{self.conversation_id}",
                    "method": "POST",
                    "url": "/v1/messages",
                    "body": {
                        "model": self.model,
                        "max_tokens": 4000,
                        "temperature": 0.1,
                        "system": system_prompt,
                        "messages": [
                            {
                                "role": "user",
                                "content": task_prompt
                            }
                        ],
                        "metadata": {
                            "cluster_id": cluster_id,
                            "cluster_name": cluster_data['cluster_name'],
                            "participant_count": cluster_data['participant_count'],
                            "conversation_id": self.conversation_id
                        }
                    }
                }
                
                batch_requests.append(batch_request)
                logger.info(f"Prepared batch request for cluster {cluster_id} ({cluster_data['cluster_name']})")
                
            except Exception as e:
                logger.error(f"Error preparing batch request for cluster {cluster_id}: {e}")
                continue
        
        logger.info(f"Prepared {len(batch_requests)} batch requests for participant cluster analysis")
        return batch_requests
    
    async def submit_batch(self, batch_requests: List[Dict[str, Any]]) -> str:
        """Submit batch requests to Anthropic's Batch API or use sequential fallback."""
        try:
            logger.info("Using Anthropic provider with model: {0}".format(self.model))
            
            # For now, use sequential fallback approach (like 801 script does)
            # Store batch data for sequential processing
            batch_id = str(uuid.uuid4())
            
            # Initialize storage services
            dynamodb = boto3.resource(
                'dynamodb',
                endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
            )
            
            # Create batch jobs table if it doesn't exist
            try:
                batch_table = dynamodb.create_table(
                    TableName='Delphi_ParticipantBatchJobs',
                    KeySchema=[
                        {'AttributeName': 'batch_id', 'KeyType': 'HASH'}
                    ],
                    AttributeDefinitions=[
                        {'AttributeName': 'batch_id', 'AttributeType': 'S'}
                    ],
                    ProvisionedThroughput={
                        'ReadCapacityUnits': 5,
                        'WriteCapacityUnits': 5
                    }
                )
                batch_table.wait_until_exists()
            except Exception as e:
                # Table probably already exists
                batch_table = dynamodb.Table('Delphi_ParticipantBatchJobs')
            
            # Helper function to convert floats to Decimals for DynamoDB
            def convert_floats_to_decimals(data):
                if isinstance(data, float):
                    return Decimal(str(data))
                elif isinstance(data, dict):
                    return {k: convert_floats_to_decimals(v) for k, v in data.items()}
                elif isinstance(data, list):
                    return [convert_floats_to_decimals(item) for item in data]
                else:
                    return data
            
            # Store batch job metadata
            batch_data = {
                'batch_id': batch_id,
                'conversation_id': str(self.conversation_id),
                'model': self.model,
                'status': 'sequential_fallback',
                'created_at': datetime.now().isoformat(),
                'total_requests': len(batch_requests),
                'request_map': {},
                'batch_data': {'requests': convert_floats_to_decimals(batch_requests)}
            }
            
            # Create request mapping
            for req in batch_requests:
                req_id = req.get('request_id', str(uuid.uuid4()))
                if 'request_id' not in req:
                    req['request_id'] = req_id
                
                # Extract metadata from the request
                metadata = {
                    'conversation_id': str(self.conversation_id),
                    'section_name': 'participant_groups'
                }
                if 'custom_id' in req:
                    parts = req['custom_id'].split('_')
                    if len(parts) >= 4:  # participant_cluster_{cluster_id}_{conv_id}
                        metadata['cluster_id'] = parts[2]
                        metadata['cluster_name'] = f"Group {parts[2]}"
                
                batch_data['request_map'][req_id] = metadata
            
            # Store in DynamoDB
            batch_table.put_item(Item=batch_data)
            
            logger.info(f"Stored participant batch job {batch_id} with {len(batch_requests)} requests for sequential processing")
            
            return batch_id
            
        except Exception as e:
            logger.error(f"Error submitting batch: {e}")
            raise
    
    async def generate_reports(self):
        """Main method to generate participant cluster narrative reports."""
        try:
            logger.info(f"Starting participant cluster narrative report generation for conversation {self.conversation_id}")
            
            # Get participant clusters data
            clusters_data = await self.get_participant_clusters_data()
            if not clusters_data:
                logger.error("Failed to get participant clusters data")
                return False
            
            # Check for existing cached reports unless no_cache is specified
            if not self.no_cache:
                logger.info("Checking for existing cached reports...")
                # TODO: Implement cache checking logic
            
            # Prepare batch requests
            batch_requests = await self.prepare_batch_requests(clusters_data)
            if not batch_requests:
                logger.error("No batch requests prepared")
                return False
            
            # Submit batch
            batch_id = await self.submit_batch(batch_requests)
            
            # Store batch metadata in job queue
            if self.job_id:
                try:
                    # Update job with batch information
                    dynamodb = boto3.resource(
                        'dynamodb',
                        endpoint_url=os.environ.get('DYNAMODB_ENDPOINT'),
                        region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'),
                        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
                    )
                    
                    job_table = dynamodb.Table('Delphi_JobQueue')
                    job_table.update_item(
                        Key={'job_id': self.job_id},
                        UpdateExpression='SET batch_id = :batch_id, batch_status = :status, updated_at = :timestamp',
                        ExpressionAttributeValues={
                            ':batch_id': batch_id,
                            ':status': 'SUBMITTED',
                            ':timestamp': datetime.now().isoformat()
                        }
                    )
                    logger.info(f"Updated job {self.job_id} with batch ID {batch_id}")
                    
                except Exception as e:
                    logger.warning(f"Could not update job queue: {e}")
            
            logger.info(f"Successfully initiated participant cluster narrative report generation")
            logger.info(f"Batch ID: {batch_id}")
            logger.info(f"Monitor batch status with: python 812_check_participant_batch_status.py --batch_id {batch_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error generating reports: {e}")
            logger.error(traceback.format_exc())
            return False
        finally:
            try:
                self.postgres_client.shutdown()
            except:
                pass

async def main():
    """Main function to parse arguments and execute participant cluster report generation."""
    parser = argparse.ArgumentParser(description="Generate participant cluster narrative reports using batch API")
    parser.add_argument("--conversation_id", type=str, required=True, help="Conversation ID")
    parser.add_argument("--model", type=str, help="LLM model to use (defaults to ANTHROPIC_MODEL env var)")
    parser.add_argument("--no-cache", action='store_true', help="Ignore cached report data")
    parser.add_argument("--max-batch-size", type=int, default=10, help="Maximum number of participant groups per batch")
    
    args = parser.parse_args()
    
    try:
        generator = ParticipantBatchReportGenerator(
            conversation_id=args.conversation_id,
            model=args.model,
            no_cache=args.no_cache,
            max_batch_size=args.max_batch_size
        )
        
        success = await generator.generate_reports()
        if success:
            logger.info("Participant cluster narrative report generation completed successfully")
            return 0
        else:
            logger.error("Participant cluster narrative report generation failed")
            return 1
            
    except Exception as e:
        logger.error(f"Error in main: {e}")
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)