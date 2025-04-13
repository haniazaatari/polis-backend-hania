#!/bin/bash
# Run the fixed XML generator using Docker

set -e

# Get the conversation ID
CONVERSATION_ID=${1:-27616}

# Create a temporary Python script using the fixed implementation
cat > /tmp/fixed_xml_generator.py << 'EOF'
#!/usr/bin/env python3
"""
Generate XML for a conversation using the fixed implementation.
"""

import os
import sys
import json
import logging
import psycopg2
import psycopg2.extras
from collections import defaultdict
from xml.dom.minidom import parseString
import xml.etree.ElementTree as ET

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_math_data(zid):
    """Get math data for a conversation."""
    try:
        # Connect to PostgreSQL
        conn_string = f"host=host.docker.internal port=5432 dbname=polisDB_prod_local_mar14 user=postgres password=''"
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
        return math_data
    
    except Exception as e:
        logger.error(f"Error getting math data: {e}")
        return None
    
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def get_votes(zid):
    """Get votes for a conversation."""
    try:
        # Connect to PostgreSQL
        conn_string = f"host=host.docker.internal port=5432 dbname=polisDB_prod_local_mar14 user=postgres password=''"
        conn = psycopg2.connect(conn_string)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Query votes
        cursor.execute("""
        SELECT 
            v.zid, 
            v.pid, 
            v.tid, 
            v.vote
        FROM 
            votes_latest_unique v
        WHERE 
            v.zid = %s
        """, (zid,))
        
        votes = cursor.fetchall()
        return [dict(v) for v in votes]
    
    except Exception as e:
        logger.error(f"Error getting votes: {e}")
        return []
    
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def get_comments(zid):
    """Get comments for a conversation."""
    try:
        # Connect to PostgreSQL
        conn_string = f"host=host.docker.internal port=5432 dbname=polisDB_prod_local_mar14 user=postgres password=''"
        conn = psycopg2.connect(conn_string)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Query comments
        cursor.execute("""
        SELECT 
            tid, 
            zid, 
            pid, 
            txt, 
            created, 
            mod,
            active
        FROM 
            comments 
        WHERE 
            zid = %s
        ORDER BY 
            tid
        """, (zid,))
        
        comments = cursor.fetchall()
        return [dict(c) for c in comments]
    
    except Exception as e:
        logger.error(f"Error getting comments: {e}")
        return []
    
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def process_group_clusters(math_data):
    """Process group-clusters structure to extract primary groups."""
    group_assignments = {}
    primary_group_clusters = {}
    
    if isinstance(math_data, dict) and 'group-clusters' in math_data:
        group_clusters = math_data['group-clusters']
        if isinstance(group_clusters, list) and len(group_clusters) > 0:
            try:
                # Log group clusters information
                logger.info(f"Group-clusters list has {len(group_clusters)} items")
                
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
                    logger.info(f"Extracted {len(group_assignments)} direct group assignments from group-clusters")
            
            except Exception as e:
                logger.error(f"Error processing group-clusters: {e}")
                
    return group_assignments, primary_group_clusters
    
def process_base_clusters(math_data, group_assignments, primary_group_clusters):
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
            logger.info(f"Processing base-clusters structure with {num_base_clusters} base clusters")
            
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
            
            logger.info(f"After processing base-clusters, total group assignments: {len(group_assignments)}")
            
        except Exception as e:
            logger.error(f"Error processing base-clusters: {e}")
            
    return group_assignments

def process_vote_data(votes, comments, group_assignments):
    """Process votes and organize by group."""
    # Initialize structure for vote data
    vote_data = {}
    
    # Initialize comment data
    for comment in comments:
        tid = comment['tid']
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
    
    # Process votes
    for vote in votes:
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
    
    return vote_data

def format_export_data(comments, vote_data):
    """Format data for export."""
    export_comments = []
    
    for comment in comments:
        tid = comment['tid']
        
        if tid in vote_data:
            record = {
                "comment-id": tid,
                "comment": comment.get('txt', ''),
            }
            
            # Add vote data
            comment_votes = vote_data[tid]
            record["total-votes"] = comment_votes['total_votes']
            record["total-agrees"] = comment_votes['total_agrees'] 
            record["total-disagrees"] = comment_votes['total_disagrees']
            record["total-passes"] = comment_votes['total_passes']
            
            # Add group data
            for group_id, group_data in comment_votes['groups'].items():
                if group_id != -1:  # Skip unassigned participants
                    record[f"group-{group_id}-votes"] = group_data['votes']
                    record[f"group-{group_id}-agrees"] = group_data['agrees']
                    record[f"group-{group_id}-disagrees"] = group_data['disagrees']
                    record[f"group-{group_id}-passes"] = group_data['passes']
            
            export_comments.append(record)
    
    return export_comments

def convert_to_xml(comment_data):
    """Convert comment data to XML format."""
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

def generate_xml_for_conversation(conversation_id):
    """Generate XML for a conversation."""
    try:
        # Get math data
        math_data = get_math_data(int(conversation_id))
        if not math_data:
            logger.error("Failed to get math data")
            return
        
        # Get votes
        votes = get_votes(int(conversation_id))
        logger.info(f"Retrieved {len(votes)} votes")
        
        # Get comments
        comments = get_comments(int(conversation_id))
        logger.info(f"Retrieved {len(comments)} comments")
        
        # Process group clusters to get primary group structure
        group_assignments, primary_group_clusters = process_group_clusters(math_data)
        
        # Process base clusters to get full participant mapping
        group_assignments = process_base_clusters(math_data, group_assignments, primary_group_clusters)
        
        # Count number of groups
        n_groups = 0
        if group_assignments:
            n_groups = max(group_assignments.values()) + 1
        logger.info(f"Found {n_groups} groups with {len(group_assignments)} participant assignments")
        
        # Process votes by group
        vote_data = process_vote_data(votes, comments, group_assignments)
        
        # Format for export
        export_comments = format_export_data(comments, vote_data)
        logger.info(f"Formatted {len(export_comments)} comments for export")
        
        # Count votes by group
        total_votes = sum(comment.get('total-votes', 0) for comment in export_comments)
        
        # Count votes by group
        group_votes = {}
        for comment in export_comments:
            # Find group keys
            for key in comment.keys():
                if key.startswith("group-") and key.endswith("-votes"):
                    group_id = key.split("-")[1]
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
        xml_output = convert_to_xml(export_comments)
        
        # Save XML to file
        xml_path = f"/app/output/conversation_{conversation_id}_fixed.xml"
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
        for i, comment in enumerate(export_comments[:5]):
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
        report_path = f"/app/output/conversation_{conversation_id}_report.json"
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        logger.info(f"Report saved to {report_path}")
        
    except Exception as e:
        logger.error(f"Error generating XML: {e}")
        import traceback
        logger.error(traceback.format_exc())

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate XML with fixed implementation')
    parser.add_argument('--conversation_id', type=str, required=True, help='Conversation ID to process')
    args = parser.parse_args()
    
    generate_xml_for_conversation(args.conversation_id)
EOF

# Create output directory
mkdir -p /Users/colinmegill/polis/delphi/umap_narrative/tests/output

# Run the script using Docker
docker run --rm \
  -v /tmp/fixed_xml_generator.py:/app/fixed_xml_generator.py \
  -v /Users/colinmegill/polis/delphi/umap_narrative/tests/output:/app/output \
  --network host \
  python:3.9 bash -c "pip install psycopg2-binary && python /app/fixed_xml_generator.py --conversation_id $CONVERSATION_ID"

# Report results
echo -e "\nXML generation complete! Results are in the output directory."
echo "Use this command to view the report: cat /Users/colinmegill/polis/delphi/umap_narrative/tests/output/conversation_${CONVERSATION_ID}_report.json"