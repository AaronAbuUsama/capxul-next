// The bench host's stack, CapxulBenchHost: the AWS machine the shared platform runs on (src/aws.ts). Deployed before
// the platform's stack (alchemy.run.ts) with PLATFORM_HOST=aws; only CI deploys it, signed in to AWS through GitHub's
// OIDC as the role bootstrap/ creates. Its state is in the same shared Cloudflare state store as the platform's.
import * as AWS from "@alchemy.run/aws";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { BenchHost } from "./src/aws.ts";
import { HOST_STACK } from "./src/names.ts";
import { names } from "./src/stage.ts";

export default Alchemy.Stack(
  HOST_STACK,
  { providers: AWS.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const n = yield* names;
    const host = yield* BenchHost;
    return {
      stage: n.stage,
      name: n.aws,
      instanceId: host.machine.instanceId,
      zone: host.zone,
      volumeId: host.data.volumeId,
      securityGroupId: host.noInbound.groupId,
    };
  }),
);
