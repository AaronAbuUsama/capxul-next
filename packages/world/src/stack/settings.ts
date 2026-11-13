// What the caller decides about a world, handed to the stack as a service around a deploy. A deploy run in-process
// replaces the config provider with one built from the process environment, so these cannot travel as Config, and
// nothing is ever written to the process environment.
import * as Alchemy from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import { WorldSettingsMissing } from "../failures.ts";

export interface WorldSettings {
  readonly owner: string;
  /** RFC 3339. Neon deletes the world's branch by itself at this moment; the sweeper deletes the rest. */
  readonly expiresAt: string;
  /** The stage of the world this one's database is forked from; none for a world made from nothing. */
  readonly forkedFrom: Option.Option<string>;
  /** The shared bench the world's company sites are on, and its site token there (src/site/Bench.ts); none for a world with no bench. */
  readonly bench: Option.Option<BenchGrant>;
  /**
   * The branch a world restored from a snapshot forks: the snapshot's own (src/platform/branches.ts). It takes the
   * place of `forkedFrom`'s branch.
   */
  readonly parentBranch: Option.Option<string>;
  /**
   * The token of the operator who owns the world, which its Core accepts as the owner's at both doors (decisions.md,
   * 36). Left out, the world mints one of its own (`operator-token`).
   */
  readonly operatorToken: Option.Option<Redacted.Redacted>;
}

/** What a world is given on a bench when it is created: where its site door is, and its token there. */
export interface BenchGrant {
  /** The platform stage the bench belongs to (packages/platform). */
  readonly stage: string;
  readonly door: string;
  readonly token: Redacted.Redacted;
}

export const WorldSettings = Context.Reference<Option.Option<WorldSettings>>("capxul/world/WorldSettings", {
  defaultValue: () => Option.none(),
});

const blank: WorldSettings = {
  owner: "",
  expiresAt: "",
  forkedFrom: Option.none(),
  bench: Option.none(),
  parentBranch: Option.none(),
  operatorToken: Option.none(),
};

/**
 * The world's settings as the stack sees them. Inside a running Worker the stack's files are evaluated again, only
 * to name bindings; the settings are neither known nor needed there.
 */
export const worldSettings = Effect.gen(function* () {
  if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return blank;
  const provided = yield* WorldSettings;
  if (Option.isSome(provided)) return provided.value;
  return yield* Effect.die(
    WorldSettingsMissing.make({
      message: "a world is deployed through this package's create, which provides its owner and expiry",
    }),
  );
});
