FROM public.ecr.aws/lambda/python:3.10

# Install system dependencies
RUN yum update -y && yum install -y \
    gcc \
    g++ \
    make \
    git \
    && yum clean all

# Copy requirements and install dependencies
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install EVOC from the local directory
COPY ../evoc-main ${LAMBDA_TASK_ROOT}/evoc-main
WORKDIR ${LAMBDA_TASK_ROOT}/evoc-main
RUN pip install -e .
WORKDIR ${LAMBDA_TASK_ROOT}

# Install other dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . ${LAMBDA_TASK_ROOT}/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=${LAMBDA_TASK_ROOT}
ENV LOG_LEVEL=INFO
ENV MODEL_CACHE_DIR=/tmp/model_cache

# Create model cache directory
RUN mkdir -p ${MODEL_CACHE_DIR} && chmod 777 ${MODEL_CACHE_DIR}

# Set the Lambda handler
CMD ["polismath_commentgraph.lambda_handler.lambda_handler"]