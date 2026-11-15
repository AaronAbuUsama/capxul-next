# Acceptance claims of the domain `people`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `org.member.invite` | 4 | 0 | 0 | 4 | 0 |
| `invite.list` | 1 | 0 | 0 | 1 | 0 |
| `invite.accept` | 3 | 0 | 0 | 3 | 0 |
| `invite.decline` | 2 | 0 | 0 | 2 | 0 |
| `org.member.list` | 2 | 0 | 0 | 2 | 0 |

## 1. `org.member.invite`

- Served by: the world group.
- Refusals: `OrgNotFound`, `CannotManagePeople`, `AlreadyAMember`, `AlreadyInvited`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `member_invited`.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: reads of the company's board and members and of the world's cast in its database, then one write.

1. A Director invites a person by email to be a member: the invitation is pending at once, and there is nothing to sign. *(thin line)*
   - In: `founded`.
   - Observes: org.member.invite as dana of olga@cast.test as a member answers an invitation pending, naming Northwind, that email, the role and dana. It asks for no approval: the record gains one member_invited and nothing else, the chain's head is unchanged while the world's clock is frozen, and invite.list as olga holds the invitation, pending.
   - Old: none; this claim is new.
2. An email no person of the world signs in with is invited all the same: the invitation waits for whoever signs up with it.
   - In: `founded`.
   - Observes: org.member.invite as dana of rex@elsewhere.test answers an invitation pending for that email, and no person of the cast lists it with invite.list.
   - Old: none; this claim is new.
3. Only a Director may invite; anyone else is refused, and nothing is sent.
   - In: `founded`.
   - Observes: As sam, a member with no permission, and as olga, who is not a member, org.member.invite is refused with CannotManagePeople naming Northwind and the caller. As eli, the other Director, it answers an invitation he sent. record.export shows no new entry for a refused call.
   - Refusals: `CannotManagePeople`.
   - Old: none; this claim is new.
4. A person who already belongs to the company, and an email whose invitation is still pending, are refused.
   - In: `founded`.
   - Observes: org.member.invite as dana of sam@cast.test (a member) and of eli@cast.test (a Director) is refused with AlreadyAMember naming the person; a second invitation of olga@cast.test while hers is pending, with AlreadyInvited naming the pending invitation. Once she has declined, eli invites her again; once she has accepted, she is refused with AlreadyAMember. A company nobody founded is refused with OrgNotFound, and an address that is not an email with PayloadRejected. record.export shows no new entry for any of them.
   - Refusals: `AlreadyAMember`, `AlreadyInvited`, `OrgNotFound`.
   - Old: none; this claim is new.

## 2. `invite.list`

- Served by: the world group.
- Refusals: `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 1,000 ms, provisional, excluding waking a parked world. Basis: one read of the world's database.

1. A person lists every invitation sent to their email, whatever its state, oldest first, and only those. *(thin line)*
   - In: `founded`.
   - Observes: invite.list as olga after dana invites her answers that invitation, pending, from dana for Northwind; after she declines it and accepts eli's, it answers both, dana's declined then eli's accepted. rex@elsewhere.test's invitation is listed to nobody of the cast. As sam it answers none. Every invitation it lists is to the caller's email, and the record gains no entry.
   - Old: none; this claim is new.

## 3. `invite.accept`

- Served by: the world group.
- Refusals: `InvitationNotFound`, `NotYourInvitation`, `InvitationClosed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Accepted`: `invitation_accepted`; `AlreadyAccepted`: none.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: a read of the invitation and the caller's cast entry in the world's database, then one write.

1. The invitee accepts and is a member at once; nothing is signed and nothing reaches the chain or the company's site. *(thin line)*
   - In: `founded`.
   - Observes: invite.accept as olga of eli's pending invitation answers Accepted: the invitation accepted and olga a member. The record gains one invitation_accepted naming olga and nothing else, and the chain's head is unchanged while the world's clock is frozen. org.member.list then lists olga as a member, and org.member.grant as dana of issue-invoices for olga is proposed, not refused with NotAMember.
   - Old: none; this claim is new.
2. Accepting again answers the same, and changes nothing.
   - In: `founded`.
   - Observes: invite.accept as olga of the invitation she accepted answers AlreadyAccepted with the same invitation and member, and the record gains no entry.
   - Old: none; this claim is new.
3. An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.
   - In: `founded`.
   - Observes: invite.accept as sam of olga's invitation is refused with NotYourInvitation naming it and sam; as olga of the invitation she declined, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry, and olga is not a member until she accepts. A cancelled invitation is refused the same way, with InvitationClosed in state cancelled, once org.invite.cancel can cancel one.
   - Refusals: `NotYourInvitation`, `InvitationClosed`, `InvitationNotFound`.
   - Old: none; this claim is new.

## 4. `invite.decline`

- Served by: the world group.
- Refusals: `InvitationNotFound`, `NotYourInvitation`, `InvitationClosed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `invitation_declined`.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: a read of the invitation and the caller's cast entry in the world's database, then one write.

1. The invitee declines; the invitation is closed and they do not join. *(thin line)*
   - In: `founded`.
   - Observes: invite.decline as olga of dana's invitation answers it declined. The record gains one invitation_declined naming neither olga nor her email, and org.member.list as dana does not list her.
   - Old: none; this claim is new.
2. An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.
   - In: `founded`.
   - Observes: invite.decline as sam of olga's invitation is refused with NotYourInvitation; as olga a second time, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry.
   - Refusals: `NotYourInvitation`, `InvitationClosed`, `InvitationNotFound`.
   - Old: none; this claim is new.

## 5. `org.member.list`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NotAMember`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 1,000 ms, provisional, excluding waking a parked world. Basis: one read of the world's database.

1. The company's people: its Directors in the board's order, then its members in the order they joined. *(thin line)*
   - In: `founded`.
   - Observes: org.member.list as dana of Northwind answers dana and eli as Directors, then sam and pat as members, each with the email of their cast entry; after olga accepts, olga follows pat as a member, and she sees the same list. It reads only: the record gains no entry.
   - Old: none; this claim is new.
2. Only the company's own people, and the world's owner, see it.
   - In: `founded`.
   - Observes: org.member.list as the world's owner answers what it answers dana. As olga before she accepts it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. record.export shows no new entry.
   - Refusals: `NotAMember`, `OrgNotFound`.
   - Old: none; this claim is new.
