// The platform's way in from the internet: one remotely-managed Cloudflare Tunnel, its ingress configuration, the
// connector (cloudflared) running as a container on the platform's host, and the platform's DNS names. The connector
// dials out to Cloudflare's edge, so the host accepts no inbound traffic at all.
//
// Ingress: the door's hostname (`<stage>-door.<domain>`) goes to the site door; every other name one level under the
// domain (`*.<domain>`) goes to the bench's web process, which picks the site from the Host header; anything else gets
// a 404 from the tunnel. One proxied wildcard record sends every such name to the tunnel, so a world needs no DNS
// record and no change to the platform for its sites. Names are one level deep because Cloudflare's free
// certificate covers one level; under `worlds.abuusama.dev`, itself a level down, rehearsals are checked over HTTP
// (roadmap, "Test addresses").
//
// PLATFORM_EDGE=tunnel (the default) is the design. PLATFORM_EDGE=none leaves the tunnel, its connector and the
// wildcard out, and publishes the door's name as a TXT record that says so. A Claude cloud container cannot create a
// tunnel (its egress policy refuses any Cloudflare request that returns a credential, records/spike/01), so a
// rehearsal there exercises the bench, the door and one DNS record. Only one stage per domain can hold the wildcard:
// that is the shared platform's, `staging`.
//
// `doorUrl` is where a world reaches the door: through the tunnel, or, with no edge, only on the host itself (its
// loopback port), so with PLATFORM_EDGE=none nothing on Cloudflare, a world's Core included, can reach it.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { names } from "./stage.ts";

const CLOUDFLARED = "cloudflare/cloudflared:2025.11.1";
export const RECORD_COMMENT = "cx-platform (Capxul); made by packages/platform";

export const edgeMode = Config.Literals(["tunnel", "none"], "PLATFORM_EDGE").pipe(Config.withDefault("tunnel"));

export const Edge = (
  context: Docker.Context,
  network: Docker.Network,
  services: { readonly web: string; readonly door: string },
  bench: { readonly doorLocalPort: number },
) =>
  Effect.gen(function* () {
    const n = yield* names;
    const mode = yield* edgeMode;
    const zoneId = yield* Config.String("PLATFORM_ZONE_ID");
    if (mode === "none") {
      const doorRecord = yield* Cloudflare.DNS.Record("DoorRecord", {
        zoneId,
        name: n.doorHost,
        type: "TXT",
        content: `"cx-platform ${n.stage}: site door; no tunnel (PLATFORM_EDGE=none)"`,
        comment: RECORD_COMMENT,
      });
      const doorUrl = `http://127.0.0.1:${bench.doorLocalPort}`;
      return { mode, zoneId, records: [doorRecord], tunnelId: undefined, connector: undefined, doorUrl };
    }

    const tunnel = yield* Cloudflare.Tunnel.Tunnel("Tunnel", { name: n.prefix });
    yield* Cloudflare.Tunnel.Configuration("Ingress", {
      tunnelId: tunnel.tunnelId,
      ingress: [
        { hostname: n.doorHost, service: services.door },
        { hostname: n.siteWildcard, service: services.web },
      ],
      catchAllService: "http_status:404",
    });
    const toTunnel = (id: string, name: string) =>
      Cloudflare.DNS.Record(id, {
        zoneId,
        name,
        type: "CNAME",
        content: Output.interpolate`${tunnel.tunnelId}.cfargotunnel.com`,
        proxied: true,
        comment: RECORD_COMMENT,
      });
    const doorRecord = yield* toTunnel("DoorRecord", n.doorHost);
    const sitesRecord = yield* toTunnel("SitesRecord", n.siteWildcard);
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
    return {
      mode,
      zoneId,
      records: [doorRecord, sitesRecord],
      tunnelId: tunnel.tunnelId,
      connector,
      doorUrl: `http://${n.doorHost}`,
    };
  });
