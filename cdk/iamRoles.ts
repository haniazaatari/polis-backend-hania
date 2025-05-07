import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export default (self: Construct) => {
  const instanceRole = new iam.Role(self, 'InstanceRole', {
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
  const codeDeployRole = new iam.Role(self, 'CodeDeployRole', {
    assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSCodeDeployRole'),
    ],
  });
  return { instanceRole, codeDeployRole }
}