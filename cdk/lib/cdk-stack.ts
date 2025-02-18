import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';

interface PolisStackProps extends cdk.StackProps {
  domainName?: string;
  enableSSHAccess?: boolean; // Make optional, default to false
  envFile: string;
  branch?: string;
  sshAllowedIpRange?: string; // Add a property for SSH access control
  webKeyPairName?: string;    // Key pair for web instances
  mathWorkerKeyPairName?: string; // Key pair for math worker
}
const defaultBranch = 'edge';

function createPolisUserData(props: PolisStackProps, isMathWorker: boolean, databaseEndpoint: string, dbUser:string): ec2.UserData {
  const userData = ec2.UserData.forLinux();

  const baseCommands = [
      '#!/bin/bash',
      'set -e',
      'set -x',
      'dnf update -y',
      'dnf install -y docker git',
      'systemctl start docker',
      'systemctl enable docker',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
  ];

  // Read environment file and modify DATABASE_URL
  const envContent = readFileSync(props.envFile, 'utf8');
  const databaseUrl = `postgres://${dbUser}:${dbUser}@${databaseEndpoint}/polisdb`; // Construct URL
  const modifiedEnvContent = envContent.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`);

  const appCommands = [
      'cd /opt',
      'git clone https://github.com/compdemocracy/polis.git polis',
      'cd /opt/polis',
      `git checkout ${props.branch || defaultBranch}`,
      'cat > .env << \'ENVEOF\'',
      modifiedEnvContent, // Use modified content
      'ENVEOF',
      `cd ${isMathWorker ? 'math' : 'server'}`,
      `docker pull compdemocracy/polis-${isMathWorker ? 'math' : 'server'}:latest`,
      'docker run -d \\',
      `    --name polis-${isMathWorker ? 'math' : 'server'} \\`,
      '    --restart unless-stopped \\',
      '    --memory-reservation=2g \\',
      '    --memory=$(free -b | awk \'/Mem:/ {printf "%.0f", $2*0.8}\') \\',
      '    --env-file ../.env \\', // Use the modified .env file
      `    compdemocracy/polis-${isMathWorker ? 'math' : 'server'}:latest`,
  ];

  userData.addCommands(...baseCommands, ...appCommands);
  return userData;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PolisStackProps) {
    super(scope, id, props);

    // if (!props.domainName) {
    //   throw new Error("domainName is a required property.");
    // }

    const defaultSSHRange = '0.0.0.0/0';

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
      }]
    });

    const instanceTypeWeb = ec2.InstanceType.of(ec2.InstanceClass.M3, ec2.InstanceSize.MEDIUM);
    const machineImageWeb = new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2 });
    const instanceTypeMathWorker = ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE2);
    const machineImageMathWorker = new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2 });

    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc,
      description: 'Allow HTTP and SSH access to web instances',
      allowAllOutbound: true,
    });

    const mathWorkerSecurityGroup = new ec2.SecurityGroup(this, 'MathWorkerSG', {
      vpc,
      description: 'Security group for Polis math worker',
      allowAllOutbound: true,
    });

    if (props.enableSSHAccess) {
      webSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.sshAllowedIpRange || defaultSSHRange), ec2.Port.tcp(22), 'Allow SSH access');
      mathWorkerSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.sshAllowedIpRange || defaultSSHRange), ec2.Port.tcp(22), 'Allow SSH access');
    }
    // Create key pair for web instances if SSH is enabled and a key name is provided
    let webKeyPair;
    if (props.enableSSHAccess && props.webKeyPairName) {
        webKeyPair = new ec2.CfnKeyPair(this, 'WebKeyPair', {
            keyName: props.webKeyPairName,
        });
    }

    // Create key pair for math instance if SSH is enabled and a key name is provided
    let mathWorkerKeyPair;
    if (props.enableSSHAccess && props.mathWorkerKeyPairName) {
      mathWorkerKeyPair = new ec2.CfnKeyPair(this, 'MathWorkerKeyPair', {
        keyName: props.mathWorkerKeyPairName
      });
    }


    // Create IAM role for the math instance
    const mathRole = new iam.Role(this, 'MathWorkerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    mathRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );

    // ALB Security Group - Allow HTTP/HTTPS from anywhere
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LBSecurityGroup', {
        vpc,
        description: 'Security group for the load balancer',
        allowAllOutbound: true,
    });
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from anywhere');


    // --- Web ASG ---
    webSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.sshAllowedIpRange || defaultSSHRange), ec2.Port.tcp(22), 'Allow SSH'); // Control SSH separately
    webSecurityGroup.addIngressRule(lbSecurityGroup, ec2.Port.tcp(80), 'Allow HTTP from ALB');  // ONLY from ALB! - do we need to add to 443 as well?

    // --- Postgres ---
    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({version: rds.PostgresEngineVersion.VER_17_2 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      credentials: rds.Credentials.fromGeneratedSecret('dbUser'),
      databaseName: 'polisdb',
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: true,
      publiclyAccessible: false
    });

    // Get the database endpoint address AFTER the DB is created
    const databaseEndpoint = db.dbInstanceEndpointAddress;
     // Get the generated secret
    const dbSecret = db.secret;
    if (!dbSecret) {
      throw new Error("Database secret is undefined.");
    }
    const dbUser = dbSecret.secretValueFromJson('username').unsafeUnwrap();

    const asgWeb = new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      instanceType: instanceTypeWeb,
      machineImage: machineImageWeb,
      minCapacity: 2,
      maxCapacity: 10,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: webSecurityGroup,
        keyPair: props.enableSSHAccess && webKeyPair ?
            ec2.KeyPair.fromKeyPairName(this, 'ImportedWebKeyPair', webKeyPair.keyName) :
            undefined, // Conditionally add key pair
      userData: createPolisUserData(props, false, databaseEndpoint, dbUser),
    });

    const asgMathWorker = new autoscaling.AutoScalingGroup(this, 'AsgMathWorker', {
      vpc,
      instanceType: instanceTypeMathWorker,
      machineImage: machineImageMathWorker,
      minCapacity: 1,
      maxCapacity: 5,
      securityGroup: mathWorkerSecurityGroup,
      keyPair: props.enableSSHAccess && mathWorkerKeyPair?
        ec2.KeyPair.fromKeyPairName(this, 'ImportedMathWorkerKeyPair', mathWorkerKeyPair.keyName) :
        undefined, // Conditionally add
      role: mathRole,
      userData: createPolisUserData(props, true, databaseEndpoint, dbUser),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

     // Allow traffic from the web ASG to the database
     db.connections.allowFrom(asgWeb, ec2.Port.tcp(5432), 'Allow database access from web ASG');
     db.connections.allowFrom(asgMathWorker, ec2.Port.tcp(5432), 'Allow database access from math ASG');

    // ELB
    const lb = new elbv2.ApplicationLoadBalancer(this, 'Lb', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup, // Use the dedicated ALB security group
    });

    const listener = lb.addListener('Listener', { port: 80 });
    listener.addTargets('Target', {
      port: 80,
      targets: [asgWeb], // web app accessible from port 80
    });

    // Route53 - implimenting later
    // const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props?.domainName as string });
    // new route53.ARecord(this, 'ARecord', {
    //   zone,
    //   recordName: props?.domainName,
    //   target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
    // });

    // CloudWatch Logging
    const logGroup = new logs.LogGroup(this, 'LogGroup');
    asgWeb.node.addDependency(logGroup);
    asgMathWorker.node.addDependency(logGroup);
    asgWeb.node.addDependency(db);
    asgMathWorker.node.addDependency(db);

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: lb.loadBalancerDnsName,
    });
  }
}
