import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { buildBlueprint, defineTable, rippleOf } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const build = (records: readonly unknown[]) => buildBlueprint({ name: "t", stage: "as-is", records });
const before = build(f.records);

test("the same blueprint has no ripple", () => {
  const r = rippleOf(before, build(f.records));
  assert.deepEqual([r.added, r.removed, r.changed, r.reached, r.evals.reworded], [[], [], [], [], []]);
});

test("a changed table names the fields that changed and reaches every record that depends on it", () => {
  const wider = defineTable({ ...f.invitations, fields: Schema.Struct({ ...(f.invitations.fields as Schema.Struct<Schema.Struct.Fields>).fields, note: Schema.String }) });
  const after = build(f.records.map((r) => (r === f.invitations ? wider : r)));
  const r = rippleOf(before, after);
  assert.deepEqual(r.changed, [{ key: "table:invitations", fields: ["fields"] }]);
  assert.ok(r.reached.some((d) => d.key === "rpc:organizations.invitations.invite" && d.distance === 1));
  assert.ok(r.reached.some((d) => d.kind === "operation"));
  assert.ok(!r.reached.some((d) => d.key === "table:invitations"));
});

test("a removed record reaches what depended on it before; an added one is listed", () => {
  const r = rippleOf(before, build(f.records.filter((x) => x !== f.invitationSent)));
  assert.ok(r.removed.includes("event:invitation_sent"));
  assert.ok(r.reached.length > 0);
  const back = rippleOf(build(f.records.filter((x) => x !== f.invitationSent)), before);
  assert.ok(back.added.includes("event:invitation_sent"));
});

test("an acceptance line whose observes changes re-words its eval, as a changed claim does", () => {
  const observed = (observes: string) => ({ ...f.invite, acceptance: [{ claim: "An Owner's invitation is pending and the invitee gets one email.", observes }, null, "A Seat that is not an Owner is refused."] });
  const was = build(f.records.map((r) => (r === f.invite ? observed("cli: prints the invitation") : r)));
  const now = build(f.records.map((r) => (r === f.invite ? observed("cli: prints nothing; read: the mail sink holds one email") : r)));
  assert.deepEqual(rippleOf(was, now).evals.reworded, ["acc:org.member.invite/c-90dd4c9d35059050"]);
});
