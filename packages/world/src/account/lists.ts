// world.list, world.snapshot.list and world.snapshot.delete, as the platform serves them: what an operator has on the
// platform (packages/blueprint, src/world/inventory.ts). A world holds its row in the registry from its claim until its
// name is released, so its owner's list holds what counts against their quota, an expired world not yet swept
// included; each as world.show shows it, read from its own database, with how many snapshots the platform keeps of
// it. A snapshot is in use while a world the shared state holds hangs from its branch (branches.ts, `hangingFrom`): a
// world restored from it, or its own world reset to it in place. Neon cannot delete a branch with children, so such a
// snapshot cannot go. Deleting one removes what its save made (its branch, the chain's state saved under its name on
// the hub, what its sites saved on the bench), then the platform's row of it, and records `snapshot_deleted`.
import { CurrentOperator, Errors, type World as Blueprint } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { claimsOf, registry } from "../things/registry/reserve.ts";
import { describeFailure } from "../common/describe.ts";
import { keptConnection } from "../things/world/handle.ts";
import { doorCall } from "../things/world/client.ts";
import { Limits, type World } from "../things/world/values.ts";
import { dropSaved } from "../things/site/snapshot.ts";
import { recordedOutput } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import { dropBranch, hangers } from "../parts/database/branches.ts";
import { existingRecorded } from "./worlds.ts";
import { instantOf, readFacts } from "../things/world/store.ts";
import { forgetSnapshot, prepareStore, snapshotCounts, snapshotOf, snapshotsOf, type SnapshotRow } from "./store.ts";
import { emitDeclared, opened, Recorded, stateOf } from "./view.ts";

type SnapshotListPayload = (typeof Blueprint.snapshotList.rpc.payloadSchema)["Type"];
type SnapshotDeletePayload = (typeof Blueprint.snapshotDelete.rpc.payloadSchema)["Type"];
type ListedWorld = typeof Blueprint.ListedWorld.Type;

/** A snapshot as its save answered it, from the platform's row of it. */
export const savedOf = (world: string, row: SnapshotRow): typeof Blueprint.Snapshot.Type => ({
  world,
  snapshot: row.snapshot,
  recordSeq: row.record_seq,
  clock: { mode: row.clock_mode, now: instantOf(row.clock_ms) },
  template: row.template,
  savedAt: row.saved_at,
  companies: row.companies,
  migrations: row.migrations,
});

/** The world `world` and what its stage records, refusing a caller who is not its owner. */
const ownedBy = (world: string) =>
  Effect.gen(function* () {
    const { operator } = yield* CurrentOperator;
    const { stage, recorded } = yield* existingRecorded(world);
    const output = yield* Schema.decodeUnknownEffect(Recorded)(recorded).pipe(Effect.orDie);
    if (output.owner !== operator) return yield* Errors.NotWorldOwner.make({ world, owner: output.owner });
    return { stage, output, recorded };
  });

/**
 * One world of the list as world.show shows it, read from its database; none, with a warning, for a world that cannot
 * be shown so: one still being made, or what is left of a take-down that did not finish.
 */
const listedOf = (stage: string, hostMs: number, snapshots: number) =>
  Effect.gen(function* () {
    const output = yield* Effect.flatMap(recordedOutput(stage), Schema.decodeUnknownEffect(Recorded));
    const facts = yield* readFacts(yield* keptConnection(stage, output.branch), hostMs);
    if (facts.born === null) return yield* Effect.fail("its record holds no world_created yet");
    return Option.some<ListedWorld>({
      world: nameOf(stage),
      grade: facts.born.grade,
      state: stateOf(output),
      expiresAt: output.expiresAt,
      door: output.coreUrl,
      parent: facts.born.parent,
      snapshots,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.as(Effect.logWarning(`${stage} is not listed: ${describeFailure(error)}`), Option.none<ListedWorld>()),
    ),
  );

export const list = Effect.fn("platform.world.list")(function* () {
  const { operator } = yield* CurrentOperator;
  return yield* Effect.gen(function* () {
    const { maxPerOwner } = yield* Limits;
    const stages = Arr.map(yield* claimsOf(yield* registry, operator), (claim) => claim.name);
    yield* prepareStore;
    const counts = yield* snapshotCounts(stages);
    const countOf = (stage: string) =>
      Option.getOrElse(
        Option.map(
          Arr.findFirst(counts, (count) => count.stage === stage),
          (count) => count.snapshots,
        ),
        () => 0,
      );
    const hostMs = yield* Clock.currentTimeMillis;
    const listed = yield* Effect.forEach(stages, (stage) => listedOf(stage, hostMs, countOf(stage)), {
      concurrency: 4,
    });
    const worlds = Arr.sort(
      Arr.getSomes(listed),
      Order.mapInput(Order.String, (world: ListedWorld) => world.world),
    );
    return { owner: operator, limit: maxPerOwner, worlds };
  }).pipe(Effect.orDie);
});

export const snapshotList = Effect.fn("platform.world.snapshot.list")(function* (payload: SnapshotListPayload) {
  const { stage } = yield* ownedBy(payload.world);
  return yield* Effect.gen(function* () {
    yield* prepareStore;
    const rows = yield* snapshotsOf(stage);
    const inUse = yield* hangers;
    const snapshots = Arr.map(rows, (row) => ({
      ...savedOf(payload.world, row),
      inUseBy: Arr.map(inUse(row.branch_id), nameOf),
    }));
    return { world: payload.world, snapshots };
  }).pipe(Effect.orDie);
});

/**
 * Forgets the chain's state saved under a snapshot's name on the world's hub. A hub deployed before it could forget one
 * answers that it has no such route: the state then stays until the world goes, as all of a world's saved states do.
 */
const forgetChainState = (world: World, snapshot: string) =>
  doorCall(world, "chain", HttpClientRequest.delete(`/chain/snapshot/${snapshot}`), Schema.Unknown).pipe(
    Effect.asVoid,
    Effect.catchIf(
      (error) => Str.includes("no such route")(error.message),
      () => Effect.logWarning(`${world.stage}'s hub keeps the chain's state of ${snapshot} until the world goes`),
    ),
  );

export const snapshotDelete = Effect.fn("platform.world.snapshot.delete")(function* (payload: SnapshotDeletePayload) {
  const { stage, output, recorded } = yield* ownedBy(payload.world);
  yield* prepareStore.pipe(Effect.orDie);
  const found = yield* snapshotOf(stage, payload.snapshot).pipe(Effect.orDie);
  if (Option.isNone(found))
    return yield* Errors.SnapshotNotFound.make({ world: payload.world, snapshot: payload.snapshot });
  const row = found.value;
  const inUse = (yield* hangers.pipe(Effect.orDie))(row.branch_id);
  if (Arr.isReadonlyArrayNonEmpty(inUse))
    return yield* Errors.SnapshotInUse.make({
      world: payload.world,
      snapshot: payload.snapshot,
      worlds: Arr.map(inUse, nameOf),
    });
  return yield* Effect.gen(function* () {
    const { world } = yield* opened(stage, { recorded });
    yield* dropBranch(row.branch_id);
    yield* forgetChainState(world, payload.snapshot);
    const bench = output.bench ?? "none";
    if (row.companies > 0 && bench !== "none") yield* dropSaved(stage, bench, payload.snapshot);
    yield* forgetSnapshot(stage, payload.snapshot);
    const facts = yield* readFacts(world.database, yield* Clock.currentTimeMillis);
    const success = savedOf(payload.world, row);
    yield* emitDeclared("world.snapshot.delete", { payload, success }, stage, world.database, facts.clockMs);
    return success;
  }).pipe(Effect.orDie);
});
