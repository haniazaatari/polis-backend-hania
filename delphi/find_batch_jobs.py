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

job_table = dynamodb.Table("Delphi_JobQueue")

# Find all jobs that start with "batch_report_39321"
response = job_table.scan()
all_items = response.get('Items', [])

batch_report_jobs = [item for item in all_items if item.get('job_id', '').startswith('batch_report_39321')]
batch_report_jobs.sort(key=lambda x: x.get('created_at', ''), reverse=True)

print(f"Found {len(batch_report_jobs)} batch report jobs for conversation 39321\n")

# Show the most recent one
if batch_report_jobs:
    latest = batch_report_jobs[0]
    print(f"Most recent batch report job:")
    print(f"Job ID: {latest.get('job_id')}")
    print(f"Created: {latest.get('created_at')}")
    print(f"Batch ID: {latest.get('batch_id')}")
    
    # Now check what this job stored
    reports_table = dynamodb.Table("Delphi_NarrativeReports")
    
    response = reports_table.scan(
        FilterExpression='job_id = :jid',
        ExpressionAttributeValues={
            ':jid': latest.get('job_id')
        }
    )
    
    items = response.get('Items', [])
    print(f"\nReports stored by job {latest.get('job_id')}: {len(items)}")
    
    sections = []
    for item in sorted(items, key=lambda x: x.get('section', '')):
        section = item.get('section')
        model = item.get('model')
        timestamp = item.get('timestamp', '')[:19]  # Just date/time
        sections.append(section)
        print(f"  {section:<15} {model:<30} {timestamp}")
    
    print("\nCompleteness check for layer0 sections:")
    for i in range(8):
        expected = f"layer0_{i}"
        if expected in sections:
            print(f"  ✓ {expected}")
        else:
            print(f"  ✗ MISSING: {expected}")