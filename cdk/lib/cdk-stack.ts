import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

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

    const logGroup = new logs.LogGroup(this, 'LogGroup');

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
    let webKeyPair: ec2.IKeyPair | undefined;
    if (props.enableSSHAccess) {
      webKeyPair = props.webKeyPairName
      ? ec2.KeyPair.fromKeyPairName(this, 'WebKeyPair', props.webKeyPairName)
      : new ec2.KeyPair(this, 'WebKeyPair');
    }

    let mathWorkerKeyPair: ec2.IKeyPair | undefined;
      if (props.enableSSHAccess) {
        mathWorkerKeyPair = props.mathWorkerKeyPairName
        ? ec2.KeyPair.fromKeyPairName(this, 'MathWorkerKeyPair', props.mathWorkerKeyPairName)
        : new ec2.KeyPair(this, 'MathWorkerKeyPair');
      }

    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforAWSCodeDeploy'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
      ],
    });

    // IAM Role for CodeDeploy
    const codeDeployRole = new iam.Role(this, 'CodeDeployRole', {
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSCodeDeployRole'),
      ],
    });

    // ALB Security Group - Allow HTTP/HTTPS from anywhere
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LBSecurityGroup', {
      vpc,
      description: 'Security group for the load balancer',
      allowAllOutbound: true,
    });
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from anywhere');

    // things are dockerized so we need ECR
    const ecrWebRepository = new ecr.Repository(this, 'PolisRepositoryServer', {
      repositoryName: 'polis/server',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // fine for alpha testing - change to retain after
      imageScanOnPush: true, // Enable image scanning (recommended)
    });

    const ecrMathRepository = new ecr.Repository(this, 'PolisRepositoryMath', {
      repositoryName: 'polis/math',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // fine for alpha testing - change to retain after
      imageScanOnPush: true, // Enable image scanning (recommended)
    });

    ecrWebRepository.grantPull(instanceRole);
    ecrMathRepository.grantPull(instanceRole);

    // might remove this, not sure it's necessary since latest image is always pulled
    const imageTagParameter = new ssm.StringParameter(this, 'ImageTagParameter', {
      parameterName: '/polis/image-tag',
      stringValue: 'initial-tag', //CI/CD will update this
    });


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

    const dbSecretArnParam = new ssm.StringParameter(this, 'DBSecretArnParameter', {
      parameterName: '/polis/db-secret-arn',
      stringValue: db.secret!.secretArn,
      description: 'SSM Parameter storing the ARN of the Polis Database Secret',
    });

    const dbHostParam = new ssm.StringParameter(this, 'DBHostParameter', {
      parameterName: '/polis/db-host',
      stringValue: db.dbInstanceEndpointAddress,
      description: 'SSM Parameter storing the Polis Database Host',
    });

    const dbPortParam = new ssm.StringParameter(this, 'DBPortParameter', {
      parameterName: '/polis/db-port',
      stringValue: db.dbInstanceEndpointPort,
      description: 'SSM Parameter storing the Polis Database Port',
    });

    const usrdata = (CLOUDWATCH_LOG_GROUP_NAME: string, service: string) => {
      let ld;
      ld = ec2.UserData.forLinux();
      ld.addCommands(
        '#!/bin/bash',
        'set -e',
        'set -x',
        'sudo yum update -y',
        'sudo yum install -y amazon-cloudwatch-agent -y',
        'sudo yum install -y amazon-linux-extras',
        'sudo amazon-linux-extras install docker -y',
        'sudo systemctl start docker',
        'sudo systemctl enable docker',
        'sudo usermod -a -G docker ec2-user',
        'sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose',
        'sudo chmod +x /usr/local/bin/docker-compose',
        'docker-compose --version', // Verify installation
        'sudo yum install -y jq',
        `export SERVICE=${service}`,
        'exec 1>>/var/log/user-data.log 2>&1',
        'echo "Finished User Data Execution at $(date)"',
      );
      return ld;
    };

    // --- Launch Templates ---
    const webLaunchTemplate = new ec2.LaunchTemplate(this, 'WebLaunchTemplate', {
      machineImage: machineImageWeb,
      userData: usrdata(logGroup.logGroupName, "server"),
      instanceType: instanceTypeWeb,
      securityGroup: webSecurityGroup,
      keyPair: props.enableSSHAccess ? webKeyPair : undefined, // Conditionally add key pair
      role: instanceRole,
  });

    const mathWorkerLaunchTemplate = new ec2.LaunchTemplate(this, 'MathWorkerLaunchTemplate', {
      machineImage: machineImageMathWorker,
      userData: usrdata(logGroup.logGroupName, "math"),
      instanceType: instanceTypeMathWorker,
      securityGroup: mathWorkerSecurityGroup,
      keyPair: props.enableSSHAccess ? mathWorkerKeyPair : undefined,
      role: instanceRole,
    });

    const asgWeb = new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      launchTemplate: webLaunchTemplate,
      minCapacity: 2,
      maxCapacity: 10,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const asgMathWorker = new autoscaling.AutoScalingGroup(this, 'AsgMathWorker', {
      vpc,
      launchTemplate: mathWorkerLaunchTemplate,
      minCapacity: 1,
      maxCapacity: 5,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // DEPLOY STUFF
    const application = new codedeploy.ServerApplication(this, 'CodeDeployApplication', {
      applicationName: 'PolisApplication',
    });

    const deploymentBucket = new s3.Bucket(this, 'DeploymentPackageBucket', {
      bucketName: `polis-deployment-packages-${cdk.Stack.of(this).account}-${cdk.Stack.of(this).region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    deploymentBucket.grantRead(instanceRole);
  
    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'DeploymentGroup', {
      application,
      deploymentGroupName: 'PolisDeploymentGroup',
      autoScalingGroups: [asgWeb, asgMathWorker], // Your ASGs
      deploymentConfig: codedeploy.ServerDeploymentConfig.ONE_AT_A_TIME, // Or another config
      role: codeDeployRole, // The IAM role for CodeDeploy
      installAgent: true, // Installs the CodeDeploy agent.
      // we also need configure alarms and auto-rollback here.
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
      healthCheck: {
        path: "/api/v3/testConnection"
      }
    });

    // Route53 - implimenting later
    // const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props?.domainName as string });
    // new route53.ARecord(this, 'ARecord', {
    //   zone,
    //   recordName: props?.domainName,
    //   target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
    // });
    asgWeb.node.addDependency(logGroup);
    asgMathWorker.node.addDependency(logGroup);
    asgWeb.node.addDependency(db);
    asgMathWorker.node.addDependency(db);
  }
}
