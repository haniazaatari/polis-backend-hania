"""
Central configuration for test datasets.

This module provides a single source of truth for dataset paths and file discovery,
eliminating hard-coded paths scattered across test files.
"""

import os
from pathlib import Path
from typing import Dict, Optional
import glob


# Dataset configuration mapping dataset names to report IDs
# Only includes datasets currently used in tests
DATASETS = {
    'biodiversity': {
        'report_id': 'r4tykwac8thvzv35jrn53',
        'description': 'NZ Biodiversity Strategy'
    },
    'vw': {
        'report_id': 'r6vbnhffkxbd7ifmfbdrd',
        'description': 'VW Conversation'
    },
}


def get_real_data_dir() -> Path:
    """
    Get the absolute path to the real_data directory.

    Returns:
        Path to the real_data directory (delphi/real_data)
    """
    # This file is in delphi/tests, so go up one level to delphi, then into real_data
    tests_dir = Path(__file__).parent
    delphi_dir = tests_dir.parent
    real_data_dir = delphi_dir / 'real_data'

    return real_data_dir.resolve()


def find_dataset_file(report_id: str, suffix: str) -> str:
    """
    Find a file in the real_data directory by report ID and suffix.

    This function uses glob patterns to find files with timestamped names,
    allowing tests to work regardless of when the data was downloaded.

    Args:
        report_id: Report ID (e.g., 'r4tykwac8thvzv35jrn53')
        suffix: File suffix to search for. Supported suffixes:
            - 'votes.csv' - Vote data
            - 'comments.csv' - Comment data
            - 'summary.csv' - Summary statistics
            - 'math_blob.json' - Clojure math computation output

    Returns:
        Absolute path to the file

    Raises:
        FileNotFoundError: If no matching file is found
        ValueError: If multiple matching files are found

    Examples:
        >>> find_dataset_file('r4tykwac8thvzv35jrn53', 'votes.csv')
        '/path/to/real_data/r4tykwac8thvzv35jrn53/2025-11-07-1035-r4tykwac8thvzv35jrn53-votes.csv'

        >>> find_dataset_file('r4tykwac8thvzv35jrn53', 'math_blob.json')
        '/path/to/real_data/r4tykwac8thvzv35jrn53/r4tykwac8thvzv35jrn53_math_blob.json'
    """
    real_data_dir = get_real_data_dir()
    report_dir = real_data_dir / report_id

    if not report_dir.exists():
        raise FileNotFoundError(
            f"Report directory not found: {report_dir}\n"
            f"Make sure you have downloaded the test data for report {report_id}"
        )

    # Build the search pattern based on suffix
    if suffix == 'math_blob.json':
        # Math blob uses format: {report_id}_math_blob.json
        pattern = f"{report_id}_math_blob.json"
    else:
        # CSV files use format: {timestamp}-{report_id}-{suffix}
        pattern = f"*-{report_id}-{suffix}"

    search_path = report_dir / pattern
    matches = glob.glob(str(search_path))

    if not matches:
        raise FileNotFoundError(
            f"No file found matching pattern: {search_path}\n"
            f"Available files in {report_dir}:\n" +
            "\n".join(f"  - {f.name}" for f in sorted(report_dir.glob('*')))
        )

    if len(matches) > 1:
        raise ValueError(
            f"Multiple files found matching pattern: {search_path}\n" +
            "\n".join(f"  - {m}" for m in matches) +
            "\nPlease clean up old files or specify a more specific pattern."
        )

    return os.path.abspath(matches[0])


def get_dataset_files(dataset_name: str) -> Dict[str, str]:
    """
    Get file paths for a dataset by name.

    Args:
        dataset_name: Dataset name (e.g., 'biodiversity', 'vw')
                     Must be a key in the DATASETS dictionary

    Returns:
        Dictionary with keys:
            - 'votes': Path to votes CSV file
            - 'comments': Path to comments CSV file
            - 'summary': Path to summary CSV file
            - 'math_blob': Path to math blob JSON file
            - 'data_dir': Path to the dataset directory
            - 'report_id': The report ID for this dataset

    Raises:
        ValueError: If dataset_name is not recognized
        FileNotFoundError: If any required files are missing

    Examples:
        >>> files = get_dataset_files('biodiversity')
        >>> print(files['votes'])
        '/path/to/real_data/r4tykwac8thvzv35jrn53/2025-11-07-1035-r4tykwac8thvzv35jrn53-votes.csv'
    """
    if dataset_name not in DATASETS:
        available = ', '.join(DATASETS.keys())
        raise ValueError(
            f"Unknown dataset: {dataset_name}\n"
            f"Available datasets: {available}"
        )

    report_id = DATASETS[dataset_name]['report_id']
    real_data_dir = get_real_data_dir()
    data_dir = real_data_dir / report_id

    # Find all required files
    files = {
        'report_id': report_id,
        'data_dir': str(data_dir),
        'votes': find_dataset_file(report_id, 'votes.csv'),
        'comments': find_dataset_file(report_id, 'comments.csv'),
        'summary': find_dataset_file(report_id, 'summary.csv'),
        'math_blob': find_dataset_file(report_id, 'math_blob.json'),
    }

    return files


def get_dataset_report_id(dataset_name: str) -> str:
    """
    Get the report ID for a dataset by name.

    Args:
        dataset_name: Dataset name (e.g., 'biodiversity', 'vw')

    Returns:
        The report ID string

    Raises:
        ValueError: If dataset_name is not recognized
    """
    if dataset_name not in DATASETS:
        available = ', '.join(DATASETS.keys())
        raise ValueError(
            f"Unknown dataset: {dataset_name}\n"
            f"Available datasets: {available}"
        )

    return DATASETS[dataset_name]['report_id']


def list_available_datasets() -> Dict[str, Dict[str, str]]:
    """
    List all available datasets and their information.

    Returns:
        Dictionary mapping dataset names to their configuration
    """
    return DATASETS.copy()


def get_dataset_file_optional(dataset_name: str, suffix: str) -> Optional[str]:
    """
    Get a dataset file path, returning None if the file doesn't exist.

    This is useful for files that may not always be present (e.g., math_blob.json
    when only CSV files were downloaded).

    Args:
        dataset_name: Dataset name (e.g., 'biodiversity', 'vw')
        suffix: File suffix (e.g., 'votes.csv', 'math_blob.json')

    Returns:
        Absolute path to the file, or None if not found
    """
    try:
        report_id = get_dataset_report_id(dataset_name)
        return find_dataset_file(report_id, suffix)
    except (FileNotFoundError, ValueError):
        return None
