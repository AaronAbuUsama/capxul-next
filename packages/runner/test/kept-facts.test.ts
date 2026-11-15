// Facts a shared world kept with older code still decode once moved (src/shared/facts.ts, MOVES): the facts the shared
// world kept on 14 November 2026 (test/kept/) are put in a real Postgres as `keepFacts` keeps them, read back by
// `factsIn` as a run on the shared world reads a restored template, and every call they hold must then decode with
// its operation's schemas, as the scenarios' record.export check decodes them. A change to an answer's schema that
// facts kept before it cannot meet fails here, unless a new move brings them to it. It failed platform.yml's `shared`
// job on 15 November 2026 (run 43717960691, "pay Brightside and branch the books": the world.create call's answer is
// not of its schema).
//
// Runs with CAPXUL_ROWS_DATABASE, a throwaway Postgres whose `runner` schema it drops (in CI the job's own service
// container). In CI it never skips: without the database it fails.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as SQL from "@alchemy.run/sql/Postgres";
import { readFileSync } from "node:fs";
import { MadeCall, operations, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { factsIn, keepFacts, keptNames } from "../src/shared/facts.ts";

const url = process.env["CAPXUL_ROWS_DATABASE"];
const skip = url === undefined && process.env["CI"] === undefined;

/** The facts kept on 14 November 2026, as they were kept (test/kept/README.md). */
const KEPT_2026_11_14 = Schema.decodeUnknownEffect(
  Schema.Struct({ name: Schema.String, facts: Schema.Record(Schema.String, Schema.Unknown) }),
)(JSON.parse(readFileSync(new URL("./kept/2026-11-14.json", import.meta.url), "utf8")));

/**
 * The test's Postgres as a world the runner keeps facts in. An object parameter is sent as JSON text, as Neon's HTTP
 * endpoint sends it (packages/world, src/database/sql.ts).
 */
const held = {
  name: "kept",
  sql: (statement: string, params: ReadonlyArray<unknown> = []) =>
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.unsafe(
        statement,
        Arr.map(params, (param) => (param !== null && typeof param === "object" ? JSON.stringify(param) : param)),
      ),
    ),
};

type Codec = Schema.Codec<unknown, unknown>;

/** The calls whose payload or answer does not decode with its operation's schemas, by operation. */
const undecodable = (facts: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const calls = yield* Schema.decodeUnknownEffect(Schema.Array(MadeCall))(facts["calls"]);
    const byName: Readonly<Record<string, { readonly rpc: unknown }>> = operations;
    return Arr.flatMap(calls, (call) =>
      Option.match(Rec.get(byName, call.operation), {
        onNone: () => [`${call.operation}: undeclared`],
        onSome: (operation) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an operation's schemas need no services: they are the blueprint's plain Schemas, which Rpc's generic type leaves open (as packages/scenarios, src/support/record.ts).
          const rpc = operation.rpc as { readonly payloadSchema: Codec; readonly successSchema: Codec };
          const payload = Exit.isSuccess(Schema.decodeExit(rpc.payloadSchema)(call.payload));
          const answer =
            call.outcome !== "success" || Exit.isSuccess(Schema.decodeExit(rpc.successSchema)(call.answer));
          return payload && answer ? [] : [call.operation];
        },
      }),
    );
  });

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(Effect.provide(effect, SQL.PostgresLayer({ url: Redacted.make(url ?? "") })).pipe(Effect.scoped));

const fresh = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const kept = yield* KEPT_2026_11_14;
  yield* sql.unsafe("drop schema if exists runner cascade");
  yield* keepFacts(held, kept.name, kept.facts);
  return kept;
});

test("facts the shared world kept on 14 November did not decode as kept", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kept = yield* KEPT_2026_11_14;
      assert.deepEqual(yield* undecodable(kept.facts), [World.create.rpc._tag, World.show.rpc._tag]);
    }),
  ));

test("facts the shared world kept on 14 November decode once moved, read as a run reads them", { skip }, () =>
  run(
    Effect.gen(function* () {
      const kept = yield* fresh;
      const read = yield* factsIn(held, kept.name);
      assert.ok(Option.isSome(read));
      assert.deepEqual(yield* undecodable(read.value), []);
      // Moving twice changes nothing more, and the kept names are as they were.
      const again = yield* factsIn(held, kept.name);
      assert.deepEqual(again, read);
      assert.deepEqual(yield* keptNames(held), [kept.name]);
    }),
  ),
);
