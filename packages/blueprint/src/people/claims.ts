// The acceptance claims of the people operations. Rendered into claims.md.
import { claim, type ClaimsOf } from "../claims/claim.ts";
import {
  AlreadyAMember,
  AlreadyInvited,
  CannotManagePeople,
  InvitationClosed,
  InvitationNotFound,
  NotAMember,
  NotYourInvitation,
  OrgNotFound,
} from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as People from "./operations.ts";

export const memberInvite: ClaimsOf = {
  operation: People.memberInvite,
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

export const inviteList: ClaimsOf = {
  operation: People.inviteList,
  claims: [
    claim(
      "A person lists every invitation sent to their email, whatever its state, oldest first, and only those.",
      w.founded,
      "invite.list as olga after dana invites her answers that invitation, pending, from dana for Northwind; after she declines it and accepts dana's second, it answers both, the first declined then the second accepted. rex@elsewhere.test's invitation is listed to nobody of the cast. As sam it answers none. Every invitation it lists is to the caller's email, and the record gains no entry.",
      { thinLine: true },
    ),
  ],
  dropped: [],
};

export const inviteAccept: ClaimsOf = {
  operation: People.inviteAccept,
  claims: [
    claim(
      "The invitee accepts and is a member at once; nothing is signed and nothing reaches the chain or the company's site.",
      w.founded,
      "invite.accept as olga of dana's second invitation, pending, answers Accepted: the invitation accepted and olga a member. The record gains one invitation_accepted naming olga and nothing else, and the chain's head is unchanged while the world's clock is frozen. org.member.list then lists olga as a member, and org.member.grant as dana of issue-invoices for olga is proposed, not refused with NotAMember.",
      {
        thinLine: true,
      },
    ),
    claim(
      "Accepting again answers the same, and changes nothing.",
      w.founded,
      "invite.accept as olga of the invitation she accepted answers AlreadyAccepted with the same invitation and member, and the record gains no entry.",
    ),
    claim(
      "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
      w.founded,
      "invite.accept as sam of olga's invitation is refused with NotYourInvitation naming it and sam; as olga of the invitation she declined, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry, and olga is not a member until she accepts. A cancelled invitation is refused the same way, with InvitationClosed in state cancelled, once org.invite.cancel can cancel one.",
      { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
    ),
  ],
  dropped: [],
};

export const inviteDecline: ClaimsOf = {
  operation: People.inviteDecline,
  claims: [
    claim(
      "The invitee declines; the invitation is closed and they do not join.",
      w.founded,
      "invite.decline as olga of dana's invitation answers it declined. The record gains one invitation_declined naming neither olga nor her email, and org.member.list as dana does not list her.",
      { thinLine: true },
    ),
    claim(
      "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
      w.founded,
      "invite.decline as sam of olga's invitation is refused with NotYourInvitation; as olga a second time, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry.",
      { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
    ),
  ],
  dropped: [],
};

export const memberList: ClaimsOf = {
  operation: People.memberList,
  claims: [
    claim(
      "The company's people: its Directors in the board's order, then its members in the order they joined.",
      w.founded,
      "org.member.list as dana of Northwind answers dana and eli as Directors, then sam and pat as members, each with the email of their cast entry; after olga accepts, olga follows pat as a member, and she sees the same list. It reads only: the record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Only the company's own people, and the world's owner, see it.",
      w.founded,
      "org.member.list as the world's owner answers what it answers dana. As olga before she accepts it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};
