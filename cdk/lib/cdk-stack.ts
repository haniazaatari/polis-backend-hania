import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions'; // Import actions submodule
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as efs from 'aws-cdk-lib/aws-efs'; // Import EFS module
import { Construct } from 'constructs';

interface PolisStackProps extends cdk.StackProps {
  enableSSHAccess?: boolean; // Make optional, default to false
  envFile: string;
  branch?: string;
  sshAllowedIpRange?: string; // Add a property for SSH access control
  webKeyPairName?: string;    // Key pair for web instances
  mathWorkerKeyPairName?: string; // Key pair for math worker
  delphiSmallKeyPairName?: string; // Key pair for small Delphi instances
  delphiLargeKeyPairName?: string; // Key pair for large Delphi instance
  ollamaKeyPairName?: string; // Key pair for Ollama instance - NEW
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PolisStackProps) {
    super(scope, id, props);

    const defaultSSHRange = '0.0.0.0/0';
    const ollamaPort = 11434;
    const ollamaModelDirectory = '/efs/ollama-models';
    const ollamaNamespace = 'OllamaMetrics'; // Custom namespace for GPU metrics

    // --- VPC Configuration
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1, // Use 1 for non-prod/cost saving, 2+ for prod HA
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        {
          cidrMask: 24,
          name: 'PrivateWithEgress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ]
    });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Polis Application Alarms',
    });
    alarmTopic.addSubscription(new subscriptions.EmailSubscription('tim@compdemocracy.org'));
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Instance Types & AMIs
    const instanceTypeWeb = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM);
    const machineImageWeb = new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 });
    const instanceTypeMathWorker = ec2.InstanceType.of(ec2.InstanceClass.R8G, ec2.InstanceSize.XLARGE4);
    const machineImageMathWorker = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
    });
    // Delphi small instance
    const instanceTypeDelphiSmall = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE);
    const machineImageDelphiSmall = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023
    });
    // Delphi large instance
    const instanceTypeDelphiLarge = ec2.InstanceType.of(ec2.InstanceClass.C6G, ec2.InstanceSize.XLARGE4);
    const machineImageDelphiLarge = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });
    // Ollama Instance
    const instanceTypeOllama = ec2.InstanceType.of(ec2.InstanceClass.G4DN, ec2.InstanceSize.XLARGE); // x86_64 GPU instance
    const machineImageOllama = ec2.MachineImage.genericLinux({
      'us-east-1': 'ami-08e0cf6df13ae3ddb',
    });

    // --- Security Groups
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc,
      description: 'Allow HTTP and SSH access to web instances',
      allowAllOutbound: true
    });
    const mathWorkerSecurityGroup = new ec2.SecurityGroup(this, 'MathWorkerSG', {
      vpc,
      description: 'Security group for Polis math worker',
      allowAllOutbound: true
    });
    // Delphi Security Group
    const delphiSecurityGroup = new ec2.SecurityGroup(this, 'DelphiSecurityGroup', {
      vpc,
      description: 'SG for Delphi instances',
      allowAllOutbound: true
    });
    // Ollama Security Group 
    const ollamaSecurityGroup = new ec2.SecurityGroup(this, 'OllamaSecurityGroup', {
      vpc,
      description: 'SG for Ollama instance',
      allowAllOutbound: true
    });
    // EFS Security Group
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc,
      description: 'SG for EFS mount targets',
      allowAllOutbound: false
    });

    // Allow Delphi -> Ollama
    ollamaSecurityGroup.addIngressRule(
      delphiSecurityGroup,
      ec2.Port.tcp(ollamaPort),
      `Allow Delphi access on ${ollamaPort}`
    );
    // Allow Ollama -> EFS
    efsSecurityGroup.addIngressRule(
      ollamaSecurityGroup,
      ec2.Port.tcp(2049), // NFS port
      'Allow NFS from Ollama instances'
    );

    // Conditional SSH Access
    if (props.enableSSHAccess) {
      const sshPeer = ec2.Peer.ipv4(props.sshAllowedIpRange || defaultSSHRange);
      webSecurityGroup.addIngressRule(sshPeer, ec2.Port.tcp(22), 'Allow SSH access');
      mathWorkerSecurityGroup.addIngressRule(sshPeer, ec2.Port.tcp(22), 'Allow SSH access');
      delphiSecurityGroup.addIngressRule(sshPeer, ec2.Port.tcp(22), 'Allow SSH access'); // NEW
      ollamaSecurityGroup.addIngressRule(sshPeer, ec2.Port.tcp(22), 'Allow SSH access'); // NEW
    }

    webSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.sshAllowedIpRange || defaultSSHRange), ec2.Port.tcp(22), 'Allow SSH'); // Control SSH separately
    webSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');
    webSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from anywhere');


    // --- Key Pairs
    const getKeyPair = (name: string, requestedName?: string): ec2.IKeyPair | undefined => {
      if (!props.enableSSHAccess) return undefined;
      return requestedName
        ? ec2.KeyPair.fromKeyPairName(this, name, requestedName)
        : new ec2.KeyPair(this, name);
    };
    const webKeyPair = getKeyPair('WebKeyPair', props.webKeyPairName);
    const mathWorkerKeyPair = getKeyPair('MathWorkerKeyPair', props.mathWorkerKeyPairName);
    const delphiSmallKeyPair = getKeyPair('DelphiSmallKeyPair', props.delphiSmallKeyPairName);
    const delphiLargeKeyPair = getKeyPair('DelphiLargeKeyPair', props.delphiLargeKeyPairName);
    const ollamaKeyPair = getKeyPair('OllamaKeyPair', props.ollamaKeyPairName);


    // --- IAM Role
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforAWSCodeDeploy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:AbortMultipartUpload'],
      resources: ['arn:aws:s3:::*', 'arn:aws:s3:::*/*'],
    }));

    // IAM Role for CodeDeploy
    const codeDeployRole = new iam.Role(this, 'CodeDeployRole', {
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSCodeDeployRole'),
      ],
    });

    // ALB Security Group
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LBSecurityGroup', {
      vpc,
      description: 'Security group for the load balancer',
      allowAllOutbound: true,
    });
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');
    lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from anywhere');

    // --- ECR Repositories
    const createEcrRepo = (name: string): ecr.Repository => {
      const repo = new ecr.Repository(this, `PolisRepository${name}`, {
        repositoryName: `polis/${name.toLowerCase()}`,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        imageScanOnPush: true,
      });

      repo.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowPublicPull',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ],
      }));
      repo.grantPull(instanceRole); // Grant pull to the shared instance role
      return repo;
    };
    const ecrWebRepository = createEcrRepo('Server');
    const ecrMathRepository = createEcrRepo('Math');
    const ecrDelphiRepository = createEcrRepo('Delphi');

    // --- SSM Parameter for Image Tag
    const imageTagParameter = new ssm.StringParameter(this, 'ImageTagParameter', {
      parameterName: '/polis/image-tag',
      stringValue: 'initial-tag', //CI/CD will update this
    });

    // --- Postgres (PG17, GP2 in 'Private' ISOLATED subnet) ---
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc,
      subnetGroupName: 'PolisDatabaseSubnetGroup',
      description: 'Subnet group for the postgres database',
      vpcSubnets: { subnetGroupName: 'Private' },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const db = new rds.DatabaseInstance(this, 'Database', {
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


    // --- EFS for Ollama Models
    const fileSystem = new efs.FileSystem(this, 'OllamaModelFileSystem', {
      vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.ELASTIC,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      securityGroup: efsSecurityGroup,
      vpcSubnets: { subnetGroupName: 'PrivateWithEgress' },
    });


    // --- User Data Scripts (Optimized function used by all) ---
    // Generic User Data function (Works with NAT Gateway for internet)
    const usrdata = (CLOUDWATCH_LOG_GROUP_NAME: string, service: string, instanceSize?: string) => {
      let ld: ec2.UserData;
      ld = ec2.UserData.forLinux();
      ld.addCommands(
        '#!/bin/bash',
        'set -e',
        'set -x',
        `echo "Writing service type '${service}' to /tmp/service_type.txt"`,
        `echo "${service}" > /tmp/service_type.txt`,
        `echo "Contents of /tmp/service_type.txt: $(cat /tmp/service_type.txt)"`,
        // If instanceSize is provided, write it to a file
        instanceSize ? `echo "Writing instance size '${instanceSize}' to /tmp/instance_size.txt"` : '',
        instanceSize ? `echo "${instanceSize}" > /tmp/instance_size.txt` : '',
        instanceSize ? `echo "Contents of /tmp/instance_size.txt: $(cat /tmp/instance_size.txt)"` : '',
        'sudo yum update -y',
        'sudo yum install -y amazon-cloudwatch-agent -y',
        'sudo dnf install -y wget ruby docker',
        'sudo systemctl start docker',
        'sudo systemctl enable docker',
        'sudo usermod -a -G docker ec2-user',
        'sudo curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose',
        'sudo chmod +x /usr/local/bin/docker-compose',
        'docker-compose --version', // Verify installation
        'sudo yum install -y jq',
        `export SERVICE=${service}`,
        instanceSize ? `export INSTANCE_SIZE=${instanceSize}` : '',
        'exec 1>>/var/log/user-data.log 2>&1',
        'echo "Finished User Data Execution at $(date)"',
        'sudo mkdir -p /etc/docker', // Ensure /etc/docker directory exists
        `sudo tee /etc/docker/daemon.json << EOF
{
  "log-driver": "awslogs",
  "log-opts": {
    "awslogs-group": "${CLOUDWATCH_LOG_GROUP_NAME}",
    "awslogs-region": "${cdk.Stack.of(this).region}",
    "awslogs-stream": "${service}"
  }
}
EOF`,
        'sudo systemctl restart docker',
        'sudo systemctl status docker'
      );
      return ld;
    };

    const ollamaUsrData = ec2.UserData.forLinux();
    const cwAgentConfigPath = '/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json';
    ollamaUsrData.addCommands(
      ...usrdata(logGroup.logGroupName, "ollama").render().split('\n').filter(line => line.trim() !== ''),
      'echo "Installing EFS utilities for Ollama..."',
      'sudo dnf install -y amazon-efs-utils nfs-utils',
      'echo "Starting Ollama specific setup..."',
      'echo "Configuring CloudWatch Agent for GPU metrics..."',
      `sudo tee ${cwAgentConfigPath} << EOF
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "metrics": {
    "append_dimensions": { "AutoScalingGroupName": "\${aws:AutoScalingGroupName}", "ImageId": "\${aws:ImageId}", "InstanceId": "\${aws:InstanceId}", "InstanceType": "\${aws:InstanceType}" },
    "metrics_collected": {
      "nvidia_gpu": { "measurement": [ {"name": "utilization_gpu", "unit": "Percent"}, {"name": "utilization_memory", "unit": "Percent"}, {"name": "memory_total", "unit": "Megabytes"}, {"name": "memory_used", "unit": "Megabytes"}, {"name": "memory_free", "unit": "Megabytes"}, {"name": "power_draw", "unit": "Watts"}, {"name": "temperature_gpu", "unit": "Count"} ], "metrics_collection_interval": 60, "nvidia_smi_path": "/usr/bin/nvidia-smi", "metrics_aggregation_interval": 60, "namespace": "${ollamaNamespace}" },
      "disk": { "measurement": [ "used_percent" ], "metrics_collection_interval": 60, "resources": [ "/" ] },
      "mem": { "measurement": [ "mem_used_percent" ], "metrics_collection_interval": 60 }
    }
  }
}
EOF`,
        'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:${cwAgentConfigPath} -s',
        'sudo systemctl enable amazon-cloudwatch-agent',
        'echo "CloudWatch Agent configured and started."',
        'echo "Mounting EFS filesystem ${fileSystem.fileSystemId}..."',
        `sudo mkdir -p ${ollamaModelDirectory}`,
        `sudo mount -t efs -o tls ${fileSystem.fileSystemId}:/ ${ollamaModelDirectory}`,
        `echo "${fileSystem.fileSystemId}:/ ${ollamaModelDirectory} efs _netdev,tls 0 0" | sudo tee -a /etc/fstab`,
        `sudo chown ec2-user:ec2-user ${ollamaModelDirectory}`,
        'echo "EFS mounted successfully."',
        'echo "Starting Ollama container..."',
        'sudo docker run -d --name ollama \\',
        '  --gpus all \\',
        '  -p 0.0.0.0:11434:11434 \\',
        `  -v ${ollamaModelDirectory}:/root/.ollama \\`,
        '  --restart unless-stopped \\',
        '  ollama/ollama serve',
        '(',
        '  echo "Waiting for Ollama service (background task)..."',
        '  sleep 60',
        '  echo "Pulling default Ollama model (llama3.1:8b) in background..."',
        '  sudo docker exec ollama ollama pull llama3.1:8b || echo "Failed to pull default model initially, may need manual pull later."',
        '  echo "Background model pull task finished."',
        ') &',
        'disown',
        'echo "Ollama setup script finished."'
    );


    // --- Launch Templates
    const webLaunchTemplate = new ec2.LaunchTemplate(this, 'WebLaunchTemplate', {
      machineImage: machineImageWeb,
      userData: usrdata(logGroup.logGroupName, "server"),
      instanceType: instanceTypeWeb,
      securityGroup: webSecurityGroup,
      keyPair: webKeyPair,
      role: instanceRole,
    });
    const mathWorkerLaunchTemplate = new ec2.LaunchTemplate(this, 'MathWorkerLaunchTemplate', {
      machineImage: machineImageMathWorker,
      userData: usrdata(logGroup.logGroupName, "math"),
      instanceType: instanceTypeMathWorker,
      securityGroup: mathWorkerSecurityGroup,
      keyPair: mathWorkerKeyPair,
      role: instanceRole,
    });
    // Delphi Small Launch Template
    const delphiSmallLaunchTemplate = new ec2.LaunchTemplate(this, 'DelphiSmallLaunchTemplate', {
      machineImage: machineImageDelphiSmall,
      userData: usrdata(logGroup.logGroupName, "delphi", "small"),
      instanceType: instanceTypeDelphiSmall,
      securityGroup: delphiSecurityGroup,
      keyPair: delphiSmallKeyPair,
      role: instanceRole,
    });
    // Delphi Large Launch Template
    const delphiLargeLaunchTemplate = new ec2.LaunchTemplate(this, 'DelphiLargeLaunchTemplate', {
      machineImage: machineImageDelphiLarge,
      userData: usrdata(logGroup.logGroupName, "delphi", "large"),
      instanceType: instanceTypeDelphiLarge,
      securityGroup: delphiSecurityGroup,
      keyPair: delphiLargeKeyPair,
      role: instanceRole,
    });
    // Ollama Launch Template
    const ollamaLaunchTemplate = new ec2.LaunchTemplate(this, 'OllamaLaunchTemplate', {
      machineImage: machineImageOllama,
      userData: ollamaUsrData,
      instanceType: instanceTypeOllama,
      securityGroup: ollamaSecurityGroup,
      keyPair: ollamaKeyPair,
      role: instanceRole,
      blockDevices: [
        {
          deviceName: '/dev/xvda', // Adjust if needed for DLAMI
          volume: ec2.BlockDeviceVolume.ebs(100, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });


    // --- Auto Scaling Groups
    const commonAsgProps = { vpc, role: instanceRole };

    // Ollama ASG
    const asgOllama = new autoscaling.AutoScalingGroup(this, 'AsgOllama', {
      vpc,
      launchTemplate: ollamaLaunchTemplate,
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 1,
      vpcSubnets: { subnetGroupName: 'PrivateWithEgress' },
      healthCheck: autoscaling.HealthCheck.ec2({ grace: cdk.Duration.minutes(10) }),
    });
    asgOllama.node.addDependency(logGroup);
    asgOllama.node.addDependency(fileSystem); // Ensure EFS is ready before instances start

    // Web ASG
    const asgWeb = new autoscaling.AutoScalingGroup(this, 'Asg', {
      vpc,
      launchTemplate: webLaunchTemplate,
      minCapacity: 2,
      maxCapacity: 10,
      desiredCapacity: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      healthCheck: autoscaling.HealthCheck.elb({grace: cdk.Duration.minutes(5)})
    });

    // Math Worker ASG
    const asgMathWorker = new autoscaling.AutoScalingGroup(this, 'AsgMathWorker', {
      vpc,
      launchTemplate: mathWorkerLaunchTemplate,
      minCapacity: 1,
      desiredCapacity: 1,
      maxCapacity: 5,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      healthCheck: autoscaling.HealthCheck.ec2({ grace: cdk.Duration.minutes(2) }),
    });

    // Delphi Small ASG
    const asgDelphiSmall = new autoscaling.AutoScalingGroup(this, 'AsgDelphiSmall', {
      vpc,
      launchTemplate: delphiSmallLaunchTemplate,
      minCapacity: 1,
      desiredCapacity: 1,
      maxCapacity: 5,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheck: autoscaling.HealthCheck.ec2({ grace: cdk.Duration.minutes(5) }),
    });

    // Delphi Large ASG
    const asgDelphiLarge = new autoscaling.AutoScalingGroup(this, 'AsgDelphiLarge', {
      vpc,
      launchTemplate: delphiLargeLaunchTemplate,
      minCapacity: 1,
      desiredCapacity: 1,
      maxCapacity: 3,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheck: autoscaling.HealthCheck.ec2({ grace: cdk.Duration.minutes(5) }),
    });


    // --- Scaling Policies & Alarms
    const mathWorkerCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        AutoScalingGroupName: asgMathWorker.autoScalingGroupName
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(10),
    });
    asgMathWorker.scaleToTrackMetric('CpuTracking', {
      metric: mathWorkerCpuMetric,
      targetValue: 50,
    });

    // Add Delphi CPU Scaling Policies & Alarms
    const createDelphiCpuScaling = (asg: autoscaling.AutoScalingGroup, name: string, target: number): cloudwatch.Metric => {
      const cpuMetric = new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: { AutoScalingGroupName: asg.autoScalingGroupName },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      });
      asg.scaleToTrackMetric(`${name}CpuTracking`, {
        metric: cpuMetric,
        targetValue: target
      });

      // High CPU Alarm
      const alarm = new cloudwatch.Alarm(this, `${name}HighCpuAlarm`, {
        metric: cpuMetric,
        threshold: 80, // Alert if CPU > 80%
        evaluationPeriods: 2, // for 2 consecutive periods (10 minutes total)
        datapointsToAlarm: 2, // Ensure 2 datapoints are breaching
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `Alert when ${name} instances CPU exceeds 80% for 10 minutes`,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE, // Or BREACHING/NOT_BREACHING as appropriate
      });
      // Add SNS action to the alarm
      alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
      return cpuMetric;
    };
    const delphiSmallCpuMetric = createDelphiCpuScaling(asgDelphiSmall, 'DelphiSmall', 60); // Target 60% CPU
    const delphiLargeCpuMetric = createDelphiCpuScaling(asgDelphiLarge, 'DelphiLarge', 60); // Target 60% CPU

    // Add Ollama GPU Scaling Policy
    const ollamaGpuMetric = new cloudwatch.Metric({
      namespace: ollamaNamespace, // Custom namespace from CW Agent config
      metricName: 'utilization_gpu', // GPU utilization metric name from CW Agent config
      dimensionsMap: { AutoScalingGroupName: asgOllama.autoScalingGroupName },
      statistic: 'Average',
      period: cdk.Duration.minutes(1),
    });
    asgOllama.scaleToTrackMetric('OllamaGpuScaling', {
      metric: ollamaGpuMetric,
      targetValue: 75,
      cooldown: cdk.Duration.minutes(5), // Prevent flapping
      disableScaleIn: false, // Allow scaling down
      estimatedInstanceWarmup: cdk.Duration.minutes(5), // Time until instance contributes metrics meaningfully
    });

    // --- Ollama Network Load Balancer (Internal, in Private+Egress)
    const ollamaNlb = new elbv2.NetworkLoadBalancer(this, 'OllamaNlb', {
      vpc,
      internetFacing: false, // Internal only
      crossZoneEnabled: true,
      // Place NLB interfaces in PRIVATE_WITH_EGRESS subnets alongside Ollama instances
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    const ollamaListener = ollamaNlb.addListener('OllamaListener', {
      port: ollamaPort,
      protocol: elbv2.Protocol.TCP,
    });
    const ollamaTargetGroup = new elbv2.NetworkTargetGroup(this, 'OllamaTargetGroup', {
      vpc,
      port: ollamaPort,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: [asgOllama],
      healthCheck: {
        protocol: elbv2.Protocol.TCP,
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(60),
    });
    ollamaListener.addTargetGroups('OllamaTg', ollamaTargetGroup);

    // Secret for Ollama NLB endpoint
    const ollamaServiceSecret = new secretsmanager.Secret(this, 'OllamaServiceSecret', {
      secretName: '/polis/ollama-service-url',
      description: 'URL for the internal Ollama service endpoint (NLB)',
      // Store the NLB DNS name and port
      secretStringValue: cdk.SecretValue.unsafePlainText(`http://${ollamaNlb.loadBalancerDnsName}:${ollamaPort}`),
    });
    ollamaServiceSecret.grantRead(instanceRole);

    // --- DEPLOY STUFF
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

    // Deployment Group
    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'DeploymentGroup', {
      application,
      deploymentGroupName: 'PolisDeploymentGroup',
      autoScalingGroups: [asgWeb, asgMathWorker, asgDelphiSmall, asgDelphiLarge],
      deploymentConfig: codedeploy.ServerDeploymentConfig.ONE_AT_A_TIME,
      role: codeDeployRole,
      installAgent: true,
      // Consider load balancer integration for blue/green (more complex)
    });


    // --- DB Access Rules
    db.connections.allowFrom(asgWeb, ec2.Port.tcp(5432), 'Allow database access from web ASG');
    db.connections.allowFrom(asgMathWorker, ec2.Port.tcp(5432), 'Allow database access from math ASG');
    db.connections.allowFrom(asgDelphiSmall, ec2.Port.tcp(5432), 'Allow database access from Delphi small ASG');
    db.connections.allowFrom(asgDelphiLarge, ec2.Port.tcp(5432), 'Allow database access from Delphi large ASG');

    // --- Application Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'Lb', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup, // Use the dedicated ALB security group
      idleTimeout: cdk.Duration.seconds(300),
    });

    const webTargetGroup = new elbv2.ApplicationTargetGroup(this, 'WebAppTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [asgWeb],
      healthCheck: {
        path: "/api/v3/testConnection",
        interval: cdk.Duration.seconds(300)
      }
    });

    const httpListener = lb.addListener('HttpListener', {
      port: 80,
      open: true,
      defaultTargetGroups: [webTargetGroup],
    });

    const certificate = new acm.Certificate(this, 'WebAppCertificate', {
      domainName: 'pol.is',
      validation: acm.CertificateValidation.fromDns(),
    });

    const httpsListener = lb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      open: true,
      defaultTargetGroups: [webTargetGroup],
    });

    const webScalingPolicy = asgWeb.scaleOnRequestCount('WebScalingPolicy', {
      targetRequestsPerMinute: 600,
    });

    // --- Secrets & Dependencies ---
    const webAppEnvVarsSecret = new secretsmanager.Secret(this, 'WebAppEnvVarsSecret', {
      secretName: 'polis-web-app-env-vars',
      description: 'Environment variables for the Polis web application',
    });
    const clientAdminEnvVarsSecret = new secretsmanager.Secret(this, 'ClientAdminEnvVarsSecret', {
      secretName: 'polis-client-admin-env-vars',
      description: 'Environment variables for the Polis client-admin web application',
    });

    const clientReportEnvVarsSecret = new secretsmanager.Secret(this, 'ClientReportEnvVarsSecret', {
      secretName: 'polis-client-report-env-vars',
      description: 'Environment variables for the Polis client-report web application',
    });
    webAppEnvVarsSecret.grantRead(instanceRole);
    clientAdminEnvVarsSecret.grantRead(instanceRole);
    clientReportEnvVarsSecret.grantRead(instanceRole);

    // Dependencies (Add ASGs to loops/lists)
    const addDbDependency = (asg: autoscaling.IAutoScalingGroup) => asg.node.addDependency(db);
    const addLogDependency = (asg: autoscaling.IAutoScalingGroup) => asg.node.addDependency(logGroup);
    const addSecretDependency = (asg: autoscaling.IAutoScalingGroup) => asg.node.addDependency(webAppEnvVarsSecret);

    // Apply common dependencies to all ASGs
    [asgWeb, asgMathWorker, asgDelphiSmall, asgDelphiLarge, asgOllama].forEach(asg => {
      addLogDependency(asg);
      addSecretDependency(asg);
      // Only add DB dependency if the service needs it
      if (asg !== asgOllama) { // Assuming Ollama doesn't directly need DB creds
        addDbDependency(asg);
      }
    });
    asgOllama.node.addDependency(fileSystem);

    // --- Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName, description: 'Public DNS name of the Application Load Balancer' });
    new cdk.CfnOutput(this, 'OllamaNlbDnsName', { value: ollamaNlb.loadBalancerDnsName, description: 'Internal DNS Name for the Ollama Network Load Balancer'});
    new cdk.CfnOutput(this, 'OllamaServiceSecretArn', { value: ollamaServiceSecret.secretArn, description: 'ARN of the Secret containing the Ollama service URL' });
    new cdk.CfnOutput(this, 'EfsFileSystemId', { value: fileSystem.fileSystemId, description: 'ID of the EFS File System for Ollama models' });
  }
}