#!/usr/bin/env python3
"""
Script to download real test data from Polis exports for delphi tests.

This script downloads data from a running Polis instance:
1. Downloads CSV exports (comments, votes, summary) from the report endpoint
   - Requires: Polis web server running (default: http://localhost)
2. Extracts the math blob JSON from the Postgres database
   - Requires: Postgres database with the reports and math_main table populated
   - Note: Math blobs may not be available if the database is not accessible or
     if the Clojure math computation hasn't run for the given report
3. Saves all files to the real_data/<report_id>/ folder

Usage:
    # From command line with report IDs
    python download_real_data.py <report_id> [<report_id2> ...]

    # From environment variable (set TEST_REPORT_IDS in .env)
    python download_real_data.py

Examples:
    python download_real_data.py rabc123xyz456
    python download_real_data.py rabc123xyz456 rdef789uvw012
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / '.env')

import psycopg2
import requests


def get_db_connection():
    """Create a connection to the Postgres database using environment variables."""
    # These will be automatically loaded from .env by pyauto-dotenv when running from delphi directory
    return psycopg2.connect(
        database=os.environ.get('POSTGRES_DB', 'polismath'),
            user=os.environ.get('POSTGRES_USER', 'postgres'),
            password=os.environ.get('POSTGRES_PASSWORD', 'postgres'),
            host=os.environ.get('POSTGRES_HOST', 'localhost'),
            port=os.environ.get('POSTGRES_PORT', '5432')
    )


def fetch_csv_export(report_id: str, export_type: str, base_url: str = "http://localhost") -> Optional[str]:
    """
    Fetch CSV export from the report endpoint.

    Args:
        report_id: The report ID to export
        export_type: Type of export (comments, votes, summary, etc.)
        base_url: Base URL for the Polis instance

    Returns:
        CSV content as string, or None if failed
    """
    url = f"{base_url}/api/v3/reportExport/{report_id}/{export_type}.csv"

    try:
        print(f"Fetching {export_type} from {url}...")
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        # Check if we got CSV content
        if 'text/csv' not in response.headers.get('content-type', ''):
            print(f"Warning: Response is not CSV (content-type: {response.headers.get('content-type')})")

        return response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching {export_type}: {e}")
        return None


def extract_math_blob(report_id: str) -> Optional[dict]:
    """
    Extract the math blob JSON from the Postgres database.

    Args:
        report_id: The report ID to query

    Returns:
        Math blob as dictionary, or None if failed
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Query to get the math blob from math_main table
        # We join with reports to get the zid from the report_id
        query = """
            SELECT m.data
            FROM math_main m
            JOIN reports r ON m.zid = r.zid
            WHERE r.report_id = %s
            ORDER BY m.modified DESC
            LIMIT 1
        """

        print(f"Querying database for math blob (report_id: {report_id})...")
        cursor.execute(query, (report_id,))
        result = cursor.fetchone()

        if result:
            # The data column is already a JSON object in psycopg2
            math_blob = result[0]
            print(f"Successfully extracted math blob (size: {len(json.dumps(math_blob))} bytes)")
            return math_blob
        else:
            print(f"No math blob found for report_id: {report_id}")
            return None

    except Exception as e:
        print(f"Error extracting math blob: {e}")
        return None
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()


def save_test_data(report_id: str, output_dir: Path, base_url: str = "http://localhost") -> bool:
    """
    Download and save test data for a given report ID.

    Args:
        report_id: The report ID to process
        output_dir: Directory to save the files
        base_url: Base URL for the Polis instance

    Returns:
        True if successful, False otherwise
    """
    print(f"\n{'='*60}")
    print(f"Processing report ID: {report_id}")
    print(f"{'='*60}\n")

    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate timestamp for filenames (matching the format in test files)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")

    # Download CSV files
    csv_types = ['comments', 'votes', 'summary']
    success = True

    for csv_type in csv_types:
        csv_content = fetch_csv_export(report_id, csv_type, base_url)

        if csv_content:
            # Save with timestamp prefix (matching test file naming convention)
            filename = f"{timestamp}-{report_id}-{csv_type}.csv"
            filepath = output_dir / filename

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(csv_content)

            print(f"✓ Saved {csv_type} to {filepath}")
        else:
            print(f"✗ Failed to download {csv_type}")
            success = False

    # Extract and save math blob
    math_blob = extract_math_blob(report_id)

    if math_blob:
        # Save math blob with descriptive name
        math_filename = f"{report_id}_math_blob.json"
        math_filepath = output_dir / math_filename

        with open(math_filepath, 'w', encoding='utf-8') as f:
            json.dump(math_blob, f, indent=2)

        print(f"✓ Saved math blob to {math_filepath}")
    else:
        print(f"✗ Failed to extract math blob")
        success = False

    if success:
        print(f"\n✓ Successfully generated test data for {report_id}")
        print(f"  Files saved to: {output_dir}")
    else:
        print(f"\n✗ Some files failed to generate for {report_id}")

    return success


def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(
        description="Download real test data from Polis exports",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download test data for a single report
  python download_real_data.py rabc123xyz456

  # Download test data for multiple reports
  python download_real_data.py rabc123xyz456 rdef789uvw012

  # Load report IDs from TEST_REPORT_IDS environment variable (.env)
  python download_real_data.py

  # Specify custom base URL
  python download_real_data.py --base-url http://localhost:5000 rabc123xyz456

  # Specify custom output directory
  python download_real_data.py --output-dir /path/to/output rabc123xyz456
        """
    )

    parser.add_argument(
        'report_ids',
        nargs='*',
        help='One or more report IDs to process (if not specified, uses TEST_REPORT_IDS from .env)'
    )

    parser.add_argument(
        '--base-url',
        default='http://localhost',
        help='Base URL for the Polis instance (default: http://localhost)'
    )

    parser.add_argument(
        '--output-dir',
        type=Path,
        default=None,
        help='Output directory (default: real_data/<report_id>)'
    )

    args = parser.parse_args()

    # Get report IDs from command line or environment variable
    report_ids = args.report_ids
    if not report_ids:
        # Try to load from environment variable
        env_report_ids = os.getenv('TEST_REPORT_IDS', '').strip()
        if env_report_ids:
            # Split by comma and/or whitespace, filter empty strings
            report_ids = [rid.strip() for rid in env_report_ids.replace(',', ' ').split() if rid.strip()]
            print(f"Loaded {len(report_ids)} report IDs from TEST_REPORT_IDS environment variable")
        else:
            parser.error("No report IDs provided. Either pass them as arguments or set TEST_REPORT_IDS in .env")

    # Get the delphi directory (parent of tests directory where this script lives)
    delphi_dir = Path(__file__).parent.parent

    # Process each report ID
    results = {}
    for report_id in report_ids:
        # Determine output directory
        if args.output_dir:
            output_dir = args.output_dir / report_id
        else:
            output_dir = delphi_dir / 'real_data' / report_id

        results[report_id] = save_test_data(report_id, output_dir, args.base_url)

    # Print summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}\n")

    successful = [rid for rid, success in results.items() if success]
    failed = [rid for rid, success in results.items() if not success]

    print(f"Successful: {len(successful)}/{len(results)}")
    if successful:
        for rid in successful:
            print(f"  ✓ {rid}")

    if failed:
        print(f"\nFailed: {len(failed)}/{len(results)}")
        for rid in failed:
            print(f"  ✗ {rid}")
        sys.exit(1)
    else:
        print("\n✓ All report IDs processed successfully!")


if __name__ == '__main__':
    main()
