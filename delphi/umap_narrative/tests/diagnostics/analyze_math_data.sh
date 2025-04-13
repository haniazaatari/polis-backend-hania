#!/bin/bash
# Analyze math data using Docker to avoid dependency issues

set -e

# Get the ZID from the command line
ZID=${1:-27616}  # Default to 27616 if not provided

# Create a temporary Python script
cat > /tmp/analyze_math_data.py << 'EOF'
#!/usr/bin/env python3
"""
Script to extract and analyze math_main data structure directly from PostgreSQL.

This is a simplified version for running in Docker with direct SQL access.
"""

import os
import sys
import json
import logging
import psycopg2
import psycopg2.extras
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def extract_math_data(zid):
    """
    Extract and analyze math data for a conversation.
    
    Args:
        zid: Conversation ID
    """
    try:
        # Get database connection info from environment variables
        db_host = os.environ.get('DATABASE_HOST', 'localhost')
        db_port = os.environ.get('DATABASE_PORT', '5432')
        db_name = os.environ.get('DATABASE_NAME', 'polisDB_prod_local_mar14')
        db_user = os.environ.get('DATABASE_USER', 'postgres')
        db_password = os.environ.get('DATABASE_PASSWORD', '')
        
        # Connect to PostgreSQL
        conn_string = f"host={db_host} port={db_port} dbname={db_name} user={db_user} password={db_password}"
        conn = psycopg2.connect(conn_string)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Query math_main data
        cursor.execute("""
        SELECT data
        FROM math_main 
        WHERE zid = %s
        ORDER BY modified DESC
        LIMIT 1
        """, (zid,))
        
        result = cursor.fetchone()
        
        if not result or 'data' not in result:
            logger.error(f"No math data found for conversation {zid}")
            return None
        
        # Get the math data
        math_data = result['data']
        
        # Save raw data to file
        output_dir = Path('/app/output')
        os.makedirs(output_dir, exist_ok=True)
        
        raw_output_path = output_dir / f"math_data_{zid}_raw.json"
        with open(raw_output_path, 'w') as f:
            json.dump(math_data, f, indent=2)
        logger.info(f"Raw math data saved to {raw_output_path}")
        
        # Analyze the structure
        analyze_math_structure(math_data, zid, output_dir)
        
        # Close the connection
        cursor.close()
        conn.close()
        
        return math_data
    
    except Exception as e:
        logger.error(f"Error extracting math data: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None

def analyze_math_structure(math_data, zid, output_dir):
    """
    Analyze the structure of math data.
    
    Args:
        math_data: Math data from PostgreSQL
        zid: Conversation ID
        output_dir: Directory to save output files
    """
    # Create analysis output file
    analysis_path = output_dir / f"math_data_{zid}_analysis.txt"
    
    with open(analysis_path, 'w') as f:
        f.write(f"MATH DATA STRUCTURE ANALYSIS FOR CONVERSATION {zid}\n")
        f.write("=" * 80 + "\n\n")
        
        # Check top-level keys
        f.write("TOP-LEVEL KEYS:\n")
        for key in math_data.keys():
            f.write(f"- {key}\n")
        f.write("\n")
        
        # Check for group assignments in various locations
        group_assignments = {}
        assigned_participants = 0
        total_participants = 0
        
        # Check for direct group_assignments
        if 'group_assignments' in math_data:
            f.write("FOUND: direct group_assignments\n")
            f.write(f"- Length: {len(math_data['group_assignments'])}\n")
            group_assignments = math_data['group_assignments']
            assigned_participants = len(group_assignments)
            f.write(f"- Sample: {list(group_assignments.items())[:5]}\n\n")
        
        # Check for group-clusters
        if 'group-clusters' in math_data:
            f.write("FOUND: group-clusters\n")
            clusters = math_data['group-clusters']
            f.write(f"- Number of clusters: {len(clusters)}\n")
            
            # Count members in each cluster
            cluster_counts = {}
            cluster_members = []
            
            for i, cluster in enumerate(clusters):
                if isinstance(cluster, dict) and 'members' in cluster and 'id' in cluster:
                    group_id = cluster['id']
                    members = cluster['members']
                    cluster_counts[group_id] = len(members)
                    cluster_members.extend(members)
                    f.write(f"- Cluster {group_id}: {len(members)} members\n")
                    f.write(f"  - Sample members: {members[:5]}\n")
            
            f.write(f"- Total participants in clusters: {len(set(cluster_members))}\n\n")
        
        # Check for participation.ptptogroup
        if 'participation' in math_data and isinstance(math_data['participation'], dict):
            f.write("FOUND: participation section\n")
            participation = math_data['participation']
            
            for key in participation.keys():
                f.write(f"- {key}\n")
            
            if 'ptptogroup' in participation:
                f.write("\nFOUND: participation.ptptogroup\n")
                ptptogroup = participation['ptptogroup']
                f.write(f"- Length: {len(ptptogroup)}\n")
                f.write(f"- Sample: {list(ptptogroup.items())[:5]}\n")
                
                # Use this as our primary group assignments if we haven't found any yet
                if not group_assignments:
                    group_assignments = ptptogroup
                    assigned_participants = len(ptptogroup)
            
            f.write("\n")
        
        # Check user-vote-counts for total participants
        if 'user-vote-counts' in math_data:
            f.write("FOUND: user-vote-counts\n")
            user_vote_counts = math_data['user-vote-counts']
            total_participants = len(user_vote_counts)
            f.write(f"- Total participants who voted: {total_participants}\n\n")
        
        # Check for group_votes structure
        if 'group_votes' in math_data:
            f.write("FOUND: group_votes structure\n")
            group_votes = math_data['group_votes']
            f.write(f"- Number of groups: {len(group_votes)}\n")
            
            for group_id, votes in group_votes.items():
                comment_count = sum(1 for k in votes.keys() if k != 'n-members')
                f.write(f"- Group {group_id}: votes on {comment_count} comments\n")
                if 'n-members' in votes:
                    f.write(f"  - Members: {votes['n-members']}\n")
            
            f.write("\n")
        
        # Compute coverage statistics
        f.write("COVERAGE STATISTICS:\n")
        f.write(f"- Total participants: {total_participants}\n")
        f.write(f"- Participants with group assignments: {assigned_participants}\n")
        
        if total_participants > 0:
            coverage = assigned_participants / total_participants * 100
            f.write(f"- Group assignment coverage: {coverage:.1f}%\n")
        else:
            f.write("- Group assignment coverage: N/A (no participants)\n")
            
        # Analyze group distribution
        if group_assignments:
            f.write("\nGROUP DISTRIBUTION:\n")
            group_counts = {}
            
            for pid, group_id in group_assignments.items():
                if group_id not in group_counts:
                    group_counts[group_id] = 0
                group_counts[group_id] += 1
            
            for group_id, count in sorted(group_counts.items()):
                f.write(f"- Group {group_id}: {count} participants\n")
    
    logger.info(f"Analysis saved to {analysis_path}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Extract and analyze math data structure')
    parser.add_argument('--zid', type=int, required=True, help='Conversation ID')
    args = parser.parse_args()
    
    extract_math_data(args.zid)
EOF

# Create output directory
mkdir -p /Users/colinmegill/polis/delphi/umap_narrative/tests/diagnostics/output

# Run the analysis script using Docker
docker run --rm \
  -v /tmp/analyze_math_data.py:/app/analyze_math_data.py \
  -v /Users/colinmegill/polis/delphi/umap_narrative/tests/diagnostics/output:/app/output \
  -e DATABASE_HOST=host.docker.internal \
  -e DATABASE_PORT=5432 \
  -e DATABASE_NAME=polisDB_prod_local_mar14 \
  -e DATABASE_USER=postgres \
  -e DATABASE_PASSWORD="" \
  --network host \
  python:3.9 bash -c "pip install psycopg2-binary && python /app/analyze_math_data.py --zid $ZID"

echo "Analysis complete! Results saved to output directory."