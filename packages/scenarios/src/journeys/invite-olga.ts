// Journey: invite olga to Northwind. Northwind's people are as founded; dana, its founder, invites olga, who is in the
// world's cast but belongs to no company, as a member; she declines; eli, a Director but not the founder, may not
// invite her again, so dana does, and she accepts, and is a member at once, with nothing signed and nothing on the
// chain; then she can be given a permission like any member. For now only the founder invites (docs/roadmap.md, "Who
// may invite"). Who may not invite, whom nobody invites again, and who may not answer another's invitation are
// refused along the way.
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { same } from "../support/expect.ts";
import { invitationsOf, type Member } from "../support/people.ts";

const steps = outline({
  people: [
    "member.list",
    "Northwind's people as founded: dana and eli its Directors, sam and pat its members; olga, who is none of them, may not see them",
  ],
  invite: [
    "invitation.send",
    "who may not invite, and who already belongs, are refused; dana invites olga as a member, pending at once with nothing to sign, and cannot invite her twice while it waits; an email nobody has yet is invited all the same",
  ],
  find: ["invitation.list", "olga finds dana's invitation to Northwind, pending; sam has none, and nobody has rex's"],
  decline: [
    "invitation.decline",
    "sam may not decline olga's invitation; olga declines it, and cannot decline it twice",
  ],
  again: [
    "invitation.send",
    "eli, a Director but not the founder, may not invite olga again; dana does: her declined invitation no longer stands in the way",
  ],
  accept: [
    "invitation.accept",
    "olga cannot accept what she declined, nor what nobody sent, and sam may not accept hers; olga accepts dana's second and is a member at once, and accepting again answers the same",
  ],
  mine: ["invitation.list", "olga's invitations, both from dana: the first declined, then the second accepted"],
  joined: ["member.list", "olga sees Northwind's people, herself last as a member, as dana does"],
  member: ["invitation.send", "olga belongs to Northwind now: inviting her again is refused"],
  grant: ["org.member.grant", "dana proposes that olga issue invoices: she is a member now, so it is proposed"],
});

const dana = { as: "dana" } as const;
const eli = { as: "eli" } as const;
const sam = { as: "sam" } as const;
const olga = { as: "olga" } as const;

const OLGA_EMAIL = "olga@cast.test";
/** Someone not yet in the world: nobody of the cast signs in with it. */
const REX_EMAIL = "rex@elsewhere.test";
/** A company and an invitation nobody made. */
const NO_ORG = "org_nowhere1";
const NO_INVITATION = "inv_nobody01";

const AS_FOUNDED: ReadonlyArray<Member> = [
  { person: "dana", email: "dana@cast.test", role: "director" },
  { person: "eli", email: "eli@cast.test", role: "director" },
  { person: "sam", email: "sam@cast.test", role: "member" },
  { person: "pat", email: "pat@cast.test", role: "member" },
];
const OLGA: Member = { person: "olga", email: OLGA_EMAIL, role: "member" };

export const inviteOlga = journey(
  {
    name: "invite olga to Northwind",
    world: "shared",
    story:
      "dana, Northwind's founder, invites olga as a member, olga declines, eli may not invite her again but dana does and she accepts, and is a member at once with nothing signed, so dana can propose a permission for her; everyone who may not is refused.",
    given: startingWorlds.founded,
    steps,
  },
  Effect.gen(function* () {
    const { founded } = yield* given(startingWorlds.founded);
    const capxul = yield* Capxul;
    const org = founded.org;
    const invite = (email: string) => ({ org, email, role: "member" }) as const;

    yield* steps.people.run((op) =>
      Effect.gen(function* () {
        const listed = yield* op.succeeds({ org }, dana);
        yield* same("Northwind's people as founded", listed.members, AS_FOUNDED);
        const owned = yield* op.succeeds({ org });
        yield* same("Northwind's people as the world's owner sees them", owned.members, AS_FOUNDED);
        yield* op.refused("NotAMember", { org }, olga);
        yield* op.refused("OrgNotFound", { org: NO_ORG }, dana);
      }),
    );

    const first = yield* steps.invite.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("CannotManagePeople", invite(OLGA_EMAIL), sam);
        yield* op.refused("CannotManagePeople", invite(REX_EMAIL), olga);
        const member = yield* op.refused("AlreadyAMember", invite("sam@cast.test"), dana);
        const director = yield* op.refused("AlreadyAMember", invite("eli@cast.test"), dana);
        yield* same("the people who already belong", [member.person, director.person], ["sam", "eli"]);
        yield* op.refused("OrgNotFound", { ...invite(OLGA_EMAIL), org: NO_ORG }, dana);
        yield* op.refused("PayloadRejected", invite("olga at cast.test"), dana);
        const invited = yield* op.succeeds(invite(OLGA_EMAIL), dana);
        yield* same("dana's invitation", [invited.invitedBy, invited.state], ["dana", "pending"]);
        const twice = yield* op.refused("AlreadyInvited", invite(OLGA_EMAIL), dana);
        yield* same("the invitation still pending", twice.invitation, invited.id);
        const rex = yield* op.succeeds(invite(REX_EMAIL), dana);
        yield* same("rex's invitation", [rex.email, rex.state], [REX_EMAIL, "pending"]);
        return invited;
      }),
    );

    yield* steps.find.run((op) =>
      Effect.gen(function* () {
        const hers = yield* op.succeeds({}, olga);
        yield* same("olga's invitations", hers.invitations, [first]);
        const his = yield* op.succeeds({}, sam);
        yield* same("sam's invitations", his.invitations, []);
      }),
    );

    yield* steps.decline.run((op) =>
      Effect.gen(function* () {
        const notHis = yield* op.refused("NotYourInvitation", { invitation: first.id }, sam);
        yield* same("the invitation sam may not decline", [notHis.invitation, notHis.person], [first.id, "sam"]);
        const declined = yield* op.succeeds({ invitation: first.id }, olga);
        yield* same("the declined invitation", declined, { ...first, state: "declined" });
        const closed = yield* op.refused("InvitationClosed", { invitation: first.id }, olga);
        yield* same("the closed invitation's state", closed.state, "declined");
        yield* op.refused("InvitationNotFound", { invitation: NO_INVITATION }, olga);
        const people = (yield* capxul["member.list"]({ org }, dana)).members;
        yield* same("Northwind's people once olga declined", people, AS_FOUNDED);
      }),
    );

    const second = yield* steps.again.run((op) =>
      Effect.gen(function* () {
        const notFounder = yield* op.refused("CannotManagePeople", invite(OLGA_EMAIL), eli);
        yield* same("who may not invite", [notFounder.org, notFounder.person], [org, "eli"]);
        const invited = yield* op.succeeds(invite(OLGA_EMAIL), dana);
        yield* expect(invited.id !== first.id, `dana's second invitation has the declined one's id, ${first.id}`);
        yield* same("dana's second invitation", [invited.invitedBy, invited.state], ["dana", "pending"]);
        return invited;
      }),
    );

    yield* steps.accept.run((op) =>
      Effect.gen(function* () {
        const closed = yield* op.refused("InvitationClosed", { invitation: first.id }, olga);
        yield* same("the declined invitation's state", closed.state, "declined");
        yield* op.refused("InvitationNotFound", { invitation: NO_INVITATION }, olga);
        yield* op.refused("NotYourInvitation", { invitation: second.id }, sam);
        const accepted = yield* op.answers("Accepted", { invitation: second.id }, olga);
        yield* same("the accepted invitation", accepted.invitation, { ...second, state: "accepted" });
        yield* same("olga as a member", accepted.member, OLGA);
        const again = yield* op.answers("AlreadyAccepted", { invitation: second.id }, olga);
        yield* same("the same acceptance", [again.invitation, again.member], [accepted.invitation, accepted.member]);
      }),
    );

    yield* steps.mine.run((op) =>
      Effect.gen(function* () {
        const hers = yield* op.succeeds({}, olga);
        yield* same("olga's invitations", hers.invitations, [
          { ...first, state: "declined" },
          { ...second, state: "accepted" },
        ]);
        for (const person of ["dana", "eli", "sam", "pat"])
          yield* expect(
            !Arr.some(yield* invitationsOf(person), (each) => each.email === REX_EMAIL),
            `${person} lists rex's invitation`,
          );
      }),
    );

    yield* steps.joined.run((op) =>
      Effect.gen(function* () {
        const seen = yield* op.succeeds({ org }, olga);
        yield* same("Northwind's people as olga sees them", seen.members, [...AS_FOUNDED, OLGA]);
        const byDana = yield* op.succeeds({ org }, dana);
        yield* same("Northwind's people as dana sees them", byDana.members, seen.members);
      }),
    );

    yield* steps.member.run((op) =>
      Effect.gen(function* () {
        const refused = yield* op.refused("AlreadyAMember", invite(OLGA_EMAIL), dana);
        yield* same("who already belongs", refused.person, "olga");
      }),
    );

    yield* steps.grant.run((op) =>
      Effect.gen(function* () {
        const proposed = yield* op.succeeds(
          { org, member: "olga", permission: "issue-invoices", note: "Olga sends our invoices" },
          dana,
        );
        yield* same("the proposed change", [proposed.change.member, proposed.change.state], ["olga", "proposed"]);
      }),
    );
  }),
);
