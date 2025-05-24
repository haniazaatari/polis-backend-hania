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

# Get specific job
job_table = dynamodb.Table("Delphi_JobQueue")

# Get the most recent batch job for conversation 39321
job_id = "batch_report_39321_1748114107_16b5bfcd"
response = job_table.get_item(Key={'job_id': job_id})

if 'Item' in response:
    item = response['Item']
    print(f"Job ID: {job_id}")
    print(f"Batch ID: {item.get('batch_id')}")
    print(f"Status: {item.get('status')}")
    
    # Get batch results
    batch_results_str = item.get('batch_results', '{}')
    if batch_results_str and len(batch_results_str) > 2:
        try:
            results = json.loads(batch_results_str)
            print(f"\nTotal results in batch: {len(results)}")
            
            # Extract all custom_ids
            all_custom_ids = []
            for i, result in enumerate(results):
                custom_id = result.get('custom_id', f'unknown_{i}')
                status = result.get('status', 'unknown')
                all_custom_ids.append(custom_id)
                print(f"  {i}: {custom_id} - {status}")
            
            # Check which are missing
            print("\nChecking for missing clusters:")
            for i in range(8):
                expected_id = f"39321_layer0_{i}"
                if expected_id not in all_custom_ids:
                    print(f"  MISSING: {expected_id}")
            
        except Exception as e:
            print(f"Error parsing batch results: {e}")
            print(f"Raw results string length: {len(batch_results_str)}")
            # Print first 500 chars
            print(f"First 500 chars: {batch_results_str[:500]}...")

# Also check what's in the narrative reports table
print("\n\nChecking Narrative Reports table:")
reports_table = dynamodb.Table("Delphi_NarrativeReports")

# Scan for recent reports from this batch
response = reports_table.scan(
    FilterExpression='job_id = :jid',
    ExpressionAttributeValues={
        ':jid': job_id
    }
)

items = response.get('Items', [])
print(f"Found {len(items)} reports stored from this batch")

sections = []
for item in items:
    section = item.get('section', 'unknown')
    sections.append(section)

sections.sort()
print(f"Sections stored: {sections}")

# Check for missing sections
for i in range(8):
    if f"layer0_{i}" not in sections:
        print(f"  MISSING SECTION: layer0_{i}")