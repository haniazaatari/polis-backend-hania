# Use an official Python runtime as a parent image
# Using 3.12 as recommended in QUICK_START.md
FROM python:3.12-slim

# Set environment variables
# Prevent Python from writing pyc files to disc
ENV PYTHONDONTWRITEBYTECODE=1
# Ensure Python output is sent straight to terminal
ENV PYTHONUNBUFFERED=1

# Install dependencies needed for building packages and cloning evoc
RUN apt-get update && \
    apt-get install -y git build-essential cmake \
    gcc g++ gfortran libopenblas-dev curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
    

# Set the working directory in the container
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt
# Install additional dependencies needed for the orchestrator and make sure they're in the path
RUN pip install --no-cache-dir colorlog fastapi==0.115.0 pydantic
# Verify FastAPI installation
RUN pip list | grep fastapi

# Clone and install evoc
RUN git clone https://github.com/TutteInstitute/evoc && \
    cd evoc && \
    pip install .

# Copy all the necessary files for the application
COPY polismath/ ./polismath/
COPY scripts/ ./scripts/
COPY umap_narrative/ ./umap_narrative/

# Create data directory
RUN mkdir -p data

# Make port 8080 available to the world outside this container
# Default port seems to be 8080 based on server.py
# Use ARG/ENV to make this configurable if needed
EXPOSE 8080

# Set PYTHONPATH to include current directory
ENV PYTHONPATH "${PYTHONPATH}:/app"

# Copy the required scripts and make them executable
COPY start_poller.sh .
COPY run_delphi.sh .
COPY create_dynamodb_tables.py .
COPY setup_minio.py .
COPY scripts/setup_ollama.sh ./setup_ollama.sh
RUN chmod +x start_poller.sh run_delphi.sh setup_ollama.sh

# Command to:
# 1. Initialize DynamoDB tables
# 2. Set up the Ollama model based on environment variables
# 3. Start the job poller with a 2-second polling interval
CMD ["bash", "-c", "echo 'Setting up DynamoDB tables...' && python create_dynamodb_tables.py --endpoint-url=${DYNAMODB_ENDPOINT:-http://dynamodb:8000} && echo 'Setting up MinIO bucket...' && python setup_minio.py && echo 'Setting up Ollama model...' && ./setup_ollama.sh && echo 'Starting job poller...' && POLL_INTERVAL=2 ./start_poller.sh"]
