# The build order of the domain `documents`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 8 | `doc.create` | database, site | `office-holder`, `payment-drafted` | The first operation on a company's site: needs roadmap step 1.4 and a member with a site user. |
| 9 | `doc.submit` | database, index, signing, site | `office-holder`, `payment-drafted`, `payment-held` | Needs documents to submit; a held payment opens a sponsored approval. |
