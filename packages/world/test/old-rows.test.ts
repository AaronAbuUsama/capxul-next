// Rows written by earlier code still read as the platform reads them (world.show, world.list): each format in
// test/rows/ is put into a real Postgres with the migrations its world had then, Core's later migrations are applied
// in name order as `migrate` applies them (src/database/sql.ts), and the platform's own queries and decoding
// (src/platform/facts.ts) must then read the world. A change to what the platform reads that rows written before it
// cannot meet fails here, unless a new migration moves those rows (AGENTS.md, "Changing what works"). It fails the
// shared world's renewal otherwise, as it did on 15 November 2026 (platform.yml run 43700976392).
//
// Runs with CAPXUL_ROWS_DATABASE, a throwaway Postgres whose `app` and `world` schemas it drops (in CI the job's own
// service container). In CI it never skips: without the database it fails.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as SQL from "@alchemy.run/sql/Postgres";
import { migrations } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as SqlClient from "effect/sql/SqlClient";
import { CONTRACTS } from "../src/chain/contracts.ts";
import { statementsOf } from "../src/database/sql.ts";
import { CAST, COMPANIES, factsOf, jsonSql, ONE } from "../src/platform/facts.ts";
import type { OldRows } from "./rows/old-rows.ts";
import { shared20261114 } from "./rows/shared-2026-11-14.ts";

const url = process.env["CAPXUL_ROWS_DATABASE"];
const skip = url === undefined && process.env["CI"] === undefined;
const directory = fileURLToPath(migrations.href);
const files = Arr.sort(Arr.filter(readdirSync(directory), Str.endsWith(".sql")), Order.String);

/** Every format of rows earlier code wrote, oldest first. A new format is added here, never one changed. */
const FORMATS: ReadonlyArray<OldRows> = [shared20261114];

const apply = (names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const name of names) {
      for (const statement of statementsOf(readFileSync(`${directory}${name}`, "utf8"))) yield* sql.unsafe(statement);
      yield* sql.unsafe("insert into world.migrations (name) values ($1)", [name]);
    }
  });

/** A database holding `rows` as their world had them, with the migrations it had then. */
const written = (rows: OldRows) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe("drop schema if exists app cascade");
    yield* sql.unsafe("drop schema if exists world cascade");
    yield* sql.unsafe("create schema world");
    yield* sql.unsafe(
      "create table world.migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    yield* apply(rows.applied);
    const params: Array<unknown> = [rows.world.chain_id];
    const contracts = jsonSql(rows.world.contracts, params);
    yield* sql.unsafe(`insert into app.world (one, chain_id, contracts) values (true, $1, ${contracts})`, params);
    yield* sql.unsafe("insert into app.clock (id, mode, frozen_at_ms, offset_ms) values (1, $1, $2, $3)", [
      rows.clock.mode,
      rows.clock.frozen_at_ms,
      rows.clock.offset_ms,
    ]);
    for (const [position, member] of rows.cast.entries())
      yield* sql.unsafe("insert into app.cast (person, position, email, signer, safe) values ($1, $2, $3, $4, $5)", [
        member.person,
        position,
        member.email,
        member.signer,
        member.safe,
      ]);
    for (const company of rows.companies)
      yield* sql.unsafe(
        "insert into app.companies (org, handle, name, site_state, site_url) values ($1, $2, $3, $4, $5)",
        [company.org, company.handle, company.name, company.site_state, company.site_url],
      );
    const born: Array<unknown> = [];
    const payload = jsonSql({ grade: rows.born.grade, parent: null }, born);
    yield* sql.unsafe(
      `insert into app.events (trace_id, operation, event, payload, at_ms) values ('old', 'world.create', 'world_created', ${payload}, 0)`,
      born,
    );
  });

/** The world as the platform reads it from the database now. */
const read = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* factsOf(yield* sql.unsafe(ONE), yield* sql.unsafe(CAST), yield* sql.unsafe(COMPANIES), 0);
});

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(Effect.provide(effect, SQL.PostgresLayer({ url: Redacted.make(url ?? "") })).pipe(Effect.scoped));

for (const rows of FORMATS)
  test(
    `rows written by ${rows.written} read as the platform reads a world, once the later migrations apply`,
    { skip },
    () =>
      run(
        Effect.gen(function* () {
          yield* written(rows);
          yield* apply(Arr.filter(files, (name) => !rows.applied.includes(name)));
          const facts = yield* read;
          assert.deepEqual(facts.contracts, CONTRACTS);
          assert.equal(facts.cast.length, rows.cast.length);
          assert.equal(facts.companies.length, rows.companies.length);
          assert.equal(facts.born?.grade, rows.born.grade);
          assert.equal(facts.migrations, files.at(-1));
        }),
      ),
  );

test("the shared world's rows of 14 November did not read before 0008_world_budgets.sql", { skip }, () =>
  run(
    Effect.gen(function* () {
      yield* written(shared20261114);
      yield* apply(Arr.filter(files, (name) => !shared20261114.applied.includes(name) && name < "0008"));
      const exit = yield* Effect.exit(read);
      assert.ok(Exit.isFailure(exit) && Str.includes("budgets")(String(exit.cause)), String(exit));
    }),
  ),
);

test("0008_world_budgets.sql writes the Budgets address every world's chain has", () => {
  assert.ok(Str.includes(CONTRACTS.budgets)(readFileSync(`${directory}0008_world_budgets.sql`, "utf8")));
});
