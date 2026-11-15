// Step 3.4's proof, the invitation's own cases (the generic ones are ./machines.test.ts): its lifecycle
// (src/things/invitation/lifecycle.ts) as the lead declared it, holding its verbs, events and refusal as their
// declarations; its state schemas; and the migration that gives its table the machine's CHECK constraint. Moved here
// from ./machines.test.ts unchanged but for the declarations it compares, to keep each file under 300 lines. Run with
// `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Errors, machines, People } from "../src/index.ts";
import { Invitation } from "../src/things/invitation/lifecycle.ts";

const sorted = (items: ReadonlyArray<string>) => Arr.sort(items, Order.String);

test("the invitation's machine is as the lead declared it", () => {
  assert.strictEqual(machines.invitation, Invitation);
  assert.equal(Invitation.name, "invitation");
  assert.equal(Invitation.key, "invitation");
  assert.deepEqual(Invitation.states, ["pending", "accepted", "declined"]);
  assert.deepStrictEqual(
    { ...Invitation.start },
    {
      state: "pending",
      by: People.invitationSend,
      event: People.MemberInvited,
    },
  );
  assert.deepEqual(sorted(Rec.keys(Invitation.moves)), ["accept", "decline"]);
  const closed = { refusal: Errors.InvitationClosed };
  assert.deepStrictEqual(Invitation.moves.accept, {
    from: ["pending"],
    to: "accepted",
    by: People.invitationAccept,
    event: People.InvitationAccepted,
    otherwise: { accepted: "unchanged", declined: closed },
  });
  assert.deepStrictEqual(Invitation.moves.decline, {
    from: ["pending"],
    to: "declined",
    by: People.invitationDecline,
    event: People.InvitationDeclined,
    otherwise: { accepted: closed, declined: closed },
  });
  assert.deepEqual(Invitation.refusedStates, ["accepted", "declined"]);
});

test("the invitation's state and InvitationClosed's state field are its machine's state schemas", () => {
  assert.strictEqual(People.InvitationState, Invitation.State);
  assert.deepEqual(People.InvitationState.literals, Invitation.states);
  const field: Schema.Top = Errors.InvitationClosed.fields.state;
  assert.strictEqual(field, Invitation.RefusedState);
  for (const state of Invitation.states)
    assert.equal(Schema.is(field)(state), Arr.contains(Invitation.refusedStates, state), state);
  assert.ok(!Schema.is(field)("cancelled"));
});

const MIGRATIONS = new URL("../../core/migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, MIGRATIONS), "utf8");

test("the newest migration on app.invitations adds the machine's CHECK constraint; 0006 is as it was applied", () => {
  const touching = Arr.filter(sorted(readdirSync(MIGRATIONS)), (name) => Str.includes("app.invitations")(read(name)));
  const newest = Arr.last(touching).pipe(Option.getOrThrow);
  assert.notEqual(newest, "0006_people_invitations.sql");
  assert.ok(Str.includes(Invitation.check("state"))(read(newest)), `${newest} lacks ${Invitation.check("state")}`);
  assert.ok(!/check\s*\(/i.test(read("0006_people_invitations.sql")), "0006 was edited: an applied migration is not");
});
