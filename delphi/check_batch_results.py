#!/usr/bin/env python3
import boto3
import json

# Connect to DynamoDB
dynamodb = boto3.resource(
    "dynamodb",
    endpoint_url="http://localhost:8000",
    region_name="us-east-1",
    aws_access_key_id="dummy",
    aws_secret_access_key="dummy"
)

# Check the job queue for recent batch jobs
job_table = dynamodb.Table("Delphi_JobQueue")

# Scan for recent batch jobs with batch_id
response = job_table.scan()
all_items = response.get("Items", [])

# Filter for items with batch_id and sort by created_at
batch_items = [item for item in all_items if "batch_id" in item and item.get("batch_id")]
sorted_items = sorted(batch_items, key=lambda x: x.get("created_at", ""), reverse=True)

print("Recent batch jobs:")
for item in sorted_items[:5]:
    print(f"\nJob ID: {item.get('job_id')}")
    print(f"  Conversation ID: {item.get('conversation_id')}")
    print(f"  Batch ID: {item.get('batch_id')}")
    print(f"  Created: {item.get('created_at')}")
    print(f"  Status: {item.get('status')}")
    
    # Check batch results
    batch_results = item.get("batch_results", "{}")
    if batch_results and len(batch_results) > 2:
        try:
            results = json.loads(batch_results)
            if isinstance(results, list):
                print(f"  Number of results: {len(results)}")
                # Extract custom_ids and check for gaps
                custom_ids = []
                for r in results:
                    if isinstance(r, dict) and "custom_id" in r:
                        custom_ids.append(r["custom_id"])
                custom_ids.sort()
                print(f"  Results received: {custom_ids}")
                
                # Check for missing clusters
                if item.get('conversation_id') == '39321':
                    expected = ['39321_layer0_0', '39321_layer0_1', '39321_layer0_2', 
                               '39321_layer0_3', '39321_layer0_4', '39321_layer0_5',
                               '39321_layer0_6', '39321_layer0_7']
                    missing = [e for e in expected if e not in custom_ids]
                    if missing:
                        print(f"  MISSING RESULTS: {missing}")
        except Exception as e:
            print(f"  Error parsing results: {e}")

# Also check if we can find the specific batch from Anthropic API
print("\n\nChecking most recent conversation 39321 batch:")
conv_39321_items = [item for item in sorted_items if item.get('conversation_id') == '39321']
if conv_39321_items:
    latest = conv_39321_items[0]
    print(f"Latest batch for 39321: {latest.get('batch_id')}")
    print(f"Status: {latest.get('status')}")