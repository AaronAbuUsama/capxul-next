# The build order of the domain `organizations`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 5 | `org.create` | database, chain, index, signing | `fresh` | The first operation inside a world. Its third claim needs `approval.sign`. |
| 7 | `org.member.grant` | database, chain, index, signing | `founded`, `office-holder` | Needs a founded company and `approval.sign` to execute its proposal. |
