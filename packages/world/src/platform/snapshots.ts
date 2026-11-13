// world.snapshot.save and world.snapshot.restore, as the platform serves them (decisions.md, 17 to 19, 46 and 51).
// A snapshot is a branch of the world's database, the chain's whole state saved under the snapshot's name in the
// world's own bucket, and the platform's row of it; it belongs to its world and goes with it. A restore always makes
// a new world: its database forks the snapshot's branch, its chain adopts the saved state, and its record continues
// the snapshot's with its own `world_created`, naming its parent.
//
// A company's site is not saved yet: a world with companies is a fault to save, until the bench can back a site up
// and restore it (it waits on roadmap step 1.4 and the site door).
import { CurrentOperator, Errors, type World as Blueprint } from "@capxul/blueprint";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import { create as createWorld } from "../lifecycle/operations.ts";
import { saveChain } from "../lifecycle/parts.ts";
import { branchOf, dropBranch, forkable } from "./branches.ts";
import { existing, isTaken, keptOrDestroyed, tried } from "./create.ts";
import { instantOf, readFacts, writeRestored } from "./facts.ts";
import { tokenOf } from "./operators.ts";
import { refusalsOnly } from "./refusals.ts";
import { steady } from "./steady.ts";
import { keepSnapshot, prepareStore, snapshotOf } from "./store.ts";
import { emitDeclared, opened, viewOf } from "./view.ts";

type SavePayload = (typeof Blueprint.snapshotSave.rpc.payloadSchema)["Type"];
type RestorePayload = (typeof Blueprint.snapshotRestore.rpc.payloadSchema)["Type"];

/** The world, its owner and its handle, refusing a caller who is not its owner unless `anyone` lets them. */
const ownedWorld = (world: string) =>
  Effect.gen(function* () {
    const stage = yield* existing(world);
    const { output, world: handle } = yield* opened(stage).pipe(Effect.orDie);
    return { stage, output, handle };
  });

export const save = Effect.fn("platform.world.snapshot.save")(function* (payload: SavePayload) {
  const { operator } = yield* CurrentOperator;
  const { stage, output, handle } = yield* ownedWorld(payload.world);
  if (output.owner !== operator) return yield* Errors.NotWorldOwner.make({ world: payload.world, owner: output.owner });
  yield* prepareStore.pipe(Effect.orDie);
  const found = yield* snapshotOf(stage, payload.snapshot).pipe(Effect.orDie);
  if (Option.isSome(found) && !payload.replace)
    return yield* Errors.SnapshotExists.make({ world: payload.world, snapshot: payload.snapshot });
  return yield* Effect.gen(function* () {
    const hostMs = yield* Clock.currentTimeMillis;
    const facts = yield* readFacts(handle.database, hostMs);
    if (facts.companies.length > 0)
      return yield* Effect.die("a world with companies cannot be saved yet: a site's backup waits on the bench");
    const parent = yield* forkable(stage);
    if (Option.isSome(found)) yield* dropBranch(found.value.branch_id);
    const suffix = yield* Random.nextIntBetween(0, 0xffffff);
    const branch = yield* branchOf(parent, `snap-${stage}-${payload.snapshot}-${suffix.toString(16)}`);
    yield* saveChain(handle, payload.snapshot);
    const savedAt = instantOf(hostMs);
    yield* keepSnapshot({
      stage,
      snapshot: payload.snapshot,
      branch_id: branch,
      record_seq: facts.recordHead,
      clock_mode: facts.clock.mode,
      clock_ms: facts.clockMs,
      template: payload.template,
      saved_at: savedAt,
      companies: facts.companies.length,
      migrations: facts.migrations,
    });
    const success = {
      world: payload.world,
      snapshot: payload.snapshot,
      recordSeq: facts.recordHead,
      clock: facts.clock,
      template: payload.template,
      savedAt,
      companies: facts.companies.length,
      migrations: facts.migrations,
    };
    yield* emitDeclared("world.snapshot.save", { payload, success }, stage, handle.database, facts.clockMs);
    return success;
  }).pipe(Effect.orDie);
});

export const restore = Effect.fn("platform.world.snapshot.restore")(function* (payload: RestorePayload) {
  const { operator } = yield* CurrentOperator;
  const { stage, output } = yield* ownedWorld(payload.world);
  yield* prepareStore.pipe(Effect.orDie);
  const found = yield* snapshotOf(stage, payload.snapshot).pipe(Effect.orDie);
  if (Option.isNone(found))
    return yield* Errors.SnapshotNotFound.make({ world: payload.world, snapshot: payload.snapshot });
  const snapshot = found.value;
  if (!snapshot.template && output.owner !== operator)
    return yield* Errors.NotWorldOwner.make({ world: payload.world, owner: output.owner });
  const hostMs = yield* Clock.currentTimeMillis;
  const lifetime = Duration.minutes(payload.lifetimeMinutes);
  const askedMs = hostMs + Duration.toMillis(lifetime);
  if (askedMs > DateTime.toEpochMillis(DateTime.makeUnsafe(output.expiresAt)))
    return yield* Errors.ExpiryBeyondSource.make({
      source: payload.world,
      asked: instantOf(askedMs),
      latest: output.expiresAt,
    });
  if (snapshot.companies > 0)
    return yield* Effect.die("a snapshot with companies cannot be restored yet: a site's restore waits on the bench");
  const token = yield* Effect.flatMap(tokenOf(operator), (held) =>
    Option.match(held, {
      onNone: () => Effect.die(`the platform holds no token for ${operator}`),
      onSome: Effect.succeed,
    }),
  );
  yield* tried(payload.as);
  const made = yield* createWorld({
    name: payload.as,
    owner: operator,
    lifetime,
    operatorToken: token,
    from: payload.world,
    snapshot: { branch: snapshot.branch_id, name: payload.snapshot },
  }).pipe(refusalsOnly(isTaken));
  return yield* keptOrDestroyed(
    made.world.stage,
    Effect.gen(function* () {
      const parent = { world: payload.world, snapshot: payload.snapshot, recordSeq: snapshot.record_seq };
      yield* writeRestored(made.world.database, {
        mode: snapshot.clock_mode,
        worldMs: snapshot.clock_ms,
        hostMs: yield* Clock.currentTimeMillis,
      });
      const { view, facts } = yield* viewOf(made.world.stage, { parent });
      yield* steady(view.door);
      const success = { ...view, recordHead: snapshot.record_seq + 1 };
      yield* emitDeclared(
        "world.snapshot.restore",
        { payload, success },
        made.world.stage,
        made.world.database,
        facts.clockMs,
      );
      return success;
    }).pipe(Effect.orDie),
  );
});
