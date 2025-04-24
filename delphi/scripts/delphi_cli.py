#!/usr/bin/env python3
"""
Delphi CLI - A beautiful, elegant command-line interface for Delphi
A love letter to the history of computing.

This tool provides a simple way to interact with the Delphi job system.
"""

import argparse
import sys
import boto3
import json
import uuid
import os
import time
from datetime import datetime

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    from rich.table import Table
    from rich.text import Text
    from rich import print as rprint
    from rich.progress import Progress, SpinnerColumn, TextColumn
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    print("For the best experience, install rich: pip install rich")

# Check if we're running in a terminal that supports rich features
IS_TERMINAL = sys.stdout.isatty()

# Initialize rich console if available
if RICH_AVAILABLE:
    console = Console()

def create_elegant_header():
    """Create an elegant header for the CLI."""
    if not RICH_AVAILABLE or not IS_TERMINAL:
        print("\nDelphi - Polis Analytics System\n")
        print("=" * 40)
        return

    header = Panel.fit(
        "[bold blue]Delphi[/bold blue] [italic]- Polis Analytics System[/italic]",
        border_style="blue",
        padding=(1, 2),
    )
    console.print(header)
    console.print()

def setup_dynamodb(endpoint_url=None, region='us-west-2'):
    """Set up DynamoDB connection."""
    # Use environment variable if endpoint not provided
    if endpoint_url is None:
        endpoint_url = os.environ.get('DYNAMODB_ENDPOINT', 'http://localhost:8000')
    
    # For local development
    if 'localhost' in endpoint_url or 'host.docker.internal' in endpoint_url:
        os.environ.setdefault('AWS_ACCESS_KEY_ID', 'fakeMyKeyId')
        os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'fakeSecretAccessKey')
    
    return boto3.resource('dynamodb', endpoint_url=endpoint_url, region_name=region)

def submit_job(dynamodb, zid, job_type='FULL_PIPELINE', priority=50, max_votes=None, batch_size=None):
    """Submit a job to the Delphi job queue."""
    table = dynamodb.Table('DelphiJobQueue')
    
    # Generate a unique job ID
    job_id = str(uuid.uuid4())
    
    # Current timestamp in ISO format
    now = datetime.now().isoformat()
    
    # Build job configuration
    job_config = {}
    
    if job_type == 'FULL_PIPELINE':
        # Full pipeline configs
        stages = []
        
        # PCA stage
        pca_config = {}
        if max_votes:
            pca_config['max_votes'] = int(max_votes)
        if batch_size:
            pca_config['batch_size'] = int(batch_size)
        stages.append({"stage": "PCA", "config": pca_config})
        
        # UMAP stage
        stages.append({
            "stage": "UMAP", 
            "config": {
                "n_neighbors": 15,
                "min_dist": 0.1
            }
        })
        
        # Report stage
        stages.append({
            "stage": "REPORT",
            "config": {
                "model": "claude-3-7-sonnet-20250219",
                "include_topics": True
            }
        })
        
        # Visualization
        job_config['stages'] = stages
        job_config['visualizations'] = ["basic", "enhanced", "multilayer"]
    
    # Create job item
    job_item = {
        'job_id': job_id,
        'status': 'PENDING',
        'created_at': now,
        'updated_at': now,
        'started_at': now,  # Use current time instead of empty string
        'completed_at': now,
        'worker_id': "none",  # Use a placeholder instead of empty string
        'job_type': job_type,
        'priority': priority,
        'conversation_id': str(zid),
        'retry_count': 0,
        'max_retries': 3,
        'timeout_seconds': 7200,  # 2 hours default timeout
        'job_config': json.dumps(job_config),
        'job_results': json.dumps({}),
        'logs': json.dumps({
            'entries': [
                {
                    'timestamp': now,
                    'level': 'INFO',
                    'message': f'Job created for conversation {zid}'
                }
            ],
            'log_location': "none"
        }),
        'created_by': 'delphi_cli'
    }
    
    # Put item in DynamoDB
    response = table.put_item(Item=job_item)
    
    return job_id

def list_jobs(dynamodb, status=None, limit=10):
    """List jobs in the Delphi job queue."""
    table = dynamodb.Table('DelphiJobQueue')
    
    if status:
        # Query for jobs with specific status
        response = table.query(
            KeyConditionExpression='#s = :status',
            ExpressionAttributeNames={
                '#s': 'status'
            },
            ExpressionAttributeValues={
                ':status': status
            },
            Limit=limit,
            ScanIndexForward=False  # Sort in descending order by created_at
        )
    else:
        # Scan for all jobs (up to limit)
        response = table.scan(Limit=limit)
    
    return response.get('Items', [])

def display_jobs(jobs):
    """Display jobs in a nice format."""
    if not RICH_AVAILABLE or not IS_TERMINAL:
        print("\nJobs:")
        print("=" * 40)
        for job in jobs:
            print(f"Job ID: {job.get('job_id')}")
            print(f"Status: {job.get('status')}")
            print(f"Conversation: {job.get('conversation_id')}")
            print(f"Created: {job.get('created_at')}")
            print("-" * 40)
        return

    table = Table(title="Delphi Jobs")
    
    table.add_column("Job ID", style="cyan", no_wrap=True)
    table.add_column("Conversation", style="green")
    table.add_column("Status", style="magenta")
    table.add_column("Type", style="blue")
    table.add_column("Created", style="yellow")
    
    for job in jobs:
        job_id = job.get('job_id', '')
        if len(job_id) > 8:
            job_id = job_id[:8] + '...'
            
        table.add_row(
            job_id,
            job.get('conversation_id', ''),
            job.get('status', ''),
            job.get('job_type', ''),
            job.get('created_at', '')
        )
    
    console.print(table)

def get_job_details(dynamodb, job_id):
    """Get detailed information about a specific job."""
    table = dynamodb.Table('DelphiJobQueue')
    
    response = table.query(
        IndexName='JobIdIndex',
        KeyConditionExpression='job_id = :job_id',
        ExpressionAttributeValues={
            ':job_id': job_id
        }
    )
    
    items = response.get('Items', [])
    if items:
        return items[0]
    return None

def display_job_details(job):
    """Display detailed information about a job."""
    if not job:
        print("Job not found.")
        return
    
    if not RICH_AVAILABLE or not IS_TERMINAL:
        print("\nJob Details:")
        print("=" * 40)
        for key, value in job.items():
            print(f"{key}: {value}")
        return
    
    console.print(Panel(
        f"[bold]Job ID:[/bold] {job.get('job_id')}\n"
        f"[bold]Conversation:[/bold] {job.get('conversation_id')}\n"
        f"[bold]Status:[/bold] [{'green' if job.get('status') == 'COMPLETED' else 'yellow' if job.get('status') == 'PENDING' else 'red'}]{job.get('status')}[/]\n"
        f"[bold]Type:[/bold] {job.get('job_type')}\n"
        f"[bold]Priority:[/bold] {job.get('priority')}\n"
        f"[bold]Created:[/bold] {job.get('created_at')}\n"
        f"[bold]Updated:[/bold] {job.get('updated_at')}\n"
        f"[bold]Started:[/bold] {job.get('started_at') or 'Not started'}\n"
        f"[bold]Completed:[/bold] {job.get('completed_at') or 'Not completed'}\n",
        title="Job Details",
        border_style="blue"
    ))
    
    # Display configuration
    try:
        config = json.loads(job.get('job_config', '{}'))
        if config:
            console.print(Panel(
                json.dumps(config, indent=2),
                title="Job Configuration",
                border_style="green"
            ))
    except:
        pass
    
    # Display logs
    try:
        logs = json.loads(job.get('logs', '{}'))
        if logs and 'entries' in logs:
            log_table = Table(title="Job Logs")
            log_table.add_column("Timestamp", style="yellow")
            log_table.add_column("Level", style="blue")
            log_table.add_column("Message", style="white")
            
            for entry in logs['entries']:
                log_table.add_row(
                    entry.get('timestamp', ''),
                    entry.get('level', ''),
                    entry.get('message', '')
                )
            
            console.print(log_table)
    except:
        pass

def interactive_mode():
    """Run the CLI in interactive mode."""
    if not RICH_AVAILABLE:
        print("Interactive mode requires rich library.")
        print("Please install with: pip install rich")
        return
    
    create_elegant_header()
    
    dynamodb = setup_dynamodb()
    
    # Main menu
    while True:
        console.print("\n[bold blue]What would you like to do?[/bold blue]")
        console.print("1. [green]Submit a new job[/green]")
        console.print("2. [yellow]List existing jobs[/yellow]")
        console.print("3. [cyan]View job details[/cyan]")
        console.print("4. [red]Exit[/red]")
        
        choice = Prompt.ask("Enter your choice", choices=["1", "2", "3", "4"])
        
        if choice == "1":
            # Submit a new job
            zid = Prompt.ask("[bold]Enter conversation ID (zid)[/bold]")
            job_type = Prompt.ask(
                "[bold]Job type[/bold]", 
                choices=["FULL_PIPELINE", "PCA", "UMAP", "REPORT"],
                default="FULL_PIPELINE"
            )
            priority = int(Prompt.ask("[bold]Priority[/bold] (0-100)", default="50"))
            
            # Optional parameters
            max_votes = None
            batch_size = None
            
            if Confirm.ask("Would you like to set advanced parameters?"):
                max_votes = Prompt.ask("Maximum votes to process", default="")
                if not max_votes:
                    max_votes = None
                    
                batch_size = Prompt.ask("Batch size", default="")
                if not batch_size:
                    batch_size = None
            
            # Confirm submission
            if Confirm.ask(f"Submit job for conversation {zid}?"):
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    transient=True,
                ) as progress:
                    progress.add_task(description="Submitting job...", total=None)
                    job_id = submit_job(
                        dynamodb=dynamodb,
                        zid=zid,
                        job_type=job_type,
                        priority=priority,
                        max_votes=max_votes,
                        batch_size=batch_size
                    )
                
                console.print(f"[bold green]Job submitted with ID: {job_id}[/bold green]")
        
        elif choice == "2":
            # List jobs
            status = Prompt.ask(
                "[bold]Filter by status[/bold]",
                choices=["ALL", "PENDING", "PROCESSING", "COMPLETED", "FAILED"],
                default="ALL"
            )
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                transient=True,
            ) as progress:
                progress.add_task(description="Fetching jobs...", total=None)
                jobs = list_jobs(
                    dynamodb=dynamodb,
                    status=None if status == "ALL" else status
                )
            
            display_jobs(jobs)
        
        elif choice == "3":
            # View job details
            job_id = Prompt.ask("[bold]Enter job ID[/bold]")
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                transient=True,
            ) as progress:
                progress.add_task(description="Fetching job details...", total=None)
                job = get_job_details(dynamodb=dynamodb, job_id=job_id)
            
            display_job_details(job)
        
        elif choice == "4":
            # Exit
            console.print("[bold green]Goodbye![/bold green]")
            break

def main():
    """Main entry point for the Delphi CLI."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Delphi CLI - Polis Analytics System")
    
    # Command subparsers
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Submit command
    submit_parser = subparsers.add_parser("submit", help="Submit a new job")
    submit_parser.add_argument("--zid", required=True, help="Conversation ID (zid)")
    submit_parser.add_argument("--job-type", default="FULL_PIPELINE", 
                               choices=["FULL_PIPELINE", "PCA", "UMAP", "REPORT"],
                               help="Type of job to submit")
    submit_parser.add_argument("--priority", type=int, default=50, 
                               help="Job priority (0-100)")
    submit_parser.add_argument("--max-votes", help="Maximum votes to process")
    submit_parser.add_argument("--batch-size", help="Batch size for processing")
    
    # List command
    list_parser = subparsers.add_parser("list", help="List jobs")
    list_parser.add_argument("--status", 
                             choices=["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
                             help="Filter by status")
    list_parser.add_argument("--limit", type=int, default=10,
                             help="Maximum number of jobs to list")
    
    # Details command
    details_parser = subparsers.add_parser("details", help="View job details")
    details_parser.add_argument("job_id", help="Job ID to view details for")
    
    # Common options
    parser.add_argument("--endpoint-url", help="DynamoDB endpoint URL")
    parser.add_argument("--region", default="us-west-2", help="AWS region")
    
    # Interactive mode is the default when no arguments are provided
    parser.add_argument("--interactive", action="store_true", 
                        help="Run in interactive mode")
    
    args = parser.parse_args()
    
    # Set up DynamoDB connection
    dynamodb = setup_dynamodb(
        endpoint_url=args.endpoint_url,
        region=args.region
    )
    
    # Create header
    create_elegant_header()
    
    # No arguments or interactive flag - go to interactive mode
    if len(sys.argv) == 1 or args.interactive:
        interactive_mode()
        return
    
    # Handle commands
    if args.command == "submit":
        job_id = submit_job(
            dynamodb=dynamodb,
            zid=args.zid,
            job_type=args.job_type,
            priority=args.priority,
            max_votes=args.max_votes,
            batch_size=args.batch_size
        )
        
        if RICH_AVAILABLE and IS_TERMINAL:
            console.print(f"[bold green]Job submitted with ID: {job_id}[/bold green]")
        else:
            print(f"Job submitted with ID: {job_id}")
    
    elif args.command == "list":
        jobs = list_jobs(
            dynamodb=dynamodb,
            status=args.status,
            limit=args.limit
        )
        display_jobs(jobs)
    
    elif args.command == "details":
        job = get_job_details(
            dynamodb=dynamodb,
            job_id=args.job_id
        )
        display_job_details(job)

if __name__ == "__main__":
    main()