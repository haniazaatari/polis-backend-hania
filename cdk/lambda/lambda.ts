import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';



const createDBBackupLambda = (self: Construct, db: cdk.aws_rds.DatabaseInstance, vpc: cdk.aws_ec2.IVpc, dbBackupBucket: cdk.aws_s3.Bucket, dbBackupLambdaRole: iam.Role) => {
  return new lambda.Function(self, 'DBBackupLambda', {
    runtime: lambda.Runtime.PYTHON_3_9,
    handler: 'handler.lambda_handler',
    code: lambda.Code.fromAsset('lambda/handler'),
    vpc: vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [db.connections.securityGroups[0]],
    role: dbBackupLambdaRole,
    timeout: cdk.Duration.minutes(10),
    memorySize: 512,
    environment: {
      BACKUP_BUCKET_NAME: dbBackupBucket.bucketName,
    },
  });
}

export { createDBBackupLambda }