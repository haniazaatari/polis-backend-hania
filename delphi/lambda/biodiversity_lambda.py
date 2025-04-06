"""
AWS Lambda function to process the biodiversity dataset using the Python math implementation.

This module can be used as a Lambda function to process a Pol.is conversation
with vote data stored in a PostgreSQL database and write the results to DynamoDB.
"""

import os
import sys
import json
import time
import boto3
import psycopg2
from psycopg2 import extras
from datetime import datetime

# Add parent directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Import the polismath modules
from polismath.conversation.conversation import Conversation
from polismath.database.postgres import PostgresClient, PostgresConfig

def connect_to_db(config):
    """Connect to PostgreSQL database using config from environment variables."""
    try:
        conn = psycopg2.connect(
            dbname=config.get('db_name', 'polis'),
            user=config.get('db_user', 'postgres'),
            password=config.get('db_password', ''),
            host=config.get('db_host', 'localhost'),
            port=config.get('db_port', 5432)
        )
        print("Connected to database successfully")
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def init_dynamodb(config):
    """Initialize a connection to DynamoDB."""
    print("Initializing DynamoDB connection")
    
    # Determine if we should use a local endpoint (for development) or AWS
    use_local = config.get('use_local_dynamo', 'false').lower() == 'true'
    endpoint_url = config.get('dynamo_endpoint', 'http://localhost:8000') if use_local else None
    
    dynamo_kwargs = {
        'region_name': config.get('aws_region', 'us-west-2')
    }
    
    # Add local development settings if needed
    if use_local:
        dynamo_kwargs['endpoint_url'] = endpoint_url
        dynamo_kwargs['aws_access_key_id'] = 'dummy'
        dynamo_kwargs['aws_secret_access_key'] = 'dummy'
    
    # Create DynamoDB resource
    dynamodb = boto3.resource('dynamodb', **dynamo_kwargs)
    
    # Get table names
    math_table_name = config.get('math_table_name', 'polis_math')
    conv_table_name = config.get('conv_table_name', 'polis_conversations')
    
    # Check if tables exist, otherwise create them
    tables = list(dynamodb.tables.all())
    table_names = [table.name for table in tables]
    
    # Create conversations table if it doesn't exist
    if conv_table_name not in table_names:
        print(f"Creating {conv_table_name} table")
        conversations_table = dynamodb.create_table(
            TableName=conv_table_name,
            KeySchema=[
                {'AttributeName': 'zid', 'KeyType': 'HASH'}  # Partition key
            ],
            AttributeDefinitions=[
                {'AttributeName': 'zid', 'AttributeType': 'S'}
            ],
            ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
        )
        # Wait for table creation
        conversations_table.meta.client.get_waiter('table_exists').wait(TableName=conv_table_name)
        print(f"{conv_table_name} table created")
    else:
        conversations_table = dynamodb.Table(conv_table_name)
        print(f"Using existing {conv_table_name} table")
    
    # Create math table if it doesn't exist
    if math_table_name not in table_names:
        print(f"Creating {math_table_name} table")
        math_table = dynamodb.create_table(
            TableName=math_table_name,
            KeySchema=[
                {'AttributeName': 'zid', 'KeyType': 'HASH'}  # Partition key
            ],
            AttributeDefinitions=[
                {'AttributeName': 'zid', 'AttributeType': 'S'}
            ],
            ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
        )
        # Wait for table creation
        math_table.meta.client.get_waiter('table_exists').wait(TableName=math_table_name)
        print(f"{math_table_name} table created")
    else:
        math_table = dynamodb.Table(math_table_name)
        print(f"Using existing {math_table_name} table")
    
    return {
        'dynamodb': dynamodb,
        'conversations_table': conversations_table,
        'math_table': math_table
    }

def write_to_dynamodb(dynamodb_resources, conversation_id, conv_data):
    """Write conversation data to DynamoDB."""
    math_table = dynamodb_resources['math_table']
    conversations_table = dynamodb_resources['conversations_table']
    
    try:
        print(f"Writing conversation {conversation_id} to DynamoDB")
        
        # Prepare math data record (serialized version for DynamoDB)
        math_json = json.dumps(conv_data)
        
        # Put math data
        math_table.put_item(
            Item={
                'zid': str(conversation_id),
                'math_data': math_json,
                'last_updated': int(time.time())
            }
        )
        print(f"Math data written to DynamoDB for conversation {conversation_id}")
        
        # Create a summary record for the conversations table
        summary = {
            'zid': str(conversation_id),
            'participant_count': conv_data.get('n', 0),
            'comment_count': conv_data.get('n-cmts', 0),
            'group_count': len(conv_data.get('group-clusters', [])),
            'last_updated': int(time.time())
        }
        
        # Put conversation summary
        conversations_table.put_item(Item=summary)
        print(f"Conversation summary written to DynamoDB for conversation {conversation_id}")
        
        return True
    except Exception as e:
        print(f"Error writing to DynamoDB: {e}")
        return False

def fetch_votes(conn, conversation_id, limit=0):
    """Fetch votes for a specific conversation from PostgreSQL."""
    start_time = time.time()
    
    print(f"[{start_time:.2f}s] Fetching votes for conversation {conversation_id}")
    cursor = conn.cursor(cursor_factory=extras.DictCursor)
    
    query = """
    SELECT 
        v.created as timestamp,
        v.tid as comment_id,
        v.pid as voter_id,
        v.vote
    FROM 
        votes v
    WHERE
        v.zid = %s
    ORDER BY 
        v.created
    """
    
    if limit > 0:
        query += " LIMIT %s"
        args = (conversation_id, limit)
    else:
        args = (conversation_id,)
    
    try:
        print(f"[{time.time() - start_time:.2f}s] Starting vote query execution...")
        cursor.execute(query, args)
        print(f"[{time.time() - start_time:.2f}s] Query executed, beginning fetch of all votes...")
        
        # Fetch in batches to show progress
        votes = []
        batch_size = 10000
        
        while True:
            fetch_start = time.time()
            batch = cursor.fetchmany(batch_size)
            if not batch:
                break
            votes.extend(batch)
            print(f"[{time.time() - start_time:.2f}s] Fetched batch of {len(batch)} votes, total now: {len(votes)}")
        
        print(f"[{time.time() - start_time:.2f}s] All votes fetched: {len(votes)} total")
        cursor.close()
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error fetching votes: {e}")
        cursor.close()
        return {'votes': []}
    
    # Convert to the format expected by the Conversation class
    print(f"[{time.time() - start_time:.2f}s] Converting {len(votes)} votes to internal format...")
    convert_start = time.time()
    votes_list = []
    
    # Process in batches
    batch_size = 50000
    for i in range(0, len(votes), batch_size):
        end_idx = min(i + batch_size, len(votes))
        batch = votes[i:end_idx]
        
        batch_votes = []
        for vote in batch:
            # Handle timestamp
            if vote['timestamp']:
                try:
                    created_time = int(float(vote['timestamp']) * 1000)
                except (ValueError, TypeError):
                    created_time = None
            else:
                created_time = None
                
            batch_votes.append({
                'pid': str(vote['voter_id']),
                'tid': str(vote['comment_id']),
                'vote': float(vote['vote']),
                'created': created_time
            })
        
        votes_list.extend(batch_votes)
        print(f"[{time.time() - start_time:.2f}s] Converted batch of {len(batch)} votes ({i+1}-{end_idx}/{len(votes)})")
    
    print(f"[{time.time() - start_time:.2f}s] Vote conversion completed in {time.time() - convert_start:.2f}s")
    
    # Pack into the expected votes format
    result = {
        'votes': votes_list
    }
    
    print(f"[{time.time() - start_time:.2f}s] Vote processing completed in {time.time() - start_time:.2f}s")
    return result

def fetch_moderation(conn, conversation_id):
    """Fetch moderation data for a specific conversation from PostgreSQL."""
    start_time = time.time()
    
    print(f"[{start_time:.2f}s] Fetching moderation data for conversation {conversation_id}")
    cursor = conn.cursor(cursor_factory=extras.DictCursor)
    
    try:
        # Query moderated comments
        query_mod_comments = """
        SELECT
            tid,
            mod,
            is_meta
        FROM
            comments
        WHERE
            zid = %s
        """
        cursor.execute(query_mod_comments, (conversation_id,))
        mod_comments = cursor.fetchall()
        print(f"[{time.time() - start_time:.2f}s] Fetched {len(mod_comments)} comment moderation records")
        
        # Check if participants table exists
        table_check = """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'participants'
        )
        """
        cursor.execute(table_check)
        table_exists = cursor.fetchone()[0]
        
        mod_ptpts = []
        if table_exists:
            # Query moderated participants
            query_mod_ptpts = """
            SELECT
                pid
            FROM
                participants
            WHERE
                zid = %s AND
                mod = '-1'
            """
            cursor.execute(query_mod_ptpts, (conversation_id,))
            mod_ptpts = cursor.fetchall()
            print(f"[{time.time() - start_time:.2f}s] Fetched {len(mod_ptpts)} participant moderation records")
        else:
            print(f"[{time.time() - start_time:.2f}s] Participants table does not exist, skipping")
            
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error fetching moderation data: {e}")
        cursor.close()
        return {
            'mod_out_tids': [],
            'mod_in_tids': [],
            'meta_tids': [],
            'mod_out_ptpts': []
        }
        
    cursor.close()
    
    # Format moderation data
    mod_out_tids = [str(c['tid']) for c in mod_comments if c['mod'] == '-1']
    mod_in_tids = [str(c['tid']) for c in mod_comments if c['mod'] == '1']
    meta_tids = [str(c['tid']) for c in mod_comments if c['is_meta']]
    mod_out_ptpts = [str(p['pid']) for p in mod_ptpts]
    
    print(f"[{time.time() - start_time:.2f}s] Moderation stats: {len(mod_out_tids)} excluded comments, {len(mod_in_tids)} featured comments")
    
    result = {
        'mod_out_tids': mod_out_tids,
        'mod_in_tids': mod_in_tids,
        'meta_tids': meta_tids,
        'mod_out_ptpts': mod_out_ptpts
    }
    
    return result

def process_conversation(conn, config, conversation_id, vote_limit=0):
    """Process a single conversation and save results to DynamoDB."""
    start_time = time.time()
    
    print(f"[{time.time() - start_time:.2f}s] Processing conversation {conversation_id}")
    
    # Create a new conversation
    print(f"[{time.time() - start_time:.2f}s] Creating conversation object")
    conv = Conversation(str(conversation_id))
    
    # Fetch votes
    print(f"[{time.time() - start_time:.2f}s] Starting vote retrieval...")
    votes = fetch_votes(conn, conversation_id, vote_limit)
    print(f"[{time.time() - start_time:.2f}s] Retrieved {len(votes['votes'])} votes")
    
    # Fetch moderation
    print(f"[{time.time() - start_time:.2f}s] Starting moderation retrieval...")
    moderation = fetch_moderation(conn, conversation_id)
    print(f"[{time.time() - start_time:.2f}s] Retrieved moderation data")
    
    # Update conversation with votes
    print(f"[{time.time() - start_time:.2f}s] Adding votes to conversation...")
    conv = conv.update_votes(votes, recompute=False)  # Don't recompute yet
    
    # Apply moderation
    print(f"[{time.time() - start_time:.2f}s] Applying moderation settings...")
    conv = conv.update_moderation(moderation, recompute=False)  # Don't recompute yet
    
    # Recompute to generate clustering, PCA, and representativeness
    print(f"[{time.time() - start_time:.2f}s] Starting full recomputation...")
    recompute_start = time.time()
    
    # Break down the recomputation steps for better tracking
    print(f"[{time.time() - start_time:.2f}s] 1. Computing PCA...")
    try:
        conv._compute_pca()
        print(f"[{time.time() - start_time:.2f}s] PCA completed in {time.time() - recompute_start:.2f}s")
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error in PCA computation: {e}")
    
    print(f"[{time.time() - start_time:.2f}s] 2. Computing clusters...")
    cluster_time = time.time()
    try:
        conv._compute_clusters()
        print(f"[{time.time() - start_time:.2f}s] Clustering completed in {time.time() - cluster_time:.2f}s")
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error in clustering computation: {e}")
    
    print(f"[{time.time() - start_time:.2f}s] 3. Computing representativeness...")
    repness_time = time.time()
    try:
        conv._compute_repness()
        print(f"[{time.time() - start_time:.2f}s] Representativeness completed in {time.time() - repness_time:.2f}s")
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error in representativeness computation: {e}")
    
    print(f"[{time.time() - start_time:.2f}s] 4. Computing participant info...")
    ptptinfo_time = time.time()
    try:
        conv._compute_participant_info()
        print(f"[{time.time() - start_time:.2f}s] Participant info completed in {time.time() - ptptinfo_time:.2f}s")
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error in participant info computation: {e}")
    
    print(f"[{time.time() - start_time:.2f}s] All recomputations completed")
    
    # Extract key metrics
    group_count = len(conv.group_clusters)
    comment_count = conv.comment_count
    participant_count = conv.participant_count
    
    print(f"[{time.time() - start_time:.2f}s] Results: {group_count} groups, {comment_count} comments, {participant_count} participants")
    
    # Save to DynamoDB
    try:
        print(f"[{time.time() - start_time:.2f}s] Initializing DynamoDB connection...")
        dynamodb_resources = init_dynamodb(config)
        
        print(f"[{time.time() - start_time:.2f}s] Writing to DynamoDB...")
        conv_data = conv.to_dict()
        success = write_to_dynamodb(dynamodb_resources, conversation_id, conv_data)
        if success:
            print(f"[{time.time() - start_time:.2f}s] Successfully wrote results to DynamoDB")
        else:
            print(f"[{time.time() - start_time:.2f}s] Failed to write results to DynamoDB")
    except Exception as e:
        print(f"[{time.time() - start_time:.2f}s] Error with DynamoDB: {e}")
    
    total_time = time.time() - start_time
    print(f"[{time.time() - start_time:.2f}s] Conversation processing completed in {total_time:.2f} seconds")
    
    return {
        'conversation_id': str(conversation_id),
        'processing_time': total_time,
        'groups': group_count,
        'comments': comment_count,
        'participants': participant_count,
        'success': True
    }

def get_biodiversity_conversation_id(conn):
    """Attempt to find the biodiversity conversation in the database."""
    try:
        cursor = conn.cursor(cursor_factory=extras.DictCursor)
        
        # Try to find the biodiversity conversation by name if the zinvites table exists
        cursor.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'zinvites'
        )
        """)
        zinvites_exists = cursor.fetchone()[0]
        
        if zinvites_exists:
            # First try to find by keyword 'biodiversity' in the zinvite
            cursor.execute("""
            SELECT z.zid, z.zinvite, COUNT(v.tid) as vote_count
            FROM zinvites z
            LEFT JOIN votes v ON z.zid = v.zid
            WHERE z.zinvite ILIKE '%biodiversity%'
            GROUP BY z.zid, z.zinvite
            ORDER BY vote_count DESC
            LIMIT 1
            """)
            result = cursor.fetchone()
            
            if result:
                return result['zid'], result['vote_count'], result['zinvite']
                
            # If not found, try with conversations table if it exists
            cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'conversations'
            )
            """)
            conversations_exists = cursor.fetchone()[0]
            
            if conversations_exists:
                cursor.execute("""
                SELECT c.zid, z.zinvite, COUNT(v.tid) as vote_count
                FROM conversations c
                JOIN zinvites z ON c.zid = z.zid
                LEFT JOIN votes v ON c.zid = v.zid
                WHERE c.topic ILIKE '%biodiversity%' OR c.description ILIKE '%biodiversity%'
                GROUP BY c.zid, z.zinvite
                ORDER BY vote_count DESC
                LIMIT 1
                """)
                result = cursor.fetchone()
                
                if result:
                    return result['zid'], result['vote_count'], result['zinvite']
        
        # Fallback to most popular conversation
        cursor.execute("""
        SELECT v.zid, COUNT(*) as vote_count
        FROM votes v
        GROUP BY v.zid
        ORDER BY vote_count DESC
        LIMIT 1
        """)
        result = cursor.fetchone()
        
        if result:
            # If we have zinvites, get the zinvite
            if zinvites_exists:
                cursor.execute("SELECT zinvite FROM zinvites WHERE zid = %s", (result['zid'],))
                zinvite_result = cursor.fetchone()
                zinvite = zinvite_result['zinvite'] if zinvite_result else str(result['zid'])
            else:
                zinvite = str(result['zid'])
                
            return result['zid'], result['vote_count'], zinvite
            
        # If all else fails, return a hardcoded ID (the biodiversity ID, if known)
        return "3atycmhmer", 0, "3atycmhmer"
        
    except Exception as e:
        print(f"Error finding biodiversity conversation: {e}")
        # Return a hardcoded ID as a last resort
        return "3atycmhmer", 0, "3atycmhmer"

def lambda_handler(event, context):
    """
    AWS Lambda handler function.
    
    Parameters:
    - event: Lambda event object
    - context: Lambda context object
    
    Returns:
    - JSON response with processing results
    """
    start_time = time.time()
    
    # Extract configuration from event or use defaults
    config = event.get('config', {})
    conversation_id = event.get('conversation_id', None)
    vote_limit = int(event.get('vote_limit', 0))
    
    # Try to get database credentials from environment if not in config
    if 'db_host' not in config and 'DB_HOST' in os.environ:
        config['db_host'] = os.environ['DB_HOST']
    if 'db_name' not in config and 'DB_NAME' in os.environ:
        config['db_name'] = os.environ['DB_NAME']
    if 'db_user' not in config and 'DB_USER' in os.environ:
        config['db_user'] = os.environ['DB_USER']
    if 'db_password' not in config and 'DB_PASSWORD' in os.environ:
        config['db_password'] = os.environ['DB_PASSWORD']
    if 'db_port' not in config and 'DB_PORT' in os.environ:
        config['db_port'] = os.environ['DB_PORT']
    
    try:
        # Connect to database
        print(f"[{time.time() - start_time:.2f}s] Connecting to database...")
        conn = connect_to_db(config)
        if not conn:
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'message': 'Failed to connect to database',
                    'error': 'Database connection error'
                })
            }
        
        # Find conversation ID if not provided
        if conversation_id is None:
            # Try to find the biodiversity conversation
            print(f"[{time.time() - start_time:.2f}s] Looking for biodiversity conversation...")
            conversation_id, vote_count, zinvite = get_biodiversity_conversation_id(conn)
            print(f"[{time.time() - start_time:.2f}s] Found conversation {conversation_id} (zinvite: {zinvite}) with {vote_count} votes")
        
        # Process the conversation
        result = process_conversation(conn, config, conversation_id, vote_limit)
        
        # Close the database connection
        conn.close()
        
        # Return success result
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    
    except Exception as e:
        # Log the error
        print(f"[{time.time() - start_time:.2f}s] Error in lambda_handler: {e}")
        import traceback
        traceback.print_exc()
        
        # Return error result
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Error processing request',
                'error': str(e)
            })
        }

# For local testing
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Process a Polis conversation and save to DynamoDB.')
    parser.add_argument('--conversation-id', help='Conversation ID to process')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of votes to process (0 for all)')
    parser.add_argument('--db-host', default='localhost', help='Database host')
    parser.add_argument('--db-name', default='polis_subset', help='Database name')
    parser.add_argument('--db-user', default='christian', help='Database user')
    parser.add_argument('--db-password', default='christian', help='Database password')
    parser.add_argument('--db-port', default=5432, type=int, help='Database port')
    parser.add_argument('--local-dynamo', action='store_true', help='Use local DynamoDB')
    parser.add_argument('--dynamo-endpoint', default='http://localhost:8000', help='DynamoDB endpoint URL')
    
    args = parser.parse_args()
    
    # Create event from arguments
    event = {
        'config': {
            'db_host': args.db_host,
            'db_name': args.db_name,
            'db_user': args.db_user,
            'db_password': args.db_password,
            'db_port': args.db_port,
            'use_local_dynamo': 'true' if args.local_dynamo else 'false',
            'dynamo_endpoint': args.dynamo_endpoint
        },
        'conversation_id': args.conversation_id,
        'vote_limit': args.limit
    }
    
    # Call the lambda handler
    result = lambda_handler(event, None)
    print(json.dumps(result, indent=2))