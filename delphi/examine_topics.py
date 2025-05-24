#!/usr/bin/env python3
import boto3
import json
from datetime import datetime
from decimal import Decimal
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# DynamoDB connection
dynamodb = boto3.resource(
    'dynamodb',
    endpoint_url='http://localhost:8000',
    region_name='us-east-1',
    aws_access_key_id='dummy',
    aws_secret_access_key='dummy'
)

def decimal_default(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError

def get_llm_topics(zid):
    """Fetch all LLM topic names for a conversation"""
    table = dynamodb.Table('Delphi_CommentClustersLLMTopicNames')
    
    response = table.query(
        KeyConditionExpression='conversation_id = :zid',
        ExpressionAttributeValues={
            ':zid': str(zid)
        }
    )
    
    items = response['Items']
    
    # Continue fetching if there are more items
    while 'LastEvaluatedKey' in response:
        response = table.query(
            KeyConditionExpression='conversation_id = :zid',
            ExpressionAttributeValues={
                ':zid': str(zid)
            },
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response['Items'])
    
    return items

def get_cluster_structure(zid):
    """Fetch cluster structure/keywords for understanding relationships"""
    table = dynamodb.Table('Delphi_CommentClustersStructureKeywords')
    
    response = table.query(
        KeyConditionExpression='conversation_id = :zid',
        ExpressionAttributeValues={
            ':zid': str(zid)
        }
    )
    
    items = response['Items']
    
    # Continue fetching if there are more items
    while 'LastEvaluatedKey' in response:
        response = table.query(
            KeyConditionExpression='conversation_id = :zid',
            ExpressionAttributeValues={
                ':zid': str(zid)
            },
            ExclusiveStartKey=response['LastEvaluatedKey']
        )
        items.extend(response['Items'])
    
    return items

def analyze_topics(zid=39321):
    """Analyze topic storage patterns for a conversation"""
    print(f"\n=== Analyzing LLM Topics for ZID {zid} ===\n")
    
    # Get LLM topics
    topics = get_llm_topics(zid)
    print(f"Found {len(topics)} LLM topic entries\n")
    
    # Group by model and timestamp to understand runs
    runs = {}
    for topic in topics:
        model = topic.get('model_name', 'unknown')
        created_at = topic.get('created_at', 'unknown')
        
        # Try to parse timestamp
        if created_at != 'unknown':
            try:
                # Handle different timestamp formats
                if 'T' in created_at:
                    timestamp = created_at.split('T')[0]
                else:
                    timestamp = created_at.split(' ')[0] if ' ' in created_at else created_at
            except:
                timestamp = created_at
        else:
            timestamp = 'unknown'
        
        run_key = f"{model}@{timestamp}"
        
        if run_key not in runs:
            runs[run_key] = []
        runs[run_key].append(topic)
    
    print(f"Found {len(runs)} distinct runs:\n")
    
    for run_key, run_topics in sorted(runs.items()):
        model, timestamp = run_key.split('@')
        print(f"Run: {run_key}")
        print(f"  Model: {model}")
        print(f"  Date: {timestamp}")
        print(f"  Topics: {len(run_topics)}")
        
        # Show topic distribution by layer
        layer_counts = {}
        for topic in run_topics:
            layer_id = topic.get('layer_id', 'unknown')
            if layer_id not in layer_counts:
                layer_counts[layer_id] = 0
            layer_counts[layer_id] += 1
        
        print(f"  Layer distribution: {dict(sorted(layer_counts.items()))}")
        print()
    
    # Show detailed topics for the most recent run
    print("\n=== Most Recent Run Details ===\n")
    
    latest_run_key = sorted(runs.keys())[-1] if runs else None
    if latest_run_key:
        latest_topics = runs[latest_run_key]
        
        # Sort by topic_key
        latest_topics.sort(key=lambda x: (x.get('layer_id', 0), x.get('cluster_id', 0)))
        
        print(f"Topics from {latest_run_key}:\n")
        for topic in latest_topics[:20]:  # Show first 20
            topic_key = topic.get('topic_key', 'unknown')
            topic_name = topic.get('topic_name', 'unknown')
            layer = topic.get('layer_id', 'unknown')
            cluster = topic.get('cluster_id', 'unknown')
            
            print(f"  {topic_key}: {topic_name}")
            print(f"    Layer: {layer}, Cluster: {cluster}")
            
    # Show cluster structure for context
    print("\n=== Cluster Structure (Sample) ===\n")
    
    clusters = get_cluster_structure(zid)
    print(f"Found {len(clusters)} cluster entries\n")
    
    # Show a few examples
    for cluster in clusters[:5]:
        cluster_key = cluster.get('cluster_key', 'unknown')
        size = cluster.get('size', 0)
        top_words = cluster.get('top_words', [])
        
        print(f"Cluster: {cluster_key}")
        print(f"  Size: {size} comments")
        print(f"  Top words: {', '.join(top_words[:5]) if top_words else 'None'}")
        print()
    
    # Check for missing topics
    print("\n=== Checking for Missing Topics ===\n")
    
    # Get all cluster keys from structure
    all_cluster_keys = set(c.get('cluster_key') for c in clusters if c.get('cluster_key'))
    
    # Get all topic keys from latest run
    if latest_run_key:
        latest_topic_keys = set(t.get('topic_key') for t in runs[latest_run_key] if t.get('topic_key'))
        
        missing = all_cluster_keys - latest_topic_keys
        extra = latest_topic_keys - all_cluster_keys
        
        print(f"Clusters without topics: {len(missing)}")
        if missing:
            print(f"  Examples: {list(missing)[:5]}")
        
        print(f"\nTopics without clusters: {len(extra)}")
        if extra:
            print(f"  Examples: {list(extra)[:5]}")

if __name__ == "__main__":
    analyze_topics(39321)