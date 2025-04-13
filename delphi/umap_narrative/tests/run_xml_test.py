#!/usr/bin/env python3
"""
Test harness for XML conversion module.

This script allows testing the XML converter with real conversation data
from PostgreSQL. It processes the data and outputs XML and analysis results.
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path

# Add parent directory to path to allow imports
script_dir = Path(__file__).parent
parent_dir = script_dir.parent.parent
sys.path.append(str(parent_dir))

# Import from local modules
from umap_narrative.utils.xml_converter import PolisXMLConverter
from umap_narrative.polismath_commentgraph.utils.storage import PostgresClient
from umap_narrative.polismath_commentgraph.utils.group_data import GroupDataProcessor

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def run_xml_test(conversation_id: str, output_dir: str) -> bool:
    """
    Run XML conversion test with real conversation data.
    
    Args:
        conversation_id: Conversation ID to test
        output_dir: Directory to save output files
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Connect to PostgreSQL
        logger.info(f"Connecting to PostgreSQL for conversation {conversation_id}")
        postgres_client = PostgresClient()
        postgres_client.initialize()
        
        # Get conversation data
        conversation = postgres_client.get_conversation_by_id(int(conversation_id))
        if not conversation:
            logger.error(f"Conversation {conversation_id} not found")
            return False
        
        conversation_name = conversation.get("topic", f"Conversation {conversation_id}")
        logger.info(f"Processing conversation: {conversation_name}")
        
        comments = postgres_client.get_comments_by_conversation(int(conversation_id))
        logger.info(f"Retrieved {len(comments)} comments")
        
        # Process through GroupDataProcessor
        logger.info("Processing data with GroupDataProcessor")
        group_processor = GroupDataProcessor(postgres_client)
        processed_data = group_processor.get_export_data(int(conversation_id))
        
        processed_comments = processed_data.get('comments', [])
        logger.info(f"Processed {len(processed_comments)} comments with group data")
        
        # Generate full XML
        logger.info("Generating full XML representation")
        xml_output = PolisXMLConverter.convert_to_xml(processed_comments)
        full_xml_path = os.path.join(output_dir, f"{conversation_id}_full.xml")
        with open(full_xml_path, 'w') as f:
            f.write(xml_output)
        logger.info(f"Full XML saved to {full_xml_path}")
        
        # Generate filtered XML (first 10 comments)
        logger.info("Generating filtered XML representation (first 10 comments)")
        filtered_comments = processed_comments[:10]
        filtered_xml = PolisXMLConverter.convert_to_xml(filtered_comments)
        filtered_xml_path = os.path.join(output_dir, f"{conversation_id}_filtered.xml")
        with open(filtered_xml_path, 'w') as f:
            f.write(filtered_xml)
        logger.info(f"Filtered XML saved to {filtered_xml_path}")
        
        # Analyze group distribution
        logger.info("Analyzing group distribution")
        analysis = PolisXMLConverter.analyze_group_distribution(processed_comments)
        analysis_path = os.path.join(output_dir, f"{conversation_id}_analysis.json")
        with open(analysis_path, 'w') as f:
            json.dump(analysis, f, indent=2, default=str)
        logger.info(f"Analysis saved to {analysis_path}")
        
        # Extract a sample of problematic comments (low group coverage)
        logger.info("Extracting problematic comments")
        problem_threshold = 50.0  # Less than 50% coverage
        problematic_comments = []
        
        for comment_id, coverage_data in analysis["group_coverage_by_comment"].items():
            if coverage_data["total_votes"] > 0 and coverage_data["coverage_percent"] < problem_threshold:
                # Find the original comment
                for comment in processed_comments:
                    if str(comment.get("comment-id", "")) == str(comment_id):
                        problematic_comments.append({
                            "comment_id": comment_id,
                            "comment_text": comment.get("comment", ""),
                            "total_votes": coverage_data["total_votes"],
                            "group_votes": coverage_data["group_votes"],
                            "coverage_percent": coverage_data["coverage_percent"],
                            "groups": coverage_data["groups"]
                        })
                        break
        
        # Save problematic comments
        problem_path = os.path.join(output_dir, f"{conversation_id}_problem_comments.json")
        with open(problem_path, 'w') as f:
            json.dump(problematic_comments, f, indent=2)
        logger.info(f"Found {len(problematic_comments)} problematic comments, saved to {problem_path}")
        
        # Print summary
        print("\n=== XML CONVERSION SUMMARY ===")
        print(f"Conversation: {conversation_name} (ID: {conversation_id})")
        print(f"Total Comments: {analysis['total_comments']}")
        print(f"Total Votes: {analysis['total_votes']}")
        print(f"Comments with Group Data: {analysis['comments_with_groups']}")
        print(f"Groups Found: {', '.join(analysis['groups_found'])}")
        
        if analysis['total_votes'] > 0:
            coverage = (analysis['total_group_votes'] / analysis['total_votes']) * 100
            print(f"Overall Group Coverage: {coverage:.1f}%")
            print(f"Average Comment-Level Coverage: {analysis['average_group_coverage']:.1f}%")
        
        print(f"\nFull Results Available in: {output_dir}")
        return True
    
    except Exception as e:
        logger.error(f"Error running XML test: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False
    
    finally:
        # Clean up PostgreSQL connection
        if 'postgres_client' in locals():
            postgres_client.shutdown()

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Test XML conversion')
    parser.add_argument('--conversation_id', required=True, help='Conversation ID to test')
    parser.add_argument('--output_dir', default='./xml_test_output', help='Output directory')
    args = parser.parse_args()
    
    # Run the test
    success = run_xml_test(args.conversation_id, args.output_dir)
    
    if success:
        print("XML test completed successfully!")
    else:
        print("XML test failed. Check the logs for details.")
        sys.exit(1)

if __name__ == "__main__":
    main()