// The runner's plumbing on made-up input: migrations split into statements, the SQL host of a connection string, an
// answer from Cloudflare's edge told from Core's, an inventory, record names and failures in words.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors } from "@capxul/blueprint";
import * as Cause from "effect/Cause";
import { describe } from "../src/failure.ts";
import { slugOf } from "../src/record.ts";
import { hostOf, statementsOf } from "../src/world/database.ts";
import { isEmpty } from "../src/world/leftovers.ts";

test("a migration file is its statements, comments dropped", () => {
  const file = "-- a comment\ncreate schema if not exists app;\n\ncreate table t (id int);\n-- the end\n";
  assert.deepEqual(statementsOf(file), ["create schema if not exists app", "create table t (id int)"]);
});

test("the SQL endpoint's host is the connection string's host, without user, port or database", () => {
  assert.equal(
    hostOf("postgresql://u:p@ep-x.eu-west-2.aws.neon.tech:5432/db?sslmode=require"),
    "ep-x.eu-west-2.aws.neon.tech",
  );
});

test("an inventory is empty only when no kind of resource is left", () => {
  assert.ok(isEmpty({ workers: [], hyperdrives: [], neonProjects: [] }));
  assert.ok(!isEmpty({ workers: [], hyperdrives: ["capxulcore-core-hyperdrive-core-abc123"], neonProjects: [] }));
});

test("a record's file name is its run's name in lower case, dashes for the rest", () => {
  assert.equal(slugOf("example: record.export answers a fresh world"), "example-record-export-answers-a-fresh-world");
});

test("a refusal is described with every field it carries", () => {
  const cause = Cause.fail(Errors.NotImplemented.make({ operation: "record.export" }));
  assert.equal(describe(cause), '{"_tag":"NotImplemented","operation":"record.export"}');
});
