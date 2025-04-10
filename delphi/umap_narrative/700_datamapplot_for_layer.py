#!/usr/bin/env python3
"""
Generate DataMapPlot visualization for a specific layer of a conversation using data from PostgreSQL and DynamoDB.

This script:
1. Connects to both PostgreSQL (for comment data) and DynamoDB (for cluster data)
2. Retrieves UMAP coordinates and topic names for a specified conversation and layer
3. Generates an interactive visualization using DataMapPlot
"""

import os
import sys
import json
import logging
import argparse
import numpy as np
import pandas as pd
import datamapplot
from pathlib import Path
from boto3.dynamodb.conditions import Key

# Import from local modules
from polismath_commentgraph.utils.storage import PostgresClient, DynamoDBStorage

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def setup_environment(db_host=None, db_port=None, db_name=None, db_user=None, db_password=None):
    """Set up environment variables for database connections."""
    # PostgreSQL settings
    if db_host:
        os.environ['DATABASE_HOST'] = db_host
    elif not os.environ.get('DATABASE_HOST'):
        os.environ['DATABASE_HOST'] = 'localhost'
    
    if db_port:
        os.environ['DATABASE_PORT'] = str(db_port)
    elif not os.environ.get('DATABASE_PORT'):
        os.environ['DATABASE_PORT'] = '5432'
    
    if db_name:
        os.environ['DATABASE_NAME'] = db_name
    elif not os.environ.get('DATABASE_NAME'):
        os.environ['DATABASE_NAME'] = 'polisDB_prod_local_mar14'
    
    if db_user:
        os.environ['DATABASE_USER'] = db_user
    elif not os.environ.get('DATABASE_USER'):
        os.environ['DATABASE_USER'] = 'postgres'
    
    if db_password:
        os.environ['DATABASE_PASSWORD'] = db_password
    elif not os.environ.get('DATABASE_PASSWORD'):
        os.environ['DATABASE_PASSWORD'] = ''
    
    # Print database connection info
    logger.info(f"Database connection info:")
    logger.info(f"- HOST: {os.environ.get('DATABASE_HOST')}")
    logger.info(f"- PORT: {os.environ.get('DATABASE_PORT')}")
    logger.info(f"- DATABASE: {os.environ.get('DATABASE_NAME')}")
    logger.info(f"- USER: {os.environ.get('DATABASE_USER')}")
    
    # DynamoDB settings (for local DynamoDB)
    if not os.environ.get('DYNAMODB_ENDPOINT'):
        os.environ['DYNAMODB_ENDPOINT'] = 'http://localhost:8000'
    if not os.environ.get('AWS_ACCESS_KEY_ID'):
        os.environ['AWS_ACCESS_KEY_ID'] = 'fakeMyKeyId'
    if not os.environ.get('AWS_SECRET_ACCESS_KEY'):
        os.environ['AWS_SECRET_ACCESS_KEY'] = 'fakeSecretAccessKey'
    if not os.environ.get('AWS_DEFAULT_REGION'):
        os.environ['AWS_DEFAULT_REGION'] = 'us-west-2'

def load_comment_texts(zid):
    """
    Load comment texts from PostgreSQL.
    
    Args:
        zid: Conversation ID
        
    Returns:
        Dictionary mapping comment_id to text
    """
    logger.info(f"Loading comments directly from PostgreSQL for conversation {zid}")
    postgres_client = PostgresClient()
    
    try:
        # Initialize connection
        postgres_client.initialize()
        
        # Get comments
        comments = postgres_client.get_comments_by_conversation(int(zid))
        
        if not comments:
            logger.error(f"No comments found in PostgreSQL for conversation {zid}")
            return None
            
        # Create a dictionary of comment_id to text
        comment_dict = {comment['tid']: comment['txt'] for comment in comments if comment.get('txt')}
        
        logger.info(f"Loaded {len(comment_dict)} comments from PostgreSQL")
        return comment_dict
        
    except Exception as e:
        logger.error(f"Error loading comments from PostgreSQL: {e}")
        return None
        
    finally:
        # Clean up connection
        postgres_client.shutdown()

def load_conversation_data_from_dynamo(zid, layer_id, dynamo_storage):
    """
    Load data from DynamoDB for a specific conversation and layer.
    
    Args:
        zid: Conversation ID
        layer_id: Layer ID
        dynamo_storage: DynamoDBStorage instance
        
    Returns:
        Dictionary with data from DynamoDB
    """
    logger.info(f"Loading data from DynamoDB for conversation {zid}, layer {layer_id}")
    
    # Initialize data dictionary
    data = {
        "comment_positions": {},
        "cluster_assignments": {},
        "topic_names": {}
    }
    
    # Try to get conversation metadata
    try:
        meta = dynamo_storage.get_conversation_meta(zid)
        if not meta:
            logger.error(f"No metadata found for conversation {zid}")
            return None
            
        logger.info(f"Conversation name: {meta.get('conversation_name', f'Conversation {zid}')}")
        data["meta"] = meta
    except Exception as e:
        logger.error(f"Error getting conversation metadata: {e}")
        return None
    
    # Load comment embeddings to get comment IDs in order
    try:
        # Query CommentEmbeddings for this conversation
        logger.info(f"Loading comment embeddings to get full comment list...")
        table = dynamo_storage.dynamodb.Table(dynamo_storage.table_names['comment_embeddings'])
        response = table.query(
            KeyConditionExpression=Key('conversation_id').eq(str(zid))
        )
        embeddings = response.get('Items', [])
        
        # Handle pagination if needed
        while 'LastEvaluatedKey' in response:
            response = table.query(
                KeyConditionExpression=Key('conversation_id').eq(str(zid)),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            embeddings.extend(response.get('Items', []))
        
        # Extract comment IDs in order
        comment_ids = [int(item['comment_id']) for item in embeddings]
        data["comment_ids"] = comment_ids
        logger.info(f"Loaded {len(comment_ids)} comment IDs from embeddings")
    except Exception as e:
        logger.error(f"Error retrieving comment embeddings: {e}")
        
    # Get comment clusters
    try:
        # Query CommentClusters for this conversation
        table = dynamo_storage.dynamodb.Table(dynamo_storage.table_names['comment_clusters'])
        response = table.query(
            KeyConditionExpression=Key('conversation_id').eq(str(zid))
        )
        clusters = response.get('Items', [])
        
        # Handle pagination if needed
        while 'LastEvaluatedKey' in response:
            response = table.query(
                KeyConditionExpression=Key('conversation_id').eq(str(zid)),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            clusters.extend(response.get('Items', []))
        
        logger.info(f"Retrieved {len(clusters)} comment cluster assignments")
        
        # Extract positions and cluster assignments for the specified layer
        position_column = f"position"
        cluster_column = f"layer{layer_id}_cluster_id"
        
        for item in clusters:
            comment_id = int(item.get('comment_id'))
            if comment_id is None:
                continue
                
            # Extract position
            if position_column in item and isinstance(item[position_column], dict):
                pos = item[position_column]
                if 'x' in pos and 'y' in pos:
                    data["comment_positions"][comment_id] = [float(pos['x']), float(pos['y'])]
            
            # Extract cluster assignment for this layer
            if cluster_column in item:
                data["cluster_assignments"][comment_id] = int(item[cluster_column])
        
        logger.info(f"Extracted {len(data['comment_positions'])} positions and {len(data['cluster_assignments'])} cluster assignments")
        
        # If positions were not found, try to get them from UMAP graph
        if len(data["comment_positions"]) == 0:
            logger.info("No positions found in CommentClusters, fetching from UMAPGraph...")
            
            # Try to get positions from the UMAPGraph table
            try:
                # Get all edges from UMAPGraph for this conversation
                umap_table = dynamo_storage.dynamodb.Table(dynamo_storage.table_names['umap_graph'])
                response = umap_table.query(
                    KeyConditionExpression=Key('conversation_id').eq(str(zid))
                )
                edges = response.get('Items', [])
                
                # Handle pagination if needed
                while 'LastEvaluatedKey' in response:
                    response = umap_table.query(
                        KeyConditionExpression=Key('conversation_id').eq(str(zid)),
                        ExclusiveStartKey=response['LastEvaluatedKey']
                    )
                    edges.extend(response.get('Items', []))
                
                logger.info(f"Retrieved {len(edges)} edges from UMAPGraph")
                
                # Extract positions from edges
                positions = {}
                for edge in edges:
                    # Check if this edge has position information
                    if 'position' in edge and isinstance(edge['position'], dict) and 'x' in edge['position'] and 'y' in edge['position']:
                        pos = edge['position']
                        # Determine which comment this position belongs to
                        if 'source_id' in edge:
                            comment_id = int(edge['source_id'])
                            positions[comment_id] = [float(pos['x']), float(pos['y'])]
                        
                # Map positions to comment IDs
                for comment_id in data["cluster_assignments"].keys():
                    if comment_id in positions:
                        data["comment_positions"][comment_id] = positions[comment_id]
                
                logger.info(f"Extracted {len(data['comment_positions'])} positions from UMAPGraph")
                
                # If we still don't have all positions, check if we can use the comment embeddings
                if len(data['comment_positions']) < len(data['cluster_assignments']):
                    logger.info(f"Still missing positions for {len(data['cluster_assignments']) - len(data['comment_positions'])} comments")
            except Exception as e:
                logger.error(f"Error retrieving positions from UMAPGraph: {e}")
    except Exception as e:
        logger.error(f"Error retrieving comment clusters: {e}")
    
    # Get topic names from LLMTopicNames
    try:
        # Query LLMTopicNames for this conversation and layer
        table = dynamo_storage.dynamodb.Table(dynamo_storage.table_names['llm_topic_names'])
        response = table.query(
            KeyConditionExpression=Key('conversation_id').eq(str(zid))
        )
        topic_names = response.get('Items', [])
        
        # Handle pagination if needed
        while 'LastEvaluatedKey' in response:
            response = table.query(
                KeyConditionExpression=Key('conversation_id').eq(str(zid)),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            topic_names.extend(response.get('Items', []))
        
        # Filter to this layer and extract topic names
        for item in topic_names:
            if item.get('layer_id') == layer_id:
                cluster_id = item.get('cluster_id')
                if cluster_id is not None:
                    data["topic_names"][int(cluster_id)] = item.get('topic_name', f"Topic {cluster_id}")
        
        logger.info(f"Retrieved {len(data['topic_names'])} topic names for layer {layer_id}")
    except Exception as e:
        logger.error(f"Error retrieving topic names: {e}")
    
    return data

def create_visualization(zid, layer_id, data, comment_texts, output_dir=None):
    """
    Create and save a visualization for a specific layer.
    
    Args:
        zid: Conversation ID
        layer_id: Layer ID
        data: Dictionary with data from DynamoDB
        comment_texts: Dictionary mapping comment_id to text
        output_dir: Optional directory to save the visualization
        
    Returns:
        Path to the saved visualization
    """
    # Setup output directory if specified
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    else:
        output_dir = os.path.join("polis_data", str(zid), "python_output")
        os.makedirs(output_dir, exist_ok=True)
    
    # Get conversation name
    conversation_name = data.get("meta", {}).get("conversation_name", f"Conversation {zid}")
    
    # Prepare data for visualization
    positions = data["comment_positions"]
    cluster_assignments = data["cluster_assignments"]
    topic_names = data["topic_names"]
    
    # Check if we have positions
    if not positions:
        logger.error("No position data found for comments")
        return None
    
    # Create arrays for 2D coordinates and labels
    comment_ids = sorted(positions.keys())
    
    if len(comment_ids) == 0:
        logger.error("No comments with positions found")
        return None
    
    document_map = np.array([positions[cid] for cid in comment_ids])
    logger.info(f"Created document_map with shape {document_map.shape}")
    
    # Create cluster assignments array
    cluster_labels = np.array([cluster_assignments.get(cid, -1) for cid in comment_ids])
    
    # Debug: Check if all comments are unclustered in this layer
    unique_clusters = np.unique(cluster_labels)
    logger.info(f"Unique cluster labels in this layer: {unique_clusters}")
    
    # Check if we have valid clusters (not just -1 which is unclustered)
    if len(unique_clusters) == 1 and unique_clusters[0] == -1:
        logger.error(f"All comments are unclustered in layer {layer_id}, cannot create visualization")
        return None
    
    # Create hover text array with comment ID and text
    hover_text = []
    for cid in comment_ids:
        text = comment_texts.get(cid, "")
        hover_text.append(f"Comment {cid}: {text}")
    
    # Create label strings using the topic names and clean up formatting (remove asterisks)
    def clean_topic_name(name):
        # Remove asterisks from topic names (e.g., "**Topic Name**" becomes "Topic Name")
        if isinstance(name, str):
            return name.replace('*', '')
        return name
        
    label_strings = np.array([
        clean_topic_name(topic_names.get(label, f"Topic {label}")) if label >= 0 else "Unclustered"
        for label in cluster_labels
    ])
    
    # Create visualization
    logger.info(f"Creating visualization for conversation {zid}, layer {layer_id}...")
    viz_file = os.path.join(output_dir, f"{zid}_layer_{layer_id}_datamapplot.html")
    
    try:
        # Debug info before visualization
        logger.info(f"Document map shape: {document_map.shape}")
        logger.info(f"Label strings shape: {label_strings.shape}")
        logger.info(f"Number of unique labels: {len(np.unique(label_strings))}")
        logger.info(f"Sample labels: {np.unique(label_strings)[:5]}")
        
        # For large number of clusters (like layer 0), use cvd_safer=True to avoid the interp error
        num_unique_labels = len(np.unique(label_strings))
        
        # Generate interactive visualization with safer coloring for layers with many clusters
        # Set specific color for unclustered comments (cluster -1) as darker grey
        noise_color = "#aaaaaa"  # Darker grey color for unclustered comments
        
        # Create a dictionary to sort points by cluster - unclustered (-1) should be LAST in the array
        # so they appear at the bottom layer in the visualization
        sorted_indices = np.argsort([0 if x == -1 else 1 for x in cluster_labels])
        document_map = document_map[sorted_indices]
        label_strings = label_strings[sorted_indices]
        hover_text = [hover_text[i] for i in sorted_indices]
        
        interactive_figure = datamapplot.create_interactive_plot(
            document_map,
            label_strings,
            hover_text=hover_text,
            title=f"{conversation_name} - Layer {layer_id}",
            sub_title=f"Interactive map of {len(document_map)} comments with {len(topic_names)} topics",
            point_radius_min_pixels=2,
            point_radius_max_pixels=10,
            width="100%",
            height=800,
            noise_label="Unclustered",  # The label for uncategorized comments
            noise_color=noise_color,    # Darker grey color for uncategorized
            cvd_safer=True if num_unique_labels > 50 else False  # Use CVD-safer coloring for layers with many clusters
        )
        
        # Save the visualization
        interactive_figure.save(viz_file)
        logger.info(f"Saved visualization to {viz_file}")
        
        # Try to open in browser
        try:
            import webbrowser
            webbrowser.open(f"file://{viz_file}")
            logger.info(f"Opened visualization in browser")
        except:
            logger.info(f"Visualization available at: file://{viz_file}")
        
        return viz_file
    except Exception as e:
        logger.error(f"Error creating visualization: {e}")
        # Print full traceback for debugging
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return None

def generate_visualization(zid, layer_id=0, output_dir=None, dynamo_endpoint=None):
    """
    Generate visualization for a specific conversation and layer.
    
    Args:
        zid: Conversation ID
        layer_id: Optional Layer ID (default: 0)
        output_dir: Optional directory to save the visualization
        dynamo_endpoint: Optional DynamoDB endpoint URL
        
    Returns:
        Path to the saved visualization
    """
    # Setup environment
    setup_environment()
    
    # Set DynamoDB endpoint if provided
    if dynamo_endpoint:
        os.environ['DYNAMODB_ENDPOINT'] = dynamo_endpoint
    
    # Initialize DynamoDB storage
    dynamo_storage = DynamoDBStorage(
        endpoint_url=os.environ.get('DYNAMODB_ENDPOINT')
    )
    
    # Load comment texts from PostgreSQL
    comment_texts = load_comment_texts(zid)
    if not comment_texts:
        logger.error("Failed to load comment texts")
        return None
    
    # Load data from DynamoDB
    data = load_conversation_data_from_dynamo(zid, layer_id, dynamo_storage)
    if not data:
        logger.error("Failed to load data from DynamoDB")
        return None
    
    # Create and save visualization
    viz_file = create_visualization(zid, layer_id, data, comment_texts, output_dir)
    
    if viz_file:
        logger.info(f"Successfully generated visualization for conversation {zid}, layer {layer_id}")
        return viz_file
    else:
        logger.error(f"Failed to generate visualization for conversation {zid}, layer {layer_id}")
        return None

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Generate DataMapPlot visualization for a layer of a conversation')
    parser.add_argument('--conversation_id', '--zid', type=str, required=True,
                      help='Conversation ID to process')
    parser.add_argument('--layer', type=int, default=0,
                      help='Layer ID to visualize (default: 0)')
    parser.add_argument('--output_dir', type=str, default=None,
                      help='Directory to save the visualization')
    parser.add_argument('--dynamo_endpoint', type=str, default=None,
                      help='DynamoDB endpoint URL (default: http://localhost:8000)')
    
    args = parser.parse_args()
    
    logger.info(f"Generating visualization for conversation {args.conversation_id}, layer {args.layer}")
    
    viz_file = generate_visualization(
        args.conversation_id,
        layer_id=args.layer,
        output_dir=args.output_dir,
        dynamo_endpoint=args.dynamo_endpoint
    )
    
    if viz_file:
        print(f"Visualization saved to: {viz_file}")
        print(f"View in browser: file://{viz_file}")
        return 0
    else:
        print("Failed to generate visualization")
        return 1

if __name__ == "__main__":
    sys.exit(main())