// The whole-run isolation check (src/checks/isolation-run.ts) on made-up histories: a run whose every entry is its own
// journey's passes; an entry of one journey's call naming another journey's company fails, and so does an entry no
// call of the run wrote, unless the world wrote it of itself (its birth). No stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations, Organizations, People, World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import { checkRunIsolation, type RunEntry } from "../src/checks/isolation-run.ts";

const FOUNDED = Organizations.OrgFounded.identifier;
const CREATE = operations["org.create"].rpc._tag;
const INVITED = People.MemberInvited.identifier;
const SEND = People.invitationSend.rpc._tag;
const BIRTH = operations["world.create"].rpc._tag;

const entry = (seq: number, trace: string, operation: string, event: string, org: string | null): RunEntry => ({
  seq,
  trace,
  operation,
  event,
  carried: org === null ? {} : { org },
});

const calls = [
  { traceId: "f1", journey: "found" },
  { traceId: "f2", journey: "found" },
  { traceId: "p1", journey: "pay" },
  { traceId: "p2", journey: "pay" },
];

const clean: ReadonlyArray<RunEntry> = [
  entry(1, "w0", BIRTH, World.WorldCreated.identifier, null),
  entry(2, "f1", CREATE, FOUNDED, "org_found"),
  entry(3, "p1", CREATE, FOUNDED, "org_pay"),
  entry(4, "f2", SEND, INVITED, "org_found"),
];

test("a run whose every entry is its own journey's, or the world's birth, passes", () => {
  const checks = checkRunIsolation({ calls, entries: clean, producers: new Map() });
  assert.deepEqual(
    Arr.map(checks, (each) => each.passed),
    [true, true],
  );
});

test("an entry of one journey's call that names another journey's company fails, naming both", () => {
  const crossed = [...clean, entry(5, "p2", SEND, INVITED, "org_found")];
  const [companies] = checkRunIsolation({ calls, entries: crossed, producers: new Map() });
  assert.equal(companies?.passed, false);
  assert.match(companies?.detail ?? "", /pay's call names found's company org_found/);
});

test("an entry no call of the run wrote fails, with what the tap says wrote it", () => {
  const stray = [...clean, entry(5, "x9", SEND, INVITED, "org_found")];
  const producers = new Map([["x9", { producer: "capxul-api", span: SEND }]]);
  const [, unwritten] = checkRunIsolation({ calls, entries: stray, producers });
  assert.equal(unwritten?.passed, false);
  assert.match(unwritten?.detail ?? "", /entry 5 .* no call of the run wrote; capxul-api wrote it/);
});
