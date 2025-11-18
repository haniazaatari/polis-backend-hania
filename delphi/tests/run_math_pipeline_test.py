import os
import time
import pytest
import boto3
import csv
import decimal
from unittest import mock
import sys  # Import sys
import re # Import re for parsing SQL

# Add the project root (parent directory of 'tests') to the Python path
# This allows Pylance and local pytest runs to find 'run_math_pipeline'
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Import the main function from the script we want to test
from run_math_pipeline import main as run_math_pipeline_main

# --- Define Mock Data Paths ---
# FIX: Corrected path inside the container. The 'delphi' part is removed
# because docker cp maps 'delphi/real_data' to '/app/real_data'.
MOCK_DATA_DIR = os.path.join(project_root, "real_data", "r4tykwac8thvzv35jrn53")
# These filenames are based on the user's screenshots
COMMENTS_FILE = os.path.join(MOCK_DATA_DIR, "2025-11-11-1704-r4tykwac8thvzv35jrn53-comments.csv")
VOTES_FILE = os.path.join(MOCK_DATA_DIR, "2025-11-11-1704-r4tykwac8thvzv35jrn53-votes.csv")
MOCK_ZID = 123456789 # We can use our own ZID for the test

# --- Fixtures to Set Up Test Environment ---

@pytest.fixture(scope="module")
def dynamodb_resource():
    """Create a resource connection to the test DynamoDB."""
    endpoint_url = os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')
    if not endpoint_url:
        pytest.fail("DYNAMODB_ENDPOINT not set. Cannot connect to test DynamoDB.")
        
    return boto3.resource(
        'dynamodb',
        endpoint_url=endpoint_url,
        region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID', 'dummy'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY', 'dummy')
    )

def parse_csv_to_dicts(filepath):
    """Helper to read CSV data."""
    if not os.path.exists(filepath):
        # Use pytest.skip to signal that the test should be skipped if data is missing
        pytest.skip(f"Mock data file not found: {filepath}. Skipping test.")
    
    data = []
    # FIX: Open with encoding='utf-8-sig' to handle potential BOM (Byte Order Mark)
    # at the start of the CSV file, which can corrupt the first header name.
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append(row)
    return data

@pytest.fixture(scope="module")
def mock_comments_data():
    """Loads mock comments from CSV and formats them as fetch_comments would."""
    comments_csv = parse_csv_to_dicts(COMMENTS_FILE)
    comments_list = []
    for comment in comments_csv:
        # Assuming 'moderated' column: 0=neutral, -1=rejected
        if comment.get('moderated') == '-1':
            continue
        
        try:
            created_time = int(decimal.Decimal(comment['timestamp']) * 1000)
        except (ValueError, TypeError, decimal.InvalidOperation):
            created_time = None

        comments_list.append({
            # FIX: Changed to 'comment-id' to match the CSV header
            'tid': str(comment['comment-id']),
            'created': created_time,
            # FIX: Changed to 'comment-body' to match the CSV header
            'txt': comment['comment-body'],
            'is_seed': bool(comment.get('is_seed', 'false').lower() == 'true')
        })
    return {'comments': comments_list}

@pytest.fixture(scope="module")
def mock_votes_data():
    """Loads mock votes from CSV and formats them for fetch_votes AND raw batching."""
    votes_csv = parse_csv_to_dicts(VOTES_FILE)
    votes_list_dicts = []
    votes_list_tuples = [] # For the raw cursor.fetchall() mock
    
    for vote in votes_csv:
        try:
            created_time_float = float(vote['timestamp'])
            created_time_int = int(created_time_float * 1000)
        except (ValueError, TypeError):
            created_time_float = None
            created_time_int = None

        # For Conversation.update_votes()
        votes_list_dicts.append({
            # FIX: Changed to 'voter-id' to match CSV header
            'pid': str(vote['voter-id']),
            # FIX: Changed to 'comment-id' to match CSV header
            'tid': str(vote['comment-id']),
            'vote': float(vote['vote']),
            'created': created_time_int
        })
        
        # For cursor.fetchall()
        # Format: (created, tid, pid, vote)
        votes_list_tuples.append((
            created_time_float,
            # FIX: Changed to 'comment-id' to match CSV header
            int(vote['comment-id']),
            # FIX: Changed to 'voter-id' to match CSV header
            int(vote['voter-id']),
            float(vote['vote'])
        ))
    
    # Sort by created timestamp, as the script's query does
    votes_list_tuples.sort(key=lambda x: x[0] if x[0] is not None else 0)
    
    return {
        'votes_dicts': {'votes': votes_list_dicts},
        'votes_tuples': votes_list_tuples
    }

@pytest.fixture(scope="module")
def mock_moderation_data():
    """Provides mock moderation data."""
    # We can enhance this if moderation CSVs become available
    return {
        'mod_out_tids': [],
        'mod_in_tids': [],
        'meta_tids': [],
        'mod_out_ptpts': []
    }

# --- The Test Function ---

@mock.patch('psycopg2.connect')
def test_run_math_pipeline_e2e(mock_connect, dynamodb_resource, mock_comments_data, mock_votes_data, mock_moderation_data):
    """
    Runs the entire math pipeline script, mocking all database calls
    and checking DynamoDB for results.
    """
    zid = MOCK_ZID
    votes_tuples = mock_votes_data['votes_tuples']
    total_votes = len(votes_tuples)

    # --- Setup Mocks ---
    
    # Create mock cursor and connection
    mock_cursor = mock.Mock()
    mock_connection = mock.Mock()
    mock_connection.cursor.return_value = mock_cursor
    mock_connect.return_value = mock_connection
    
    # This will store the results of execute calls
    sql_results = {}
    
    # Define the behavior of the mock cursor
    def mock_execute(sql, params=None):
        sql = sql.strip()
        # 1. Mock COUNT(*) query
        if "SELECT COUNT(*) FROM votes" in sql:
            sql_results['last'] = 'count'
        
        # 2. Mock batched SELECT from votes
        elif "SELECT v.created, v.tid, v.pid, v.vote FROM votes" in sql:
            sql_results['last'] = 'batch'
            # Extract LIMIT and OFFSET
            limit_match = re.search(r'LIMIT (\d+)', sql)
            offset_match = re.search(r'OFFSET (\d+)', sql)
            
            limit = int(limit_match.group(1)) if limit_match else None
            offset = int(offset_match.group(1)) if offset_match else 0
            
            if limit:
                sql_results['batch_data'] = votes_tuples[offset : offset + limit]
            else:
                sql_results['batch_data'] = votes_tuples[offset:]
        
        # 3. Mock moderation (participants)
        elif "FROM participants WHERE" in sql:
            sql_results['last'] = 'mod_ptpts'
        
        # 4. Mock moderation (comments)
        elif "FROM comments WHERE" in sql:
            sql_results['last'] = 'mod_comments'
        
        # 5. Mock check for participants table
        elif "information_schema.tables" in sql:
             sql_results['last'] = 'table_check'
             
        else:
            sql_results['last'] = 'other'

    def mock_fetchone():
        if sql_results.get('last') == 'count':
            return (total_votes,)
        if sql_results.get('last') == 'table_check':
            return (True,)
        return None

    def mock_fetchall():
        if sql_results.get('last') == 'batch':
            return sql_results.get('batch_data', [])
        if sql_results.get('last') == 'mod_ptpts':
            return [] # No moderated participants
        if sql_results.get('last') == 'mod_comments':
            return [] # No moderated/meta comments
        return []

    mock_cursor.execute.side_effect = mock_execute
    mock_cursor.fetchone.side_effect = mock_fetchone
    mock_cursor.fetchall.side_effect = mock_fetchall

    # --- Mock the helper functions ---
    # The script uses these *before* the batching logic
    with mock.patch('run_math_pipeline.fetch_comments', return_value=mock_comments_data), \
         mock.patch('run_math_pipeline.fetch_moderation', return_value=mock_moderation_data):
        
        # 1. Mock command-line arguments
        test_args = [
            "run_math_pipeline.py",
            "--zid", str(zid),
            "--batch-size", "20000", # Use a reasonable batch size
        ]
        
        with mock.patch.object(sys, 'argv', test_args):
            # 2. Run the main function
            try:
                run_math_pipeline_main()
            except SystemExit as e:
                pytest.fail(f"run_math_pipeline.py exited unexpectedly: {e}")

    # 3. Verify results were written to DynamoDB
    
    # Define the static keys used for conversation-wide data
    # We must assume a default math_tick of 0, as the script doesn't set one
    MOCK_MATH_TICK = 0
    ZID_TICK = f"{zid}_{MOCK_MATH_TICK}"

    # Check for PCA results
    pca_table = dynamodb_resource.Table("Delphi_PCAResults")
    # FIX: Use composite key (zid, math_tick) from schema
    pca_item = pca_table.get_item(Key={'zid': str(zid), 'math_tick': MOCK_MATH_TICK}).get('Item')
    assert pca_item is not None, f"PCAResults item was not created in DynamoDB (Key: {zid}, {MOCK_MATH_TICK})"
    assert 'pca_matrix' in pca_item, "pca_matrix not in PCAResults"
    assert len(pca_item['pca_matrix']) == len(mock_comments_data['comments'])
    
    # Check for K-Means clusters
    kmeans_table = dynamodb_resource.Table("Delphi_KMeansClusters")
    # FIX: Use composite key (zid_tick, group_id). We must query, not get_item.
    response = kmeans_table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key('zid_tick').eq(ZID_TICK)
    )
    assert response['Count'] > 0, f"KMeansClusters items were not created in DynamoDB (Key: {ZID_TICK})"
    kmeans_item = response['Items'][0] # Just check the first item
    assert 'clusters' in kmeans_item, "clusters not in KMeansClusters"
    assert len(kmeans_item['clusters']) > 0, "No clusters were generated"

    # Check for Representative Comments
    repness_table = dynamodb_resource.Table("Delphi_RepresentativeComments")
    # FIX: Use GSI 'zid-index' to query. The primary key (zid_tick_gid) is too complex.
    response = repness_table.query(
        IndexName='zid-index',
        KeyConditionExpression=boto3.dynamodb.conditions.Key('zid').eq(str(zid))
    )
    assert response['Count'] > 0, f"RepresentativeComments items were not found via 'zid-index' (Key: {zid})"
    repness_item = response['Items'][0] # Just check one
    assert 'repness' in repness_item, "repness not in RepresentativeComments"
    assert len(repness_item['repness']) > 0, "No repness data was generated"

    # Check for Participant Projections
    proj_table = dynamodb_resource.Table("Delphi_PCAParticipantProjections")
    
    # Get unique participant IDs from the votes
    pids = set(v['pid'] for v in mock_votes_data['votes_dicts']['votes'])
    
    count = 0
    for pid in pids:
        # Note: The script *should* be filtering moderated-out participants.
        # Our mock_moderation_data is empty, so all pids should be present.
        # FIX: Use composite key (zid_tick, participant_id) from schema
        proj_item = proj_table.get_item(Key={'zid_tick': ZID_TICK, 'participant_id': str(pid)}).get('Item')
        assert proj_item is not None, f"PCAParticipantProjections item for pid {pid} was not created (Key: {ZID_TICK}, {pid})"
        assert 'projection' in proj_item, f"projection not in item for pid {pid}"
        count += 1
    
    assert count == len(pids), f"Did not find projections for all {len(pids)} active participants"