"""
Security utilities for the Delphi job system.
"""

import logging
import re
from typing import Dict, List, Set

logger = logging.getLogger("delphi.security")

# List of allowed environment variable prefixes
ALLOWED_ENV_PREFIXES = [
    "DELPHI_",
    "AWS_",
    "ANTHROPIC_",
    "OPENAI_",
    "OLLAMA_",
    "PYTHONPATH"
]

# Regular expression for validating environment variable names
ENV_NAME_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

# Maximum environment variable value length
MAX_ENV_VALUE_LENGTH = 1024

def validate_environment_variables(env_vars: Dict[str, str]) -> Dict[str, str]:
    """
    Validate and sanitize environment variables.
    
    Args:
        env_vars: Dictionary of environment variables
        
    Returns:
        Dictionary of validated variables
    """
    valid_vars = {}
    
    for name, value in env_vars.items():
        # Check if name is valid
        if not ENV_NAME_PATTERN.match(name):
            logger.warning(f"Invalid environment variable name: {name}")
            continue
        
        # Check if name has an allowed prefix
        if not any(name.startswith(prefix) for prefix in ALLOWED_ENV_PREFIXES):
            logger.warning(f"Environment variable {name} does not have an allowed prefix")
            continue
        
        # Check value length
        if len(str(value)) > MAX_ENV_VALUE_LENGTH:
            logger.warning(f"Environment variable {name} value exceeds maximum length")
            continue
        
        # Variable passed all checks
        valid_vars[name] = str(value)
    
    return valid_vars