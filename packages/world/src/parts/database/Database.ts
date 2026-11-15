// A world's one database: its own copy-on-write branch of the Neon project the platform stage owns (made through
// Neon's API, src/parts/database/neon.ts), and the Hyperdrive configuration through which the world's Core reaches it.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { DATABASE_REGION } from "@capxul/core";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { PLATFORM } from "../../stack/names.ts";
import { worldSettings } from "../../stack/settings.ts";

/** Logical ids, as the state store keys them. */
export const PROJECT_ID = "worlds-db";
export const REGISTRY_ID = "registry";
export const HYPERDRIVE_ID = "world-db";

/** The Neon project every world's branch belongs to. Created only in the platform stage. */
export const WorldsProject = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (stage !== PLATFORM) return yield* Neon.Project.ref(PROJECT_ID, { stage: PLATFORM });
  const orgId = yield* Config.String("NEON_ORG_ID");
  // Neon's free plan keeps at most 6 hours of history; Alchemy's default asks for 24. Core's region, where its Worker
  // is placed (D5).
  return yield* Neon.Project(PROJECT_ID, { region: DATABASE_REGION, orgId, historyRetentionSeconds: 21600 });
});

/**
 * The registry of world names: a branch of its own, so that a world, which forks the project's empty default
 * branch, never carries a copy of it. Created only in the platform stage.
 */
export const Registry = Effect.gen(function* () {
  const project = yield* WorldsProject;
  return yield* Neon.Branch(REGISTRY_ID, { project, name: "registry" });
});

/**
 * Cloudflare's pooled way in to the world's branch. A Core Worker binds this; it never sees the connection string. The
 * branch itself is made by the world's create through Neon's API (src/parts/database/neon.ts), not by the stack: Alchemy's
 * Neon provider looks at a new branch every 5 s, which cost 6 to 9 s of every create. Its take-down deletes it.
 */
export const WorldDatabase = Effect.gen(function* () {
  const { branch } = yield* worldSettings;
  // Its query cache is off, as Core's own stage's is (packages/core, src/stack/database.ts): a read just after a write
  // must see it. With the cache on, approval.sign read a subject's approvals as they were before the last signature
  // (the chain journey in w-cops3).
  const origin = branch.connectionUri.pipe(Redacted.value, Neon.parsePostgresOrigin);
  return yield* Cloudflare.Hyperdrive.Connection(HYPERDRIVE_ID, { origin, caching: { disabled: true } });
});
