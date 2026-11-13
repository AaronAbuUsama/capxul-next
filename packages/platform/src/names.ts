// Every name the platform gives a resource, derived from the stage. All Docker objects start `cx-platform-<stage>`,
// so they cannot collide with another agent's on a shared engine; every AWS object is named `capxul-bench-<stage>…`,
// which is what the CI role's IAM permissions are limited to (bootstrap/src/aws-policy.ts); every DNS name is
// `<label>.<PLATFORM_DOMAIN>`, one level under the domain, which is all Cloudflare's free certificate covers.
//
// Two kinds of stage: `staging`, the shared platform on the bench host in AWS, and `pr-<x>`, a rehearsal on a stand-in
// host (a Docker engine the deployer can reach, such as this container's own). Pure, so the tests can import it;
// src/stage.ts reads the stage being deployed.

/** The platform's stack: the bench, the tunnel and its connector, and the DNS names. */
export const STACK = "CapxulPlatform";
/** The bench host's stack on AWS: the machine, its disk, its network and its role. */
export const HOST_STACK = "CapxulBenchHost";
/** The stage of the shared platform. */
export const STAGING = "staging";
/** Every rehearsal's stage starts with this. */
export const REHEARSAL_PREFIX = "pr-";
/** The prefix of every AWS name; the CI role may change IAM objects with this prefix only. */
export const AWS_PREFIX = "capxul-bench";

const STAGE = /^(staging|pr-[a-z0-9-]{1,21})$/;

/** Whether a stage name is one the platform accepts: `staging`, or `pr-` and 1 to 21 of a-z, 0-9 and -. */
export const isStage = (stage: string): boolean => STAGE.test(stage);

/** The names derived from one stage and one domain. Pure, so the tests can call it. */
export const namesOf = (stage: string, domain: string) => {
  const prefix = `cx-platform-${stage}`;
  return {
    stage,
    domain,
    prefix,
    aws: `${AWS_PREFIX}-${stage}`,
    container: (role: string) => `${prefix}-${role}`,
    hostname: (label: string) => `${label}.${domain}`,
    /** The DNS name of the site door. */
    doorHost: `${stage}-door.${domain}`,
    /** The names every company site may take: one level under the domain. */
    siteWildcard: `*.${domain}`,
  };
};

export type Names = ReturnType<typeof namesOf>;
