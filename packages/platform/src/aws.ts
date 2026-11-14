// The bench host on AWS (Aaron, 13 November 2026): one EC2 machine for the shared Frappe bench, on a disk that
// survives restarts, in a network of its own, with a security group that has no inbound rule. Nothing on the internet
// can open a connection to it: the tunnel's connector dials out to Cloudflare, and the deployer reaches the machine's
// Docker engine through AWS Systems Manager (SSM), which needs the CI role, not an open port.
//
// The machine's own role carries only AmazonSSMManagedInstanceCore, so the SSM agent can register, and the metadata
// service requires session tokens with a hop limit of 1, so no container on the host can borrow that role.
// Every IAM name starts `capxul-bench-<stage>`: the CI role may create, change and pass IAM objects with that prefix
// only (bootstrap/src/aws-policy.ts).
import * as AWS from "@alchemy.run/aws";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { names } from "./stage.ts";
import { userData } from "./user-data.ts";

/** The one managed policy the machine's role carries; also the only one the CI role may attach (aws-policy.ts). */
export const SSM_CORE_POLICY = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore";
/** The machine's size: 2 vCPU and 8 GiB, room for MariaDB, Redis and a handful of sites (README, "Cost"). */
export const DEFAULT_INSTANCE_TYPE = "t3.large";
/** The data disk, in GiB: Docker's images, build cache and the bench's volumes. */
export const DEFAULT_DATA_GB = 60;
/** The device name the attachment asks for; Nitro machines show it under its volume id (user-data.ts). */
const DATA_DEVICE = "/dev/sdf";
/** The network's range; Alchemy's Network makes its one public subnet the first /24 of it, 10.73.0.0/24. */
export const NETWORK_CIDR = "10.73.0.0/16";
/**
 * The machine's fixed private address, in the public subnet. The data disk attaches to one machine at a time, so a
 * replacement (a new image or new user data) must remove the old machine before it makes the new one. Alchemy's
 * Instance replaces delete-first only when the replacement keeps a fixed private address (@alchemy.run/aws
 * src/EC2/Instance.ts, reusesFixedPrivateIp); without one it made the new machine first, whose attachment then
 * failed with VolumeInUse (14 November 2026). The bench is down for the minutes a replacement takes.
 */
export const MACHINE_PRIVATE_IP = "10.73.0.10";

/**
 * The pinned AWS.EC2.Instance is a Platform (it can also host a bundled program), and its type leaves the
 * requirements as `any`. A plain machine, with no `main`, needs only the AWS providers, like every other resource here.
 */
const typed = (instance: Effect.Effect<AWS.EC2.Instance, never, unknown>) =>
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unsafe-effect-type-assertion, typescript/no-unsafe-type-assertion -- see above: only the requirements are narrowed, from Alchemy's `any` to the AWS providers every resource of this stack needs.
  instance as Effect.Effect<AWS.EC2.Instance, never, AWS.Providers>;

export const hostSettings = Effect.all({
  // A pinned image: a newer one would replace the machine. bootstrap.sh resolves it once (PLATFORM_AMI_ID).
  amiId: Config.String("PLATFORM_AMI_ID"),
  instanceType: Config.String("PLATFORM_INSTANCE_TYPE").pipe(Config.withDefault(DEFAULT_INSTANCE_TYPE)),
  dataGb: Config.Int("PLATFORM_DATA_GB").pipe(Config.withDefault(DEFAULT_DATA_GB)),
});

export const BenchHost = Effect.gen(function* () {
  const n = yield* names;
  const settings = yield* hostSettings;
  const tags = { Name: n.aws, "capxul:stage": n.stage };

  // One public subnet in one zone, an internet gateway for the way out, no NAT (a NAT gateway costs more than the
  // machine). The public address is for outbound traffic only: the security group admits nothing.
  const network = yield* AWS.EC2.Network("Network", { cidrBlock: NETWORK_CIDR, availabilityZones: 1, tags });
  const zone = network.availabilityZones[0];
  const subnetId = network.publicSubnetIds[0];
  if (zone === undefined || subnetId === undefined) return yield* Effect.die("the network has no public subnet");
  const noInbound = yield* AWS.EC2.SecurityGroup("NoInbound", {
    vpcId: network.vpcId,
    groupName: `${n.aws}-no-inbound`,
    description: "Capxul bench host: no inbound rule; all outbound (the tunnel and SSM dial out)",
    ingress: [],
    egress: [{ ipProtocol: "-1", cidrIpv4: "0.0.0.0/0" }],
    tags,
  });

  const role = yield* AWS.IAM.Role("MachineRole", {
    roleName: `${n.aws}-machine`,
    description: "The Capxul bench host's own role: the SSM agent only",
    assumeRolePolicyDocument: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: ["sts:AssumeRole"] }],
    },
    managedPolicyArns: [SSM_CORE_POLICY],
    tags,
  });
  const profile = yield* AWS.IAM.InstanceProfile("MachineProfile", {
    instanceProfileName: `${n.aws}-machine`,
    roleName: role.roleName,
    tags,
  });

  const data = yield* AWS.EC2.Volume("Data", {
    availabilityZone: zone,
    size: settings.dataGb,
    volumeType: "gp3",
    encrypted: true,
    tags: { ...tags, Name: `${n.aws}-data` },
    // Retained: the disk holds MariaDB and every site. A change that replaces it (a smaller size, another zone) or a
    // destroy of the stack keeps the old disk instead of deleting it; deleting it is a deliberate step by hand.
  }).pipe(Alchemy.RemovalPolicy.retain());
  const machine = yield* typed(
    AWS.EC2.Instance("Machine", {
      imageId: settings.amiId,
      instanceType: settings.instanceType,
      subnetId,
      availabilityZone: zone,
      privateIpAddress: MACHINE_PRIVATE_IP,
      securityGroupIds: [noInbound.groupId],
      instanceProfileName: profile.instanceProfileName,
      associatePublicIpAddress: true,
      metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
      userData: data.volumeId.pipe(Output.map(userData)),
      tags,
    }),
  );
  yield* AWS.EC2.VolumeAttachment("DataAttachment", {
    volumeId: data.volumeId,
    instanceId: machine.instanceId,
    device: DATA_DEVICE,
  });
  return { machine, data, noInbound, zone };
});
