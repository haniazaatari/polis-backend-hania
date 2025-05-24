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

# Look for the actual report generation job (not the check job)
job_table = dynamodb.Table("Delphi_JobQueue")

# Find report generation jobs
response = job_table.scan(
    FilterExpression='conversation_id = :cid AND job_type = :jtype AND attribute_exists(batch_id)',
    ExpressionAttributeValues={
        ':cid': '39321',
        ':jtype': 'NARRATIVE_BATCH_REPORT'
    }
)

items = sorted(response.get('Items', []), key=lambda x: x.get('created_at', ''), reverse=True)

if items:
    latest = items[0]
    print(f"Latest NARRATIVE_BATCH_REPORT job:")
    print(f"Job ID: {latest.get('job_id')}")
    print(f"Created: {latest.get('created_at')}")
    
    # Check what reports were created from this specific job
    reports_table = dynamodb.Table("Delphi_NarrativeReports")
    
    response = reports_table.scan(
        FilterExpression='job_id = :jid',
        ExpressionAttributeValues={
            ':jid': latest.get('job_id')
        }
    )
    
    items = response.get('Items', [])
    print(f"\nReports created by this job: {len(items)}")
    
    sections = []
    for item in sorted(items, key=lambda x: x.get('section', '')):
        section = item.get('section')
        model = item.get('model')
        sections.append(section)
        print(f"  {section} - {model}")
    
    print("\nChecking completeness:")
    for i in range(8):
        expected = f"layer0_{i}"
        if expected in sections:
            print(f"  ✓ {expected}")
        else:
            print(f"  ✗ MISSING: {expected}")