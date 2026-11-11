import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { buildBlueprint, defineEvent, defineLog, defineMetric } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const build = (records: readonly unknown[], stage: "as-is" | "target" = "as-is") => buildBlueprint({ name: "t", stage, records: [...f.records, ...records] });
const rules = (xs: readonly { record: string; rule: string; detail: string }[], prefix: string) =>
  xs.filter((x) => x.rule.startsWith(prefix)).map((x) => `${x.record} ${x.rule}: ${x.detail}`);
const rpc = f.records.find((r) => (r as { _kind: string })._kind === "rpc") as never;
const component = f.records.find((r) => (r as { _kind: string })._kind === "component") as never;

test("a product or failure event names what sends it; a transition event does not; pii names its own properties", () => {
  const product = defineEvent({ id: "invite_viewed", about: "Seen.", props: Schema.Struct({ email: Schema.String }), purpose: "product", pii: ["email", "name"] });
  const transition = defineEvent({ id: "odd_sent", about: "Sent.", props: Schema.Struct({}), producer: rpc });
  assert.deepEqual(rules(build([product, transition]).problems, "event-").concat(rules(build([product]).problems, "event-pii")), [
    "event:invite_viewed event-producer: a product event names what sends it",
    "event:invite_viewed event-pii: pii names name, which it does not carry",
    "event:odd_sent event-producer: a transition event is sent by its machine; it names no producer",
    "event:invite_viewed event-pii: pii names name, which it does not carry",
  ]);
});

test("a product event nothing reads and a failure nothing watches are gaps; each derives its analytics evals", () => {
  const product = defineEvent({ id: "invite_viewed", about: "Seen.", props: Schema.Struct({ email: Schema.String }), purpose: "product", producer: rpc, pii: ["email"] });
  const failure = defineEvent({ id: "invite_bounced", about: "Bounced.", props: Schema.Struct({}), purpose: "failure", producer: rpc });
  const b = build([product, failure]);
  assert.deepEqual([...rules(b.gaps, "unread"), ...rules(b.gaps, "unwatched")], [
    "event:invite_viewed unread-event: no journey, insight or alert reads it",
    "event:invite_bounced unwatched-failure: no alert watches it",
  ]);
  const ids = b.evals.map((e) => e.id).filter((id) => id.startsWith("ana:"));
  assert.deepEqual(ids, ["ana:invite_viewed/schema", "ana:invite_viewed/pii", "ana:invite_bounced/schema"]);
});

test("a log row and a metric derive their evals; redact names its own attributes; a target design logs every rpc and workflow", () => {
  const row = defineLog({ id: "operation_row", title: "Operation row", about: "One wide row per rpc call.", component, level: "info", per: "rpc", attributes: Schema.Struct({ outcome: Schema.String }), redact: ["email"] });
  const once = defineLog({ id: "boot", title: "Boot", about: "Written at start.", component, level: "info", per: "once", attributes: Schema.Struct({}) });
  const metric = defineMetric({ id: "invites_sent", title: "Invites sent", about: "A count.", component, instrument: "counter", unit: "{invite}", attributes: Schema.Struct({}), producer: rpc });
  const b = build([row, once, metric], "target");
  assert.deepEqual(rules(b.problems, "log-"), [
    "log:operation_row log-redact: redact names email, which it does not carry",
    "log:boot log-producer: a row written once names what writes it",
  ]);
  assert.deepEqual(b.evals.map((e) => e.id).filter((id) => /^(log|met):/.test(id)), ["log:operation_row/written", "log:operation_row/redacted", "log:boot/written", "met:invites_sent/emitted"]);
  assert.deepEqual(rules(b.gaps, "unlogged"), ["system:capxul unlogged-operation: no log row is written per workflow"]);
  assert.deepEqual(rules(build([]).gaps, "unlogged"), []);
});
