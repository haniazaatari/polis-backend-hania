# Polis Math Lambda Functions

This directory contains AWS Lambda functions for the Python-based implementation of the Polis math system.

## Biodiversity Lambda Function

The `biodiversity_lambda.py` file contains a Lambda function for processing the biodiversity dataset using the Python math implementation. This function can:

1. Connect to a PostgreSQL database to fetch votes and moderation data
2. Process the conversation data using the Polis math algorithms
3. Write the results to DynamoDB

### Usage

The function can be deployed as an AWS Lambda function or run locally for testing.

#### Lambda Deployment

To deploy the function to AWS Lambda:

1. Install dependencies:
   ```
   pip install -r requirements.txt -t ./package
   ```

2. Add the function code:
   ```
   cp biodiversity_lambda.py package/
   ```

3. Package the function:
   ```
   cd package
   zip -r ../biodiversity_lambda.zip .
   cd ..
   ```

4. Deploy to AWS Lambda using the AWS CLI:
   ```
   aws lambda create-function \
     --function-name polis-biodiversity \
     --runtime python3.9 \
     --handler biodiversity_lambda.lambda_handler \
     --memory-size 1024 \
     --timeout 300 \
     --role YOUR_LAMBDA_ROLE_ARN \
     --zip-file fileb://biodiversity_lambda.zip
   ```

5. Set environment variables in the Lambda console:
   - `DB_HOST`: PostgreSQL database host
   - `DB_NAME`: Database name
   - `DB_USER`: Database username
   - `DB_PASSWORD`: Database password
   - `DB_PORT`: Database port (typically 5432)

#### Local Testing

The function can also be run locally for testing:

```
python biodiversity_lambda.py --db-host localhost --db-name polis_subset --db-user postgres --db-password postgres
```

Optional arguments:
- `--conversation-id ID`: Process a specific conversation ID (default: auto-detect biodiversity conversation)
- `--limit N`: Limit to N votes (for testing, default: 0 = no limit)
- `--local-dynamo`: Use a local DynamoDB instance
- `--dynamo-endpoint URL`: Custom DynamoDB endpoint (default: http://localhost:8000)

### Function Parameters

The Lambda function accepts an event with the following parameters:

```json
{
  "config": {
    "db_host": "your-database-host",
    "db_name": "polis",
    "db_user": "postgres",
    "db_password": "your-password",
    "db_port": 5432,
    "use_local_dynamo": "false",
    "dynamo_endpoint": "http://localhost:8000",
    "math_table_name": "polis_math",
    "conv_table_name": "polis_conversations"
  },
  "conversation_id": "3atycmhmer",
  "vote_limit": 0
}
```

If `conversation_id` is not provided, the function will attempt to find a biodiversity-related conversation.

### Return Value

The function returns a JSON response with processing results:

```json
{
  "statusCode": 200,
  "body": {
    "conversation_id": "3atycmhmer",
    "processing_time": 12.34,
    "groups": 3,
    "comments": 42,
    "participants": 156,
    "success": true
  }
}
```

In case of errors, it returns:

```json
{
  "statusCode": 500,
  "body": {
    "message": "Error processing request",
    "error": "Error details"
  }
}
```