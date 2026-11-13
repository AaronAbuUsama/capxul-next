// The platform's way in from the internet: one remotely-managed Cloudflare Tunnel, its ingress Configuration, the
// connector (cloudflared) running as a container on the platform's host, and the platform's own DNS name.
//
// Ingress: the door's hostname goes to the site door; every other hostname that reaches the tunnel goes to the bench's
// web process, which picks the site from the Host header. A world therefore needs only a DNS record per site (its own
// stack, world.run.ts), never a change to the platform.
//
// PLATFORM_EDGE=tunnel (the default) is the design. PLATFORM_EDGE=none leaves the tunnel and its connector out and
// makes each DNS name a TXT record that says so: the rehearsal's machine could not create a tunnel (its egress
// policy refuses any Cloudflare request that returns a credential, and a tunnel's token is one), so there the stack
// exercises the bench, the door and the DNS records alone (README, "What was blocked").
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { names } from "./names.ts";

const CLOUDFLARED = "cloudflare/cloudflared:2025.11.1";
export const RECORD_COMMENT = "cx-platform rehearsal (Capxul); safe to delete";

export const edgeMode = Config.Literals(["tunnel", "none"], "PLATFORM_EDGE").pipe(Config.withDefault("tunnel"));

/** The DNS record that publishes `name`: a proxied CNAME to the tunnel, or, with no tunnel, a TXT marker. */
export const SiteRecord = (
  id: string,
  props: { zoneId: string | Output.Output<string>; name: string; tunnelId?: Output.Output<string>; says: string },
) =>
  props.tunnelId === undefined
    ? Cloudflare.DNS.Record(id, {
        zoneId: props.zoneId,
        name: props.name,
        type: "TXT",
        content: `"${props.says}; no tunnel (PLATFORM_EDGE=none)"`,
        comment: RECORD_COMMENT,
      })
    : Cloudflare.DNS.Record(id, {
        zoneId: props.zoneId,
        name: props.name,
        type: "CNAME",
        content: Output.interpolate`${props.tunnelId}.cfargotunnel.com`,
        proxied: true,
        comment: RECORD_COMMENT,
      });

export const Edge = (
  context: Docker.Context,
  network: Docker.Network,
  services: { readonly web: string; readonly door: string },
) =>
  Effect.gen(function* () {
    const n = yield* names;
    const mode = yield* edgeMode;
    const zoneId = yield* Config.String("PLATFORM_ZONE_ID");
    const doorHost = n.hostname(`${n.stage}-door`);
    const says = `cx-platform ${n.stage}: site door`;
    if (mode === "none") {
      const doorRecord = yield* SiteRecord("DoorRecord", { zoneId, name: doorHost, says });
      return { mode, doorHost, zoneId, doorRecord, tunnelId: undefined, connector: undefined };
    }

    const tunnel = yield* Cloudflare.Tunnel.Tunnel("Tunnel", { name: n.prefix });
    yield* Cloudflare.Tunnel.Configuration("Ingress", {
      tunnelId: tunnel.tunnelId,
      ingress: [{ hostname: doorHost, service: services.door }],
      catchAllService: services.web,
    });
    const doorRecord = yield* SiteRecord("DoorRecord", { zoneId, name: doorHost, tunnelId: tunnel.tunnelId, says });
    // The connector dials out to Cloudflare's edge from the host; nothing on the host is published for it.
    const connector = yield* Docker.Container("Connector", {
      context,
      name: n.container("connector"),
      image: CLOUDFLARED,
      command: ["tunnel", "--no-autoupdate", "--metrics", "0.0.0.0:2000", "run"],
      environment: { TUNNEL_TOKEN: tunnel.token },
      networks: [{ name: network.name, aliases: ["connector"] }],
      restart: "unless-stopped",
      start: true,
    });
    return { mode, doorHost, zoneId, doorRecord, tunnelId: tunnel.tunnelId, connector };
  });
