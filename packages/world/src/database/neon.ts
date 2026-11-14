// A world's branch through Neon's API, where Alchemy's own Neon provider is slow: it looks at a branch's operations
// every 5 s, so a branch whose compute is ready in 1 to 2 s takes 6 to 9 s in a deploy (spikes/world-speed; this
// package's `records/hub` spans). The world's create makes its branch here first, looking every 250 ms, and its
// stack then adopts it by name (src/database/Db.ts), so Alchemy still owns it and destroys it with the world. The same
// helpers restore a branch in place from a snapshot's (src/lifecycle/reset.ts) and delete branches leaf first.
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { PlatformFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { recordedOutput } from "../stack/engine.ts";
import { PLATFORM } from "../stack/names.ts";

const NEON = "https://console.neon.tech/api/v2";
/** Neon locks a project while an operation on it runs (423): such a request is sent again. */
const LOCKED = 423;

const failed = (cause: unknown) => PlatformFailed.make({ step: "branch", message: describeFailure(cause) });

/** Neon's refusal of one request, with its status. */
interface Refused {
  readonly status: number;
  readonly body: string;
}

/** One request to Neon's API and its JSON answer; a 404 is `null` when `missing` says so. */
export const neon = (request: HttpClientRequest.HttpClientRequest, missing: "fail" | "ok" = "fail") =>
  Effect.gen(function* () {
    const key = yield* Config.Redacted("NEON_API_KEY");
    const response = yield* HttpClient.execute(request.pipe(HttpClientRequest.bearerToken(Redacted.value(key))));
    if (response.status === 404 && missing === "ok") return null;
    if (response.status >= 300) {
      const body = yield* response.text;
      return yield* Effect.fail<Refused>({ status: response.status, body: Str.slice(0, 300)(body) });
    }
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.retry({
      while: (error) => Predicate.hasProperty(error, "status") && error.status === LOCKED,
      schedule: Schedule.spaced("1 second"),
      times: 60,
    }),
  );

const Operations = Schema.Struct({
  operations: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
});
const Operation = Schema.Struct({ operation: Schema.Struct({ status: Schema.String }) });

/** Waits until each of Neon's operations has finished, looking every 250 ms, at most a minute. */
export const finished = (project: string, answer: unknown) =>
  Effect.gen(function* () {
    const { operations } = yield* Schema.decodeUnknownEffect(Operations)(answer ?? { operations: [] });
    yield* Effect.forEach(
      operations,
      (operation) =>
        neon(HttpClientRequest.get(`${NEON}/projects/${project}/operations/${operation.id}`)).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Operation)),
          Effect.flatMap(({ operation: now }) =>
            now.status === "finished" || now.status === "skipped"
              ? Effect.void
              : now.status === "failed" || now.status === "error"
                ? Effect.die(`Neon's operation ${operation.id} ${now.status}`)
                : Effect.fail("running"),
          ),
          Effect.retry({ while: (error) => error === "running", schedule: Schedule.spaced("250 millis"), times: 240 }),
        ),
      { concurrency: 10, discard: true },
    );
  });

const Created = Schema.Struct({
  branch: Schema.Struct({ id: Schema.String, expires_at: Schema.String.pipe(Schema.NullOr, Schema.optional) }),
  connection_uris: Schema.Array(Schema.Struct({ connection_uri: Schema.String })),
});

/** A world's branch as it was made: its id, the expiry as Neon wrote it, and its connection string (a secret). */
export interface MadeBranch {
  readonly id: string;
  readonly expiresAt: string | null;
  readonly connectionUri: Redacted.Redacted;
}

/**
 * Makes a branch with its own compute, named `name`, from `parent` (the project's default branch when none), that
 * Neon deletes by itself at `expiresAt`; waits until its compute answers.
 */
export const makeBranch = Effect.fn("world.neon.makeBranch")(function* (
  project: string,
  name: string,
  parent: string | undefined,
  expiresAt: string | undefined,
) {
  const answer = yield* neon(
    HttpClientRequest.post(`${NEON}/projects/${project}/branches`).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        branch: {
          name,
          ...(parent === undefined ? {} : { parent_id: parent }),
          ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
        },
        endpoints: [{ type: "read_write" }],
      }),
    ),
  );
  const created = yield* Schema.decodeUnknownEffect(Created)(answer);
  yield* finished(project, answer);
  const uri = yield* Effect.fromOption(Arr.head(created.connection_uris));
  return {
    id: created.branch.id,
    expiresAt: created.branch.expires_at ?? null,
    connectionUri: Redacted.make(uri.connection_uri),
  } satisfies MadeBranch;
}, Effect.mapError(failed));

/** The Neon project every world's branch belongs to, as the platform stage recorded it. */
export const projectId = Effect.flatMap(
  recordedOutput(PLATFORM),
  Schema.decodeUnknownEffect(Schema.Struct({ projectId: Schema.String })),
).pipe(Effect.mapBoth({ onSuccess: (platform) => platform.projectId, onFailure: failed }));

/** Neon's default database and role on every branch of the project, which a world uses. */
const DATABASE = { database_name: "neondb", role_name: "neondb_owner" };

/** The connection string of a world's branch, from Neon: never kept anywhere but in memory. */
export const connectionOf = Effect.fn("world.neon.connection")(function* (project: string, branch: string) {
  const answer = yield* neon(
    HttpClientRequest.get(`${NEON}/projects/${project}/connection_uri`).pipe(
      HttpClientRequest.setUrlParams({ branch_id: branch, ...DATABASE }),
    ),
  );
  const { uri } = yield* Schema.decodeUnknownEffect(Schema.Struct({ uri: Schema.String }))(answer);
  return Redacted.make(uri);
}, Effect.mapError(failed));

const Branches = Schema.Struct({
  branches: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, parent_id: Schema.optional(Schema.String) }),
  ),
});

/** Every branch of the project: its id, its name and its parent. */
export const branchesOf = (project: string) =>
  neon(HttpClientRequest.get(`${NEON}/projects/${project}/branches`)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Branches)),
    Effect.mapBoth({ onSuccess: (answer) => answer.branches, onFailure: failed }),
  );

/** Deletes a branch and waits for Neon to finish; one that is already gone is no failure. */
export const deleteBranch = Effect.fn("world.neon.deleteBranch")(function* (project: string, branch: string) {
  const answer = yield* neon(HttpClientRequest.delete(`${NEON}/projects/${project}/branches/${branch}`), "ok").pipe(
    // Neon answers 422 "branch is already deleted" for a branch it is still deleting (spikes/world-speed, 5.10).
    Effect.catchIf(
      (error): error is Refused =>
        Predicate.hasProperty(error, "status") && error.status === 422 && Str.includes("already deleted")(error.body),
      () => Effect.succeed(null),
    ),
  );
  if (answer !== null) yield* finished(project, answer);
}, Effect.mapError(failed));

/**
 * Rewinds `branch` in place to what `source` holds (Neon's restore): the branch keeps its id, its compute and its
 * connection string. Its state until now is kept as a branch called `preserveAs`, which Neon requires when the
 * branch has children; the caller deletes it when nothing hangs from it.
 */
export const restoreBranch = Effect.fn("world.neon.restoreBranch")(function* (
  project: string,
  branch: string,
  source: string,
  preserveAs: string,
) {
  const answer = yield* neon(
    HttpClientRequest.post(`${NEON}/projects/${project}/branches/${branch}/restore`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ source_branch_id: source, preserve_under_name: preserveAs }),
    ),
  );
  yield* finished(project, answer);
}, Effect.mapError(failed));
