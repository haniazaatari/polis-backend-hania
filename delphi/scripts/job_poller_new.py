#!/usr/bin/env python3
"""
Delphi Job Poller Service

This script runs as a daemon to poll the Delphi_JobQueue for pending jobs
and execute them.

Usage:
    python job_poller.py [options]

Options:
    --endpoint-url=URL  DynamoDB endpoint URL (default: http://localhost:8000)
    --region=REGION     AWS region (default: us-west-2)
    --interval=SECONDS  Polling interval in seconds (default: 10)
    --max-workers=N     Maximum number of concurrent workers (default: 1)
    --log-level=LEVEL   Logging level (default: INFO)
    --log-file=FILE     Optional log file path
"""

import argparse
import logging
import os
import signal
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from job_system.db.dynamodb import DynamoDBJobStore
from job_system.poller.worker import Worker
from job_system.utils.logging import configure_logging

# Global flag for graceful shutdown
running = True

def signal_handler(sig, frame):
    """Handle exit signals gracefully."""
    global running
    running = False
    logging.info("Shutting down gracefully...")

def main():
    """Main entry point for the job poller."""
    # Parse arguments
    parser = argparse.ArgumentParser(description='Delphi Job Poller Service')
    parser.add_argument('--endpoint-url', type=str, default=None,
                       help='DynamoDB endpoint URL')
    parser.add_argument('--region', type=str, default='us-west-2',
                       help='AWS region')
    parser.add_argument('--interval', type=int, default=10,
                       help='Polling interval in seconds')
    parser.add_argument('--max-workers', type=int, default=1,
                       help='Maximum number of concurrent workers')
    parser.add_argument('--log-level', type=str, default='INFO',
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                       help='Logging level')
    parser.add_argument('--log-file', type=str, default=None,
                       help='Optional log file path')
    
    args = parser.parse_args()
    
    # Configure logging
    configure_logging(args.log_level, args.log_file)
    logger = logging.getLogger("delphi.poller")
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("Starting Delphi Job Poller Service")
    logger.info(f"Endpoint URL: {args.endpoint_url or os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')}")
    logger.info(f"Region: {args.region}")
    logger.info(f"Polling interval: {args.interval} seconds")
    logger.info(f"Maximum workers: {args.max_workers}")
    
    try:
        # Initialize job store
        db_store = DynamoDBJobStore(
            endpoint_url=args.endpoint_url,
            region=args.region
        )
        
        # Create workers
        workers = []
        for i in range(args.max_workers):
            worker = Worker(db_store, interval=args.interval)
            thread = threading.Thread(
                target=worker.run,
                daemon=True
            )
            thread.start()
            workers.append((worker, thread))
            logger.info(f"Started worker {i+1}")
        
        # Keep main thread alive until signaled to stop
        while running and any(thread.is_alive() for _, thread in workers):
            time.sleep(1)
        
        # Stop all workers
        for worker, _ in workers:
            worker.stop()
        
        logger.info("All workers have stopped. Exiting.")
    except Exception as e:
        logger.error(f"Error in main function: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()