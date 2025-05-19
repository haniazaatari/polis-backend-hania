"""
Configuration management for the job system.
"""

import os
from typing import Dict, Any, Optional

class Config:
    """Configuration management for the job system."""
    
    def __init__(self):
        """Initialize default configuration."""
        self.settings = {
            # Database settings
            "dynamodb_endpoint": os.environ.get("DYNAMODB_ENDPOINT", "http://localhost:8000"),
            "dynamodb_region": os.environ.get("AWS_REGION", "us-west-2"),
            "table_name": "Delphi_JobQueue",
            
            # Worker settings
            "polling_interval": int(os.environ.get("DELPHI_POLLING_INTERVAL", "10")),
            "max_workers": int(os.environ.get("DELPHI_MAX_WORKERS", "1")),
            
            # Process settings
            "default_timeout": int(os.environ.get("DELPHI_DEFAULT_TIMEOUT", "3600")),
            "max_output_lines": int(os.environ.get("DELPHI_MAX_OUTPUT_LINES", "1000")),
            
            # Path settings
            "run_delphi_path": os.environ.get("DELPHI_RUN_SCRIPT", "./run_delphi.sh"),
            "narrative_batch_script": os.environ.get(
                "DELPHI_NARRATIVE_BATCH_SCRIPT", 
                "/app/umap_narrative/801_narrative_report_batch.py"
            ),
            "batch_status_script": os.environ.get(
                "DELPHI_BATCH_STATUS_SCRIPT", 
                "/app/umap_narrative/803_check_batch_status.py"
            ),
            
            # Default job settings
            "default_model": os.environ.get("DELPHI_DEFAULT_MODEL", "claude-3-5-sonnet-20241022"),
            "default_batch_size": int(os.environ.get("DELPHI_DEFAULT_BATCH_SIZE", "20")),
        }
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.settings.get(key, default)
    
    def update(self, settings: Dict[str, Any]):
        """Update configuration with new settings."""
        self.settings.update(settings)
    
    def from_env(self, prefix: str = "DELPHI_"):
        """Load configuration from environment variables with a given prefix."""
        for key, value in os.environ.items():
            if key.startswith(prefix):
                # Convert to lower case and remove prefix
                config_key = key[len(prefix):].lower()
                
                # Convert numeric values
                if value.isdigit():
                    value = int(value)
                elif value.lower() in ("true", "false"):
                    value = value.lower() == "true"
                
                self.settings[config_key] = value

# Global configuration instance
config = Config()