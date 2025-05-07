import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';


export default (
  self: Construct,
  logGroup: cdk.aws_logs.LogGroup,
  ollamaNamespace: string,
  ollamaModelDirectory: string,
  fileSystem: cdk.aws_efs.FileSystem,
  machineImageWeb: ec2.IMachineImage,
  instanceTypeWeb: ec2.InstanceType,
  webSecurityGroup: ec2.ISecurityGroup,
  webKeyPair: ec2.IKeyPair | undefined,
  instanceRole: cdk.aws_iam.IRole,
  machineImageMathWorker: ec2.IMachineImage,
  instanceTypeMathWorker: ec2.InstanceType,
  mathWorkerSecurityGroup: ec2.ISecurityGroup,
  mathWorkerKeyPair: ec2.IKeyPair | undefined,
  machineImageDelphiSmall: ec2.IMachineImage,
  instanceTypeDelphiSmall: ec2.InstanceType,
  delphiSmallKeyPair: ec2.IKeyPair | undefined,
  machineImageDelphiLarge: ec2.IMachineImage,
  instanceTypeDelphiLarge: ec2.InstanceType,
  delphiSecurityGroup: ec2.ISecurityGroup,
  delphiLargeKeyPair: ec2.IKeyPair | undefined,
  machineImageOllama: ec2.IMachineImage,
  instanceTypeOllama: ec2.InstanceType,
  ollamaKeyPair: ec2.IKeyPair | undefined,
  ollamaSecurityGroup: ec2.ISecurityGroup
) => {
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
  "awslogs-region": "${cdk.Stack.of(self).region}",
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
  const webLaunchTemplate = new ec2.LaunchTemplate(self, 'WebLaunchTemplate', {
    machineImage: machineImageWeb,
    userData: usrdata(logGroup.logGroupName, "server"),
    instanceType: instanceTypeWeb,
    securityGroup: webSecurityGroup,
    keyPair: webKeyPair,
    role: instanceRole,
  });
  const mathWorkerLaunchTemplate = new ec2.LaunchTemplate(self, 'MathWorkerLaunchTemplate', {
    machineImage: machineImageMathWorker,
    userData: usrdata(logGroup.logGroupName, "math"),
    instanceType: instanceTypeMathWorker,
    securityGroup: mathWorkerSecurityGroup,
    keyPair: mathWorkerKeyPair,
    role: instanceRole,
  });
  // Delphi Small Launch Template
  const delphiSmallLaunchTemplate = new ec2.LaunchTemplate(self, 'DelphiSmallLaunchTemplate', {
    machineImage: machineImageDelphiSmall,
    userData: usrdata(logGroup.logGroupName, "delphi", "small"),
    instanceType: instanceTypeDelphiSmall,
    securityGroup: delphiSecurityGroup,
    keyPair: delphiSmallKeyPair,
    role: instanceRole,
  });
  // Delphi Large Launch Template
  const delphiLargeLaunchTemplate = new ec2.LaunchTemplate(self, 'DelphiLargeLaunchTemplate', {
    machineImage: machineImageDelphiLarge,
    userData: usrdata(logGroup.logGroupName, "delphi", "large"),
    instanceType: instanceTypeDelphiLarge,
    securityGroup: delphiSecurityGroup,
    keyPair: delphiLargeKeyPair,
    role: instanceRole,
  });
  // Ollama Launch Template
  const ollamaLaunchTemplate = new ec2.LaunchTemplate(self, 'OllamaLaunchTemplate', {
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

  return {
    webLaunchTemplate,
    mathWorkerLaunchTemplate,
    delphiSmallLaunchTemplate,
    delphiLargeLaunchTemplate,
    ollamaLaunchTemplate
  }
}