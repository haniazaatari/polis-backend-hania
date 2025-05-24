#!/usr/bin/env python3
import boto3
import json
from datetime import datetime

# Connect to DynamoDB
dynamodb = boto3.resource(
    "dynamodb",
    endpoint_url="http://localhost:8000",
    region_name="us-east-1",
    aws_access_key_id="dummy",
    aws_secret_access_key="dummy"
)

# Get the most recent batch job for conversation 39321
job_table = dynamodb.Table("Delphi_JobQueue")

# Scan for batch jobs for conversation 39321
response = job_table.scan(
    FilterExpression='conversation_id = :cid AND attribute_exists(batch_id)',
    ExpressionAttributeValues={
        ':cid': '39321'
    }
)

items = sorted(response.get('Items', []), key=lambda x: x.get('created_at', ''), reverse=True)

if not items:
    print("No batch jobs found for conversation 39321")
    exit()

# Get the most recent one
latest = items[0]
print(f"Latest batch job for conversation 39321:")
print(f"Job ID: {latest.get('job_id')}")
print(f"Batch ID: {latest.get('batch_id')}")
print(f"Created: {latest.get('created_at')}")
print(f"Status: {latest.get('status')}")

# Check the stored results
batch_results_str = latest.get('batch_results', '{}')
if batch_results_str and len(batch_results_str) > 2:
    try:
        results = json.loads(batch_results_str)
        print(f"\nTotal results stored: {len(results)}")
        
        # Extract custom_ids
        custom_ids = []
        for r in results:
            if isinstance(r, dict):
                custom_id = r.get('custom_id')
                status = r.get('status', 'unknown')
                if custom_id:
                    custom_ids.append(custom_id)
                    print(f"  {custom_id} - {status}")
                else:
                    print(f"  [NO CUSTOM_ID] - {status}")
        
        # Check what's missing
        print("\nChecking for missing clusters:")
        for i in range(8):
            expected = f"39321_layer0_{i}"
            if expected not in custom_ids:
                print(f"  MISSING: {expected}")
                
    except Exception as e:
        print(f"Error parsing batch results: {e}")

# Also check the narrative reports table to see what was actually stored
print("\n\nChecking Narrative Reports table:")
reports_table = dynamodb.Table("Delphi_NarrativeReports")

# Get the report_id from the job
report_id = latest.get('report_id')
if report_id:
    # Scan for reports from this report_id
    response = reports_table.scan(
        FilterExpression='report_id = :rid',
        ExpressionAttributeValues={
            ':rid': report_id
        }
    )
    
    items = response.get('Items', [])
    print(f"Found {len(items)} reports for report_id {report_id}")
    
    sections = []
    for item in items:
        section = item.get('section', 'unknown')
        rid_section_model = item.get('rid_section_model', '')
        sections.append(section)
        print(f"  Stored: {rid_section_model}")
    
    # Check what sections are missing
    print("\nChecking for missing sections:")
    for i in range(8):
        expected = f"layer0_{i}"
        if expected not in sections:
            print(f"  MISSING SECTION: {expected}")