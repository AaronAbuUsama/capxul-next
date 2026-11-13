// The CI role's two policies, as data: who may take the role on (trust), and what it may do (permissions). Pure, so
// test/aws-policy.test.ts reads them. The bootstrap stack (bootstrap.run.ts) attaches both.
//
// Trust: GitHub Actions' OIDC tokens for this repository only, from a workflow on `master` or a pull request into
// `master`, and nothing else. GitHub's default subject for a pull request does not name the branch it goes into, so
// bootstrap.sh sets this repository's subject template to `repo`, `context` and `base_ref`, and the subjects read
//   repo:<repo>:ref:refs/heads/master:base_ref:          a push to master, or a run started on master
//   repo:<repo>:pull_request:base_ref:master             a pull request into master
// where <repo> is `<owner>/<name>`, or `<owner>@<owner id>/<name>@<repo id>` once GitHub's immutable subjects are on
// (always, for a repository made or renamed after 15 July 2026; no template removes the ids). bootstrap.sh reads which
// from GitHub and passes it as BOOTSTRAP_SUBJECT_REPO.
// A job that names a GitHub environment has another context, so it cannot take the role on.
//
// Permissions: what host.run.ts (src/aws.ts) and bin/forward.sh need, and no more:
// - EC2: the machine, its data disk, its network and its security group, in the platform's region only;
// - IAM: the machine's role and instance profile, named `capxul-bench-*` only; the one managed policy that role may
//   carry (AmazonSSMManagedInstanceCore), which is also the only one the CI role may attach; no inline policy and no
//   permissions boundary, so the CI role cannot give the machine (and through SSM, itself) more than that;
// - SSM: a port-forward session to the platform's machines (tagged `Name: capxul-bench-*`) and shell commands on them, for the Docker engine and for
//   reading a machine that does not come up.
import type * as AWS from "@alchemy.run/aws";

type PolicyDocument = AWS.IAM.PolicyDocument;

export const OIDC_HOST = "token.actions.githubusercontent.com";
export const OIDC_AUDIENCE = "sts.amazonaws.com";
/** The subject template bootstrap.sh gives the repository; the subjects below are written for it. */
export const SUBJECT_CLAIMS: ReadonlyArray<string> = ["repo", "context", "base_ref"];
export const TRUNK = "master";
export const SSM_CORE_POLICY = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore";
/** The names of the machine's IAM objects (packages/platform/src/names.ts, AWS_PREFIX). */
export const BENCH_IAM_PREFIX = "capxul-bench-";

/**
 * The OIDC subjects that may take the role on, for `repo` the repository part of the subject (above), each compared
 * exactly. The first is the push subject of GitHub's default template too, so a push to master is trusted whether or not the custom template has been set; a pull request is
 * trusted only once it has, since the default subject (`repo:<repo>:pull_request`) does not say where it goes.
 */
export const subjects = (repo: string): Array<string> => [
  `repo:${repo}:ref:refs/heads/${TRUNK}`,
  `repo:${repo}:ref:refs/heads/${TRUNK}:base_ref:`,
  `repo:${repo}:pull_request:base_ref:${TRUNK}`,
];

export const trustPolicy = (providerArn: string, repo: string): PolicyDocument => ({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "GitHubActionsOnMaster",
      Effect: "Allow",
      Principal: { Federated: providerArn },
      Action: ["sts:AssumeRoleWithWebIdentity"],
      Condition: {
        StringEquals: { [`${OIDC_HOST}:aud`]: OIDC_AUDIENCE, [`${OIDC_HOST}:sub`]: subjects(repo) },
      },
    },
  ],
});

const EC2_READ = [
  "ec2:DescribeAvailabilityZones",
  "ec2:DescribeInstances",
  "ec2:DescribeInternetGateways",
  "ec2:DescribeRouteTables",
  "ec2:DescribeSecurityGroupRules",
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSubnets",
  "ec2:DescribeVolumes",
  "ec2:DescribeVpcAttribute",
  "ec2:DescribeVpcs",
  "ec2:GetConsoleOutput",
];
const EC2_WRITE = [
  "ec2:AssociateRouteTable",
  "ec2:AttachInternetGateway",
  "ec2:AttachVolume",
  "ec2:AuthorizeSecurityGroupEgress",
  "ec2:AuthorizeSecurityGroupIngress",
  "ec2:CreateInternetGateway",
  "ec2:CreateRoute",
  "ec2:CreateRouteTable",
  "ec2:CreateSecurityGroup",
  "ec2:CreateSubnet",
  "ec2:CreateTags",
  "ec2:CreateVolume",
  "ec2:CreateVpc",
  "ec2:DeleteInternetGateway",
  "ec2:DeleteRoute",
  "ec2:DeleteRouteTable",
  "ec2:DeleteSecurityGroup",
  "ec2:DeleteSubnet",
  "ec2:DeleteTags",
  "ec2:DeleteVolume",
  "ec2:DeleteVpc",
  "ec2:DetachInternetGateway",
  "ec2:DetachVolume",
  "ec2:DisassociateRouteTable",
  "ec2:ModifyInstanceAttribute",
  "ec2:ModifyInstanceMetadataOptions",
  "ec2:ModifySecurityGroupRules",
  "ec2:ModifySubnetAttribute",
  "ec2:ModifyVolume",
  "ec2:ModifyVpcAttribute",
  "ec2:RebootInstances",
  "ec2:ReplaceRoute",
  "ec2:ReplaceRouteTableAssociation",
  "ec2:RevokeSecurityGroupEgress",
  "ec2:RevokeSecurityGroupIngress",
  "ec2:RunInstances",
  "ec2:StartInstances",
  "ec2:StopInstances",
  "ec2:TerminateInstances",
];
const IAM_BENCH = [
  "iam:AddRoleToInstanceProfile",
  "iam:CreateInstanceProfile",
  "iam:CreateRole",
  "iam:DeleteInstanceProfile",
  "iam:DeleteRole",
  "iam:DeleteRolePolicy",
  "iam:DetachRolePolicy",
  "iam:GetInstanceProfile",
  "iam:GetRole",
  "iam:GetRolePolicy",
  "iam:ListAttachedRolePolicies",
  "iam:ListInstanceProfileTags",
  "iam:ListInstanceProfilesForRole",
  "iam:ListRolePolicies",
  "iam:ListRoleTags",
  "iam:RemoveRoleFromInstanceProfile",
  "iam:TagInstanceProfile",
  "iam:TagRole",
  "iam:UntagInstanceProfile",
  "iam:UntagRole",
  "iam:UpdateAssumeRolePolicy",
  "iam:UpdateRole",
];

export const permissionsPolicy = (account: string, region: string): PolicyDocument => {
  const inRegion = { StringEquals: { "aws:RequestedRegion": region } };
  const role = `arn:aws:iam::${account}:role/${BENCH_IAM_PREFIX}*`;
  const profile = `arn:aws:iam::${account}:instance-profile/${BENCH_IAM_PREFIX}*`;
  const instances = `arn:aws:ec2:${region}:${account}:instance/*`;
  return {
    Version: "2012-10-17",
    Statement: [
      { Sid: "Ec2Read", Effect: "Allow", Action: EC2_READ, Resource: "*", Condition: inRegion },
      { Sid: "Ec2BenchHost", Effect: "Allow", Action: EC2_WRITE, Resource: "*", Condition: inRegion },
      { Sid: "IamList", Effect: "Allow", Action: ["iam:ListInstanceProfiles", "iam:ListRoles"], Resource: "*" },
      { Sid: "IamBenchRole", Effect: "Allow", Action: IAM_BENCH, Resource: [role, profile] },
      {
        Sid: "IamBenchRolePolicy",
        Effect: "Allow",
        Action: ["iam:AttachRolePolicy"],
        Resource: role,
        Condition: { ArnEquals: { "iam:PolicyARN": SSM_CORE_POLICY } },
      },
      {
        Sid: "IamPassBenchRole",
        Effect: "Allow",
        Action: ["iam:PassRole"],
        Resource: role,
        Condition: { StringEquals: { "iam:PassedToService": "ec2.amazonaws.com" } },
      },
      {
        Sid: "SsmBenchMachines",
        Effect: "Allow",
        Action: ["ssm:StartSession", "ssm:SendCommand"],
        Resource: instances,
        Condition: { StringLike: { "ssm:resourceTag/Name": `${BENCH_IAM_PREFIX}*` } },
      },
      {
        Sid: "SsmDocuments",
        Effect: "Allow",
        Action: ["ssm:StartSession", "ssm:SendCommand"],
        Resource: [
          `arn:aws:ssm:${region}::document/AWS-StartPortForwardingSession`,
          `arn:aws:ssm:${region}::document/AWS-RunShellScript`,
        ],
      },
      {
        Sid: "SsmRead",
        Effect: "Allow",
        Action: [
          "ssm:DescribeInstanceInformation",
          "ssm:DescribeSessions",
          "ssm:GetCommandInvocation",
          "ssm:GetConnectionStatus",
          "ssm:ListCommandInvocations",
          "ssm:ResumeSession",
          "ssm:TerminateSession",
        ],
        Resource: "*",
      },
    ],
  };
};
