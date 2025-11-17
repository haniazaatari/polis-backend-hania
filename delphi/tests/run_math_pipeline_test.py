import os
import sys
import time
import pytest
import psycopg2
import boto3
from psycopg2 import extras
from unittest import mock

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

# Import the main function from the script we want to test
from run_math_pipeline import main as run_math_pipeline_main

# --- Fixtures to Set Up Test Environment ---

@pytest.fixture(scope="module")
def db_conn():
    """Create a connection to the test PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            dbname=os.environ.get("DATABASE_NAME", "polis-test"),
            user=os.environ.get("DATABASE_USER", "postgres"),
            password=os.environ.get("DATABASE_PASSWORD", "postgres"),
            host=os.environ.get("POSTGRES_HOST", "localhost"), # 'postgres' in CI
            port=os.environ.get("DATABASE_PORT", 5432)
        )
        yield conn
        conn.close()
    except psycopg2.OperationalError as e:
        pytest.fail(f"Could not connect to test Postgres DB: {e}")

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

@pytest.fixture(scope="function")
def conversation_data(db_conn):
    """
    Sets up mock data in Postgres for a single conversation and yields the zid.
    Cleans up the data after the test.
    """
    zid = "test-pipeline-123"
    now = int(time.time())
    
    with db_conn.cursor() as cursor:
        # 1. Clean up any old data (just in case)
        cursor.execute("DELETE FROM votes WHERE zid = %s", (zid,))
        cursor.execute("DELETE FROM comments WHERE zid = %s", (zid,))
        cursor.execute("DELETE FROM participants WHERE zid = %s", (zid,))
        
        # 2. Insert Participants
        # p1 and p2 will agree, p3 will disagree
        participants = [
            (zid, 101, now),
            (zid, 102, now),
            (zid, 103, now),
            (zid, 104, now), # Moderated out participant
        ]
        psycopg2.extras.execute_values(
            cursor,
            "INSERT INTO participants (zid, pid, created) VALUES %s",
            participants
        )
        # Moderate out p4
        cursor.execute("UPDATE participants SET mod = '-1' WHERE zid = %s AND pid = 104", (zid,))

        # 3. Insert Comments
        comments = [
            # tid, zid, pid, created, txt, is_seed
            (1, zid, 101, now, "Comment 1: This is great", True),
            (2, zid, 102, now, "Comment 2: I agree", False),
            (3, zid, 103, now, "Comment 3: This is bad", False),
            (4, zid, 101, now, "Comment 4: Moderated out", False),
        ]
        psycopg2.extras.execute_values(
            cursor,
            "INSERT INTO comments (tid, zid, pid, created, txt, is_seed) VALUES %s",
            comments
        )
        # Moderate out c4
        cursor.execute("UPDATE comments SET mod = '-1' WHERE zid = %s AND tid = 4", (zid,))
        
        # 4. Insert Votes
        # p1, p2, p3 vote on c1, c2, c3
        votes = [
            # zid, pid, tid, vote, created
            (zid, 101, 1, 1, now + 10),
            (zid, 101, 2, 1, now + 11),
            (zid, 101, 3, -1, now + 12),
            (zid, 102, 1, 1, now + 13),
            (zid, 102, 2, 1, now + 14),
            (zid, 102, 3, -1, now + 15),
            (zid, 103, 1, -1, now + 16),
            (zid, 103, 2, -1, now + 17),
            (zid, 103, 3, 1, now + 18),
            (zid, 104, 1, 1, now + 19), # Vote from moderated-out participant
        ]
        psycopg2.extras.execute_values(
            cursor,
            "INSERT INTO votes (zid, pid, tid, vote, created) VALUES %s",
            votes
        )
        
        db_conn.commit()

    yield zid # This is the value the test function will receive

    # 5. Teardown
    with db_conn.cursor() as cursor:
        cursor.execute("DELETE FROM votes WHERE zid = %s", (zid,))
        cursor.execute("DELETE FROM comments WHERE zid = %s", (zid,))
        cursor.execute("DELETE FROM participants WHERE zid = %s", (zid,))
        db_conn.commit()


# --- The Test Function ---

def test_run_math_pipeline_e2e(conversation_data, dynamodb_resource):
    """
    Runs the entire math pipeline script on the mock data and checks DynamoDB for results.
    """
    zid = conversation_data # Get the zid from the fixture
    
    # 1. Mock command-line arguments
    # We patch 'sys.argv' to simulate running:
    # python run_math_pipeline.py --zid test-pipeline-123 --batch-size 2
    test_args = [
        "run_math_pipeline.py",
        "--zid", zid,
        "--batch-size", "2", # Use a small batch size to force batching
    ]
    
    with mock.patch.object(sys, 'argv', test_args):
        # 2. Run the main function
        try:
            run_math_pipeline_main()
        except SystemExit as e:
            pytest.fail(f"run_math_pipeline.py exited unexpectedly: {e}")

    # 3. Verify results were written to DynamoDB
    
    # Check for PCA results
    pca_table = dynamodb_resource.Table("Delphi_PCAResults")
    pca_item = pca_table.get_item(Key={'zid': zid}).get('Item')
    assert pca_item is not None, "PCAResults item was not created in DynamoDB"
    assert 'pca_matrix' in pca_item, "pca_matrix not in PCAResults"
    assert len(pca_item['pca_matrix']) == 3 # 3 comments (c1, c2, c3)
    
    # Check for K-Means clusters
    kmeans_table = dynamodb_resource.Table("Delphi_KMeansClusters")
    kmeans_item = kmeans_table.get_item(Key={'zid': zid}).get('Item')
    assert kmeans_item is not None, "KMeansClusters item was not created in DynamoDB"
    assert 'clusters' in kmeans_item, "clusters not in KMeansClusters"
    assert len(kmeans_item['clusters']) > 0, "No clusters were generated"

    # Check for Representative Comments
    repness_table = dynamodb_resource.Table("Delphi_RepresentativeComments")
    repness_item = repness_table.get_item(Key={'zid': zid}).get('Item')
    assert repness_item is not None, "RepresentativeComments item was not created"
    assert 'repness' in repness_item, "repness not in RepresentativeComments"
    assert len(repness_item['repness']) > 0, "No repness data was generated"

    # Check for Participant Projections
    proj_table = dynamodb_resource.Table("Delphi_PCAParticipantProjections")
    # We should have projections for pids 101, 102, 103 (but not 104, who was moderated out)
    pids = ["101", "102", "103"]
    count = 0
    for pid in pids:
        proj_item = proj_table.get_item(Key={'zid_pid': f"{zid}_{pid}"}).get('Item')
        assert proj_item is not None, f"PCAParticipantProjections item for pid {pid} was not created"
        assert 'projection' in proj_item, f"projection not in item for pid {pid}"
        count += 1
    
    assert count == 3, "Did not find projections for all 3 active participants"
    
    # Check that the moderated-out participant has no projection
    mod_proj_item = proj_table.get_item(Key={'zid_pid': f"{zid}_104"}).get('Item')
    assert mod_proj_item is None, "A projection was incorrectly created for a moderated-out participant"