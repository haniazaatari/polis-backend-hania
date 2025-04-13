#!/usr/bin/env python3
"""
Verify group votes data against PostgreSQL and DynamoDB sources.

This script queries both PostgreSQL and DynamoDB to verify group assignment data
and analyze vote distribution across groups for a specific conversation.
"""

import os
import sys
import json
import logging
import argparse
from typing import Dict, Any, List, Optional
import pandas as pd
from pathlib import Path

# Add parent directory to path to allow imports
script_dir = Path(__file__).parent
parent_dir = script_dir.parent.parent
sys.path.append(str(parent_dir))

# Import from local modules
from umap_narrative.utils.xml_converter import PolisXMLConverter
from umap_narrative.polismath_commentgraph.utils.storage import PostgresClient, DynamoDBStorage
from umap_narrative.polismath_commentgraph.utils.group_data import GroupDataProcessor

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def verify_group_assignments(conversation_id: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Verify group assignments for a conversation.
    
    Args:
        conversation_id: Conversation ID to verify
        output_dir: Optional directory to save output files
        
    Returns:
        Dictionary with verification results
    """
    results = {
        "conversation_id": conversation_id,
        "postgresql": {},
        "dynamodb": {},
        "processed_data": {},
        "xml_analysis": {}
    }
    
    try:
        # Connect to PostgreSQL
        logger.info(f"Connecting to PostgreSQL for conversation {conversation_id}")
        postgres_client = PostgresClient()
        postgres_client.initialize()
        
        # Get conversation data
        conversation = postgres_client.get_conversation_by_id(int(conversation_id))
        comments = postgres_client.get_comments_by_conversation(int(conversation_id))
        
        # Record basic PostgreSQL data
        results["postgresql"]["conversation_name"] = conversation.get("topic", f"Conversation {conversation_id}")
        results["postgresql"]["comment_count"] = len(comments)
        
        # Process data with GroupDataProcessor
        logger.info("Processing data with GroupDataProcessor")
        group_processor = GroupDataProcessor(postgres_client)
        processed_data = group_processor.get_export_data(int(conversation_id))
        
        # Record processed data
        processed_comments = processed_data.get('comments', [])
        results["processed_data"]["comment_count"] = len(processed_comments)
        results["processed_data"]["has_math_data"] = 'math_result' in processed_data
        
        # Connect to DynamoDB
        logger.info("Connecting to DynamoDB")
        endpoint_url = os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')
        # Set environment variables for DynamoDB
        os.environ['AWS_ACCESS_KEY_ID'] = 'fakeMyKeyId'
        os.environ['AWS_SECRET_ACCESS_KEY'] = 'fakeSecretAccessKey'
        os.environ['AWS_DEFAULT_REGION'] = 'us-west-2'
        
        # Create DynamoDB storage with correct parameters
        dynamo_storage = DynamoDBStorage(
            endpoint_url=endpoint_url,
            region_name='us-west-2'
        )
        
        # Get math data
        try:
            # Try both possible locations for math data
            math_data = processed_data.get('math_result', {})
            
            # Check if we need to fetch from DynamoDB
            if not math_data:
                logger.info("Fetching math data from DynamoDB")
                table = dynamo_storage.dynamodb.Table('PolisMathAnalysis')
                response = table.get_item(Key={'zid': conversation_id})
                if 'Item' in response:
                    math_data = response['Item']
            
            # Extract group assignments from math data
            if math_data:
                total_participants, grouped_participants, group_sizes = (
                    PolisXMLConverter.extract_groups_from_math_data(math_data)
                )
                
                results["dynamodb"]["total_participants"] = total_participants
                results["dynamodb"]["grouped_participants"] = grouped_participants
                results["dynamodb"]["group_sizes"] = group_sizes
                results["dynamodb"]["group_coverage_percent"] = (
                    (grouped_participants / total_participants * 100) 
                    if total_participants > 0 else 0
                )
        except Exception as e:
            logger.error(f"Error analyzing math data: {e}")
            results["dynamodb"]["error"] = str(e)
        
        # Analyze the processed comments for XML
        logger.info("Analyzing XML conversion")
        xml_output = PolisXMLConverter.convert_to_xml(processed_comments)
        xml_analysis = PolisXMLConverter.analyze_group_distribution(processed_comments)
        results["xml_analysis"] = xml_analysis
        
        # Save outputs if directory provided
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            
            # Save XML output
            with open(os.path.join(output_dir, f"{conversation_id}_comments.xml"), 'w') as f:
                f.write(xml_output)
            
            # Save analysis as JSON
            with open(os.path.join(output_dir, f"{conversation_id}_analysis.json"), 'w') as f:
                json.dump(results, f, indent=2, default=str)
            
            logger.info(f"Analysis saved to {output_dir}")
        
        return results
    
    except Exception as e:
        logger.error(f"Error in verification process: {e}")
        import traceback
        logger.error(traceback.format_exc())
        results["error"] = str(e)
        return results
    
    finally:
        # Clean up PostgreSQL connection
        if 'postgres_client' in locals():
            postgres_client.shutdown()

def print_results(results: Dict[str, Any]) -> None:
    """
    Print verification results in a readable format.
    
    Args:
        results: Dictionary with verification results
    """
    print("\n=== GROUP ASSIGNMENT VERIFICATION RESULTS ===")
    print(f"Conversation ID: {results['conversation_id']}")
    
    if 'postgresql' in results and 'conversation_name' in results['postgresql']:
        print(f"Conversation Name: {results['postgresql']['conversation_name']}")
    
    print("\n--- PostgreSQL Data ---")
    if 'postgresql' in results:
        for key, value in results['postgresql'].items():
            print(f"{key}: {value}")
    
    print("\n--- DynamoDB Math Data ---")
    if 'dynamodb' in results:
        if 'error' in results['dynamodb']:
            print(f"Error: {results['dynamodb']['error']}")
        else:
            for key, value in results['dynamodb'].items():
                if key != 'group_sizes':
                    print(f"{key}: {value}")
            
            if 'group_sizes' in results['dynamodb']:
                print("\nGroup Sizes:")
                for group_id, size in results['dynamodb']['group_sizes'].items():
                    print(f"  Group {group_id}: {size} participants")
    
    print("\n--- XML Conversion Analysis ---")
    if 'xml_analysis' in results:
        xml = results['xml_analysis']
        print(f"Total Comments: {xml.get('total_comments', 0)}")
        print(f"Total Votes: {xml.get('total_votes', 0)}")
        print(f"Comments with Group Data: {xml.get('comments_with_groups', 0)}")
        print(f"Total Votes in Groups: {xml.get('total_group_votes', 0)}")
        print(f"Votes Not Assigned to Groups: {xml.get('missing_votes', 0)}")
        
        coverage = xml.get('average_group_coverage', 0)
        print(f"Average Group Coverage: {coverage:.1f}%")
        
        if 'groups_found' in xml:
            print(f"\nGroups Found: {', '.join(xml.get('groups_found', []))}")
    
    print("\n=== VERIFICATION SUMMARY ===")
    if 'dynamodb' in results and 'group_coverage_percent' in results['dynamodb']:
        db_coverage = results['dynamodb']['group_coverage_percent']
        print(f"DynamoDB Group Coverage: {db_coverage:.1f}%")
    
    if 'xml_analysis' in results and 'total_votes' in results['xml_analysis'] and results['xml_analysis']['total_votes'] > 0:
        xml = results['xml_analysis']
        xml_coverage = (xml['total_group_votes'] / xml['total_votes']) * 100
        print(f"XML Group Vote Coverage: {xml_coverage:.1f}%")
        
        # Provide an interpretation
        if xml_coverage < 50:
            print("\nINTERPRETATION: Less than half of all votes are assigned to groups in the XML data.")
            print("This suggests that either:")
            print("1. A significant number of participants weren't assigned to groups in the clustering")
            print("2. The group data is not being properly extracted during XML conversion")
        elif xml_coverage < 90:
            print("\nINTERPRETATION: Moderate group coverage in the XML data.")
            print("This suggests that some participants weren't assigned to groups, which is normal")
            print("in clustering algorithms that exclude edge cases and uncertain assignments.")
        else:
            print("\nINTERPRETATION: High group coverage in the XML data.")
            print("Almost all votes are associated with groups.")

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Verify group assignments in conversation data')
    parser.add_argument('--conversation_id', required=True, help='Conversation ID to verify')
    parser.add_argument('--output_dir', default='./output', help='Directory to save output files')
    args = parser.parse_args()
    
    # Run verification
    results = verify_group_assignments(args.conversation_id, args.output_dir)
    
    # Print results
    print_results(results)

if __name__ == "__main__":
    main()