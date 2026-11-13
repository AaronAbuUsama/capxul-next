# The order to build the thin line in

The twelve operations, in the order they can be built. An operation comes after everything its scenarios need: the
parts of a world it touches, and the operations that make its starting worlds. The starting worlds are declared in
`src/starting-worlds.ts` and listed with their steps in [claims.md](claims.md).

The parts of a world, as `packages/world` builds it (roadmap step 1.3):

- **registry**: the platform's table of world names, owners and expiries.
- **stack**: the world's Alchemy deploy: its door, its Core, its containers.
- **database**: the world's Neon branch: the app's data, the record and the index.
- **chain**: the world's Anvil, loaded from the seeded chain state, saved to R2.
- **index**: Ponder, indexing the chain into the world's database.
- **signing**: the cast's test keys, the bundler and the paymaster that carry a signature to the chain.
- **site**: a company's Frappe site on a bench, reached through the door (roadmap step 1.4).
- **clock**: the world's time, followed by the chain and every site.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 1 | `world.create` | registry, stack, database, chain, index, clock, the cast | `nothing`, `quota-full` | Nothing else can run without a world. It is `packages/world`'s create with an Rpc in front. |
| 2 | `world.show` | registry, database | `nothing`, `founded`, `restored` | A read of what create wrote. The first claim needs `restored` and waits for step 12's operation. |
| 3 | `record.export` | database | `fresh`, `paid`, `restored` | Reads the record, which every operation after it writes. Built early so every later scenario can read the record. |
| 4 | `world.clock.warp` | chain, clock, site when there is one | `founded` | The chain half can be built on `fresh`; its thin line claim needs a company's site and waits for step 1.4. |
| 5 | `org.create` | database, chain, index, signing | `fresh` | The first operation inside a world. Its third claim needs `approval.sign`. |
| 6 | `approval.sign` | chain, index, signing | `founded`, `payment-held` | Needed to finish a founding; without it no later starting world can be made. |
| 7 | `org.member.grant` | database, chain, index, signing | `founded`, `office-holder` | Needs a founded company and `approval.sign` to execute its proposal. |
| 8 | `doc.create` | database, site | `office-holder`, `payment-drafted` | The first operation on a company's site: needs roadmap step 1.4 and a member with a site user. |
| 9 | `doc.submit` | database, index, signing, site | `office-holder`, `payment-drafted`, `payment-held` | Needs documents to submit; a held payment opens a sponsored approval. |
| 10 | `report.run` | site | `paid` | Its claims compare the books with the chain after a payment, so it needs everything before it. |
| 11 | `world.snapshot.save` | registry, database, chain, site, clock | `fresh`, `paid`, `with-snapshot` | Copies a whole world: a branch of its database, its chain state and its sites. |
| 12 | `world.snapshot.restore` | everything `world.create` needs, and a snapshot | `with-snapshot` | Makes a world from a snapshot, so it needs create and save. |

## What can be built at the same time

Steps 1 to 4 need no company and can be built while step 1.4 (a company's site through the door) is under way.
Steps 5 to 7 need the chain, the index and signing but no site. Steps 8 to 10 need a site. Steps 11 and 12 need
every part, because a snapshot holds them all.

## Making the starting worlds

Each starting world is made through the door by the operations above. `fresh` to `paid` are made once per change to
the code and saved as template snapshots in a kept template world, and a scenario gets the one it needs restored into
a fresh private world; `quota-full`, `with-snapshot` and `restored` are made by their steps for each scenario
(`StartingWorld.made`, decisions.md 39). Whoever makes a world keeps its facts for the scenarios (decisions.md 38).
Until `world.snapshot.restore` exists (step 12), a scenario's starting world is made from `nothing` by running the
steps, which is slower but needs nothing more.
