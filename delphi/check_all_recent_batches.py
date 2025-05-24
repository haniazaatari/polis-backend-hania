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
reports_table = dynamodb.Table("Delphi_NarrativeReports")

# Find batch report jobs with actual batch IDs
response = job_table.scan()
all_items = response.get('Items', [])

batch_report_jobs = [
    item for item in all_items 
    if item.get('job_id', '').startswith('batch_report_39321') 
    and item.get('batch_id') is not None
]
batch_report_jobs.sort(key=lambda x: x.get('created_at', ''), reverse=True)

print(f"Batch report jobs with batch IDs for conversation 39321:\n")

# Check the most recent 3
for job in batch_report_jobs[:3]:
    print(f"\nJob ID: {job.get('job_id')}")
    print(f"Created: {job.get('created_at')}")
    print(f"Batch ID: {job.get('batch_id')}")
    print(f"Status: {job.get('status')}")
    
    # Check what this job stored
    response = reports_table.scan(
        FilterExpression='job_id = :jid',
        ExpressionAttributeValues={
            ':jid': job.get('job_id')
        }
    )
    
    items = response.get('Items', [])
    
    if items:
        print(f"Reports stored: {len(items)}")
        sections = []
        for item in sorted(items, key=lambda x: x.get('section', '')):
            section = item.get('section')
            sections.append(section)
        
        # Show unique sections
        unique_sections = sorted(set(sections))
        print(f"Sections: {unique_sections}")
        
        # Check for layer0 completeness
        layer0_sections = [s for s in unique_sections if s.startswith('layer0_')]
        if layer0_sections:
            print(f"Layer0 sections found: {layer0_sections}")
            missing = []
            for i in range(8):
                if f"layer0_{i}" not in layer0_sections:
                    missing.append(f"layer0_{i}")
            if missing:
                print(f"MISSING: {missing}")
            else:
                print("All layer0 sections present!")
    else:
        print("No reports stored by this job")