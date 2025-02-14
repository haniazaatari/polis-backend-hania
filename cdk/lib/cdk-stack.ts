import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

interface PolisStackProps extends cdk.StackProps {
  domainName: string;
  dynamoTable: dynamodb.Table;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PolisStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 });

    // EC2 Instances
    const instanceTypeWeb = ec2.InstanceType.of(ec2.InstanceClass.M3, ec2.InstanceSize.MEDIUM);
    const machineImageWeb = new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2 });

    const instanceTypeMathWorker = ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE2);
    const machineImageMathWorker = new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2 });

    const asgWeb = new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      instanceType: instanceTypeWeb,
      machineImage: machineImageWeb,
      minCapacity: 2,
      maxCapacity: 10,
    });

    const asgMathWorker = new autoscaling.AutoScalingGroup(this, 'AsgMathWorker', {
      vpc,
      instanceType: instanceTypeMathWorker,
      machineImage: machineImageMathWorker,
      minCapacity: 1,
      maxCapacity: 5,
    });

    // ELB
    const lb = new elbv2.ApplicationLoadBalancer(this, 'Lb', {
      vpc,
      internetFacing: true,
    });

    const listener = lb.addListener('Listener', { port: 80 });
    listener.addTargets('Target', {
      port: 80,
      targets: [asgWeb], // web app accessible from port 80
    });

    // postres
    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2, // General Purpose SSD
      credentials: rds.Credentials.fromGeneratedSecret('dbUser'),
      databaseName: 'postgresql-aws',
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT, // Destroy the database instance when the stack is deleted, but retain a snapshot
      deletionProtection: true,
      publiclyAccessible: false
    });

    // Route53
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props?.domainName as string });
    new route53.ARecord(this, 'ARecord', {
      zone,
      recordName: props?.domainName,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
    });

    // CloudWatch Logging
    const logGroup = new logs.LogGroup(this, 'LogGroup');
    asgWeb.addUserData(`#!/bin/bash\necho "Log Stream: {instance_id}" > /var/tmp/logstream.txt`); // Customize log stream name
    asgWeb.node.addDependency(logGroup); // Ensure log group exists before instances start
    asgMathWorker.addUserData(`#!/bin/bash\necho "Log Stream: {instance_id}" > /var/tmp/logstream.txt`); // Customize log stream name
    asgMathWorker.node.addDependency(logGroup); // Ensure log group exists before instances start
    //TODO further cloudwatch config

    //TODO dynamo

    //TODO s3
  }
}
