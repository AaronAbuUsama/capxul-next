// The platform rehearsal's stack: what every world on the shared bench borrows. One stage is one platform, on one
// machine: the Frappe bench as Docker resources on that machine's engine (through a Docker context), a Cloudflare
// Tunnel with its ingress, the tunnel's connector on the same machine, and the platform's DNS name. Its state is in
// the account's shared Cloudflare state store, so any container holding the Cloudflare key can plan or destroy it.
//
// Stage names start "pr-" and every resource is named `cx-platform-<stage>…`, so nothing here can collide with another
// agent's stack on the same Docker engine or Cloudflare account. Only DNS records under PLATFORM_DOMAIN are created.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Bench } from "./src/bench.ts";
import { Edge } from "./src/edge.ts";
import { Host } from "./src/host.ts";
import { names, STACK } from "./src/names.ts";

export default Alchemy.Stack(
  STACK,
  { providers: Layer.mergeAll(Cloudflare.providers(), Docker.providers()), state: Cloudflare.state() },
  Effect.gen(function* () {
    const n = yield* names;
    // The door's signing key: whoever holds it can mint a world's site token (src/token.ts). Kept out of git.
    const doorKey = yield* Config.Redacted("PLATFORM_DOOR_KEY");
    const host = yield* Host;
    const bench = yield* Bench(host.context, doorKey);
    const edge = yield* Edge(host.context, bench.network, { web: bench.webService, door: bench.doorService });
    // No secret is an output: alchemy prints outputs in plain text.
    return {
      stage: n.stage,
      host: host.endpoint,
      context: host.context.name,
      domain: n.domain,
      edge: edge.mode,
      tunnelId: edge.tunnelId ?? "",
      doorHost: edge.doorHost,
      doorRecord: edge.doorRecord.name,
      zoneId: edge.zoneId,
      containers: bench.containers.map((c) => c.name).concat(edge.connector ? [edge.connector.name] : []),
      volumes: bench.volumes.map((v) => v.name),
      network: bench.network.name,
      benchImage: bench.image.imageRef,
    };
  }),
);
