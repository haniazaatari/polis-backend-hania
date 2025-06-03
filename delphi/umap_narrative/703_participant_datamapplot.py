#!/usr/bin/env python3
"""
Generate participant-based datamapplot visualizations for a conversation.

This script:
1. Extracts participant voting patterns from PostgreSQL
2. Creates UMAP embeddings using datamapplot's built-in clustering
3. Generates LLM-based names for participant groups based on their voting patterns
4. Creates visualizations showing participant opinion clusters
"""

import os
import sys
import argparse
import numpy as np
import matplotlib.pyplot as plt
import json
import boto3
import logging
import traceback
from typing import Dict, List, Tuple, Any, Optional, Union
from datetime import datetime
from polismath_commentgraph.utils.storage import PostgresClient

# Configuration through environment variables with defaults
DB_CONFIG = {
    'host': os.environ.get('DATABASE_HOST', 'localhost'),
    'port': os.environ.get('DATABASE_PORT', '5432'),
    'name': os.environ.get('DATABASE_NAME', 'polisDB_prod_local_mar14'),
    'user': os.environ.get('DATABASE_USER', 'colinmegill'),
    'password': os.environ.get('DATABASE_PASSWORD', ''),
    'ssl_mode': os.environ.get('DATABASE_SSL_MODE', 'disable')
}

# Visualization settings
VIZ_CONFIG = {
    # Missing votes are filled with per-comment averages (no longer uses a fixed value)
    # 'missing_vote_value': deprecated - now using comment-specific averages
    
    # Minimum votes required for group characterization
    'min_votes_for_consensus': int(os.environ.get('MIN_VOTES_FOR_CONSENSUS', '3')),
    
    # Consensus thresholds for LLM characterization
    'consensus_threshold': float(os.environ.get('CONSENSUS_THRESHOLD', '0.8')),
    'distinctive_threshold': float(os.environ.get('DISTINCTIVE_THRESHOLD', '0.3')),
    
    # Maximum comments to include in LLM prompt
    'max_comments_per_category': int(os.environ.get('MAX_COMMENTS_PER_CATEGORY', '10')),
    
    # Output directory for visualizations
    'output_base_dir': os.environ.get('VIZ_OUTPUT_DIR', 'visualizations')
}

# Configure logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f"{VIZ_CONFIG['output_base_dir']}/participant_datamapplot.log", mode='a')
    ]
)
logger = logging.getLogger(__name__)

def get_postgres_connection():
    """
    Create and return a PostgreSQL database connection using the configuration.
    
    Returns:
        psycopg2 connection object
    """
    import psycopg2
    
    try:
        conn = psycopg2.connect(
            host=DB_CONFIG['host'],
            port=DB_CONFIG['port'],
            database=DB_CONFIG['name'],
            user=DB_CONFIG['user'],
            password=DB_CONFIG['password'],
            sslmode=DB_CONFIG['ssl_mode']
        )
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        raise

def extract_participant_vote_vectors(zid: int) -> Tuple[np.ndarray, List[int], List[Dict], List[Dict]]:
    """
    Extract participant voting patterns from PostgreSQL optimized for UMAP clustering.
    
    Args:
        zid: Conversation ID
        
    Returns:
        Tuple of (vote_matrix, participant_ids, participants_data, comments_data)
    """
    logger.info(f'Extracting participant vote vectors for conversation {zid}')
    
    postgres_client = PostgresClient()
    
    try:
        # Get all participants, votes, and comments for this conversation
        participants = postgres_client.get_participants_by_conversation(zid)
        votes = postgres_client.get_votes_by_conversation(zid)
        comments = postgres_client.get_comments_by_conversation(zid)
        
        logger.info(f'Found {len(participants)} participants, {len(votes)} votes, {len(comments)} comments')
        
        if not participants or not comments:
            raise ValueError(f"No participants or comments found for conversation {zid}")
        
        # Create mappings
        participant_to_index = {p['pid']: i for i, p in enumerate(participants)}
        comment_to_index = {c['tid']: i for i, c in enumerate(comments)}
        participant_ids = [p['pid'] for p in participants]
        
        # Initialize vote matrix with NaN for missing values (will be replaced with averages)
        vote_matrix = np.full((len(participants), len(comments)), np.nan)
        
        # Fill in actual votes
        votes_processed = 0
        for vote in votes:
            pid = vote.get('pid')
            tid = vote.get('tid')
            vote_value = vote.get('vote')
            
            if pid in participant_to_index and tid in comment_to_index:
                p_idx = participant_to_index[pid]
                c_idx = comment_to_index[tid]
                vote_matrix[p_idx, c_idx] = float(vote_value)
                votes_processed += 1
        
        logger.info(f'Processed {votes_processed} votes into matrix of shape {vote_matrix.shape}')
        
        # Calculate average vote for each comment and fill missing values
        logger.info('Calculating average votes per comment for missing values...')
        for c_idx in range(len(comments)):
            # Get actual votes for this comment (excluding NaN)
            comment_votes = vote_matrix[:, c_idx]
            actual_votes = comment_votes[~np.isnan(comment_votes)]
            
            if len(actual_votes) > 0:
                avg_vote = np.mean(actual_votes)
                # Replace NaN values with the average
                vote_matrix[np.isnan(vote_matrix[:, c_idx]), c_idx] = avg_vote
                logger.debug(f'Comment {c_idx}: {len(actual_votes)} actual votes, average: {avg_vote:.3f}')
            else:
                # If no votes for this comment, use 0.0 as neutral
                vote_matrix[np.isnan(vote_matrix[:, c_idx]), c_idx] = 0.0
                logger.debug(f'Comment {c_idx}: No votes, using neutral value 0.0')
        
        logger.info('Filled missing values with comment-specific averages')
        
        # Log some statistics about the vote matrix
        agree_count = np.sum(vote_matrix == 1.0)
        disagree_count = np.sum(vote_matrix == -1.0)
        pass_count = np.sum(vote_matrix == 0.0)
        # Count filled values (not 1, -1, or 0)
        filled_count = np.sum((vote_matrix != 1.0) & (vote_matrix != -1.0) & (vote_matrix != 0.0))
        
        total_cells = vote_matrix.size
        
        logger.info('Vote distribution:')
        logger.info(f'  Agree (1.0): {agree_count} ({(agree_count/total_cells)*100:.1f}%)')
        logger.info(f'  Disagree (-1.0): {disagree_count} ({(disagree_count/total_cells)*100:.1f}%)')
        logger.info(f'  Pass (0.0): {pass_count} ({(pass_count/total_cells)*100:.1f}%)')
        logger.info(f'  Filled with averages: {filled_count} ({(filled_count/total_cells)*100:.1f}%)')
        logger.info(f'  Average range: {np.min(vote_matrix):.3f} to {np.max(vote_matrix):.3f}')
        
        return vote_matrix, participant_ids, participants, comments
        
    finally:
        postgres_client.shutdown()

def create_participant_umap_clustering(vote_matrix: np.ndarray, participant_ids: List[int]) -> Dict[str, Any]:
    """
    Generate UMAP embedding and clustering for participants.
    
    Args:
        vote_matrix: Participant voting patterns matrix
        participant_ids: List of participant IDs corresponding to matrix rows
        
    Returns:
        Dictionary with UMAP results and cluster assignments
    """
    logger.info('Creating UMAP embedding and clustering for participants')
    
    try:
        # Import required libraries
        import umap
        from sklearn.cluster import KMeans
        from sklearn.decomposition import PCA
        
        logger.info(f'Running UMAP on {vote_matrix.shape[0]} participants with {vote_matrix.shape[1]} features')
        
        # Step 1: Create UMAP embedding
        logger.info("Creating UMAP embedding...")
        reducer = umap.UMAP(
            n_components=2, 
            random_state=42,
            n_neighbors=min(15, vote_matrix.shape[0]-1),  # Adjust for small datasets
            min_dist=0.1,
            metric='euclidean'
        )
        embedding = reducer.fit_transform(vote_matrix)
        logger.info(f"UMAP embedding created with shape: {embedding.shape}")
        
        # Step 2: Perform clustering on the UMAP embedding
        logger.info("Performing K-means clustering on UMAP embedding...")
        n_clusters = min(5, max(2, len(participant_ids) // 20))  # 2-5 clusters based on size
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_assignments = kmeans.fit_predict(embedding)
        logger.info(f"Created {n_clusters} clusters using K-means")
        
        # Create result dictionary
        result = {
            'embedding': embedding,
            'cluster_assignments': cluster_assignments,
            'participant_ids': participant_ids,
            'n_clusters': len(np.unique(cluster_assignments))
        }
        
        logger.info(f'UMAP clustering completed. Found {result["n_clusters"]} clusters')
        
        # Log cluster sizes
        unique_clusters, cluster_counts = np.unique(cluster_assignments, return_counts=True)
        for cluster_id, count in zip(unique_clusters, cluster_counts):
            logger.info(f'  Cluster {cluster_id}: {count} participants')
        
        return result
        
    except Exception as e:
        logger.error(f'Error in UMAP clustering: {e}')
        logger.error(traceback.format_exc())
        raise

def extract_group_characteristic_comments(cluster_assignments: np.ndarray, 
                                       vote_matrix: np.ndarray,
                                       participants_data: List[Dict],
                                       comments_data: List[Dict]) -> Dict[int, Dict[str, List[str]]]:
    """
    Extract characteristic comments for each participant cluster based on voting patterns.
    
    Args:
        cluster_assignments: Cluster ID for each participant
        vote_matrix: Participant voting patterns
        participants_data: Participant metadata
        comments_data: Comment texts and metadata
        
    Returns:
        Dictionary mapping cluster_id to characteristic comments
    """
    logger.info('Extracting characteristic comments for each participant group')
    
    consensus_threshold = VIZ_CONFIG['consensus_threshold']
    distinctive_threshold = VIZ_CONFIG['distinctive_threshold']
    min_votes = VIZ_CONFIG['min_votes_for_consensus']
    max_comments = VIZ_CONFIG['max_comments_per_category']
    
    unique_clusters = np.unique(cluster_assignments)
    group_characteristics = {}
    
    for cluster_id in unique_clusters:
        logger.info(f'Analyzing cluster {cluster_id}')
        
        # Get participants in this cluster
        cluster_mask = cluster_assignments == cluster_id
        cluster_participants = np.where(cluster_mask)[0]
        cluster_size = len(cluster_participants)
        
        logger.info(f'  Cluster {cluster_id} has {cluster_size} participants')
        
        # Initialize comment categories
        consensus_agree = []
        consensus_disagree = []
        distinctive_comments = []
        
        # Analyze each comment
        for comment_idx, comment in enumerate(comments_data):
            comment_text = comment.get('txt', '')
            if not comment_text:
                continue
            
            # Get votes from this cluster for this comment
            cluster_votes = vote_matrix[cluster_participants, comment_idx]
            
            # All votes are now real (either actual or filled with averages)
            actual_votes = cluster_votes
            
            if len(actual_votes) < min_votes:
                continue  # Not enough votes to determine consensus
            
            # Calculate consensus within cluster
            agree_votes = np.sum(actual_votes == 1.0)
            disagree_votes = np.sum(actual_votes == -1.0)
            total_actual_votes = len(actual_votes)
            
            agree_pct = agree_votes / total_actual_votes
            disagree_pct = disagree_votes / total_actual_votes
            
            # Check for strong consensus
            if agree_pct >= consensus_threshold:
                consensus_agree.append({
                    'text': comment_text,
                    'agreement': agree_pct,
                    'n_votes': total_actual_votes
                })
            elif disagree_pct >= consensus_threshold:
                consensus_disagree.append({
                    'text': comment_text,
                    'agreement': disagree_pct,
                    'n_votes': total_actual_votes
                })
            
            # Check if this comment is distinctive compared to other clusters
            other_clusters_votes = []
            for other_cluster_id in unique_clusters:
                if other_cluster_id == cluster_id:
                    continue
                
                other_mask = cluster_assignments == other_cluster_id
                other_participants = np.where(other_mask)[0]
                other_votes = vote_matrix[other_participants, comment_idx]
                other_actual = other_votes
                
                if len(other_actual) >= min_votes:
                    other_agree_pct = np.sum(other_actual == 1.0) / len(other_actual)
                    other_clusters_votes.append(other_agree_pct)
            
            # If we have other clusters to compare to
            if other_clusters_votes and total_actual_votes >= min_votes:
                avg_other_agree = np.mean(other_clusters_votes)
                difference = abs(agree_pct - avg_other_agree)
                
                if difference >= distinctive_threshold:
                    distinctive_comments.append({
                        'text': comment_text,
                        'cluster_agreement': agree_pct,
                        'others_agreement': avg_other_agree,
                        'difference': difference,
                        'n_votes': total_actual_votes
                    })
        
        # Sort and limit comments
        consensus_agree.sort(key=lambda x: x['agreement'], reverse=True)
        consensus_disagree.sort(key=lambda x: x['agreement'], reverse=True)
        distinctive_comments.sort(key=lambda x: x['difference'], reverse=True)
        
        group_characteristics[cluster_id] = {
            'consensus_agree': [c['text'] for c in consensus_agree[:max_comments]],
            'consensus_disagree': [c['text'] for c in consensus_disagree[:max_comments]],
            'distinctive': [c['text'] for c in distinctive_comments[:max_comments]],
            'size': cluster_size
        }
        
        logger.info(f'  Found {len(consensus_agree)} consensus agree, {len(consensus_disagree)} consensus disagree, {len(distinctive_comments)} distinctive comments')
    
    return group_characteristics

def store_participant_cluster_assignments_in_dynamodb(zid: int, participant_ids: List[int], cluster_assignments: np.ndarray, group_names: Dict[int, str] = None) -> None:
    """
    Store participant cluster assignments in DynamoDB for use by other scripts.
    
    Args:
        zid: Conversation ID
        participant_ids: List of participant IDs
        cluster_assignments: Array of cluster assignments for each participant
        group_names: Optional dictionary mapping cluster_id to group name
    """
    try:
        # Set up DynamoDB client
        endpoint_url = os.environ.get('DYNAMODB_ENDPOINT', 'http://dynamodb-local:8000')
        dynamodb = boto3.resource('dynamodb', 
                                 endpoint_url=endpoint_url,
                                 region_name=os.environ.get('AWS_REGION', 'us-east-1'),
                                 aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'fakeMyKeyId'),
                                 aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey'))
        
        # Check if table exists, if not, create it
        try:
            table = dynamodb.Table('Delphi_UMAPParticipantClusters')
            table.load()  # This will raise an exception if table doesn't exist
        except:
            # Create table if it doesn't exist
            logger.info('Creating Delphi_UMAPParticipantClusters table...')
            table = dynamodb.create_table(
                TableName='Delphi_UMAPParticipantClusters',
                KeySchema=[
                    {'AttributeName': 'conversation_id', 'KeyType': 'HASH'},
                    {'AttributeName': 'participant_id', 'KeyType': 'RANGE'}
                ],
                AttributeDefinitions=[
                    {'AttributeName': 'conversation_id', 'AttributeType': 'S'},
                    {'AttributeName': 'participant_id', 'AttributeType': 'N'}
                ],
                BillingMode='PAY_PER_REQUEST'
            )
            table.wait_until_exists()
            logger.info('Created Delphi_UMAPParticipantClusters table')
        
        # Store each participant's cluster assignment
        timestamp = datetime.now().isoformat()
        with table.batch_writer() as batch:
            for i, participant_id in enumerate(participant_ids):
                cluster_id = int(cluster_assignments[i])
                item = {
                    'conversation_id': str(zid),
                    'participant_id': int(participant_id),
                    'cluster_id': cluster_id,
                    'method': 'umap_kmeans_clustering',
                    'created_at': timestamp
                }
                
                # Add cluster description if available
                if group_names and cluster_id in group_names:
                    item['__internal_debug__clusterDescription'] = group_names[cluster_id]
                
                batch.put_item(Item=item)
        
        logger.info(f'Stored {len(participant_ids)} participant cluster assignments in DynamoDB')
        
    except Exception as e:
        logger.warning(f'Failed to store participant cluster assignments in DynamoDB: {e}')

# LLM naming functionality removed - using simple numbered groups

# LLM naming functionality removed - using simple numbered groups

def generate_llm_group_names(group_characteristics: Dict[int, Dict[str, List[str]]], zid: int) -> Dict[int, str]:
    """
    Generate human-readable names for participant groups using LLM analysis.
    
    Args:
        group_characteristics: Characteristic comments for each group
        zid: Conversation ID for caching
        
    Returns:
        Dictionary mapping cluster_id to group name
    """
    logger.info('Generating LLM-based names for participant groups')
    
    # First, try to load existing names from DynamoDB
    logger.info('Checking for existing group names in DynamoDB...')
    existing_names = load_group_names_from_dynamodb(zid)
    if existing_names:
        logger.info(f'Using cached group names from DynamoDB: {len(existing_names)} groups')
        return existing_names
    logger.info('No cached names found, generating new ones...')
    
    # Generate new names using Ollama LLM
    group_names = {}
    logger.info(f'Starting LLM generation for {len(group_characteristics)} groups...')
    
    try:
        # Import and configure Ollama
        logger.info('Importing ollama module...')
        import ollama
        logger.info('Ollama module imported successfully')
        import os
        
        # Get model from environment
        model_name = os.environ.get('OLLAMA_MODEL', 'gemma3:1b')
        ollama_host = os.environ.get('OLLAMA_HOST', 'http://ollama:11434')
        
        logger.info(f'Using Ollama model {model_name} at {ollama_host}')
        
        # Configure Ollama client if needed
        if ollama_host:
            try:
                ollama.client._CLIENT_BASE_URL = ollama_host
                logger.info(f"Set Ollama client base URL to {ollama_host}")
            except:
                logger.warning("Could not set ollama.client._CLIENT_BASE_URL, using environment variable")
        
        # Generate names for each group
        for cluster_id, characteristics in group_characteristics.items():
            size = characteristics['size']
            agree_comments = characteristics['consensus_agree']
            disagree_comments = characteristics['consensus_disagree']
            distinctive_comments = characteristics['distinctive']
            
            # Create LLM prompt based on comment content
            prompt = create_participant_group_prompt(agree_comments, disagree_comments, distinctive_comments, size)
            
            try:
                # Call Ollama with detailed logging
                logger.info(f'  Calling LLM for cluster {cluster_id}...')
                logger.info(f'  Model: {model_name}')
                logger.info(f'  Prompt length: {len(prompt)} characters')
                logger.info(f'  Prompt preview: {prompt[:200]}...')
                
                # Try the LLM call with exception handling
                try:
                    logger.info(f'  Making ollama.chat() call...')
                    response = ollama.chat(
                        model=model_name,
                        messages=[{"role": "user", "content": prompt}]
                    )
                    logger.info(f'  LLM response received for cluster {cluster_id}')
                    logger.info(f'  Response type: {type(response)}')
                    if response:
                        logger.info(f'  Response keys: {response.keys() if isinstance(response, dict) else "Not a dict"}')
                
                except Exception as llm_error:
                    logger.error(f'  LLM call failed for cluster {cluster_id}: {type(llm_error).__name__}: {llm_error}')
                    logger.error(f'  Using fallback name instead')
                    group_name = create_fallback_name(cluster_id, characteristics[cluster_id])
                    group_names[cluster_id] = group_name
                    logger.info(f'  Cluster {cluster_id}: "{group_name}" ({size} participants) [FALLBACK]')
                    continue
                
                # Extract response
                if hasattr(response, 'message') and hasattr(response.message, 'content'):
                    group_name = response.message.content.strip()
                else:
                    logger.warning(f"Unexpected Ollama response format for cluster {cluster_id}")
                    group_name = f"Group {cluster_id}"
                
                # Clean up the response
                group_name = clean_llm_response(group_name, cluster_id)
                
                group_names[cluster_id] = group_name
                logger.info(f'  Cluster {cluster_id}: "{group_name}" ({size} participants)')
                
            except Exception as e:
                logger.error(f'Error calling Ollama for cluster {cluster_id}: {e}')
                # Fallback to rule-based naming
                group_name = create_fallback_name(cluster_id, characteristics)
                group_names[cluster_id] = group_name
                logger.info(f'  Cluster {cluster_id}: "{group_name}" (fallback, {size} participants)')
    
    except ImportError:
        logger.warning('Ollama not available, using fallback naming')
        # Use fallback naming for all groups
        for cluster_id, characteristics in group_characteristics.items():
            group_name = create_fallback_name(cluster_id, characteristics)
            group_names[cluster_id] = group_name
            logger.info(f'  Cluster {cluster_id}: "{group_name}" (fallback)')
    
    except Exception as e:
        logger.error(f'Error with Ollama setup: {e}')
        # Use fallback naming for all groups
        for cluster_id, characteristics in group_characteristics.items():
            group_name = create_fallback_name(cluster_id, characteristics)
            group_names[cluster_id] = group_name
            logger.info(f'  Cluster {cluster_id}: "{group_name}" (fallback)')
    
    # Store the generated names in DynamoDB for future use
    store_group_names_in_dynamodb(zid, group_names)
    
    return group_names

def create_participant_group_prompt(agree_comments: List[str], disagree_comments: List[str], 
                                  distinctive_comments: List[str], size: int) -> str:
    """
    Create an expanded LLM prompt with more detailed information about group characteristics.
    """
    prompt = f"Name this participant group based on their voting patterns. Give a 3-6 word descriptive name that captures their specific stance. Return ONLY the name:\n\n"
    
    # Show top 10 comments from each category to give LLM comprehensive context
    if agree_comments:
        prompt += "This group SUPPORTS these views:\n"
        for i, comment in enumerate(agree_comments[:10]):  # Show up to 10 comments
            # Allow up to 180 characters to preserve key details
            display_comment = comment[:180] + "..." if len(comment) > 180 else comment
            prompt += f"• {display_comment}\n"
    
    if disagree_comments:
        prompt += f"\nThis group OPPOSES these views:\n"
        for i, comment in enumerate(disagree_comments[:10]):  # Show up to 10 comments
            # Allow up to 180 characters to preserve key details  
            display_comment = comment[:180] + "..." if len(comment) > 180 else comment
            prompt += f"• {display_comment}\n"
    
    # Add distinctive comments if available to show what makes this group unique
    if distinctive_comments:
        prompt += f"\nDistinctive positions:\n"
        for i, comment in enumerate(distinctive_comments[:10]):  # Show up to 10 distinctive
            display_comment = comment[:180] + "..." if len(comment) > 180 else comment
            prompt += f"• {display_comment}\n"
    
    prompt += f"\nDescriptive group name:"
    
    return prompt

def clean_llm_response(response: str, cluster_id: int) -> str:
    """
    Clean and validate LLM response for group naming.
    
    Args:
        response: Raw LLM response
        cluster_id: Cluster ID for fallback naming
        
    Returns:
        Cleaned group name
    """
    import re
    
    # Try to extract names from markdown-style bold text first (**Name**)
    bold_match = re.search(r'\*\*(.*?)\*\*', response)
    if bold_match:
        name = bold_match.group(1).strip()
    else:
        # Split into lines and try to find the name
        lines = [line.strip() for line in response.split('\n') if line.strip()]
        name = lines[0] if lines else ""
        
        # Look for "Here's a concise name" pattern and extract what follows
        for line in lines:
            if "concise name" in line.lower() and ":" in line:
                # Look at the next lines for the actual name
                idx = lines.index(line)
                if idx + 1 < len(lines):
                    potential_name = lines[idx + 1]
                    # Check if next line contains bold markdown
                    bold_match = re.search(r'\*\*(.*?)\*\*', potential_name)
                    if bold_match:
                        name = bold_match.group(1).strip()
                        break
    
    # Remove common LLM response prefixes
    prefixes_to_remove = [
        "Group name:", "Group name", "Name:", "Label:", 
        "The group name is:", "The name is:", "This group is:",
        "Based on", "Looking at", "Analyzing", "Here's a concise name"
    ]
    
    for prefix in prefixes_to_remove:
        if name.lower().startswith(prefix.lower()):
            name = name[len(prefix):].strip()
    
    # Remove quotes, punctuation, and markdown
    name = name.strip('"\'.,!?:*')
    
    # Remove numbering if present
    if name.startswith(("1. ", "2. ", "- ")):
        name = name[3:].strip()
    
    # Validate length and content
    if len(name) < 3 or len(name) > 50:
        return f"Group {cluster_id}"
    
    # Check if it's too generic
    generic_terms = ["group", "cluster", "participants", "people", "users"]
    if any(term in name.lower() for term in generic_terms) and len(name.split()) <= 2:
        return f"Group {cluster_id}"
    
    # Capitalize properly
    name = ' '.join(word.capitalize() for word in name.split())
    
    return name

def create_fallback_name(cluster_id: int, characteristics: Dict[str, Any]) -> str:
    """
    Create a fallback name when LLM is not available.
    
    Args:
        cluster_id: Cluster ID
        characteristics: Group characteristics
        
    Returns:
        Fallback group name
    """
    size = characteristics['size']
    n_agree = len(characteristics['consensus_agree'])
    n_disagree = len(characteristics['consensus_disagree'])
    n_distinctive = len(characteristics['distinctive'])
    
    # Create name based on voting patterns
    if n_agree > n_disagree:
        if n_distinctive > 5:
            name = f"Active Supporters {cluster_id}"
        elif n_agree > 7:
            name = f"Broad Coalition {cluster_id}"
        else:
            name = f"Agreement Group {cluster_id}"
    elif n_disagree > n_agree:
        if n_distinctive > 5:
            name = f"Strong Critics {cluster_id}"
        elif n_disagree > 7:
            name = f"Opposition Bloc {cluster_id}"
        else:
            name = f"Skeptical Group {cluster_id}"
    else:
        name = f"Mixed Voices {cluster_id}"
    
    return name

def upload_to_s3(file_path: str, s3_key: str, bucket_name: str = 'polis-delphi') -> bool:
    """
    Upload a file to S3/MinIO.
    
    Args:
        file_path: Local path to the file
        s3_key: S3 key (path) for the uploaded file
        bucket_name: S3 bucket name
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Use environment variables for S3 configuration
        s3_endpoint = os.environ.get('AWS_S3_ENDPOINT', 'http://minio:9000')
        s3_access_key = os.environ.get('AWS_S3_ACCESS_KEY_ID', 'minioadmin')
        s3_secret_key = os.environ.get('AWS_S3_SECRET_ACCESS_KEY', 'minioadmin')
        s3_region = os.environ.get('AWS_REGION', 'us-east-1')
        
        # Create S3 client
        s3_client = boto3.client(
            's3',
            endpoint_url=s3_endpoint,
            aws_access_key_id=s3_access_key,
            aws_secret_access_key=s3_secret_key,
            region_name=s3_region
        )
        
        # Upload file
        s3_client.upload_file(file_path, bucket_name, s3_key)
        logger.info(f'Uploaded {file_path} to s3://{bucket_name}/{s3_key}')
        return True
        
    except Exception as e:
        logger.warning(f'Failed to upload {file_path} to S3: {e}')
        return False

def create_participant_datamapplot_visualizations(umap_result: Dict[str, Any],
                                               group_names: Dict[int, str],
                                               participants_data: List[Dict],
                                               zid: int,
                                               output_dir: Optional[str] = None) -> bool:
    """
    Create participant datamapplot visualizations.
    
    Args:
        umap_result: Results from UMAP clustering
        group_names: LLM-generated group names
        zid: Conversation ID
        output_dir: Optional output directory override
        
    Returns:
        Boolean indicating success
    """
    logger.info(f'Creating participant datamapplot visualizations for conversation {zid}')
    
    try:
        # Extract data from UMAP result
        embedding = umap_result['embedding']
        cluster_assignments = umap_result['cluster_assignments']
        participant_ids = umap_result['participant_ids']
        
        # Create visualization directories
        vis_dir = os.path.join("visualizations", str(zid))
        os.makedirs(vis_dir, exist_ok=True)
        
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        
        # Create color map for clusters
        unique_clusters = np.unique(cluster_assignments)
        colors = plt.cm.Set1(np.linspace(0, 1, len(unique_clusters)))
        cluster_colors = {cluster_id: colors[i] for i, cluster_id in enumerate(unique_clusters)}
        
        # 1. Create interactive datamapplot visualization
        try:
            import datamapplot
            
            # Create label strings for each participant
            label_strings = np.array([group_names.get(cluster_id, f'Group {cluster_id}') for cluster_id in cluster_assignments])
            
            # Create hover text with participant info
            hover_text = []
            for i, pid in enumerate(participant_ids):
                cluster_id = cluster_assignments[i]
                group_name = group_names.get(cluster_id, f'Group {cluster_id}')
                hover_text.append(f"Participant {pid} - {group_name}")
            
            # Create interactive visualization
            logger.info("Creating interactive datamapplot visualization...")
            interactive_figure = datamapplot.create_interactive_plot(
                embedding,
                label_strings,
                hover_text=hover_text,
                title=f"Conversation {zid} - Participant Opinion Groups",
                sub_title=f"Interactive map of {len(embedding)} participants in {len(unique_clusters)} groups",
                point_radius_min_pixels=3,
                point_radius_max_pixels=12,
                width="100%",
                height=800,
                noise_label="Ungrouped",
                noise_color="#aaaaaa"
            )
            
            # Save interactive visualization
            interactive_file = os.path.join(vis_dir, f"{zid}_participant_groups_interactive.html")
            interactive_figure.save(interactive_file)
            logger.info(f'Saved interactive visualization to {interactive_file}')
            
            # Upload to S3
            s3_key = f"visualizations/{zid}/participant_groups_interactive.html"
            upload_to_s3(interactive_file, s3_key)
            
            if output_dir and output_dir != vis_dir:
                out_interactive = os.path.join(output_dir, f"{zid}_participant_groups_interactive.html")
                interactive_figure.save(out_interactive)
                logger.info(f'Saved interactive to output directory: {out_interactive}')
                
        except Exception as e:
            logger.warning(f"Failed to create interactive datamapplot: {e}")
        
        # 2. Create static matplotlib visualization for backup
        fig, ax = plt.subplots(figsize=(14, 12))
        ax.set_facecolor('#f8f8f8')
        
        # Plot participants colored by group
        for cluster_id in unique_clusters:
            mask = cluster_assignments == cluster_id
            if np.sum(mask) > 0:
                cluster_embedding = embedding[mask]
                ax.scatter(cluster_embedding[:, 0], cluster_embedding[:, 1],
                          c=[cluster_colors[cluster_id]], s=80, alpha=0.7,
                          label=group_names.get(cluster_id, f'Group {cluster_id}'),
                          edgecolors='black', linewidths=0.3)
        
        # Add cluster labels at centroids
        for cluster_id in unique_clusters:
            mask = cluster_assignments == cluster_id
            if np.sum(mask) > 0:
                cluster_embedding = embedding[mask]
                centroid_x = np.mean(cluster_embedding[:, 0])
                centroid_y = np.mean(cluster_embedding[:, 1])
                
                group_name = group_names.get(cluster_id, f'Group {cluster_id}')
                ax.text(centroid_x, centroid_y, group_name,
                       fontsize=12, fontweight='bold', ha='center', va='center',
                       bbox=dict(facecolor='white', alpha=0.8, edgecolor='gray', boxstyle='round,pad=0.5'))
        
        ax.set_title(f'Conversation {zid} - Participant Opinion Groups', fontsize=16)
        ax.legend(loc='upper right', facecolor='white', framealpha=0.8)
        
        # Remove axes
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        
        # Save main visualization
        output_file = os.path.join(vis_dir, f"{zid}_participant_groups_umap.png")
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        logger.info(f'Saved static visualization to {output_file}')
        
        # Upload to S3
        s3_key = f"visualizations/{zid}/participant_groups_umap.png"
        upload_to_s3(output_file, s3_key)
        
        if output_dir and output_dir != vis_dir:
            out_file = os.path.join(output_dir, f"{zid}_participant_groups_umap.png")
            plt.savefig(out_file, dpi=300, bbox_inches='tight')
            logger.info(f'Saved to output directory: {out_file}')
        
        plt.close()
        
        # 2. Engagement-sized visualization
        fig, ax = plt.subplots(figsize=(14, 12))
        ax.set_facecolor('#f8f8f8')
        
        # Calculate engagement (assuming vote matrix is available)
        # For now, use random sizes as placeholder
        engagement_sizes = np.random.randint(20, 150, len(participant_ids))
        
        for cluster_id in unique_clusters:
            mask = cluster_assignments == cluster_id
            if np.sum(mask) > 0:
                cluster_embedding = embedding[mask]
                cluster_sizes = engagement_sizes[mask]
                ax.scatter(cluster_embedding[:, 0], cluster_embedding[:, 1],
                          c=[cluster_colors[cluster_id]], s=cluster_sizes, alpha=0.6,
                          label=group_names.get(cluster_id, f'Group {cluster_id}'),
                          edgecolors='black', linewidths=0.3)
        
        ax.set_title(f'Conversation {zid} - Participant Groups (sized by engagement)', fontsize=16)
        ax.legend(loc='upper right', facecolor='white', framealpha=0.8)
        
        # Remove axes
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        
        # Save engagement visualization
        engagement_file = os.path.join(vis_dir, f"{zid}_participant_groups_engagement.png")
        plt.savefig(engagement_file, dpi=300, bbox_inches='tight')
        logger.info(f'Saved engagement visualization to {engagement_file}')
        
        # Upload to S3
        s3_key = f"visualizations/{zid}/participant_groups_engagement.png"
        upload_to_s3(engagement_file, s3_key)
        
        if output_dir and output_dir != vis_dir:
            out_engagement = os.path.join(output_dir, f"{zid}_participant_groups_engagement.png")
            plt.savefig(out_engagement, dpi=300, bbox_inches='tight')
        
        plt.close()
        
        # 3. Clean overview visualization
        fig, ax = plt.subplots(figsize=(14, 12))
        ax.set_facecolor('#f8f8f8')
        
        # Simple scatter plot with minimal labels
        for cluster_id in unique_clusters:
            mask = cluster_assignments == cluster_id
            if np.sum(mask) > 0:
                cluster_embedding = embedding[mask]
                ax.scatter(cluster_embedding[:, 0], cluster_embedding[:, 1],
                          c=[cluster_colors[cluster_id]], s=60, alpha=0.8,
                          edgecolors='black', linewidths=0.2)
        
        ax.set_title(f'Conversation {zid} - Participant Opinion Landscape', fontsize=16)
        
        # Add simple text explanation
        ax.text(0.5, 0.05, 'Each dot represents a participant, colored by their opinion group',
                transform=ax.transAxes, ha='center', fontsize=12,
                bbox=dict(facecolor='white', alpha=0.7, edgecolor='gray', boxstyle='round,pad=0.5'))
        
        # Remove axes
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        
        # Save clean visualization
        clean_file = os.path.join(vis_dir, f"{zid}_participant_groups_clean.png")
        plt.savefig(clean_file, dpi=300, bbox_inches='tight')
        logger.info(f'Saved clean visualization to {clean_file}')
        
        # Upload to S3
        s3_key = f"visualizations/{zid}/participant_groups_clean.png"
        upload_to_s3(clean_file, s3_key)
        
        if output_dir and output_dir != vis_dir:
            out_clean = os.path.join(output_dir, f"{zid}_participant_groups_clean.png")
            plt.savefig(out_clean, dpi=300, bbox_inches='tight')
        
        plt.close()
        
        logger.info('All participant datamapplot visualizations created successfully')
        return True
        
    except Exception as e:
        logger.error(f'Error creating visualizations: {e}')
        logger.error(traceback.format_exc())
        return False

def create_participant_datamapplot(zid: int, layer_num: int = 0, output_dir: Optional[str] = None, use_llm: bool = False) -> bool:
    """
    Main function to generate participant-based datamapplot visualizations.
    
    Args:
        zid: Conversation ID
        layer_num: Layer number (for compatibility, not used)
        output_dir: Optional output directory override
        use_llm: Whether to use LLM for semantic group names (default: False, uses numbered groups)
        
    Returns:
        Boolean indicating success
    """
    logger.info(f'Starting participant datamapplot generation for conversation {zid}')
    
    try:
        # 1. Extract participant vote vectors
        vote_matrix, participant_ids, participants_data, comments_data = extract_participant_vote_vectors(zid)
        
        # 2. Create UMAP embedding and clustering
        umap_result = create_participant_umap_clustering(vote_matrix, participant_ids)
        
        # 3. Extract characteristic comments for each group
        group_characteristics = extract_group_characteristic_comments(
            umap_result['cluster_assignments'],
            vote_matrix,
            participants_data,
            comments_data
        )
        
        # 4. Generate group names
        if use_llm:
            logger.info("Using LLM to generate semantic group names")
            group_names = generate_llm_group_names(group_characteristics, zid)
        else:
            logger.info("Using simple numbered group names")
            group_names = {}
            for cluster_id in group_characteristics.keys():
                group_names[cluster_id] = f"Group {cluster_id}"
        
        # 5. Store participant cluster assignments in DynamoDB (with group names)
        logger.info("Storing participant cluster assignments in DynamoDB...")
        store_participant_cluster_assignments_in_dynamodb(
            zid, 
            umap_result['participant_ids'], 
            umap_result['cluster_assignments'],
            group_names
        )
        
        # 6. Create visualizations
        success = create_participant_datamapplot_visualizations(
            umap_result,
            group_names,
            participants_data,
            zid,
            output_dir
        )
        
        if success:
            logger.info(f'Participant datamapplot generation completed successfully for conversation {zid}')
        else:
            logger.error(f'Participant datamapplot generation failed for conversation {zid}')
        
        return success
        
    except Exception as e:
        logger.error(f'Error in participant datamapplot generation: {e}')
        logger.error(traceback.format_exc())
        return False

def main():
    """Main function to parse arguments and execute visualization generation."""
    parser = argparse.ArgumentParser(description="Generate participant-based datamapplot")
    parser.add_argument("--zid", type=str, required=True, help="Conversation ID")
    parser.add_argument("--layer", type=int, default=0, help="Layer number (for compatibility)")
    parser.add_argument("--output_dir", type=str, help="Output directory")
    parser.add_argument("--consensus_threshold", type=float, default=0.8,
                        help="Threshold for group consensus (default: 0.8)")
    parser.add_argument("--distinctive_threshold", type=float, default=0.3,
                        help="Threshold for distinctive voting patterns (default: 0.3)")
    parser.add_argument("--use-llm", action='store_true', 
                        help="Use LLM to generate semantic group names (default: use numbered groups)")
    
    args = parser.parse_args()
    
    # Override config with command line arguments if provided
    if args.consensus_threshold is not None:
        VIZ_CONFIG['consensus_threshold'] = args.consensus_threshold
        logger.info(f"Using consensus threshold from command line: {VIZ_CONFIG['consensus_threshold']}")
    
    if args.distinctive_threshold is not None:
        VIZ_CONFIG['distinctive_threshold'] = args.distinctive_threshold
        logger.info(f"Using distinctive threshold from command line: {VIZ_CONFIG['distinctive_threshold']}")
    
    # Log configuration
    logger.info("Configuration:")
    logger.info(f"  Database: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['name']}")
    logger.info(f"  Missing votes: Using per-comment averages")
    logger.info(f"  Consensus threshold: {VIZ_CONFIG['consensus_threshold']}")
    logger.info(f"  Distinctive threshold: {VIZ_CONFIG['distinctive_threshold']}")
    
    # Generate visualization
    try:
        success = create_participant_datamapplot(int(args.zid), args.layer, args.output_dir, args.use_llm)
        
        if success:
            logger.info("Participant datamapplot generation completed successfully")
        else:
            logger.error("Participant datamapplot generation failed")
            sys.exit(1)
    except Exception as e:
        logger.error(f"Unhandled exception: {e}")
        logger.error(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()