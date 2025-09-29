# handler.py
import os
import subprocess
import boto3
import json
import datetime

def lambda_handler(event, context):
    ssm_client = boto3.client('ssm')
    secrets_client = boto3.client('secretsmanager')

    # --- Fetch ALL Configuration Programmatically ---

    # 1. Get Secret ARN from SSM
    secret_arn_param = ssm_client.get_parameter(Name='/polis/db-secret-arn')
    secret_arn = secret_arn_param['Parameter']['Value']

    # 2. Get DB Host from SSM
    db_host_param = ssm_client.get_parameter(Name='/polis/db-host')
    db_host = db_host_param['Parameter']['Value']

    # 3. Get Backup Bucket Name from SSM
    bucket_name_param = ssm_client.get_parameter(Name='/polis/db-backup-bucket-name')
    bucket_name = bucket_name_param['Parameter']['Value']
    
    # 4. Retrieve Secret Value from Secrets Manager
    secret_payload = secrets_client.get_secret_value(SecretId=secret_arn)['SecretString']
    secret_data = json.loads(secret_payload)
    
    db_user = secret_data['username']
    db_password = secret_data['password']
    db_name = secret_data['dbname']
    # ----------------------------------------------------

    # The rest of the script is unchanged...
    timestamp = datetime.datetime.now().strftime('%Y-%m-%d-%H-%M-%S')
    filename = f'polis-backup-{timestamp}.dump'
    filepath = f'/tmp/{filename}'
    
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password
    
    command = [
        '/usr/bin/pg_dump',
        '-h', db_host,
        '-U', db_user,
        '-d', db_name,
        '-F', 'c', 
        '-f', filepath,
        '--no-owner',
        '--no-privileges'
    ]
    
    try:
        print("Running pg_dump command...")
        subprocess.run(command, env=env, check=True, capture_output=True, text=True)
        print("pg_dump completed successfully.")
        
        print(f"Uploading {filepath} to s3://{bucket_name}/{filename}...")
        s3_client = boto3.client('s3')
        s3_client.upload_file(filepath, bucket_name, filename)
        print("Upload complete.")
        
    except subprocess.CalledProcessError as e:
        print(f"pg_dump failed. Stderr: {e.stderr}")
        raise e
    finally:
        if os.path.exists(filepath):
            os.remove(filepath)

    return {'status': 'success', 'filename': filename}