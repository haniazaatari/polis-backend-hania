#!/usr/bin/env python3
"""
502_calculate_priorities.py

Calculate comment priorities using group-based extremity values.

This script runs after extremity calculation (501_calculate_comment_extremity.py)
and computes final priority values using the group-based extremity data.
"""

import argparse
import boto3
import json
import logging
import os
import sys
import time
from decimal import Decimal
from typing import Dict, List, Optional, Any

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class PriorityCalculator:
    """Calculate comment priorities using group-based extremity values."""
    
    def __init__(self, conversation_id: int, endpoint_url: str = None):
        """
        Initialize the priority calculator.
        
        Args:
            conversation_id: The conversation ID to process
            endpoint_url: DynamoDB endpoint URL (optional)
        """
        self.conversation_id = conversation_id
        self.endpoint_url = endpoint_url
        
        # Initialize DynamoDB connection
        self.dynamodb = boto3.resource(
            'dynamodb',
            endpoint_url=endpoint_url,
            region_name='us-east-1',
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'dummy'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'dummy')
        )
        
        # Get table references
        self.comment_routing_table = self.dynamodb.Table('Delphi_CommentRouting')
        self.comment_extremity_table = self.dynamodb.Table('Delphi_CommentExtremity')
        
        logger.info(f"Initialized priority calculator for conversation {conversation_id}")

    def _importance_metric(self, A: int, P: int, S: int, E: float) -> float:
        """
        Calculate importance metric (matches Clojure implementation).
        
        Args:
            A: Number of agree votes
            P: Number of pass votes  
            S: Total number of votes
            E: Extremity value
            
        Returns:
            Importance metric value
        """
        # Laplace smoothing
        p = (P + 1) / (S + 2)  # Pass rate
        a = (A + 1) / (S + 2)  # Agree rate
        
        # Importance calculation: (1 - p) * (E + 1) * a
        return (1 - p) * (E + 1) * a

    def _priority_metric(self, is_meta: bool, A: int, P: int, S: int, E: float) -> float:
        """
        Calculate priority metric (matches Clojure implementation).
        
        Args:
            is_meta: Whether the comment is a meta comment
            A: Number of agree votes
            P: Number of pass votes
            S: Total number of votes
            E: Extremity value
            
        Returns:
            Priority metric value
        """
        META_PRIORITY = 7.0
        
        if is_meta:
            return META_PRIORITY ** 2  # 49
        else:
            # Regular priority calculation
            importance = self._importance_metric(A, P, S, E)
            # Scale by a factor which lets new comments bubble up
            scaling_factor = 1.0 + (8.0 * (2.0 ** (-S / 5.0)))
            return (importance * scaling_factor) ** 2

    def get_comment_extremity(self, comment_id: str) -> float:
        """
        Get extremity value for a comment from DynamoDB.
        
        Args:
            comment_id: The comment ID
            
        Returns:
            Extremity value (0.0 to 1.0) or 0.0 if not found
        """
        try:
            response = self.comment_extremity_table.get_item(
                Key={
                    'conversation_id': str(self.conversation_id),
                    'comment_id': str(comment_id)
                }
            )
            
            if 'Item' in response:
                extremity_value = response['Item'].get('extremity_value', 0.0)
                return float(extremity_value)
            else:
                logger.debug(f"No extremity data found for comment {comment_id}")
                return 0.0
                
        except Exception as e:
            logger.warning(f"Error retrieving extremity for comment {comment_id}: {e}")
            return 0.0

    def get_comment_routing_data(self) -> List[Dict[str, Any]]:
        """
        Get all comment routing data for the conversation.
        
        Returns:
            List of comment routing items
        """
        try:
            # Scan for all items with this conversation ID
            response = self.comment_routing_table.scan(
                FilterExpression='contains(zid_tick, :zid)',
                ExpressionAttributeValues={':zid': str(self.conversation_id)}
            )
            
            items = response['Items']
            logger.info(f"Found {len(items)} comment routing entries")
            return items
            
        except Exception as e:
            logger.error(f"Error retrieving comment routing data: {e}")
            return []

    def calculate_priorities(self) -> Dict[str, int]:
        """
        Calculate priorities for all comments in the conversation.
        
        Returns:
            Dictionary mapping comment_id to priority value
        """
        logger.info(f"Starting priority calculation for conversation {self.conversation_id}")
        start_time = time.time()
        
        # Get comment routing data (contains vote statistics)
        comment_data = self.get_comment_routing_data()
        
        if not comment_data:
            logger.warning("No comment data found")
            return {}
        
        priorities = {}
        
        for item in comment_data:
            try:
                comment_id = item.get('comment_id')
                stats = item.get('stats', {})
                
                if not comment_id or not stats:
                    continue
                
                # Extract vote data
                A = int(stats.get('agree', 0))
                D = int(stats.get('disagree', 0))
                S = int(stats.get('total', 0))
                P = S - (A + D)  # Pass votes = total - (agree + disagree)
                
                # Get extremity value from DynamoDB
                E = self.get_comment_extremity(comment_id)
                
                # Determine if meta comment (for now, assume no meta comments)
                is_meta = False
                
                # Calculate priority
                priority = self._priority_metric(is_meta, A, P, S, E)
                
                # Store as integer (matching existing format)
                priorities[comment_id] = int(priority)
                
                logger.debug(f"Comment {comment_id}: A={A}, D={D}, S={S}, P={P}, E={E:.4f}, priority={int(priority)}")
                
            except Exception as e:
                logger.warning(f"Error calculating priority for comment {comment_id}: {e}")
                priorities[comment_id] = 0  # Default value
        
        elapsed = time.time() - start_time
        logger.info(f"Calculated priorities for {len(priorities)} comments in {elapsed:.2f}s")
        
        return priorities

    def update_priorities_in_dynamodb(self, priorities: Dict[str, int]) -> bool:
        """
        Update priority values in the comment routing table.
        
        Args:
            priorities: Dictionary mapping comment_id to priority value
            
        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Updating {len(priorities)} priority values in DynamoDB")
        
        try:
            for comment_id, priority in priorities.items():
                # Find the item to update (need to get the zid_tick)
                response = self.comment_routing_table.scan(
                    FilterExpression='contains(zid_tick, :zid) AND comment_id = :cid',
                    ExpressionAttributeValues={
                        ':zid': str(self.conversation_id),
                        ':cid': comment_id
                    }
                )
                
                items = response.get('Items', [])
                if items:
                    item = items[0]
                    zid_tick = item['zid_tick']
                    
                    # Update the priority
                    self.comment_routing_table.update_item(
                        Key={
                            'zid_tick': zid_tick,
                            'comment_id': comment_id
                        },
                        UpdateExpression='SET priority = :priority',
                        ExpressionAttributeValues={':priority': priority}
                    )
                    
                    logger.debug(f"Updated priority for comment {comment_id} to {priority}")
            
            logger.info("Successfully updated all priorities in DynamoDB")
            return True
            
        except Exception as e:
            logger.error(f"Error updating priorities in DynamoDB: {e}")
            return False

    def run(self) -> bool:
        """
        Run the complete priority calculation process.
        
        Returns:
            True if successful, False otherwise
        """
        try:
            # Calculate priorities
            priorities = self.calculate_priorities()
            
            if not priorities:
                logger.error("No priorities calculated")
                return False
            
            # Update DynamoDB
            success = self.update_priorities_in_dynamodb(priorities)
            
            if success:
                logger.info(f"Priority calculation completed successfully for conversation {self.conversation_id}")
                
                # Log some statistics
                priority_values = list(priorities.values())
                avg_priority = sum(priority_values) / len(priority_values)
                max_priority = max(priority_values)
                min_priority = min(priority_values)
                
                logger.info(f"Priority statistics: min={min_priority}, max={max_priority}, avg={avg_priority:.2f}")
                
            return success
            
        except Exception as e:
            logger.error(f"Error in priority calculation: {e}")
            return False


def main():
    """Main function."""
    parser = argparse.ArgumentParser(description='Calculate comment priorities using group-based extremity')
    parser.add_argument('--conversation_id', '--zid', type=int, required=True,
                       help='Conversation ID to process')
    parser.add_argument('--endpoint-url', type=str,
                       default=os.environ.get('DYNAMODB_ENDPOINT', 'http://host.docker.internal:8000'),
                       help='DynamoDB endpoint URL')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Enable verbose logging')
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Create and run calculator
    calculator = PriorityCalculator(args.conversation_id, args.endpoint_url)
    success = calculator.run()
    
    if success:
        logger.info("Priority calculation completed successfully")
        sys.exit(0)
    else:
        logger.error("Priority calculation failed")
        sys.exit(1)


if __name__ == '__main__':
    main()