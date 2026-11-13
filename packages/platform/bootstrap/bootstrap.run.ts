// The bootstrap's stack, CapxulBootstrap (stage `ci`): everything CI needs before it can deploy the platform or make a
// world, made once by Aaron from a laptop (bootstrap.sh, BOOTSTRAP.md) and never by CI, whose keys cannot make keys.
//
// - AWS: GitHub's OIDC provider and the CI role, which only this repository's workflows on master and pull requests
//   into master may take on, with the least the bench host needs (src/aws-policy.ts). No AWS key exists anywhere.
// - Cloudflare: an account-owned token limited to what worlds and the platform need (src/cloudflare-policy.ts).
// - Neon: an organization key limited to the worlds project.
// - GitHub: the two keys as repository secrets, the settings as repository variables, and CAPXUL_CLOUD_READY=true,
//   which the gated CI jobs wait for, set last: it depends on everything else.
//
// The keys' values go from the resource that makes them to the GitHub secret that holds them inside this program; they
// are never printed, never outputs, and live otherwise only in the shared state store (encrypted). A new generation
// (CAPXUL_KEY_GENERATION) rotates both keys: new ones are made, the secrets updated, the old ones deleted. Destroying
// the stage revokes both keys and removes the role, the secrets and the variables; the OIDC provider is kept, as it is
// one per AWS account and may serve others.
import * as AWS from "@alchemy.run/aws";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Str from "effect/String";
import { OIDC_AUDIENCE, OIDC_HOST, permissionsPolicy, trustPolicy } from "./src/aws-policy.ts";
import { tokenPolicies } from "./src/cloudflare-policy.ts";

export const BOOTSTRAP_STACK = "CapxulBootstrap";
export const CI_ROLE = "capxul-ci-platform";
/** The repository variables the workflows read; CAPXUL_CLOUD_READY comes after them. */
export const VARIABLES = [
  "AWS_ROLE_ARN",
  "AWS_REGION",
  "CLOUDFLARE_ACCOUNT_ID",
  "NEON_ORG_ID",
  "PLATFORM_ZONE_ID",
  "PLATFORM_ZONE_NAME",
  "PLATFORM_DOMAIN",
  "PLATFORM_AMI_ID",
  "CAPXUL_KEY_GENERATION",
] as const;

const settings = Effect.all({
  repo: Config.String("BOOTSTRAP_REPO"),
  awsAccount: Config.String("AWS_ACCOUNT_ID"),
  awsRegion: Config.String("AWS_REGION"),
  cfAccount: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  zoneId: Config.String("PLATFORM_ZONE_ID"),
  zoneName: Config.String("PLATFORM_ZONE_NAME"),
  domain: Config.String("PLATFORM_DOMAIN"),
  neonOrg: Config.String("NEON_ORG_ID"),
  neonProject: Config.String("NEON_WORLDS_PROJECT_ID"),
  amiId: Config.String("PLATFORM_AMI_ID"),
  generation: Config.Int("CAPXUL_KEY_GENERATION").pipe(Config.withDefault(1)),
});

export default Alchemy.Stack(
  BOOTSTRAP_STACK,
  {
    // Some providers also provide services the others read (an HTTP client, Alchemy's profile store), so each is
    // provided to the ones before it rather than merged beside them.
    providers: AWS.providers().pipe(
      Layer.provideMerge(Cloudflare.providers()),
      Layer.provideMerge(Neon.providers()),
      Layer.provideMerge(GitHub.providers()),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const s = yield* settings;
    const [owner, repository = ""] = Str.split(s.repo, "/");
    if (owner === "" || repository === "") return yield* Effect.die(`BOOTSTRAP_REPO "${s.repo}" is not owner/name`);
    const keyName = `capxul-ci-worlds-g${s.generation}`;

    const oidc = yield* AWS.IAM.OpenIDConnectProvider("GitHubOidc", {
      url: `https://${OIDC_HOST}`,
      clientIDList: [OIDC_AUDIENCE],
    }).pipe(Alchemy.RemovalPolicy.retain());
    const role = yield* AWS.IAM.Role("CiRole", {
      roleName: CI_ROLE,
      description: `GitHub Actions of ${s.repo} on master and pull requests into master: the bench host`,
      assumeRolePolicyDocument: oidc.openIDConnectProviderArn.pipe(Output.map((arn) => trustPolicy(arn, s.repo))),
      inlinePolicies: { "bench-host": permissionsPolicy(s.awsAccount, s.awsRegion) },
      maxSessionDuration: "2 hours",
    });

    const cfToken = yield* Cloudflare.ApiToken.AccountApiToken("CiCloudflareToken", {
      name: keyName,
      accountId: s.cfAccount,
      policies: tokenPolicies(s.cfAccount, s.zoneId),
    });
    const neonKey = yield* Neon.OrganizationApiKey("CiNeonKey", {
      orgId: s.neonOrg,
      projectId: s.neonProject,
      name: keyName,
    });

    const repo = { owner, repository };
    const secrets = [
      yield* GitHub.Secret("SecretCloudflare", { ...repo, name: "CLOUDFLARE_API_TOKEN", value: cfToken.value }),
      yield* GitHub.Secret("SecretNeon", { ...repo, name: "NEON_API_KEY", value: neonKey.key }),
    ];
    const values: Record<(typeof VARIABLES)[number], string | Output.Output<string>> = {
      AWS_ROLE_ARN: role.roleArn,
      AWS_REGION: s.awsRegion,
      CLOUDFLARE_ACCOUNT_ID: s.cfAccount,
      NEON_ORG_ID: s.neonOrg,
      PLATFORM_ZONE_ID: s.zoneId,
      PLATFORM_ZONE_NAME: s.zoneName,
      PLATFORM_DOMAIN: s.domain,
      PLATFORM_AMI_ID: s.amiId,
      // bootstrap.sh reads it back, so `rotate` knows the next generation.
      CAPXUL_KEY_GENERATION: `${s.generation}`,
    };
    const variable = (name: string, value: string | Output.Output<string>) =>
      GitHub.Variable(`Var-${name}`, { ...repo, name, value });
    const variables = yield* Effect.forEach(VARIABLES, (name) => variable(name, values[name]));
    // Last: the gated jobs start running when this is true, so it waits for every secret and variable above.
    const ready = Output.all(...Arr.map(secrets, (x) => x.updatedAt), ...Arr.map(variables, (x) => x.updatedAt)).pipe(
      Output.map(() => "true"),
    );
    yield* variable("CAPXUL_CLOUD_READY", ready);

    return {
      repo: s.repo,
      roleArn: role.roleArn,
      oidcProvider: oidc.openIDConnectProviderArn,
      cloudflareToken: cfToken.name,
      neonKey: keyName,
      secrets: ["CLOUDFLARE_API_TOKEN", "NEON_API_KEY"],
      variables: [...VARIABLES, "CAPXUL_CLOUD_READY"],
    };
  }),
);
