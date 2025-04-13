#!/usr/bin/env python3
"""
Standalone test for the group data processor.

This version does not require the external dependencies like boto3 and sqlalchemy.
It tests the core logic of processing group and base cluster data.
"""

import json
import unittest
from unittest.mock import MagicMock
from collections import defaultdict

# Mock the Group Data Processor implementation
class GroupDataProcessor:
    """
    Simplified version of GroupDataProcessor for testing.
    Contains only the core logic for processing base-clusters.
    """
    
    def __init__(self, postgres_client=None):
        """Initialize with optional mock client."""
        self.postgres_client = postgres_client
        self.logger = MagicMock()
        self.logger.info = print
        self.logger.error = print
    
    def get_math_main_by_conversation(self, zid):
        """Mock method to return test data."""
        # In real implementation, this would query the database
        # Here we assume the test will set this value
        return self.math_data
        
    def process_group_clusters(self, math_data):
        """Process group-clusters structure to extract primary groups."""
        group_assignments = {}
        primary_group_clusters = {}
        
        if isinstance(math_data, dict) and 'group-clusters' in math_data:
            group_clusters = math_data['group-clusters']
            if isinstance(group_clusters, list) and len(group_clusters) > 0:
                try:
                    # Log group clusters information
                    print(f"Group-clusters list has {len(group_clusters)} items")
                    
                    # Process each primary group cluster
                    for cluster in group_clusters:
                        if isinstance(cluster, dict) and 'id' in cluster:
                            group_id = cluster['id']
                            # Store center coordinates for later base-cluster mapping
                            if 'center' in cluster:
                                primary_group_clusters[group_id] = {
                                    'center': cluster['center'],
                                    'members': []
                                }
                                
                            # Extract direct group assignments from members if available
                            if 'members' in cluster and isinstance(cluster['members'], list):
                                # Record members in primary group
                                primary_group_clusters[group_id]['members'] = cluster['members']
                                
                                # Add these to group assignments
                                for pid in cluster['members']:
                                    group_assignments[str(pid)] = group_id
                    
                    if group_assignments:
                        print(f"Extracted {len(group_assignments)} direct group assignments from group-clusters")
                
                except Exception as e:
                    print(f"Error processing group-clusters: {e}")
                    
        return group_assignments, primary_group_clusters
        
    def process_base_clusters(self, math_data, group_assignments, primary_group_clusters):
        """Process base-clusters structure to map all participants to groups."""
        if not isinstance(math_data, dict) or not 'base-clusters' in math_data or not primary_group_clusters:
            return group_assignments
            
        base_clusters = math_data['base-clusters']
        
        # Verify base_clusters has the expected structure
        if (isinstance(base_clusters, dict) and 
            'id' in base_clusters and isinstance(base_clusters['id'], list) and
            'members' in base_clusters and isinstance(base_clusters['members'], list) and
            'x' in base_clusters and isinstance(base_clusters['x'], list) and
            'y' in base_clusters and isinstance(base_clusters['y'], list)):
            
            try:
                # Log base clusters information
                num_base_clusters = len(base_clusters['id'])
                print(f"Processing base-clusters structure with {num_base_clusters} base clusters")
                
                # Map each base cluster to its closest primary group cluster
                base_cluster_to_group = {}
                
                for i in range(num_base_clusters):
                    base_id = base_clusters['id'][i]
                    base_x = base_clusters['x'][i]
                    base_y = base_clusters['y'][i]
                    
                    # Find the closest primary group cluster by euclidean distance
                    min_dist = float('inf')
                    closest_group = None
                    
                    for group_id, group_info in primary_group_clusters.items():
                        if 'center' in group_info:
                            group_x, group_y = group_info['center']
                            
                            # Calculate Euclidean distance
                            dist = ((base_x - group_x) ** 2 + (base_y - group_y) ** 2) ** 0.5
                            
                            if dist < min_dist:
                                min_dist = dist
                                closest_group = group_id
                    
                    # Assign this base cluster to the closest primary group
                    if closest_group is not None:
                        base_cluster_to_group[base_id] = closest_group
                
                # Now assign all participants in base clusters to their mapped primary group
                for i in range(num_base_clusters):
                    base_id = base_clusters['id'][i]
                    if base_id in base_cluster_to_group:
                        group_id = base_cluster_to_group[base_id]
                        
                        # Get all participants in this base cluster
                        if i < len(base_clusters['members']):
                            members = base_clusters['members'][i]
                            
                            # Assign each participant to the mapped group
                            for pid in members:
                                # Only assign if not already directly assigned through group-clusters
                                if str(pid) not in group_assignments:
                                    group_assignments[str(pid)] = group_id
                
                print(f"After processing base-clusters, total group assignments: {len(group_assignments)}")
                
            except Exception as e:
                print(f"Error processing base-clusters: {e}")
                
        return group_assignments
    
    def get_vote_data_by_groups(self, zid):
        """Process math data and votes to extract group assignments and votes."""
        try:
            # Get the math data
            math_data = self.math_data  # Mock for testing
            
            # Process group-clusters to get primary group structure
            group_assignments, primary_group_clusters = self.process_group_clusters(math_data)
            
            # Process base-clusters to get full participant mapping
            group_assignments = self.process_base_clusters(math_data, group_assignments, primary_group_clusters)
            
            # Count number of groups
            n_groups = 0
            if group_assignments:
                n_groups = max(group_assignments.values()) + 1
            
            # Process votes by group
            vote_data = {}
            for vote in self.votes:  # Mock for testing
                tid = vote.get('tid')
                pid = vote.get('pid')
                vote_val = vote.get('vote')
                
                if tid is not None and pid is not None and vote_val is not None:
                    # Initialize comment data if not exists
                    if tid not in vote_data:
                        vote_data[tid] = {
                            'total_votes': 0,
                            'total_agrees': 0,
                            'total_disagrees': 0,
                            'total_passes': 0,
                            'groups': defaultdict(lambda: {
                                'votes': 0,
                                'agrees': 0,
                                'disagrees': 0,
                                'passes': 0
                            })
                        }
                    
                    # Get group assignment
                    group_id = group_assignments.get(str(pid), -1)
                    
                    # Update total votes
                    vote_data[tid]['total_votes'] += 1
                    
                    # Update vote counts
                    if vote_val == 1:
                        vote_data[tid]['total_agrees'] += 1
                        vote_data[tid]['groups'][group_id]['agrees'] += 1
                    elif vote_val == -1:
                        vote_data[tid]['total_disagrees'] += 1
                        vote_data[tid]['groups'][group_id]['disagrees'] += 1
                    elif vote_val == 0:
                        vote_data[tid]['total_passes'] += 1
                        vote_data[tid]['groups'][group_id]['passes'] += 1
                    
                    # Update group vote count
                    vote_data[tid]['groups'][group_id]['votes'] += 1
            
            return {
                'vote_data': vote_data,
                'group_assignments': group_assignments,
                'n_groups': n_groups
            }
            
        except Exception as e:
            print(f"Error getting vote data by groups: {e}")
            return {
                'vote_data': {},
                'group_assignments': {},
                'n_groups': 0
            }


class TestGroupDataProcessor(unittest.TestCase):
    """Test the core functionality of the GroupDataProcessor."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.processor = GroupDataProcessor()
        
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
        
        # Set up processor with test data
        self.processor.math_data = complex_math_data
        self.processor.votes = complex_vote_data
        
        # Get vote data by groups
        result = self.processor.get_vote_data_by_groups(1)
        
        # Verify group assignments contain ALL participants
        group_assignments = result['group_assignments']
        self.assertEqual(len(group_assignments), 19)  # 5 direct + 14 from base clusters
        
        # Verify all members of base clusters 0, 1, 2 are mapped to Group 0
        for pid in ["10", "11", "12", "13", "14", "15", "16", "17", "18"]:
            self.assertEqual(group_assignments.get(pid), 0, f"Participant {pid} should be in Group 0")
            
        # Verify all members of base clusters 3, 4 are mapped to Group 1
        for pid in ["19", "20", "21", "22", "23"]:
            self.assertEqual(group_assignments.get(pid), 1, f"Participant {pid} should be in Group 1")
            
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