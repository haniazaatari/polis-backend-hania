"""
XML conversion utilities for Polis data.

This module handles the conversion of Polis conversation data to XML format,
particularly for use in LLM report generation.
"""

import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString
from typing import List, Dict, Any, Optional, Tuple


class PolisXMLConverter:
    """Convert Polis data to XML format."""
    
    @staticmethod
    def convert_to_xml(comment_data: List[Dict[str, Any]]) -> str:
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
    
    @staticmethod
    def analyze_group_distribution(comment_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Analyze the distribution of votes and group assignments in the comment data.
        
        Args:
            comment_data: List of dictionaries with comment data
            
        Returns:
            Dictionary with analysis results including:
            - total_comments: Total number of comments
            - total_votes: Total number of votes across all comments
            - comments_with_groups: Number of comments with group data
            - total_group_votes: Total number of votes assigned to groups
            - missing_votes: Number of votes not assigned to any group
            - average_group_coverage: Average percentage of votes assigned to groups
            - group_coverage_by_comment: Dictionary mapping comment IDs to percentage of votes covered by groups
        """
        result = {
            "total_comments": len(comment_data),
            "total_votes": 0,
            "comments_with_groups": 0,
            "total_group_votes": 0,
            "missing_votes": 0,
            "group_coverage_by_comment": {},
            "groups_found": set(),
        }
        
        total_coverage = 0.0
        
        for record in comment_data:
            comment_id = record.get("comment-id", "unknown")
            total_votes = record.get("total-votes", 0)
            result["total_votes"] += total_votes
            
            # Extract group IDs
            group_keys = []
            for key in record.keys():
                if key.startswith("group-") and key.count("-") >= 2 and key.endswith("-votes"):
                    group_id = key.split("-")[1]
                    if group_id not in group_keys:
                        group_keys.append(group_id)
                        result["groups_found"].add(group_id)
            
            # Sum up group votes
            group_votes = 0
            for group_id in group_keys:
                group_votes += record.get(f"group-{group_id}-votes", 0)
            
            # Calculate coverage
            coverage = 0.0
            if total_votes > 0:
                coverage = (group_votes / total_votes) * 100.0
                total_coverage += coverage
            
            # Track comments with group data
            if group_votes > 0:
                result["comments_with_groups"] += 1
                result["total_group_votes"] += group_votes
            
            # Record per-comment data
            result["group_coverage_by_comment"][comment_id] = {
                "total_votes": total_votes,
                "group_votes": group_votes,
                "coverage_percent": coverage,
                "groups": group_keys
            }
        
        # Calculate overall stats
        result["missing_votes"] = result["total_votes"] - result["total_group_votes"]
        
        if result["comments_with_groups"] > 0:
            result["average_group_coverage"] = total_coverage / result["comments_with_groups"]
        else:
            result["average_group_coverage"] = 0.0
        
        # Convert groups_found to list for better serialization
        result["groups_found"] = list(result["groups_found"])
        
        return result

    @staticmethod
    def extract_groups_from_math_data(math_data: Dict[str, Any]) -> Tuple[int, int, Dict[str, int]]:
        """
        Extract group assignment information from math data.
        
        Args:
            math_data: Dictionary with math data from DynamoDB
            
        Returns:
            Tuple containing:
            - total_participants: Total number of participants
            - grouped_participants: Participants with group assignments
            - group_sizes: Dictionary mapping group IDs to their sizes
        """
        group_clusters = math_data.get('group-clusters', [])
        group_sizes = {}
        grouped_participants = 0
        
        for cluster in group_clusters:
            if isinstance(cluster, dict) and 'members' in cluster and 'id' in cluster:
                group_id = cluster['id']
                members = cluster['members']
                group_sizes[group_id] = len(members)
                grouped_participants += len(members)
        
        # Get total participants from vote counts if available
        user_vote_counts = math_data.get('user-vote-counts', {})
        total_participants = len(user_vote_counts)
        
        return total_participants, grouped_participants, group_sizes