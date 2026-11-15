// The database of one stage of the stack `CapxulCore`: a Neon project of its own (its default branch is the one
// database) and the Hyperdrive configuration through which the Worker reaches it. Declared here so the stack and the
// Worker name the same resources. When `packages/world` lands, a world's Core binds the world's database instead.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { DATABASE_REGION } from "./region.ts";

/**
 * The stage's Neon project. Inside the running Worker this is evaluated again only to name the Hyperdrive binding;
 * the organization is a fact of the deploy, so it is not read there.
 */
export const CoreProject = Effect.gen(function* () {
  const runtime = (yield* Alchemy.ALCHEMY_PHASE) === "runtime";
  const orgId = runtime ? "" : yield* Config.String("NEON_ORG_ID");
  // Neon keeps at most 6 hours of history on the free plan; Alchemy's default asks for 24. London, as every world.
  return yield* Neon.Project("core-db", { region: DATABASE_REGION, orgId, historyRetentionSeconds: 21600 });
});

/**
 * Cloudflare's pooled way in to the stage's database; the Worker binds it and never sees the connection string. Its
 * query cache is off, so a read just after a write sees the write (docs/latency.md, "Hyperdrive's cache is off").
 */
export const CoreDatabase = Effect.gen(function* () {
  const project = yield* CoreProject;
  return yield* Cloudflare.Hyperdrive.Connection("core-hyperdrive", {
    origin: project.origin,
    caching: { disabled: true },
  });
});
