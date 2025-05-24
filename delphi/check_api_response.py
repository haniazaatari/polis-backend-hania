#!/usr/bin/env python3
import requests
import json

# Query the API endpoint directly
response = requests.get('http://localhost:5000/api/v3/delphi/reports?report_id=r6vbnhffkxbd7ifmfbdrd')

print(f"Status: {response.status_code}")
print(f"Headers: {dict(response.headers)}")

try:
    data = response.json()
    print(f"\nResponse keys: {data.keys()}")
    print(f"Status: {data.get('status')}")
    print(f"Message: {data.get('message')}")
    print(f"Current run: {data.get('current_run')}")
    print(f"Number of available runs: {len(data.get('available_runs', []))}")
    
    reports = data.get('reports', {})
    print(f"\nNumber of report sections: {len(reports)}")
    if reports:
        print("Sections found:", list(reports.keys())[:10])
        
        # Check a sample section
        first_section = list(reports.keys())[0]
        sample = reports[first_section]
        print(f"\nSample section '{first_section}':")
        print(f"  Model: {sample.get('model')}")
        print(f"  Timestamp: {sample.get('timestamp')}")
        print(f"  Has report_data: {bool(sample.get('report_data'))}")
        print(f"  Report data length: {len(sample.get('report_data', ''))}")
        
except Exception as e:
    print(f"Error parsing response: {e}")
    print(f"Raw response: {response.text[:500]}")