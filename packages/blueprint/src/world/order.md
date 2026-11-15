# The build order of the domain `world`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 1 | `world.create` | registry, stack, database, chain, index, clock, the cast | `nothing`, `quota-full` | Nothing else can run without a world. It is `packages/world`'s create with an Rpc in front. |
| 2 | `world.show` | registry, database | `nothing`, `founded`, `restored` | A read of what create wrote. The first claim needs `restored` and waits for step 12's operation. |
| 4 | `world.clock.warp` | chain, clock, site when there is one | `founded` | The chain half can be built on `fresh`; its thin line claim needs a company's site and waits for step 1.4. |
| 11 | `world.snapshot.save` | registry, database, chain, site, clock | `fresh`, `paid`, `with-snapshot` | Copies a whole world: a branch of its database, its chain state and its sites. |
| 12 | `world.snapshot.restore` | everything `world.create` needs, and a snapshot | `with-snapshot` | Makes a world from a snapshot, so it needs create and save. |
| 13 | `world.list` | registry | `quota-full` | A read of the registry's rows of the caller's worlds and the platform's rows of their snapshots. After the thin line: an operator's inventory. |
| 13 | `world.snapshot.list` | registry, database | `quota-full` | A read of the platform's rows of a world's snapshots and of the branches that hang from each. Needs `world.snapshot.save` and, for its second claim, `world.snapshot.restore`. |
| 14 | `world.snapshot.delete` | registry, database, chain | `quota-full` | Removes what a save made: the snapshot's branch, its chain state and its row. Needs `world.snapshot.list` to show what it removed and `world.snapshot.restore` for its refusal. |
