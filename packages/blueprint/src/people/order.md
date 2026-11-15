# The build order of the domain `people`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

A member's Seat is off the chain and off the site. It is no hat, no Safe owner and no site user: the founding members
of `founded` (sam and pat) have none of them, `org.member.grant` adds a hat, and only a hat brings a site user
(decisions.md, 49 and 50). In infrastructure, ADR-0040 rules the same: "Inviting someone creates a Seat, not an
on-chain role", and an invitation with no grant "has no configure, grant or cleanup command" (its organizations
README, Invitations). So these five need only the world's database, Core's store of the company's board and
members, and the cast.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 13 | `org.member.list` | database | `founded` | Reads the board and members `org.create` stored; every other operation here is checked through it. |
| 13 | `org.member.invite` | database | `founded` | Needs a founded company, whose founder invites; writes only Core's database. |
| 14 | `invite.list` | database | `founded` | Reads what `org.member.invite` wrote, by the caller's email in the cast. |
| 14 | `invite.decline` | database | `founded` | Ends what `org.member.invite` wrote. |
| 14 | `invite.accept` | database | `founded` | Adds the invitee to the members `org.member.grant` reads, so a member who joined by invitation can be granted a permission. |
