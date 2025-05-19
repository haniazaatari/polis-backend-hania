"""
Logging configuration for the Delphi job system.
"""

import logging
import sys
from typing import Optional

def configure_logging(level: str = "INFO", log_file: Optional[str] = None):
    """
    Configure logging for the job system.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional path to log file
    """
    # Set numeric level
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    # Clear existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create formatter
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Create file handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(numeric_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    
    # Configure specific loggers
    for logger_name in [
        "delphi", 
        "delphi.db", 
        "delphi.handlers", 
        "delphi.poller", 
        "delphi.worker",
        "delphi.process",
        "delphi.security"
    ]:
        logger = logging.getLogger(logger_name)
        logger.setLevel(numeric_level)