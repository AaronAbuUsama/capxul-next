import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { CommandRecordEntry } from "../../../../books/target/devnet/record-entry.ts";
import { records } from "../../../../books/target/index.ts";
import { buildBook } from "../../../../packages/book/src/build.ts";

const entry = {
  v: 1, id: "rec_example", seq: 1, prev: "0".repeat(64), trace: "trace_example",
  command: "doc submit", args: { positional: ["acme", "Sales Invoice", "INV-1"], flags: { confirm: true } },
  actor: { email: "operator@example.test", address: null, hats: ["admin"] },
  world: "main", org: "acme", site: "acme.localhost",
  world_time: "2025-01-01T00:00:00.000Z", world_time_end: "2025-01-01T00:00:01.000Z",
  real_time: "2026-11-10T00:00:00.000Z", duration_ms: 1000,
  outcome: "ok", error: null, result: { name: "INV-1" },
  changes: { tx: [{ hash: "0xexample", fn: "submit" }], docs: [{ site: "acme.localhost", doctype: "Sales Invoice", name: "INV-1", action: "submit" }] },
};
test("command record wire schema covers success, refusal, failure and restore extensions", () => {
  const decode = Schema.decodeUnknownSync(CommandRecordEntry);
  decode(entry);
  for (const outcome of ["refused", "failed"]) decode({ ...entry, outcome, error: { code: "REFUSED", reason: "Not permitted", detail: null }, result: null });
  decode({ ...entry, actor: null, lineage: { fromWorld: "parent", snapshot: "m1" } });
  const { actor, ...missing } = entry;
  assert.throws(() => decode(missing));
  assert.throws(() => decode({ ...entry, outcome: "ignored" }));
  assert.throws(() => decode({ ...entry, changes: { tx: [] } }));
});
test("every target operation declares spans and every state change declares events", () => {
  const b = buildBook({ name: "target", stage: "target", records });
  assert.deepEqual(b.gaps.filter(g => ["no-span", "state-change-without-event"].includes(g.rule)), []);
  console.log(`telemetry: ${[...b.records.values()].filter(r => r._kind === "operation").length} operations, 0 no-span, 0 state-change-without-event`);
});
