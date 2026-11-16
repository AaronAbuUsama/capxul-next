// A snapshot's database: a branch of the world's own branch, made through Neon's API with no compute of its own, so it
// costs only the storage it does not share with its parent. A world restored from the snapshot forks it in turn
// (src/parts/database/Database.ts). Neon refuses to fork a branch that has an expiry, so the world's own branch has its expiry
// taken off first; the sweeper deletes the world at its recorded expiry. A branch with children cannot be deleted,
// so a world restored from a snapshot must go before the snapshot does, which its expiry makes so (ExpiryBeyondSource).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { branchesOf, branchOperation, deleteBranch, finished, neon, projectId } from "./neon.ts";
import { PlatformFailed } from "../../common/failures.ts";
import { liftBranchExpiry } from "../../stack/cloud.ts";
import { describeFailure } from "../../common/describe.ts";
import { WorldOutput } from "../../things/world/handle.ts";
import { recordedOutput, recordedStages, recordOutput } from "../../stack/engine.ts";
import { isWorldStage } from "../../stack/names.ts";
import { forgetSnapshots, prepareStore } from "../../account/store.ts";

const NEON = "https://console.neon.tech/api/v2";
const Created = Schema.Struct({ branch: Schema.Struct({ id: Schema.String }) });

const failed = (cause: unknown) => PlatformFailed.make({ step: "branch", message: describeFailure(cause) });

/** Makes a world's branch forkable, once: its Neon expiry is taken off, and its record says so. */
export const forkable = Effect.fn("platform.forkable")(function* (stage: string) {
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(stage));
  const raw = yield* recordedOutput(stage);
  const recorded: Record<string, unknown> = Predicate.isObject(raw) ? { ...raw } : {};
  if (recorded["neonExpiry"] !== undefined) return output.branch;
  yield* liftBranchExpiry(yield* projectId, output.branch);
  yield* recordOutput(stage, { ...recorded, neonExpiry: "lifted so that snapshots could be saved" });
  return output.branch;
}, Effect.mapError(failed));

/**
 * A branch of `parent` called `name`, with no compute; its id. Waits until Neon has finished making it; `asked` runs
 * once Neon has taken the request, before that wait, for what may run beside it (a snapshot's chain save).
 */
export const branchOf = Effect.fn("platform.branch")(
  function* (parent: string, name: string, asked: Effect.Effect<void> = Effect.void) {
    const project = yield* projectId;
    const answer = yield* neon(
      HttpClientRequest.post(`${NEON}/projects/${project}/branches`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ branch: { parent_id: parent, name } }),
      ),
    );
    const created = yield* Schema.decodeUnknownEffect(Created)(answer).pipe(Effect.mapError(failed));
    yield* asked;
    // Neon's operations for it, looked at every 250 ms (src/parts/database/neon.ts).
    yield* finished(project, answer).pipe(Effect.mapError(failed));
    return created.branch.id;
  },
  branchOperation,
  Effect.mapError(failed),
);

/** Deletes a branch. One that is already gone is no failure. */
export const dropBranch = Effect.fn("platform.dropBranch")(
  function* (branch: string) {
    const project = yield* projectId;
    yield* neon(HttpClientRequest.delete(`${NEON}/projects/${project}/branches/${branch}`), "ok");
  },
  branchOperation,
  Effect.mapError(failed),
);

/** Whether a branch of the project is one of the world's: its own, a snapshot's, or one an in-place reset preserved. */
export const isBranchOf = (stage: string) => (name: string) =>
  name === stage || Str.startsWith(`snap-${stage}-`)(name) || Str.startsWith(preservedPrefix(stage))(name);

/** What an in-place reset keeps of the world's branch as it was (src/things/world/reset.ts): `<stage>-pre-<n>`. */
export const preservedPrefix = (stage: string) => `${stage}-pre-`;

/** One branch of the project, as Neon lists it. */
export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly parent_id?: string | undefined;
}

/** One world the shared state holds: its stage and its database's branch, once it has one. */
export interface WorldBranch {
  readonly stage: string;
  readonly branch: string | undefined;
}

const HasBranch = Schema.Struct({ branch: Schema.String });

/**
 * The stages of the worlds that hang from `parent`: each branch whose parent it is belongs to the world whose own
 * branch it is (a world restored from the snapshot, or the snapshot's own world reset to it in place), or else to the
 * world whose name it carries (a branch an in-place reset preserved), the longest such name when several match. A
 * branch of no world the shared state holds names none. By stage, each once.
 */
export const hangingFrom = (
  parent: string,
  branches: ReadonlyArray<Branch>,
  worlds: ReadonlyArray<WorldBranch>,
): ReadonlyArray<string> => {
  const children = Arr.filter(branches, (branch) => branch.parent_id === parent);
  const owners = Arr.flatMap(children, (child) => {
    const own = Arr.findFirst(worlds, (world) => world.branch === child.id);
    if (Option.isSome(own)) return [own.value.stage];
    const named = Arr.filter(worlds, (world) => isBranchOf(world.stage)(child.name));
    return Option.match(
      Arr.last(
        Arr.sort(
          named,
          Order.mapInput(Order.Number, (world: WorldBranch) => world.stage.length),
        ),
      ),
      { onNone: () => [], onSome: (world) => [world.stage] },
    );
  });
  return Arr.sort(Arr.dedupe(owners), Order.String);
};

/**
 * Who hangs from what, read now: the stages of the worlds the shared state holds whose database hangs from a branch
 * (`hangingFrom`), for any branch of the project.
 */
export const hangers = Effect.gen(function* () {
  const branches = yield* branchesOf(yield* projectId);
  const stages = yield* recordedStages;
  const worlds = Arr.flatMap(stages, ({ stage, output }) =>
    isWorldStage(stage) ? [{ stage, branch: Schema.is(HasBranch)(output) ? output.branch : undefined }] : [],
  );
  return (parent: string) => hangingFrom(parent, branches, worlds);
}).pipe(Effect.withSpan("platform.hangers"), Effect.mapError(failed));

/**
 * Deletes every branch of the world, children before parents, then the platform's rows of its snapshots. A snapshot
 * is a child of the world's branch, and after an in-place reset the world's branch is a child of the snapshot's
 * (spikes/world-speed, 5.10), so the order is read from the branches themselves, not assumed. A branch of another
 * world that hangs from one of these (a world restored from this one's snapshot) stops it: that world goes first.
 */
export const dropBranches = Effect.fn("platform.dropBranches")(function* (stage: string) {
  const project = yield* projectId;
  const all = yield* branchesOf(project);
  const mine = Arr.filter(all, (branch) => isBranchOf(stage)(branch.name));
  const ids = Arr.map(mine, (branch) => branch.id);
  const foreign = Arr.filter(
    all,
    (branch) => !Arr.contains(ids, branch.id) && branch.parent_id !== undefined && Arr.contains(ids, branch.parent_id),
  );
  if (Arr.isReadonlyArrayNonEmpty(foreign))
    return yield* failed(
      `${Arr.join(
        Arr.map(foreign, (branch) => branch.name),
        ", ",
      )} hang from ${stage}'s branches: destroy those worlds first`,
    );
  const depth = (id: string, seen = 0): number => {
    const parent = Arr.findFirst(mine, (branch) => branch.id === id).pipe(
      Option.flatMap((branch) => Option.fromUndefinedOr(branch.parent_id)),
    );
    return Option.isSome(parent) && Arr.contains(ids, parent.value) && seen < 50
      ? 1 + depth(parent.value, seen + 1)
      : 0;
  };
  const deepestFirst = Arr.sort(
    mine,
    Order.mapInput(Order.Number, (branch: { readonly id: string }) => -depth(branch.id)),
  );
  yield* Effect.forEach(deepestFirst, (branch) => deleteBranch(project, branch.id), { discard: true });
  yield* prepareStore;
  yield* forgetSnapshots(stage);
  return mine.length;
});
