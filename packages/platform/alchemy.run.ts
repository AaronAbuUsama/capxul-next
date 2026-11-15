// The platform's stack, CapxulPlatform: what every world on the shared bench borrows. One stage is one platform on one
// machine: the Frappe bench as Docker resources on that machine's engine (src/bench.ts, through the context of
// src/host.ts), the site door, a Cloudflare Tunnel with its ingress and its connector on the same machine, and the
// platform's DNS names (src/edge.ts), and the collector, telemetry's way in (src/collector/). Its state is in the account's shared Cloudflare state store, so any machine
// holding the Cloudflare key (and, for the AWS host, the CI role) can plan, check or destroy it.
//
// On AWS the machine itself is another stack, host.run.ts, deployed first; bin/forward.sh then opens the way to its
// Docker engine. Stage names are `staging` or `pr-<x>` (src/names.ts); only DNS records under PLATFORM_DOMAIN are made.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Bench } from "./src/bench.ts";
import { CollectorPart } from "./src/collector/stack.ts";
import { Edge } from "./src/edge.ts";
import { Host } from "./src/host.ts";
import { STACK } from "./src/names.ts";
import { names } from "./src/stage.ts";

export default Alchemy.Stack(
  STACK,
  { providers: Layer.mergeAll(Cloudflare.providers(), Docker.providers()), state: Cloudflare.state() },
  Effect.gen(function* () {
    const n = yield* names;
    const host = yield* Host;
    const bench = yield* Bench(host.context);
    const edge = yield* Edge(host.context, bench.network, { web: bench.webService, door: bench.doorService }, bench);
    const collector = yield* CollectorPart;
    // No secret is an output: alchemy prints outputs in plain text. The door key is read from its resource's state.
    return {
      stage: n.stage,
      host: host.kind,
      endpoint: host.endpoint,
      context: host.context.name,
      domain: n.domain,
      edge: edge.mode,
      tunnelId: edge.tunnelId ?? "",
      doorHost: n.doorHost,
      doorUrl: edge.doorUrl,
      doorKeyId: bench.doorKeyId,
      collectorScript: collector.script,
      collectorUrl: collector.url,
      collectorKeyId: collector.keyId,
      records: Arr.map([...edge.records, collector.record], (r) => r.name),
      zoneId: edge.zoneId,
      containers: Arr.map(
        edge.connector === undefined ? bench.containers : [...bench.containers, edge.connector],
        (c) => c.name,
      ),
      volumes: Arr.map(bench.volumes, (v) => v.name),
      network: bench.network.name,
      benchImage: bench.image.imageRef,
    };
  }),
);
