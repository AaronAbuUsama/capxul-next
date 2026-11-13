// A world's one database: its own copy-on-write branch of the Neon project the platform stage owns, and the
// Hyperdrive configuration through which the world's Core reaches it. Declared here so the stack, the index and a
// caller's Core name the same resources.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { PLATFORM } from "../stack/names.ts";
import { worldSettings } from "../stack/settings.ts";

/** Logical ids, as the state store keys them. */
export const PROJECT_ID = "worlds-db";
export const REGISTRY_ID = "registry";
export const BRANCH_ID = "world";
export const HYPERDRIVE_ID = "world-db";

/** The Neon project every world's branch belongs to. Created only in the platform stage. */
export const WorldsProject = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (stage !== PLATFORM) return yield* Neon.Project.ref(PROJECT_ID, { stage: PLATFORM });
  const orgId = yield* Config.String("NEON_ORG_ID");
  // Neon's free plan keeps at most 6 hours of history; Alchemy's default asks for 24.
  return yield* Neon.Project(PROJECT_ID, { region: "aws-eu-west-2", orgId, historyRetentionSeconds: 21600 });
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
 * The world's branch. It forks another world's branch when the world is made from one, or a snapshot's when it is
 * restored from one, and Neon deletes it by itself the moment the world expires.
 */
export const WorldBranch = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const project = yield* WorldsProject;
  const { expiresAt, forkedFrom, parentBranch } = yield* worldSettings;
  const parent = Option.isSome(parentBranch)
    ? { parentBranch: { branchId: parentBranch.value } }
    : Option.isSome(forkedFrom)
      ? { parentBranch: yield* Neon.Branch.ref(BRANCH_ID, { stage: forkedFrom.value }) }
      : {};
  return yield* Neon.Branch(BRANCH_ID, { project, name: stage, expiresAt, ...parent });
});

/** Cloudflare's pooled way in to the world's branch. A Core Worker binds this; it never sees the connection string. */
export const WorldDatabase = Effect.gen(function* () {
  const branch = yield* WorldBranch;
  // Its query cache is off, as Core's own stage's is (packages/core, src/stack/database.ts): a read just after a write
  // must see it. With the cache on, approval.sign read a subject's approvals as they were before the last signature
  // (the chain journey in w-cops3).
  return yield* Cloudflare.Hyperdrive.Connection(HYPERDRIVE_ID, { origin: branch.origin, caching: { disabled: true } });
});
