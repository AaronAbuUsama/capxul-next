// The generic path check (src/checks/paths.ts) on made-up sequences of calls: first on a small made-up machine, so the
// logic is tested on its own, then on the blueprint's own machines. No stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, machines, People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type { Call } from "../src/client.ts";
import { checkCall } from "../src/checks/checks.ts";
import {
  checkPaths,
  declaredMachines,
  sumCoverage,
  withPaths,
  type PathCall,
  type PathMachine,
} from "../src/checks/paths.ts";

/** A door: fitted shut, opened, locked from shut or open; opening a locked door is refused. Not the blueprint's. */
const DOOR: PathMachine = {
  name: "door",
  key: "door",
  states: ["shut", "open", "locked"],
  start: { state: "shut", by: "door.fit", event: "door_fitted" },
  moves: {
    open: {
      from: ["shut"],
      to: "open",
      by: "door.open",
      event: "door_opened",
      otherwise: { open: "unchanged", locked: { refusal: "DoorLocked" } },
    },
    lock: {
      from: ["shut", "open"],
      to: "locked",
      by: "door.lock",
      event: "door_locked",
      otherwise: { locked: "unchanged" },
    },
  },
};

/** A call that sent `events`, each naming its thing under `key`. */
const sentWith =
  (key: string) =>
  (operation: string, ...events: ReadonlyArray<readonly [string, string]>): PathCall => ({
    operation,
    refusal: null,
    refused: null,
    events: Arr.map(events, ([event, thing]) => ({ event, payload: { [key]: thing, by: "someone" } })),
  });
const sent = sentWith(DOOR.key);
const refused = (operation: string, refusal: string, carries: object): PathCall => ({
  operation,
  refusal,
  refused: { _tag: refusal, ...carries },
  events: [],
});
const fit = (door: string) => sent("door.fit", ["door_fitted", door]);
const open = (door: string) => sent("door.open", ["door_opened", door]);
const lock = (door: string) => sent("door.lock", ["door_locked", door]);

const doorChecks = (calls: ReadonlyArray<PathCall>) => checkPaths([DOOR], calls).checks;
const passedOf = (calls: ReadonlyArray<PathCall>) =>
  Arr.map(doorChecks(calls), (check) => (check === null ? null : check.passed));

test("a valid path passes, each call that touched the machine carrying one `path` check", () => {
  const checks = doorChecks([fit("d1"), sent("door.paint"), open("d1"), lock("d1")]);
  assert.deepEqual(
    Arr.map(checks, (check) => check?.check ?? null),
    ["path", null, "path", "path"],
  );
  assert.deepEqual(passedOf([fit("d1"), sent("door.paint"), open("d1"), lock("d1")]), [true, null, true, true]);
  assert.match(checks[2]?.detail ?? "", /door d1: shut to open by open/);
});

test("a move before the start fails, naming the start's event", () => {
  const checks = doorChecks([open("d1")]);
  assert.equal(checks[0]?.passed, false);
  assert.match(checks[0]?.detail ?? "", /door d1: door_opened \(open\) before door_fitted/);
});

test("a move from a state it cannot start from fails, naming where the thing stands", () => {
  const checks = doorChecks([fit("d1"), lock("d1"), open("d1")]);
  assert.deepEqual(
    Arr.map(checks, (check) => check?.passed),
    [true, true, false],
  );
  assert.match(checks[2]?.detail ?? "", /starts from shut, but it is locked/);
});

test("a thing started twice, an event that names no thing, and an event sent by another operation all fail", () => {
  assert.deepEqual(passedOf([fit("d1"), fit("d1")]), [true, false]);
  const nameless: PathCall = { ...fit("d1"), events: [{ event: "door_fitted", payload: { by: "someone" } }] };
  assert.match(doorChecks([nameless])[0]?.detail ?? "", /door_fitted carries no door/);
  const elsewhere = sent("door.paint", ["door_opened", "d1"]);
  assert.match(doorChecks([fit("d1"), elsewhere])[1]?.detail ?? "", /sent by door.paint, declared by door.open/);
});

test("two things interleaved are each checked on their own path", () => {
  const calls = [fit("d1"), fit("d2"), open("d2"), lock("d1"), lock("d2"), sent("door.open", ["door_opened", "d1"])];
  assert.deepEqual(passedOf(calls), [true, true, true, true, true, false]);
  const both = sent("door.lock", ["door_locked", "d1"], ["door_locked", "d2"]);
  assert.deepEqual(passedOf([fit("d1"), fit("d2"), both]), [true, true, true]);
});

test("a refusal the machine declares passes from a state it declares, and fails from another or with no state", () => {
  const locked = [fit("d1"), lock("d1")];
  assert.deepEqual(passedOf([...locked, refused("door.open", "DoorLocked", { door: "d1", state: "locked" })]), [
    true,
    true,
    true,
  ]);
  const wrong = doorChecks([fit("d1"), refused("door.open", "DoorLocked", { door: "d1", state: "shut" })]);
  assert.equal(wrong[1]?.passed, false);
  const stale = doorChecks([...locked, open("d2"), refused("door.open", "DoorLocked", { door: "d1", state: "open" })]);
  assert.equal(stale[3]?.passed, false);
  const stateless = doorChecks([refused("door.open", "DoorLocked", { door: "d1" })]);
  assert.match(stateless[0]?.detail ?? "", /DoorLocked carries no state/);
  assert.equal(doorChecks([refused("door.open", "NotYourDoor", { door: "d1" })])[0], null);
});

test("coverage counts each start, each move and each refused pair some call reached, the rest at zero", () => {
  const calls = [
    fit("d1"),
    fit("d2"),
    open("d1"),
    lock("d1"),
    lock("d2"),
    refused("door.open", "DoorLocked", { door: "d1", state: "locked" }),
    refused("door.open", "DoorLocked", { door: "d2", state: "locked" }),
  ];
  const expected = {
    machine: "door",
    started: 2,
    moves: [
      { move: "open", reached: 1 },
      { move: "lock", reached: 2 },
    ],
    refused: [{ state: "locked", move: "open", refusal: "DoorLocked", reached: 2 }],
  };
  const coverage = checkPaths([DOOR], calls).coverage;
  assert.deepEqual(coverage, [expected]);
  assert.deepEqual(checkPaths([DOOR], []).coverage, [
    {
      ...expected,
      started: 0,
      moves: [
        { move: "open", reached: 0 },
        { move: "lock", reached: 0 },
      ],
      refused: [{ ...expected.refused[0], reached: 0 }],
    },
  ]);
  assert.deepEqual(sumCoverage([coverage, coverage, []]), [
    {
      ...expected,
      started: 4,
      moves: [
        { move: "open", reached: 2 },
        { move: "lock", reached: 4 },
      ],
      refused: [{ ...expected.refused[0], reached: 4 }],
    },
  ]);
});

// The blueprint's own machines: the invitation's.
const invitation = machines.invitation;
const INVITE = People.invitationSend.rpc._tag;
const ACCEPT = People.invitationAccept.rpc._tag;
const DECLINE = People.invitationDecline.rpc._tag;
const sendsInvitation = sentWith(invitation.key);
const invited = (id: string) => sendsInvitation(INVITE, [People.MemberInvited.identifier, id]);
const accepted = (id: string) => sendsInvitation(ACCEPT, [People.InvitationAccepted.identifier, id]);
const declined = (id: string) => sendsInvitation(DECLINE, [People.InvitationDeclined.identifier, id]);
const closed = (operation: string, id: string, state: string) =>
  refused(operation, Errors.InvitationClosed.identifier, { invitation: id, state });
const blueprintChecks = (calls: ReadonlyArray<PathCall>) =>
  Arr.map(checkPaths(declaredMachines, calls).checks, (check) => check?.passed ?? null);

test("the blueprint's machines are what the path check reads, the invitation's among them", () => {
  assert.ok(Arr.some(declaredMachines, (machine) => machine.name === invitation.name));
});

test("an invitation declined, then another accepted, with the refusals the journey makes, is a path", () => {
  const calls = [
    invited("inv_olga01"),
    declined("inv_olga01"),
    closed(DECLINE, "inv_olga01", invitation.states[2]),
    invited("inv_olga02"),
    closed(ACCEPT, "inv_olga01", invitation.states[2]),
    accepted("inv_olga02"),
  ];
  assert.deepEqual(blueprintChecks(calls), [true, true, true, true, true, true]);
  const [line] = checkPaths(declaredMachines, calls).coverage;
  assert.equal(line?.started, 2);
  assert.deepEqual(line?.moves, [
    { move: "accept", reached: 1 },
    { move: "decline", reached: 1 },
  ]);
  assert.deepEqual(
    Arr.filter(line?.refused ?? [], (pair) => pair.reached > 0),
    [
      { state: invitation.states[2], move: "accept", refusal: Errors.InvitationClosed.identifier, reached: 1 },
      { state: invitation.states[2], move: "decline", refusal: Errors.InvitationClosed.identifier, reached: 1 },
    ],
  );
});

test("an invitation accepted before it was sent, or accepted after it was declined, is no path", () => {
  assert.deepEqual(blueprintChecks([accepted("inv_olga01")]), [false]);
  assert.deepEqual(blueprintChecks([invited("inv_olga01"), declined("inv_olga01"), accepted("inv_olga01")]), [
    true,
    true,
    false,
  ]);
  assert.deepEqual(blueprintChecks([invited("inv_olga01"), closed(ACCEPT, "inv_olga01", invitation.states[2])]), [
    true,
    false,
  ]);
});

/** A call as the runner records it, through its own door. */
const call = (operation: Call["operation"], traceId: string, over: Partial<Call> = {}): Call => ({
  operation,
  traceId,
  at: null,
  outcome: "success",
  refusal: null,
  payload: {},
  success: Option.none(),
  callerMs: 1,
  resent: 0,
  failure: null,
  ...over,
});

test("`withPaths` reads what Core kept under each call's trace id and adds the `path` check to the calls it touched", () => {
  const error = Errors.InvitationClosed.make({ invitation: "inv_olga01", state: "declined" });
  const calls = [
    call(INVITE, "t1"),
    call(DECLINE, "t2"),
    call(ACCEPT, "t3", { outcome: "refusal", refusal: error._tag, error: Option.some(error) }),
  ];
  const kept = {
    spans: [],
    events: [
      {
        trace_id: "t2",
        operation: DECLINE,
        event: People.InvitationDeclined.identifier,
        payload: { invitation: "inv_olga01", org: "org_northwind1" },
      },
      {
        trace_id: "t1",
        operation: INVITE,
        event: People.MemberInvited.identifier,
        payload: { invitation: "inv_olga01", org: "org_northwind1", role: "member", by: "dana" },
      },
    ],
  };
  const paths = withPaths(
    calls,
    kept,
    Arr.map(calls, (each) => checkCall(each, kept)),
  );
  const pathsOf = Arr.map(paths.calls, (checked) => Arr.filter(checked.checks, (check) => check.check === "path"));
  assert.deepEqual(
    Arr.map(pathsOf, (checks) => Arr.map(checks, (check) => check.passed)),
    [[true], [true], [true]],
  );
  const reached = Arr.filter(paths.coverage[0]?.refused ?? [], (pair) => pair.reached > 0);
  assert.deepEqual(
    Arr.map(reached, (pair) => [pair.state, pair.move]),
    [["declined", "accept"]],
  );
});
