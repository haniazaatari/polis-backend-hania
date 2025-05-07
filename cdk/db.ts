import { Construct } from "constructs";
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export default (self: Construct, vpc: cdk.aws_ec2.IVpc) => {
  const dbSubnetGroup = new rds.SubnetGroup(self, 'DatabaseSubnetGroup', {
    vpc,
    subnetGroupName: 'PolisDatabaseSubnetGroup',
    description: 'Subnet group for the postgres database',
    vpcSubnets: { subnetGroupName: 'Private' },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });
  
  const db = new rds.DatabaseInstance(self, 'Database', {
    engine: rds.DatabaseInstanceEngine.postgres({version: rds.PostgresEngineVersion.VER_17 }),
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
    vpc,
    allocatedStorage: 20,
    storageType: rds.StorageType.GP2,
    credentials: rds.Credentials.fromGeneratedSecret('dbUser'),
    databaseName: 'polisdb',
    removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    deletionProtection: true,
    publiclyAccessible: false,
    subnetGroup: dbSubnetGroup,
  });
  
  // SSM Parameters for DB connection
  const dbSecretArnParam = new ssm.StringParameter(self, 'DBSecretArnParameter', {
    parameterName: '/polis/db-secret-arn',
    stringValue: db.secret!.secretArn,
    description: 'SSM Parameter storing the ARN of the Polis Database Secret',
  });
  const dbHostParam = new ssm.StringParameter(self, 'DBHostParameter', {
    parameterName: '/polis/db-host',
    stringValue: db.dbInstanceEndpointAddress,
    description: 'SSM Parameter storing the Polis Database Host',
  });
  const dbPortParam = new ssm.StringParameter(self, 'DBPortParameter', {
    parameterName: '/polis/db-port',
    stringValue: db.dbInstanceEndpointPort,
    description: 'SSM Parameter storing the Polis Database Port',
  });

  return { dbSubnetGroup, db, dbSecretArnParam, dbHostParam, dbPortParam }
}
