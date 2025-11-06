#!/usr/bin/env python3
"""
Test script to directly test the Conversation class with real data.
"""

import os
import sys
from typing import Dict, List, Any

# Add the parent directory to the path to import the module
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from common_utils import create_test_conversation

def test_conversation(dataset_name: str) -> None:
    """
    Test the Conversation class with a real dataset.
    
    Args:
        dataset_name: 'biodiversity' or 'vw'
    """
    print(f"Testing Conversation with {dataset_name} dataset")
    
    # Create a conversation with the dataset
    try:
        print("Creating conversation...")
        conv = create_test_conversation(dataset_name)
        
        print(f"Conversation created successfully")
        print(f"Participants: {conv.participant_count}")
        print(f"Comments: {conv.comment_count}")
        print(f"Matrix shape: {conv.rating_mat.values.shape}")
        
        # Recompute the conversation
        print("Running recompute...")
        updated_conv = conv.recompute()
        
        # Check PCA results
        print(f"PCA Results:")
        print(f"  - Center shape: {updated_conv.pca['center'].shape}")
        print(f"  - Components shape: {updated_conv.pca['comps'].shape}")
        print(f"  - Projections count: {len(updated_conv.proj)}")
        
        # Check clustering results
        print(f"Clustering Results:")
        print(f"  - Number of clusters: {len(updated_conv.group_clusters)}")
        for i, cluster in enumerate(updated_conv.group_clusters):
            print(f"  - Cluster {i+1}: {len(cluster['members'])} participants")
        
        print("Conversation recompute SUCCESSFUL!")
        
    except Exception as e:
        print(f"Error during conversation processing: {e}")
        import traceback
        traceback.print_exc()
        print("Conversation recompute FAILED!")

if __name__ == "__main__":
    # Test on both datasets
    test_conversation('biodiversity')
    print("\n" + "="*50 + "\n")
    test_conversation('vw')