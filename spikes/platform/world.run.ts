// One world's stack on the shared platform: the DNS name of each of its sites, pointed at the platform's tunnel, and
// the world's owner, expiry and site quota as outputs (the sweeper of spikes/state reads `owner` and `expiresAt`).
// The world borrows the platform through the platform's recorded outputs (Output.stackRef): the zone and the tunnel
// come from there, so the world needs no setting of the platform's but its stage. Its sites are made on the bench by the site door, with the token src/run-mint.ts
// mints for this world.
//
// WORLD_PLATFORM_STAGE names the platform stage; WORLD_SITES is a comma-separated list of site labels ("r1,r2"),
// each published as `<world>-<label>.<PLATFORM_DOMAIN>`. The world's name is its stage without the "pr-" prefix.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { edgeMode, SiteRecord } from "./src/edge.ts";
import { names, STACK, STAGE_PREFIX, WORLD_STACK } from "./src/names.ts";

interface PlatformOutputs {
  readonly tunnelId: string;
  readonly zoneId: string;
}

export default Alchemy.Stack(
  WORLD_STACK,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const n = yield* names;
    const world = n.stage.slice(STAGE_PREFIX.length);
    const platformStage = yield* Config.String("WORLD_PLATFORM_STAGE");
    const labels = (yield* Config.String("WORLD_SITES")).split(",").filter((s) => s.length > 0);
    const owner = yield* Config.String("WORLD_OWNER");
    const expiresAt = yield* Config.String("WORLD_EXPIRES_AT");
    const quota = yield* Config.Number("WORLD_SITE_QUOTA");
    const platform = yield* Output.stackRef<PlatformOutputs>(STACK, { stage: platformStage });

    const mode = yield* edgeMode;
    const sites = yield* Effect.forEach(labels, (label) =>
      SiteRecord(`Site-${label}`, {
        zoneId: platform.pipe(Output.map((p) => p.zoneId)),
        name: n.hostname(`${world}-${label}`),
        tunnelId: mode === "tunnel" ? platform.pipe(Output.map((p) => p.tunnelId)) : undefined,
        says: `cx-platform world ${world}: site ${label} on platform ${platformStage}`,
      }),
    );
    return { world, platform: platformStage, owner, expiresAt, quota, sites: sites.map((s) => s.name) };
  }),
);
