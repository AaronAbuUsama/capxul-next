// The world's clock, record, document hashes and cast in Postgres, with Core's migrations applied: what record.export
// and world.clock.warp read and write in a world's database. Runs only with CAPXUL_TEST_DATABASE (a throwaway
// Postgres, such as `docker run -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17-alpine`); CI has none, so it skips.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as SQL from "@alchemy.run/sql/Postgres";
import { CurrentCall, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { migrations } from "../src/door.ts";
import { SqlCast } from "../src/site-ops/cast.ts";
import { millisOf, SqlWorldClock, WorldClock } from "../src/site-ops/clock.ts";
import { DocumentHashes, SqlDocumentHashes } from "../src/site-ops/hashes.ts";
import { SqlWorldRecord, WorldRecord } from "../src/site-ops/record.ts";
import { Cast } from "../src/site-ops/cast.ts";

const url = process.env["CAPXUL_TEST_DATABASE"];

const schema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe("drop schema if exists app cascade");
  // As the runner applies them: comment lines dropped, one statement at a time.
  for (const file of Arr.sort(
    Arr.filter(readdirSync(fileURLToPath(migrations.href)), Str.endsWith(".sql")),
    Order.String,
  )) {
    const text = readFileSync(`${fileURLToPath(migrations.href)}${file}`, "utf8");
    const lines = Arr.filter(Str.split(text, "\n"), (line) => !Str.startsWith("--")(Str.trimStart(line)));
    const statements = Arr.filter(Arr.map(Str.split(Arr.join(lines, "\n"), ";"), Str.trim), Str.isNonEmpty);
    for (const statement of statements) yield* sql.unsafe(statement);
  }
  yield* sql.unsafe("create table app.cast (person text primary key, email text not null)");
  yield* sql.unsafe("insert into app.cast values ('sam', 'sam@cast.test')");
});

test("the clock, the record, the hashes and the cast in a world's database", { skip: url === undefined }, async () => {
  const database = SQL.PostgresLayer({ url: Redacted.make(url ?? "") });
  const services = Layer.mergeAll(SqlCast, SqlDocumentHashes, SqlWorldRecord.pipe(Layer.provideMerge(SqlWorldClock)));
  const program = Effect.gen(function* () {
    yield* schema;
    const clock = yield* WorldClock;
    const record = yield* WorldRecord;
    const start = millisOf("2026-11-13T09:00:00.000Z");
    const sql = yield* SqlClient.SqlClient;
    yield* sql`insert into app.clock (mode, frozen_at_ms, offset_ms) values ('frozen', ${start}, 0)`;
    // A failed write burns an identity: positions still run 1, 2, 3.
    yield* sql`insert into app.events (trace_id, operation, event, payload, at_ms) values ('t0', 'world.create', 'world_created', '{"world":"town","owner":"ci","grade":"private","expiresAt":"2026-11-13T11:00:00.000Z","parent":null}', ${start})`;
    yield* sql`insert into app.events (trace_id, operation, event, payload, at_ms) values ('tx', 'x', 'x', null, 0)`.pipe(
      Effect.ignore,
    );
    assert.deepEqual(yield* clock.now, { mode: "frozen", nowMs: start });
    const week = 7 * 24 * 3600 * 1000;
    const success = {
      from: "2026-11-13T09:00:00.000Z",
      clock: { mode: "frozen" as const, now: "2026-11-20T09:00:00.000Z" },
      sites: 1,
    };
    yield* clock.moveTo(start + week);
    yield* record
      .emit(World.clockWarp, { payload: { target: { _tag: "by", seconds: week / 1000 } }, success })
      .pipe(Effect.provideService(CurrentCall, { traceId: Str.repeat(32)("a"), operation: "world.clock.warp" }));
    yield* record
      .emit(World.clockWarp, { payload: { target: { _tag: "by", seconds: 1 } }, success })
      .pipe(Effect.provideService(CurrentCall, { traceId: Str.repeat(32)("b"), operation: "world.clock.warp" }));
    const whole = yield* record.entries(1, null);
    assert.deepEqual(
      Arr.map(whole.entries, (entry) => [entry.seq, entry.event, entry.trace]),
      [
        [1, "world_created", "t0"],
        [2, "clock_warped", Str.repeat(32)("a")],
        [3, "clock_warped", Str.repeat(32)("b")],
      ],
    );
    assert.deepEqual(whole.entries[1]?.carried, { from: success.from, to: success.clock.now });
    assert.equal(whole.entries[1]?.atMs, start + week);
    assert.deepEqual((yield* record.entries(2, 2)).entries.length, 1);
    assert.deepEqual(yield* record.entries(4, null), { head: 3, entries: [] });
    assert.deepEqual(Option.getOrNull(yield* record.made), {
      world: "town",
      owner: "ci",
      grade: "private",
      expiresAt: "2026-11-13T11:00:00.000Z",
      parent: null,
    });
    const hashes = yield* DocumentHashes;
    const doc = { org: "org_northwind1", doctype: "Payment Entry", name: "ACC-PAY-1" };
    yield* hashes.keep(doc, `0x${Str.repeat(32)("cd")}`, "t1");
    assert.deepEqual(yield* hashes.of(doc), Option.some(`0x${Str.repeat(32)("cd")}`));
    const cast = yield* Cast;
    assert.deepEqual(yield* cast.emailOf("sam"), Option.some("sam@cast.test"));
    assert.deepEqual(yield* cast.emailOf("nobody"), Option.none());
  });
  await Effect.runPromise(program.pipe(Effect.provide(services.pipe(Layer.provideMerge(database))), Effect.scoped));
});
