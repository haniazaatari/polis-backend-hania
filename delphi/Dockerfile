# Use an official Python runtime as a parent image
# Using 3.12 as recommended in QUICK_START.md
FROM python:3.12-slim

# Set environment variables
# Prevent Python from writing pyc files to disc
ENV PYTHONDONTWRITEBYTECODE=1
# Ensure Python output is sent straight to terminal
ENV PYTHONUNBUFFERED=1

# Install git (needed to clone evoc)
RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Clone and install evoc
RUN git clone https://github.com/TutteInstitute/evoc && \
    cd evoc && \
    pip install .

# Copy all the necessary files for the application
COPY setup.py .
COPY polismath/ ./polismath/

# Create data directory
RUN mkdir -p data

# Make port 8080 available to the world outside this container
# Default port seems to be 8080 based on server.py
# Use ARG/ENV to make this configurable if needed
EXPOSE 8080

# Define the command to run the application
# This will execute 'polismath' when the container launches
# Add any default arguments needed, e.g., config file path if required
CMD ["polismath"]
