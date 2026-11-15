# Resetting a world in place to one of its snapshots

```bash
./run.sh reset <name> --to <snapshot> [--template <site template>]
```

In-process it is `reset` from the package's door (roadmap step 1.16). It rewinds the SAME world to one of its
snapshots: its name, endpoint, api, token and branch id stay, and nothing is deployed. A runner that keeps one world
for its run resets it before each journey (roadmap, "One runner, one world"). The blueprint's
`world.snapshot.restore` still makes a new world; the reset is the world's own command, not an operation.

## Where each part of it lives

| Part | Module |
|---|---|
| The steps in order (index, database, chain, clock, sites, then everything waited for) | `src/lifecycle/reset.ts` |
| The chain's rewind (`POST /chain/reset/<name>`) and its block mined at the world's time (`POST /chain/mine-at`) | `src/chain/Chain.ts`, `src/door/Door.ts` |
| Saving a snapshot without Ponder's lock | `src/platform/snapshots.ts` |
| The branches Neon's restore leaves (`<stage>-pre-<n>`), deleted children first | `src/platform/branches.ts` |
| The company sites: none, in place, or taken from a site template | `src/site/Points.ts` |
| A site template's name, and the sweep of old ones | `src/site/Templates.ts` |
| A call that may wait on other worlds' work on a busy bench (`doorJob`) | `src/site/call.ts` |

## The rules it keeps

- **The chain is never put back without its database.** The database is restored first, and a reset that fails after
  it fails loudly, for its caller to destroy the world.
- **A snapshot never carries Ponder's lock.** `world.snapshot.save` stops Ponder with SIGTERM before it takes the
  branch and the chain's state, and resumes it after; a reset stops it the same way before it restores.
- **One clock.** The api's clock, the chain's and the bench's clock entry all read the snapshot's time from the reset
  on. The chain's object works the world's time out next to anvil, since a block mined from the caller lagged the
  api's clock by up to 3 s.
- **Site templates never change.** The rule is the roadmap's decision of 14 November 2026; its owner is the site
  service, [`packages/platform/door/templates.py`](../../platform/door/templates.py). A reset whose site snapshot lost
  its sites takes them from the site template the caller names (`--template`), and fails and says so if none is named.

The reset answers how it put the sites back (`sites`: `none`, `in place` or `claimed`, with what it removed and took).

## A local bench

`WORLD_BENCH=local` names a bench this machine serves itself (`packages/platform`'s `bin/pool-bench.sh`), not a
platform stage. Its site service's address and key are given as `WORLD_BENCH_DOOR` and `WORLD_BENCH_KEY` (the runner's
`run.sh` reads the key from the bench's secrets file and never prints it); every site call is otherwise the same
(`src/site/Bench.ts`). Only this machine reaches it.
