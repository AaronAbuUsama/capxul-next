// A snapshot's database: a branch of the world's own branch, made through Neon's API with no compute of its own, so it
// costs only the storage it does not share with its parent. A world restored from the snapshot forks it in turn
// (src/database/Db.ts). Neon refuses to fork a branch that has an expiry, so the world's own branch has its expiry
// taken off first; the sweeper deletes the world at its recorded expiry. A branch with children cannot be deleted,
// so a world restored from a snapshot must go before the snapshot does, which its expiry makes so (ExpiryBeyondSource).
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { branchesOf, deleteBranch, finished, projectId } from "../database/neon.ts";
import { PlatformFailed } from "../failures.ts";
import { liftBranchExpiry } from "../lifecycle/account.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { WorldOutput } from "../lifecycle/parts.ts";
import { recordedOutput, recordOutput } from "../stack/engine.ts";
import { forgetSnapshots, prepareStore } from "./store.ts";

const NEON = "https://console.neon.tech/api/v2";
const Created = Schema.Struct({ branch: Schema.Struct({ id: Schema.String }) });

const failed = (cause: unknown) => PlatformFailed.make({ step: "branch", message: describeFailure(cause) });

/** Neon locks a project while an operation on it runs (423): such a request is sent again. */
const LOCKED = 423;

/** One request to Neon's API; its JSON answer, or Neon's refusal with its status. `missing` is an answer too. */
const neon = (request: HttpClientRequest.HttpClientRequest, missing: "fail" | "ok" = "fail") =>
  Effect.gen(function* () {
    const key = yield* Config.Redacted("NEON_API_KEY");
    const response = yield* HttpClient.execute(request.pipe(HttpClientRequest.bearerToken(Redacted.value(key))));
    if (response.status === 404 && missing === "ok") return null;
    if (response.status >= 300) {
      const body = yield* response.text;
      return yield* Effect.fail({ status: response.status, body: Str.slice(0, 200)(body) });
    }
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.retry({
      while: (error) => Predicate.hasProperty(error, "status") && error.status === LOCKED,
      schedule: Schedule.spaced("2 seconds"),
      times: 60,
    }),
    Effect.mapError(failed),
  );

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

/** A branch of `parent` called `name`, with no compute; its id. Waits until Neon has finished making it. */
export const branchOf = Effect.fn("platform.branch")(function* (parent: string, name: string) {
  const project = yield* projectId;
  const answer = yield* neon(
    HttpClientRequest.post(`${NEON}/projects/${project}/branches`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ branch: { parent_id: parent, name } }),
    ),
  );
  const created = yield* Schema.decodeUnknownEffect(Created)(answer).pipe(Effect.mapError(failed));
  // Neon's operations for it, looked at every 250 ms (src/database/neon.ts).
  yield* finished(project, answer).pipe(Effect.mapError(failed));
  return created.branch.id;
}, Effect.mapError(failed));

/** Deletes a branch. One that is already gone is no failure. */
export const dropBranch = Effect.fn("platform.dropBranch")(function* (branch: string) {
  const project = yield* projectId;
  yield* neon(HttpClientRequest.delete(`${NEON}/projects/${project}/branches/${branch}`), "ok");
});

/** Whether a branch of the project is one of the world's: its own, a snapshot's, or one an in-place reset preserved. */
export const isBranchOf = (stage: string) => (name: string) =>
  name === stage || Str.startsWith(`snap-${stage}-`)(name) || Str.startsWith(preservedPrefix(stage))(name);

/** What an in-place reset keeps of the world's branch as it was (src/lifecycle/reset.ts): `<stage>-pre-<n>`. */
export const preservedPrefix = (stage: string) => `${stage}-pre-`;

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
