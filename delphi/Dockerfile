FROM python:3.12-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        build-essential \
        cmake \
        gcc \
        g++ \
        gfortran \
        libopenblas-dev \
        curl \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision torchaudio
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir colorlog fastapi==0.115.0 pydantic

RUN git clone https://github.com/TutteInstitute/evoc && \
    cd evoc && \
    pip install --no-cache-dir .

FROM python:3.12-slim AS final

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY polismath/ ./polismath/
COPY scripts/ ./scripts/
COPY umap_narrative/ ./umap_narrative/

RUN mkdir -p data

EXPOSE 8080

ENV PYTHONPATH "${PYTHONPATH}:/app"

COPY start_poller.sh .
COPY run_delphi.sh .
COPY run_delphi.py .
COPY create_dynamodb_tables.py .
COPY setup_minio.py .
COPY scripts/setup_ollama.sh ./setup_ollama.sh
RUN chmod +x start_poller.sh run_delphi.sh run_delphi.py setup_ollama.sh

CMD ["bash", "-c", "\
    echo 'Ensuring DynamoDB tables are set up (runs in all environments)...'; \
    python create_dynamodb_tables.py && \
    echo 'DynamoDB table setup script finished.'; \
    \
    if [ -n \"${DYNAMODB_ENDPOINT}\" ]; then \
      echo 'DYNAMODB_ENDPOINT is set (value: \"${DYNAMODB_ENDPOINT}\"), assuming local/dev environment. Running additional local setup scripts...'; \
      echo 'Setting up MinIO bucket...' && python setup_minio.py && \
      echo 'Setting up Ollama model (local script)...' && ./setup_ollama.sh; \
    else \
      echo 'DYNAMODB_ENDPOINT is not set, assuming production-like environment. Skipping MinIO and local Ollama setup scripts.'; \
    fi && \
    \
    echo 'Starting job poller...' && \
    python scripts/job_poller.py --interval=2\
"]
