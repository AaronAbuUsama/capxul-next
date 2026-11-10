import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { buildBook, defineOperation, eventsSent, spansNamed, transitionsDriven } from "../src/index.ts";
import * as f from "./fixtures/invitations.ts";

const target = (records: readonly unknown[]) => buildBook({ name: "t", stage: "target", records });
const op = (b: ReturnType<typeof target>, id: string) => b.records.get(`operation:${id}`)!;

test("an operation's events are named with the transition that sends them and the rpc that drives it", () => {
  const b = target(f.records);
  assert.deepEqual(eventsSent(b, op(b, "org.member.invite")), [
    { event: "event:invitation_sent", transition: "transition:invitation.send", by: "rpc:organizations.invitations.invite" },
  ]);
  // through a flow's step rpc, and then the procedure the rpc invokes
  assert.deepEqual(eventsSent(b, op(b, "invite.accept")).map((e) => [e.event, e.by]), [["event:invitation_accepted", "rpc:organizations.invitations.accept"]]);
  assert.deepEqual(transitionsDriven(b, op(b, "invite.accept")), ["transition:invitation.accept"]);
});

test("an operation's spans are its flow's and every rpc's under it, each with who names it", () => {
  const b = target(f.records);
  assert.deepEqual(spansNamed(b, op(b, "org.member.invite")).map((s) => s.span), ["authorize", "db.tx", "mail.send"]);
  const accept = spansNamed(b, op(b, "invite.accept"));
  assert.deepEqual(accept.filter((s) => s.by.startsWith("flow:")).map((s) => s.span), ["accept", "switch"]);
  assert.deepEqual(accept.filter((s) => s.by.startsWith("rpc:")).map((s) => s.span), ["authorize", "db.tx"]);
});

test("an operation that names no span is a no-span gap, and a target book only", () => {
  const quiet = { ...f.inviteRpc, spans: [] };
  const b = target([...f.records.filter((r) => r !== f.inviteRpc), quiet]);
  assert.ok(b.gaps.some((g) => g.rule === "no-span" && g.record === "operation:org.member.invite"));
  assert.ok(!b.gaps.some((g) => g.rule === "no-span" && g.record === "operation:invite.accept"));
  const asIs = buildBook({ name: "t", stage: "as-is", records: [...f.records.filter((r) => r !== f.inviteRpc), quiet] });
  assert.ok(!asIs.gaps.some((g) => g.rule === "no-span"));
});

test("an operation that drives a transition sending no event is a state-change-without-event gap", () => {
  const expireRpc = { ...f.inviteRpc, id: "organizations.invitations.expire-now", drives: [f.lifecycle.t.expire], calls: [], errors: [f.NOT_AUTHENTICATED] };
  const silent = defineOperation({ ...f.invite, id: "invite.expire", command: "invite expire", implementedBy: expireRpc, refusals: [] });
  const b = target([...f.records, expireRpc, silent]);
  const found = b.gaps.filter((g) => g.rule === "state-change-without-event").map((g) => g.record);
  assert.deepEqual(found, ["operation:invite.expire"]);
});
