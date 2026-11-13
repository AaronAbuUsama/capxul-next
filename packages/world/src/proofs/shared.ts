// Proofs about the shared state: two creates of one name at once, and the sweeper over an expired world, a live one
// and one with no recorded expiry.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { inventory } from "../lifecycle/account.ts";
import { create, destroy, list } from "../lifecycle/operations.ts";
import { describe } from "../lifecycle/run.ts";
import type { WorldSpec } from "../lifecycle/spec.ts";
import { recordOutput } from "../stack/engine.ts";
import { insist, observed } from "./checks.ts";

const namesOf = (stage: string) =>
  Effect.map(inventory, (listing) => ({
    workers: listing.workers.ofThisStack.filter((name) => name.includes(stage)),
    containerApplications: listing.containerApplications.ofThisStack.filter((name) => name.includes(stage)),
    r2Buckets: listing.r2Buckets.ofThisStack.filter((name) => name.includes(stage)),
    hyperdriveConfigurations: listing.hyperdriveConfigurations.ofThisStack.filter((name) => name.includes(stage)),
    neonBranches: listing.neonBranches.names.filter((name) => name.includes(stage)),
  }));

const tagOf = (exit: Exit.Exit<unknown, unknown>) => (Exit.isSuccess(exit) ? "created" : describe(exit.cause));

/**
 * Two creates of the same name started at the same moment. One must win; the other must fail with
 * WorldAlreadyExists before it has created anything, so the accounts hold exactly one world's resources.
 */
export const race = Effect.gen(function* () {
  const spec = (owner: string): WorldSpec => ({ name: "p-race", owner, lifetime: Duration.minutes(40) });
  const [first, second] = yield* Effect.all(
    [Effect.exit(create(spec("racer-a"))), Effect.exit(create(spec("racer-b")))],
    { concurrency: 2 },
  );
  const results = [tagOf(first), tagOf(second)];
  const holds = yield* namesOf("w-p-race");
  const listed = (yield* list).filter((world) => world.world === "w-p-race");
  const gone = yield* Effect.exit(destroy("p-race"));
  const left = yield* namesOf("w-p-race");
  yield* observed("race", {
    proof: "two creates of one world name at once",
    results,
    whatTheAccountsHeldAfterwards: holds,
    inSharedState: listed,
    afterDestroy: { destroyed: Exit.isSuccess(gone), left },
  });
  const winners = results.filter((result) => result === "created").length;
  const refused = results.filter((result) => result.startsWith("WorldAlreadyExists")).length;
  yield* insist(
    winners === 1 && refused === 1,
    `expected one winner and one typed refusal, got ${results.join(" | ")}`,
  );
  yield* insist(
    holds.workers.length === 2 &&
      holds.containerApplications.length === 2 &&
      holds.r2Buckets.length === 1 &&
      holds.hyperdriveConfigurations.length === 1 &&
      holds.neonBranches.length === 1,
    "the accounts do not hold exactly one world's resources",
  );
  yield* insist(Object.values(left).flat().length === 0, "the destroy left something of the raced world");
  return { results, whatTheAccountsHeldAfterwards: holds, left };
});

/**
 * The sweep proof, first half. Three worlds, made at once: one that expires in four minutes, one that is live, and
 * one whose record has lost its expiry, as a world made by an older tool or by hand would be. The sweeps themselves
 * are then run with the command line from another copy of this package with an empty home directory, to show that
 * the sweeper needs nothing but the shared state.
 */
export const sweepSetup = Effect.gen(function* () {
  const made = yield* Effect.all(
    [
      create({ name: "p-old", owner: "proof", lifetime: Duration.minutes(4) }),
      create({ name: "p-live", owner: "proof", lifetime: Duration.minutes(40) }),
      create({ name: "p-undated", owner: "proof", lifetime: Duration.minutes(40) }),
    ],
    { concurrency: 3 },
  );
  yield* recordOutput("w-p-undated", { world: "w-p-undated", owner: "proof" });
  const report = {
    createMs: made.map((world) => ({ world: world.world.stage, ms: world.ms })),
    expires: made[0].world.expiresAt,
  };
  yield* observed("sweep-setup", { proof: "three worlds created at once in one process, for the sweeper", ...report });
  return report;
});

/**
 * The sweep proof, second half, after the sweeps: the expired world must be gone from the shared state and from
 * both accounts, and the other two must still be there. They are then destroyed.
 */
export const sweepCheck = Effect.gen(function* () {
  const inSharedState = (yield* list).map((world) => `${world.world}: ${world.state}`);
  const old = yield* namesOf("w-p-old");
  const live = yield* namesOf("w-p-live");
  const undated = yield* namesOf("w-p-undated");
  yield* observed("sweep", {
    proof: "after the sweep: the expired world is gone, the live one and the one with no recorded expiry are not",
    inSharedState,
    leftOfTheExpiredWorld: old,
    theLiveWorld: live,
    theWorldWithNoExpiry: undated,
  });
  yield* insist(
    Object.values(old).flat().length === 0 && !inSharedState.some((entry) => entry.startsWith("w-p-old")),
    "the sweep left something of the expired world",
  );
  yield* insist(
    live.workers.length === 2 && undated.workers.length === 2,
    "the sweep removed a world it should have kept",
  );
  yield* insist(
    inSharedState.includes("w-p-live: live") && inSharedState.includes("w-p-undated: no-expiry"),
    `the shared state holds ${inSharedState.join(", ")}`,
  );
  const destroyed = [yield* destroy("p-live"), yield* destroy("p-undated")];
  return { inSharedState, leftOfTheExpiredWorld: old, thenDestroyed: destroyed.map((gone) => gone.world) };
});
