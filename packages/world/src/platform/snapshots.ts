// world.snapshot.save and world.snapshot.restore, as the platform serves them (decisions.md, 17 to 19, 46 and 51).
// A snapshot is a branch of the world's database, the chain's whole state saved under the snapshot's name in the
// world's own bucket, and the platform's row of it; it belongs to its world and goes with it. A restore always makes
// a new world: its database forks the snapshot's branch, its chain adopts the saved state, and its record continues
// the snapshot's with its own `world_created`, naming its parent.
//
// A world's company sites are saved with it, on its bench (src/site/Saved.ts): each site's database, backed up under
// the snapshot's name; a restore makes each again in the new world from its backup, under its own label, and points
// the new world's companies at their new sites. A world with companies and no bench is a fault to save.
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
import { restoreSites, saveSites } from "../site/Saved.ts";
import { refusalsOnly } from "./refusals.ts";
import { steady } from "./steady.ts";
import { keepSnapshot, prepareStore, snapshotOf } from "./store.ts";
import { emitDeclared, opened, viewOf } from "./view.ts";

/** How long a restore waits for its sites, each made again from its backup one after another on the bench. */
const SITE_RESTORE = Duration.minutes(8);

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
    if (facts.companies.length > 0) {
      const bench = output.bench ?? "none";
      if (bench === "none") return yield* Effect.die(`${stage} has companies but no bench: its sites cannot be saved`);
      yield* saveSites(stage, bench, payload.snapshot);
    }
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
  const bench = output.bench ?? "none";
  if (snapshot.companies > 0 && bench === "none")
    return yield* Effect.die(`${stage} has companies but no bench: its sites cannot be restored`);
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
      const restoredAt = yield* Clock.currentTimeMillis;
      yield* writeRestored(made.world.database, {
        mode: snapshot.clock_mode,
        worldMs: snapshot.clock_ms,
        hostMs: restoredAt,
      });
      if (snapshot.companies > 0) {
        const clock =
          snapshot.clock_mode === "frozen"
            ? { frozen_at_ms: snapshot.clock_ms }
            : { offset_ms: snapshot.clock_ms - restoredAt };
        const sites = yield* restoreSites(stage, made.world.stage, bench, payload.snapshot, clock).pipe(
          Effect.timeout(SITE_RESTORE),
        );
        // The new world's companies are the saved world's, at their new sites: Core reaches a company's site by its
        // name (`app.organizations.site`) and lists it by its address (`app.companies.site_url`).
        yield* Effect.forEach(sites, (site) =>
          Effect.andThen(
            made.world.sql("update app.organizations set site = $2 where site = $1", [site.from, site.site]),
            made.world.sql("update app.companies set site_url = $2 where site_url = $1", [
              `https://${site.from}`,
              `https://${site.site}`,
            ]),
          ),
        );
      }
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
