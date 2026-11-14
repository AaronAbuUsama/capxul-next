// A world's admission to its fleet hub (src/lifecycle/claim.ts): the registry's insert is tried again while the hub is
// full, under the `admit` step's declared timeout; a refusal of the name or the quota comes at once, full hub or not;
// and a registry made before rows named their hub is given the column and tried again. The registry here is a
// stand-in of Neon's SQL endpoint that answers each statement as the test scripts it; the SQL itself is proven
// against a real Postgres, two processes at once (records/admission).
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { admit, claim } from "../src/lifecycle/claim.ts";
import { Timeouts } from "../src/lifecycle/spec.ts";
import { makeStopwatch } from "../src/lifecycle/steps.ts";

const DATABASE = Redacted.make("postgres://registry:secret@registry.test/neondb");
const HUB = { stage: "fleet", capacity: 2 };

interface Registry {
  /** The answers to each try of the insert, in order: true takes the name, false does not, "no column" refuses. */
  readonly tries: Array<boolean | "no column">;
  readonly taken: boolean;
  readonly live: number;
  readonly held: number;
  readonly seen: Array<string>;
  readonly prepared: Array<string>;
}

const Statement = Schema.Struct({ query: Schema.String, params: Schema.Array(Schema.Unknown) });
const SqlBody = Schema.Union([Statement, Schema.Struct({ queries: Schema.Array(Statement) })]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const answer = async (registry: Registry, request: Request): Promise<Response> => {
  const body: unknown = await request.json();
  if (!Schema.is(SqlBody)(body)) return json({ message: "not a statement" }, 400);
  if ("queries" in body) {
    registry.seen.push("transaction");
    if (Str.startsWith("select pg_advisory_xact_lock(hashtext('capxul-registry'))")(body.queries[0]?.query ?? "")) {
      registry.prepared.push(
        ...Arr.map(body.queries, (one, at) => (at === 0 ? one.query : Str.slice(0, 40)(one.query))),
      );
      return json({ results: Arr.map(body.queries, () => ({ rows: [] })) });
    }
    const outcome = registry.tries.shift() ?? false;
    if (outcome === "no column") return json({ message: 'column "hub" of relation "worlds" does not exist' }, 400);
    const last = body.queries.length - 1;
    return json({
      results: Arr.map(body.queries, (_, at) => ({ rows: at === last && outcome ? [{ name: "w-one" }] : [] })),
    });
  }
  const sql = body.query;
  registry.seen.push(Str.slice(0, 40)(sql));
  if (Str.includes("where name = $1")(sql))
    return json({
      rows: registry.taken
        ? [{ name: "w-one", owner: "other", expires_at: "2026-11-14T20:00:00.000Z", holder: "h" }]
        : [],
    });
  if (Str.includes("as live")(sql)) return json({ rows: [{ live: registry.live }] });
  if (Str.includes("as held")(sql)) return json({ rows: [{ held: registry.held }] });
  return json({ rows: [] });
};

const standIn = (registry: Registry) =>
  HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.flatMap((web) => Effect.promise(() => answer(registry, web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  );

const registryOf = (tries: Registry["tries"], more: Partial<Registry> = {}): Registry => ({
  tries,
  taken: false,
  live: 0,
  held: HUB.capacity,
  seen: [],
  prepared: [],
  ...more,
});

const transactions = (registry: Registry) => Arr.filter(registry.seen, (each) => each === "transaction").length;

/** Admits world `w-one` for owner `op` (quota 5) on HUB, asking every 20 ms; counts how often the name was held. */
const admitted = (registry: Registry) =>
  Effect.gen(function* () {
    const held = yield* Ref.make(0);
    const holder = yield* admit(DATABASE, "w-one", "op", "2026-11-14T20:00:00.000Z", 5, HUB, Duration.millis(20), () =>
      Ref.update(held, (n) => n + 1),
    );
    return { holder, held: yield* Ref.get(held) };
  }).pipe(Effect.provideService(HttpClient.HttpClient, standIn(registry)));

const failureOf = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? String(exit.cause) : "succeeded");

describe("admission to a hub", () => {
  test("a create on a full hub waits, asking again, and holds its place once one is free", async () => {
    const registry = registryOf([false, false, true]);
    const result = await Effect.runPromise(admitted(registry));
    assert.match(result.holder, /^\d+-\d+$/);
    assert.equal(result.held, 1);
    assert.equal(transactions(registry), 3);
  });

  test("an owner at the quota is refused at once, even on a full hub", async () => {
    const registry = registryOf([false, false, true], { live: 5 });
    assert.match(failureOf(await Effect.runPromiseExit(admitted(registry))), /WorldQuotaReached/);
    assert.equal(transactions(registry), 1);
  });

  test("a taken name is refused at once with who holds it", async () => {
    const registry = registryOf([false, true], { taken: true });
    assert.match(failureOf(await Effect.runPromiseExit(admitted(registry))), /WorldExists/);
    assert.equal(transactions(registry), 1);
  });

  test("a wait longer than the admit step's declared timeout fails with StepTimedOut, its duration recorded", async () => {
    const registry = registryOf(Arr.makeBy(1000, () => false));
    const { ended, ms } = await Effect.runPromise(
      Effect.gen(function* () {
        const timeouts = yield* Timeouts;
        const watch = yield* makeStopwatch({ ...timeouts, admit: Duration.millis(150) });
        const exit = yield* Effect.exit(watch.step("admit", admitted(registry)));
        return { ended: exit, ms: (yield* watch.durations).admit ?? 0 };
      }),
    );
    assert.match(failureOf(ended), /StepTimedOut/);
    assert.ok(ms >= 150 && ms < 1000, `admit took ${ms} ms`);
  });

  test("a registry made before rows named their hub is given the column, and the claim is tried again", async () => {
    const registry = registryOf(["no column", true]);
    await Effect.runPromise(
      claim(DATABASE, "w-one", "op", "2026-11-14T20:00:00.000Z", 5, HUB).pipe(
        Effect.provideService(HttpClient.HttpClient, standIn(registry)),
      ),
    );
    assert.deepEqual(registry.seen, ["transaction", "transaction", "transaction"]);
    assert.deepEqual(registry.prepared, [
      "select pg_advisory_xact_lock(hashtext('capxul-registry'))",
      "create table if not exists worlds (name ",
      "alter table worlds add column if not exi",
      "create index if not exists worlds_hub on",
    ]);
  });
});
