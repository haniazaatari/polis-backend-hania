"""
Data models for the Delphi job system.
"""

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any

class JobStatus(Enum):
    """Status of a job in the job queue."""
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class JobType(Enum):
    """Type of job to be processed."""
    FULL_PIPELINE = "FULL_PIPELINE"
    NARRATIVE_BATCH = "NARRATIVE_BATCH"
    BATCH_STATUS_CHECK = "BATCH_STATUS_CHECK"
    
    @classmethod
    def from_string(cls, job_type_str: str) -> "JobType":
        """Convert string to JobType, with fallback to FULL_PIPELINE."""
        try:
            return cls(job_type_str)
        except ValueError:
            return cls.FULL_PIPELINE

@dataclass
class JobLog:
    """Log entries for a job."""
    entries: List[Dict[str, str]] = field(default_factory=list)
    
    def add_entry(self, level: str, message: str):
        """Add a log entry with timestamp."""
        self.entries.append({
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "message": message
        })
    
    def get_latest(self, count: int = 10) -> List[Dict[str, str]]:
        """Get the latest N log entries."""
        return self.entries[-count:] if self.entries else []

@dataclass
class Job:
    """A job in the job queue."""
    job_id: str
    conversation_id: str
    status: JobStatus = JobStatus.PENDING
    job_type: JobType = JobType.FULL_PIPELINE
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    worker_id: Optional[str] = None
    version: int = 1
    logs: JobLog = field(default_factory=JobLog)
    job_config: Dict[str, Any] = field(default_factory=dict)
    job_results: Dict[str, Any] = field(default_factory=dict)
    
    # For batch jobs
    batch_id: Optional[str] = None
    batch_job_id: Optional[str] = None
    batch_check_time: Optional[str] = None
    
    # Additional fields
    report_id: Optional[str] = None
    timeout_seconds: int = 3600
    environment: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert job to DynamoDB format dictionary."""
        result = {
            "job_id": self.job_id,
            "conversation_id": self.conversation_id,
            "status": self.status.value,
            "job_type": self.job_type.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "version": self.version,
            "logs": json.dumps({"entries": self.logs.entries}),
            "job_config": json.dumps(self.job_config)
        }
        
        # Add optional fields if they exist
        if self.started_at:
            result["started_at"] = self.started_at
        if self.completed_at:
            result["completed_at"] = self.completed_at
        if self.worker_id:
            result["worker_id"] = self.worker_id
        if self.job_results:
            result["job_results"] = json.dumps(self.job_results)
        if self.batch_id:
            result["batch_id"] = self.batch_id
        if self.batch_job_id:
            result["batch_job_id"] = self.batch_job_id
        if self.batch_check_time:
            result["batch_check_time"] = self.batch_check_time
        if self.report_id:
            result["report_id"] = self.report_id
        if self.environment:
            result["environment"] = self.environment
        
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Job":
        """Create a Job from a DynamoDB item dictionary."""
        # Extract basic fields
        job = cls(
            job_id=data["job_id"],
            conversation_id=data["conversation_id"],
            status=JobStatus(data.get("status", "PENDING")),
            job_type=JobType.from_string(data.get("job_type", "FULL_PIPELINE")),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            worker_id=data.get("worker_id"),
            version=int(data.get("version", 1)),
            report_id=data.get("report_id"),
            timeout_seconds=int(data.get("timeout_seconds", 3600))
        )
        
        # Parse logs
        if "logs" in data:
            try:
                logs_data = json.loads(data["logs"])
                job.logs.entries = logs_data.get("entries", [])
            except (json.JSONDecodeError, TypeError):
                job.logs = JobLog()
        
        # Parse job_config
        if "job_config" in data:
            try:
                job.job_config = json.loads(data["job_config"])
            except (json.JSONDecodeError, TypeError):
                job.job_config = {}
                
        # Parse job_results
        if "job_results" in data:
            try:
                job.job_results = json.loads(data["job_results"])
            except (json.JSONDecodeError, TypeError):
                job.job_results = {}
        
        # Parse batch fields
        job.batch_id = data.get("batch_id")
        job.batch_job_id = data.get("batch_job_id")
        job.batch_check_time = data.get("batch_check_time")
        
        # Parse environment variables
        if "environment" in data and isinstance(data["environment"], dict):
            job.environment = data["environment"]
        
        return job