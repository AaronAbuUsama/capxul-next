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

Each domain's operations are in its own table, beside its sources: `src/<domain>/order.md`. Its "#" is the
operation's step in this order, from 1 (`world.create`) to 12 (`world.snapshot.restore`) for the thin line's twelve.

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
