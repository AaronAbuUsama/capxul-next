# The build order of the domain `record`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 3 | `record.export` | database | `fresh`, `paid`, `restored` | Reads the record, which every operation after it writes. Built early so every later scenario can read the record. |
