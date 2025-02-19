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
import * as cr from 'aws-cdk-lib/custom-resources';
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

function createPolisUserData(props: PolisStackProps, isMathWorker: boolean, databaseEndpoint: string): ec2.UserData {
  const userData = ec2.UserData.forLinux();

  const baseCommands = [
    '#!/bin/bash',
    'set -e',
    'set -x',
    // Use yum instead of dnf
    'yum update -y',
    'yum install -y docker git',
    'systemctl start docker',
    'systemctl enable docker',
    // Improved logging
    'exec 1>>/var/log/user-data.log 2>&1',
    'echo "Starting User Data Execution at $(date)"', // Timestamp
    'pwd',
    'ls -l',
  ];

  // Read environment file and modify DATABASE_URL
  const envContent = readFileSync(props.envFile, 'utf8');
  const modifiedEnvContent = envContent.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseEndpoint}`);

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
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // Use PRIVATE_ISOLATED
        },
      ]
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

    // Key Pair Creation
    let webKeyPairName = props.webKeyPairName;
    if (props.enableSSHAccess && !webKeyPairName) {
      webKeyPairName = `${id}-WebKeyPair-${this.region}`;
      new ec2.CfnKeyPair(this, 'WebKeyPair', {
        keyName: webKeyPairName,
      });
    }

    let mathWorkerKeyPairName = props.mathWorkerKeyPairName;
    if (props.enableSSHAccess && !mathWorkerKeyPairName) {
      mathWorkerKeyPairName = `${id}-MathWorkerKeyPair-${this.region}`;
      new ec2.CfnKeyPair(this, 'MathWorkerKeyPair', {
        keyName: mathWorkerKeyPairName,
      });
    }

    // Create IAM role for the math instance
    const mathRole = new iam.Role(this, 'MathWorkerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    mathRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );

    // Create IAM role for the web instance
    const webRole = new iam.Role(this, 'WebRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    webRole.addManagedPolicy(
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
    webSecurityGroup.addIngressRule(lbSecurityGroup, ec2.Port.tcp(80), 'Allow HTTP from ALB');  // ONLY from ALB!

    // --- Postgres ---

    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc,
      subnetGroupName: 'PolisDatabaseSubnetGroup', // Give it a name
      description: 'Subnet group for the postgres database', // Add a description
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      credentials: rds.Credentials.fromGeneratedSecret('dbUser'),
      databaseName: 'polisdb',
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      // deletionProtection: true, // turned off for now until preprod / prod phase
      publiclyAccessible: false,
      subnetGroup: dbSubnetGroup,
    });

    const databaseUrl = `postgres://${db.secret?.secretValueFromJson('username').unsafeUnwrap()}:${db.secret?.secretValueFromJson('password').unsafeUnwrap()}@${db.instanceEndpoint.socketAddress}:${db.dbInstanceEndpointPort}/polisdb`;

    // --- Launch Templates ---
    const webLaunchTemplate = new ec2.LaunchTemplate(this, 'WebLaunchTemplate', {
      machineImage: machineImageWeb,
      userData: createPolisUserData(props, false, databaseUrl),
      instanceType: instanceTypeWeb,
      securityGroup: webSecurityGroup,
      keyName: props.enableSSHAccess && props.webKeyPairName ? props.webKeyPairName : undefined, // Conditionally add key pair
      role: webRole,
  });

    const mathWorkerLaunchTemplate = new ec2.LaunchTemplate(this, 'MathWorkerLaunchTemplate', {
      machineImage: machineImageMathWorker,
      userData: createPolisUserData(props, true, databaseUrl),
      instanceType: instanceTypeMathWorker,
      securityGroup: mathWorkerSecurityGroup,
      keyName: props.enableSSHAccess && props.mathWorkerKeyPairName ? props.mathWorkerKeyPairName : undefined,
      role: mathRole,
    });

    const asgWeb = new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      launchTemplate: webLaunchTemplate,
      minCapacity: 2,
      maxCapacity: 10,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      signals: autoscaling.Signals.waitForMinCapacity({
        minSuccessPercentage: 90,
        // Optional: Add a warm-up period:
        // timeout: cdk.Duration.minutes(10),
      }),
    });

    const asgMathWorker = new autoscaling.AutoScalingGroup(this, 'AsgMathWorker', {
      vpc,
      launchTemplate: mathWorkerLaunchTemplate,
      minCapacity: 1,
      maxCapacity: 5,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      signals: autoscaling.Signals.waitForMinCapacity({
        minSuccessPercentage: 90,
        // Optional: Add a warm-up period:
        // timeout: cdk.Duration.minutes(10),
      }),
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

    // Custom Resource to update the default version of Web Launch Template
    const getLatestWebLTVersion = new cr.AwsCustomResource(this, 'GetLatestWebLTVersion', {
      onCreate: {
        service: 'EC2',
        action: 'describeLaunchTemplateVersions',
        parameters: {
          LaunchTemplateId: webLaunchTemplate.launchTemplateId,
          Versions: ['$Latest']
      },
      physicalResourceId: cr.PhysicalResourceId.of(`${id}-GetLatestWebLTVersion`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE })
    });

    new cr.AwsCustomResource(this, 'ModifyWebLaunchTemplateDefaultVersion', {
      onCreate: {
        service: 'EC2',
        action: 'modifyLaunchTemplate',
        parameters: {
          LaunchTemplateId: webLaunchTemplate.launchTemplateId,
          DefaultVersion: getLatestWebLTVersion.getResponseField('LaunchTemplateVersions.0.VersionNumber'),
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${id}-ModifyWebLaunchTemplateDefaultVersion`),
      },
      onUpdate: {
        service: 'EC2',
        action: 'modifyLaunchTemplate',
        parameters: {
          LaunchTemplateId: webLaunchTemplate.launchTemplateId,
          DefaultVersion: '$LATEST'
        },
        physicalResourceId: cr.PhysicalResourceId.of(webLaunchTemplate.launchTemplateId as string),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
    }).node.addDependency(getLatestWebLTVersion);


  // Custom Resource to update the default version of Math Worker Launch Template
  const getLatestMathWorkerLTVersion = new cr.AwsCustomResource(this, 'GetLatestMathWorkerLTVersion', {
    onCreate: {
      service: 'EC2',
      action: 'describeLaunchTemplateVersions',
      parameters: {
        LaunchTemplateId: mathWorkerLaunchTemplate.launchTemplateId,
        Versions: ['$Latest']
      },
      physicalResourceId: cr.PhysicalResourceId.of(`${id}-GetLatestMathWorkerLTVersion`),
    },
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE })
  });

  new cr.AwsCustomResource(this, 'ModifyMathWorkerLaunchTemplateDefaultVersion', {
    onCreate: {
      service: 'EC2',
      action: 'modifyLaunchTemplate',
      parameters: {
        LaunchTemplateId: mathWorkerLaunchTemplate.launchTemplateId,
        DefaultVersion: getLatestMathWorkerLTVersion.getResponseField('LaunchTemplateVersions.0.VersionNumber'),
      },
      physicalResourceId: cr.PhysicalResourceId.of(`${id}-ModifyMathWorkerLTVersion`),
    },
    onUpdate: {
      service: 'EC2',
      action: 'modifyLaunchTemplate',
      parameters: {
        LaunchTemplateId: mathWorkerLaunchTemplate.launchTemplateId,
        DefaultVersion: '$LATEST'
      },
      physicalResourceId: cr.PhysicalResourceId.of(mathWorkerLaunchTemplate.launchTemplateId as string),
    },
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
  }).node.addDependency(getLatestMathWorkerLTVersion); // CRUCIAL: Add dependency
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: lb.loadBalancerDnsName,
    });
  }
}
