#!/usr/bin/env python3
"""
Generate XML for a conversation using the fixed group data processor.

This script generates XML for a specific conversation ID using our fixed
implementation that correctly processes both group-clusters and base-clusters.
"""

import os
import sys
import json
import logging
from pathlib import Path

# Add parent directory to path to allow imports
script_dir = Path(__file__).parent
parent_dir = script_dir.parent.parent
sys.path.append(str(parent_dir))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Import the improved modules
from umap_narrative.utils.xml_converter import PolisXMLConverter
from umap_narrative.polismath_commentgraph.utils.storage import PostgresClient
from umap_narrative.polismath_commentgraph.utils.group_data import GroupDataProcessor

def generate_xml_for_conversation(conversation_id):
    """
    Generate XML for a conversation using the fixed implementation.
    
    Args:
        conversation_id: Conversation ID to process
    """
    try:
        # Initialize PostgreSQL client
        postgres_client = PostgresClient()
        postgres_client.initialize()
        
        # Create the group data processor
        group_processor = GroupDataProcessor(postgres_client)
        
        # Process the data
        logger.info(f"Processing data for conversation {conversation_id}...")
        export_data = group_processor.get_export_data(int(conversation_id))
        
        # Get processed comments
        processed_comments = export_data.get('comments', [])
        logger.info(f"Processed {len(processed_comments)} comments")
        
        # Print a summary of the votes by group
        if processed_comments:
            total_votes = sum(comment.get('total-votes', 0) for comment in processed_comments)
            
            # Count votes by group
            group_votes = {}
            for comment in processed_comments:
                # Find group keys
                for key in comment.keys():
                    if key.startswith('group-') and key.endswith('-votes'):
                        group_id = key.split('-')[1]
                        if group_id not in group_votes:
                            group_votes[group_id] = 0
                        group_votes[group_id] += comment.get(key, 0)
            
            # Print vote summary
            print("\nVOTE SUMMARY:")
            print(f"Total votes: {total_votes}")
            for group_id, votes in sorted(group_votes.items()):
                print(f"Group {group_id}: {votes} votes ({votes/total_votes*100:.1f}%)")
            
            # Calculate sum of group votes
            sum_group_votes = sum(group_votes.values())
            print(f"Sum of group votes: {sum_group_votes}")
            print(f"Group vote coverage: {sum_group_votes/total_votes*100:.1f}%")
            
            # Generate XML
            logger.info("Generating XML...")
            xml_output = PolisXMLConverter.convert_to_xml(processed_comments)
            
            # Save XML to file
            xml_path = script_dir / f"conversation_{conversation_id}_fixed.xml"
            with open(xml_path, 'w') as f:
                f.write(xml_output)
            logger.info(f"XML saved to {xml_path}")
            
            # Save a detailed JSON report
            report = {
                "conversation_id": conversation_id,
                "total_votes": total_votes,
                "sum_group_votes": sum_group_votes,
                "vote_coverage": sum_group_votes/total_votes*100,
                "group_votes": group_votes,
                "sample_comments": []
            }
            
            # Add a sample of 5 comments to the report
            for i, comment in enumerate(processed_comments[:5]):
                comment_report = {
                    "comment_id": comment.get("comment-id"),
                    "total_votes": comment.get("total-votes", 0),
                    "group_votes": {}
                }
                
                # Get group votes for this comment
                for key in comment.keys():
                    if key.startswith('group-') and key.endswith('-votes'):
                        group_id = key.split('-')[1]
                        comment_report["group_votes"][group_id] = comment.get(key, 0)
                
                # Calculate sum of group votes for this comment
                comment_report["sum_group_votes"] = sum(comment_report["group_votes"].values())
                comment_report["vote_coverage"] = 100.0
                if comment_report["total_votes"] > 0:
                    comment_report["vote_coverage"] = (comment_report["sum_group_votes"] / comment_report["total_votes"]) * 100
                
                report["sample_comments"].append(comment_report)
            
            # Save report to file
            report_path = script_dir / f"conversation_{conversation_id}_report.json"
            with open(report_path, 'w') as f:
                json.dump(report, f, indent=2)
            logger.info(f"Report saved to {report_path}")
            
    except Exception as e:
        logger.error(f"Error generating XML: {e}")
        import traceback
        logger.error(traceback.format_exc())
    
    finally:
        # Clean up
        if 'postgres_client' in locals():
            postgres_client.shutdown()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate XML with fixed implementation')
    parser.add_argument('--conversation_id', type=str, required=True, help='Conversation ID to process')
    args = parser.parse_args()
    
    generate_xml_for_conversation(args.conversation_id)