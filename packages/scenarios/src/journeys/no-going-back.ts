// Journey: no going back on an accepted invitation. Northwind's people are as founded; dana, its founder, invites olga
// as a member, and olga accepts, a member at once. Declining it afterwards is refused: the invitation's lifecycle
// refuses `decline` from `accepted` with InvitationClosed naming that state (packages/blueprint, things/invitation,
// lifecycle.ts), the one refused pair "invite olga to Northwind" does not reach within its ten steps. sam, who is not
// its invitee, is refused before the state is read. Nothing changes: olga's invitation stays accepted, and she stays a
// member. Written for roadmap item 3.10, every move and refusal of the invitation reached by a journey.
import { Errors, People, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given } from "../expectation.ts";
import { Cast } from "../cast.ts";
import { journey, outline } from "../journey.ts";
import { same } from "../support/expect.ts";
import { emailOf as emailIn, type Member } from "../support/people.ts";
import { tag } from "../support/tags.ts";

const steps = outline({
  invite: [People.invitationSend.rpc._tag, "dana, Northwind's founder, invites olga as a member: pending at once"],
  accept: [People.invitationAccept.rpc._tag, "olga accepts, and is a member at once"],
  decline: [
    People.invitationDecline.rpc._tag,
    "sam may not decline olga's invitation; olga cannot decline the invitation she accepted: it is closed, in state accepted",
  ],
  mine: [People.invitationList.rpc._tag, "olga's invitation is still accepted: declining it changed nothing"],
  joined: [People.memberList.rpc._tag, "olga is still a member of Northwind, last, as dana sees its people"],
});

export const noGoingBack = journey(
  {
    name: "no going back on an accepted invitation",
    world: "shared",
    worlds: 0,
    key: "nogo",
    story:
      "dana invites olga to Northwind and olga accepts; declining it afterwards is refused, the invitation closed in state accepted, and she stays a member.",
    given: startingWorlds.founded,
    steps,
  },
  Effect.gen(function* () {
    const cast = yield* Cast;
    const starting = (yield* given(startingWorlds.founded)).world;
    const emailOf = (person: string) => emailIn(starting, person);
    const OLGA_EMAIL = emailOf(cast.olga);
    const AS_FOUNDED: ReadonlyArray<Member> = [
      { person: cast.dana, email: emailOf(cast.dana), role: "director" },
      { person: cast.eli, email: emailOf(cast.eli), role: "director" },
      { person: cast.sam, email: emailOf(cast.sam), role: "member" },
      { person: cast.pat, email: emailOf(cast.pat), role: "member" },
    ];
    const OLGA: Member = { person: cast.olga, email: OLGA_EMAIL, role: "member" };
    const dana = { as: cast.dana } as const;
    const sam = { as: cast.sam } as const;
    const olga = { as: cast.olga } as const;
    const { founded } = yield* given(startingWorlds.founded);
    const org = founded.org;

    const invited = yield* steps.invite.run((op) =>
      Effect.gen(function* () {
        const made = yield* op.succeeds({ org, email: OLGA.email, role: "member" }, dana);
        yield* same("dana's invitation", [made.invitedBy, made.state], [cast.dana, "pending"]);
        return made;
      }),
    );

    yield* steps.accept.run((op) =>
      Effect.gen(function* () {
        const accepted = yield* op.answers(tag(People.Accepted), { invitation: invited.id }, olga);
        yield* same("the accepted invitation", accepted.invitation, { ...invited, state: "accepted" });
        yield* same("olga as a member", accepted.member, OLGA);
      }),
    );

    yield* steps.decline.run((op) =>
      Effect.gen(function* () {
        const notHis = yield* op.refused(tag(Errors.NotYourInvitation), { invitation: invited.id }, sam);
        yield* same("the invitation sam may not decline", [notHis.invitation, notHis.person], [invited.id, cast.sam]);
        const closed = yield* op.refused(tag(Errors.InvitationClosed), { invitation: invited.id }, olga);
        yield* same("the closed invitation", [closed.invitation, closed.state], [invited.id, "accepted"]);
      }),
    );

    yield* steps.mine.run((op) =>
      Effect.gen(function* () {
        const hers = yield* op.succeeds({}, olga);
        yield* same("olga's invitations", hers.invitations, [{ ...invited, state: "accepted" }]);
      }),
    );

    yield* steps.joined.run((op) =>
      Effect.gen(function* () {
        const people = yield* op.succeeds({ org }, dana);
        yield* same("Northwind's people as dana sees them", people.members, [...AS_FOUNDED, OLGA]);
      }),
    );
  }),
);
