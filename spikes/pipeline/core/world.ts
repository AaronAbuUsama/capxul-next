// A world's one database: a Neon branch borrowed from the `platform` stage's project, and the Hyperdrive
// configuration through which the world's Core Worker reaches it. Declared here so the stack and the Worker
// name the same resources.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** The stage that owns what worlds share. Every other stage is one world. */
export const PLATFORM = "platform";

/** The Neon project every world's branch belongs to. Created only in the `platform` stage. */
export const WorldsProject = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (stage !== PLATFORM) return yield* Neon.Project.ref("worlds-db", { stage: PLATFORM });
  const orgId = yield* Config.String("NEON_ORG_ID");
  // Neon's free plan keeps at most 6 hours of history; Alchemy's default asks for 24.
  return yield* Neon.Project("worlds-db", { region: "aws-eu-west-2", orgId, historyRetentionSeconds: 21600 });
});

/**
 * Who a world belongs to and the moment it expires (RFC 3339). The runner provides this service around a deploy.
 * A deploy from the command line, where nothing provides it, reads `WORLD_OWNER` and `WORLD_EXPIRES_AT` instead.
 */
export const WorldSettings = Context.Reference<Option.Option<{ readonly owner: string; readonly expiresAt: string }>>(
  "capxul/core/WorldSettings",
  { defaultValue: () => Option.none() },
);

/**
 * The world's owner and expiry are facts of the deploy. Inside the running Worker this file is evaluated again, only
 * to name the binding, and there they are neither known nor needed.
 */
const settings = Effect.gen(function* () {
  if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return { owner: "", expiresAt: "" };
  const provided = yield* WorldSettings;
  if (Option.isSome(provided)) return provided.value;
  return yield* Config.all({ owner: Config.String("WORLD_OWNER"), expiresAt: Config.String("WORLD_EXPIRES_AT") });
});

/** The world's branch. It names its owner, and Neon deletes it by itself the moment it expires. */
export const WorldBranch = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const project = yield* WorldsProject;
  const { owner, expiresAt } = yield* settings;
  return yield* Neon.Branch("world", { project, name: `w-${owner}-${stage}`, expiresAt });
});

/** Cloudflare's pooled way in to the world's branch. The Worker binds this; it never sees the connection string. */
export const WorldDatabase = Effect.gen(function* () {
  const branch = yield* WorldBranch;
  return yield* Cloudflare.Hyperdrive.Connection("world-db", { origin: branch.origin });
});
