// `capxul invitation send` (today `org.member.invite`): a company's founder invites a person by email.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { MemberInvited } from "../events.ts";
import { invitation } from "../examples.ts";
import { AlreadyAMember, AlreadyInvited, CannotManagePeople } from "../refusals.ts";
import { Email, Invitation, InvitedRole } from "../values.ts";

export const memberInvite = declare({
  rpc: Rpc.make("org.member.invite", {
    payload: { org: OrgId, email: Email, role: InvitedRole },
    success: Invitation,
    error: Schema.Union([OrgNotFound, CannotManagePeople, AlreadyAMember, AlreadyInvited, NotImplemented]),
  }),
  emits: [
    {
      event: MemberInvited,
      carries: ({ payload, success }) => ({
        invitation: success.id,
        org: payload.org,
        role: payload.role,
        by: success.invitedBy,
      }),
    },
  ],
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_500,
    basis: "reads of the company's board and members and of the world's cast in its database, then one write",
  },
  examples: [
    {
      payload: { org: "org_northwind1", email: "olga@cast.test", role: "member" },
      success: invitation("inv_olga01", "pending"),
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.member.invite` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: memberInvite,
  claims: [
    claim(
      "The founder invites a person by email to be a member: the invitation is pending at once, and there is nothing to sign.",
      w.founded,
      "org.member.invite as dana, Northwind's founder, of olga@cast.test as a member answers an invitation pending, naming Northwind, that email, the role and dana. It asks for no approval: the record gains one member_invited and nothing else, the chain's head is unchanged while the world's clock is frozen, and invite.list as olga holds the invitation, pending.",
      {
        thinLine: true,
      },
    ),
    claim(
      "An email no person of the world signs in with is invited all the same: the invitation waits for whoever signs up with it.",
      w.founded,
      "org.member.invite as dana of rex@elsewhere.test answers an invitation pending for that email, and no person of the cast lists it with invite.list.",
    ),
    claim(
      "Only the company's founder may invite; another Director, and anyone else, is refused, and nothing is sent.",
      w.founded,
      "As eli, a Director who is not the founder, as sam, a member with no permission, and as olga, who is not a member, org.member.invite is refused with CannotManagePeople naming Northwind and the caller, who is not the founder org_founded names in the record. record.export shows no new entry for a refused call. As dana, the founder, it answers an invitation she sent.",
      { refusals: [CannotManagePeople] },
    ),
    claim(
      "A person who already belongs to the company, and an email whose invitation is still pending, are refused.",
      w.founded,
      "org.member.invite as dana of sam@cast.test (a member) and of eli@cast.test (a Director) is refused with AlreadyAMember naming the person; a second invitation of olga@cast.test while hers is pending, with AlreadyInvited naming the pending invitation. Once she has declined, dana invites her again; once she has accepted, she is refused with AlreadyAMember. A company nobody founded is refused with OrgNotFound, and an address that is not an email with PayloadRejected. record.export shows no new entry for any of them.",
      { refusals: [AlreadyAMember, AlreadyInvited, OrgNotFound] },
    ),
  ],
  dropped: [],
};
