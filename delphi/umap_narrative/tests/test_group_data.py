#!/usr/bin/env python3
"""
Unit tests for the GroupDataProcessor.get_vote_data_by_groups method.

This module specifically tests the group data processing functionality 
to ensure group assignments are correctly extracted and votes are properly 
assigned to groups.
"""

import os
import sys
import json
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
from collections import defaultdict

# Add parent directory to path to allow imports
script_dir = Path(__file__).parent
parent_dir = script_dir.parent.parent
sys.path.append(str(parent_dir))

# Import module to test
from umap_narrative.polismath_commentgraph.utils.group_data import GroupDataProcessor
from umap_narrative.polismath_commentgraph.utils.storage import PostgresClient

class MockPostgresClient:
    """Mock PostgreSQL client for testing."""
    
    def __init__(self, math_data=None, vote_data=None, comment_data=None):
        """
        Initialize mock client with test data.
        
        Args:
            math_data: Mock data for math_main
            vote_data: Mock vote data
            comment_data: Mock comment data
        """
        self.math_data = math_data or {}
        self.vote_data = vote_data or []
        self.comment_data = comment_data or []
        
    def initialize(self):
        """Mock initialization."""
        pass
        
    def shutdown(self):
        """Mock shutdown."""
        pass
        
    def query(self, sql, params=None):
        """
        Mock query method that returns pre-configured data.
        
        Args:
            sql: SQL query (ignored in mock)
            params: Query parameters (used to determine which data to return)
            
        Returns:
            Pre-configured data based on the query
        """
        # Return math data if query is for math_main
        if "math_main" in sql and params and "zid" in params:
            return [{"data": self.math_data}] if self.math_data else []
            
        # Return empty result for other queries
        return []
        
    def get_votes_by_conversation(self, zid):
        """
        Mock method to get votes.
        
        Args:
            zid: Conversation ID
            
        Returns:
            Pre-configured vote data
        """
        return self.vote_data
        
    def get_comments_by_conversation(self, zid):
        """
        Mock method to get comments.
        
        Args:
            zid: Conversation ID
            
        Returns:
            Pre-configured comment data
        """
        return self.comment_data


class TestGroupDataProcessor(unittest.TestCase):
    """Test the GroupDataProcessor.get_vote_data_by_groups method."""
    
    def setUp(self):
        """Set up test fixtures."""
        # Sample math data with complete group assignments
        self.complete_group_assignments = {
            # Group-clusters with members in each group
            "group-clusters": [
                {"id": 0, "members": [1, 2, 3]},
                {"id": 1, "members": [4, 5, 6]}
            ],
            # Participation data with detailed group assignments
            "participation": {
                "ptptogroup": {
                    "1": 0,
                    "2": 0,
                    "3": 0,
                    "4": 1,
                    "5": 1,
                    "6": 1
                },
                "n-cmts": 10,
                "n-votes": 60
            },
            # User vote counts to determine total participants
            "user-vote-counts": {
                "1": 10,
                "2": 8,
                "3": 12,
                "4": 7,
                "5": 9,
                "6": 5
            }
        }
        
        # Sample vote data
        self.vote_data = [
            {"zid": 1, "tid": 101, "pid": 1, "vote": 1},  # Group 0 agree
            {"zid": 1, "tid": 101, "pid": 2, "vote": 1},  # Group 0 agree
            {"zid": 1, "tid": 101, "pid": 3, "vote": -1}, # Group 0 disagree
            {"zid": 1, "tid": 101, "pid": 4, "vote": -1}, # Group 1 disagree
            {"zid": 1, "tid": 101, "pid": 5, "vote": -1}, # Group 1 disagree
            {"zid": 1, "tid": 101, "pid": 6, "vote": 1},  # Group 1 agree
            
            {"zid": 1, "tid": 102, "pid": 1, "vote": 0},  # Group 0 pass
            {"zid": 1, "tid": 102, "pid": 2, "vote": 1},  # Group 0 agree
            {"zid": 1, "tid": 102, "pid": 3, "vote": 1},  # Group 0 agree
            {"zid": 1, "tid": 102, "pid": 4, "vote": 0},  # Group 1 pass
            {"zid": 1, "tid": 102, "pid": 5, "vote": 1},  # Group 1 agree
            {"zid": 1, "tid": 102, "pid": 6, "vote": -1}, # Group 1 disagree
        ]
        
        # Sample comment data
        self.comment_data = [
            {"zid": 1, "tid": 101, "txt": "Test comment 1", "pid": 1},
            {"zid": 1, "tid": 102, "txt": "Test comment 2", "pid": 2}
        ]
        
        # Create mock client with test data
        self.mock_client = MockPostgresClient(
            math_data=self.complete_group_assignments,
            vote_data=self.vote_data,
            comment_data=self.comment_data
        )
        
        # Create processor with mock client
        self.processor = GroupDataProcessor(self.mock_client)
        
    def test_complete_group_assignments(self):
        """Test with complete and correct group assignments."""
        # Get vote data by groups
        result = self.processor.get_vote_data_by_groups(1)
        
        # Verify result structure
        self.assertIn('vote_data', result)
        self.assertIn('group_assignments', result)
        self.assertIn('n_groups', result)
        
        # Verify group assignments were correctly extracted
        group_assignments = result['group_assignments']
        self.assertEqual(len(group_assignments), 6)  # All 6 participants assigned
        
        # Verify group counts
        self.assertEqual(group_assignments['1'], 0)
        self.assertEqual(group_assignments['4'], 1)
        
        # Verify vote data for comment 101
        comment_101 = result['vote_data'][101]
        self.assertEqual(comment_101['total_votes'], 6)
        self.assertEqual(comment_101['total_agrees'], 3)
        self.assertEqual(comment_101['total_disagrees'], 3)
        
        # Verify group vote data for comment 101
        group_0_data = comment_101['groups'][0]
        self.assertEqual(group_0_data['votes'], 3)
        self.assertEqual(group_0_data['agrees'], 2)
        self.assertEqual(group_0_data['disagrees'], 1)
        
        group_1_data = comment_101['groups'][1]
        self.assertEqual(group_1_data['votes'], 3)
        self.assertEqual(group_1_data['agrees'], 1)
        self.assertEqual(group_1_data['disagrees'], 2)
        
        # Verify sum of group votes equals total votes
        self.assertEqual(group_0_data['votes'] + group_1_data['votes'], comment_101['total_votes'])
        
    def test_get_math_main(self):
        """Test the get_math_main_by_conversation method directly."""
        math_data = self.processor.get_math_main_by_conversation(1)
        
        # Verify the math data was correctly retrieved and processed
        self.assertIn('group-clusters', math_data)
        self.assertIn('participation', math_data)
        self.assertIn('ptptogroup', math_data['participation'])
        
        # Verify group clusters
        clusters = math_data['group-clusters']
        self.assertEqual(len(clusters), 2)
        self.assertEqual(clusters[0]['id'], 0)
        self.assertEqual(len(clusters[0]['members']), 3)
        
        # Verify participant to group mapping
        ptptogroup = math_data['participation']['ptptogroup']
        self.assertEqual(len(ptptogroup), 6)
        self.assertEqual(ptptogroup['1'], 0)
        self.assertEqual(ptptogroup['4'], 1)

    def test_missing_group_structure(self):
        """Test behavior when the expected group structure is missing."""
        # Create math data without the group-clusters or ptptogroup
        incomplete_math_data = {
            "user-vote-counts": {
                "1": 10, "2": 8, "3": 12, "4": 7, "5": 9, "6": 5
            }
        }
        
        # Create mock client with incomplete data
        mock_client = MockPostgresClient(
            math_data=incomplete_math_data,
            vote_data=self.vote_data,
            comment_data=self.comment_data
        )
        
        # Create processor with mock client
        processor = GroupDataProcessor(mock_client)
        
        # Get vote data by groups
        result = processor.get_vote_data_by_groups(1)
        
        # Verify group assignments are empty when structure is missing
        self.assertEqual(result['group_assignments'], {})
        self.assertEqual(result['n_groups'], 0)
        
        # Verify vote data still works, just without group assignments
        self.assertIn('vote_data', result)
        self.assertIn(101, result['vote_data'])
        self.assertEqual(result['vote_data'][101]['total_votes'], 6)

    def test_alternative_group_structure(self):
        """Test with an alternative group structure format."""
        # Create math data with alternative group structure
        alternative_math_data = {
            # Group assignments in root object
            "group_assignments": {
                "1": 0, "2": 0, "3": 0, "4": 1, "5": 1, "6": 1
            },
            "n_groups": 2,
            "user-vote-counts": {
                "1": 10, "2": 8, "3": 12, "4": 7, "5": 9, "6": 5
            }
        }
        
        # Create mock client with alternative data
        mock_client = MockPostgresClient(
            math_data=alternative_math_data,
            vote_data=self.vote_data,
            comment_data=self.comment_data
        )
        
        # Create processor with mock client
        processor = GroupDataProcessor(mock_client)
        
        # Get vote data by groups
        result = processor.get_vote_data_by_groups(1)
        
        # Verify group assignments were correctly extracted from alternative structure
        group_assignments = result['group_assignments']
        self.assertEqual(len(group_assignments), 6)  # All 6 participants assigned
        
        # Verify n_groups is correct
        self.assertEqual(result['n_groups'], 2)
        
        # Verify vote data for comment 101
        comment_101 = result['vote_data'][101]
        self.assertEqual(comment_101['total_votes'], 6)
        
        # Verify group vote data
        group_0_data = comment_101['groups'][0]
        self.assertEqual(group_0_data['votes'], 3)
        group_1_data = comment_101['groups'][1]
        self.assertEqual(group_1_data['votes'], 3)
        
    def test_base_clusters_structure(self):
        """Test with the dual base-clusters and group-clusters structure."""
        # Create math data with dual clustering structure as observed in real data
        complex_math_data = {
            # Group-clusters containing core members with strong signals
            "group-clusters": [
                {"id": 0, "members": [1, 2, 3], "center": [2.0, 0.0]},
                {"id": 1, "members": [4, 5], "center": [-0.5, 0.0]}
            ],
            
            # Base-clusters containing ALL participants 
            "base-clusters": {
                "id": [0, 1, 2, 3, 4],  # 5 base clusters
                "members": [
                    [10, 11, 12],      # Base cluster 0: 3 members
                    [13, 14, 15, 16],  # Base cluster 1: 4 members
                    [17, 18],          # Base cluster 2: 2 members 
                    [19, 20, 21],      # Base cluster 3: 3 members
                    [22, 23]           # Base cluster 4: 2 members
                ],
                # Coordinates for each base cluster
                "x": [2.1, 1.9, 2.2, -0.4, -0.6],
                "y": [0.1, -0.1, 0.2, 0.1, -0.2],
                "count": [3, 4, 2, 3, 2]
            },
            
            # User vote counts for all participants
            "user-vote-counts": {
                "10": 5, "11": 6, "12": 7,  # Base cluster 0
                "13": 8, "14": 6, "15": 7, "16": 5,  # Base cluster 1
                "17": 6, "18": 5,  # Base cluster 2
                "19": 7, "20": 6, "21": 5,  # Base cluster 3
                "22": 6, "23": 7  # Base cluster 4
            }
        }
        
        # Create vote data with all participants
        complex_vote_data = [
            # Comment 101
            {"zid": 1, "tid": 101, "pid": 10, "vote": 1},  # Base cluster 0 -> Group 0
            {"zid": 1, "tid": 101, "pid": 11, "vote": 1},  # Base cluster 0 -> Group 0
            {"zid": 1, "tid": 101, "pid": 13, "vote": 1},  # Base cluster 1 -> Group 0
            {"zid": 1, "tid": 101, "pid": 17, "vote": 1},  # Base cluster 2 -> Group 0
            {"zid": 1, "tid": 101, "pid": 19, "vote": -1}, # Base cluster 3 -> Group 1
            {"zid": 1, "tid": 101, "pid": 22, "vote": -1}, # Base cluster 4 -> Group 1
            
            # Comment 102
            {"zid": 1, "tid": 102, "pid": 10, "vote": 0},  # Base cluster 0 -> Group 0
            {"zid": 1, "tid": 102, "pid": 14, "vote": 1},  # Base cluster 1 -> Group 0
            {"zid": 1, "tid": 102, "pid": 18, "vote": 1},  # Base cluster 2 -> Group 0
            {"zid": 1, "tid": 102, "pid": 20, "vote": 0},  # Base cluster 3 -> Group 1
            {"zid": 1, "tid": 102, "pid": 21, "vote": 1},  # Base cluster 3 -> Group 1
            {"zid": 1, "tid": 102, "pid": 23, "vote": -1}, # Base cluster 4 -> Group 1
        ]
        
        # Create mock client with complex data
        mock_client = MockPostgresClient(
            math_data=complex_math_data,
            vote_data=complex_vote_data,
            comment_data=self.comment_data
        )
        
        # Create processor with mock client
        processor = GroupDataProcessor(mock_client)
        
        # Get vote data by groups
        result = processor.get_vote_data_by_groups(1)
        
        # Verify group assignments contain ALL participants
        group_assignments = result['group_assignments']
        self.assertEqual(len(group_assignments), 14)  # All 14 participants should be assigned
        
        # Verify all members of base clusters 0, 1, 2 are mapped to Group 0
        for pid in ["10", "11", "12", "13", "14", "15", "16", "17", "18"]:
            self.assertEqual(group_assignments.get(pid), 0, f"Participant {pid} should be in Group 0")
            
        # Verify all members of base clusters 3, 4 are mapped to Group 1
        for pid in ["19", "20", "21", "22", "23"]:
            self.assertEqual(group_assignments.get(pid), 1, f"Participant {pid} should be in Group 1")
            
        # Verify n_groups is correct
        self.assertEqual(result['n_groups'], 2)
        
        # Verify vote data for comment 101
        comment_101 = result['vote_data'][101]
        self.assertEqual(comment_101['total_votes'], 6)
        
        # Verify group vote data
        group_0_data = comment_101['groups'][0]
        self.assertEqual(group_0_data['votes'], 4)  # 4 votes from Group 0
        self.assertEqual(group_0_data['agrees'], 4)  # All agrees
        
        group_1_data = comment_101['groups'][1]
        self.assertEqual(group_1_data['votes'], 2)  # 2 votes from Group 1
        self.assertEqual(group_1_data['disagrees'], 2)  # All disagrees
        
        # Verify sum of group votes equals total votes
        self.assertEqual(group_0_data['votes'] + group_1_data['votes'], comment_101['total_votes'])


if __name__ == "__main__":
    unittest.main()