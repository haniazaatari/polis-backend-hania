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

# Check the most recent batch
reports_table = dynamodb.Table("Delphi_NarrativeReports")

# Look for the specific job
job_id = "batch_report_39321_1748120297_a96cc443"

response = reports_table.scan(
    FilterExpression='job_id = :jid',
    ExpressionAttributeValues={
        ':jid': job_id
    }
)

items = response.get('Items', [])
print(f"Reports from job {job_id}: {len(items)}")

# Sort by section
sections = {}
for item in items:
    section = item.get('section', 'unknown')
    sections[section] = {
        'key': item.get('rid_section_model'),
        'has_data': len(item.get('report_data', '')) > 0,
        'data_length': len(item.get('report_data', ''))
    }

# Check all layer0 sections
print("\nLayer0 sections status:")
for i in range(8):
    section = f"layer0_{i}"
    if section in sections:
        info = sections[section]
        print(f"  ✓ {section} - Key: {info['key']}, Has data: {info['has_data']}, Length: {info['data_length']}")
    else:
        print(f"  ✗ MISSING: {section}")

# Also show what we do have
print(f"\nAll sections found: {sorted(sections.keys())}")