# Reset a world in place

## Reset in place (step 1.16)

`./run.sh reset <name> --to <snapshot>` (in-process: `reset` from the package's door, `src/things/world/reset.ts`) rewinds
the SAME world to one of its snapshots: its name, door, Core, token and branch id stay; nothing is deployed. The
blueprint's `world.snapshot.restore` still makes a new world (its claims and decisions say so); the reset is the
world's own command, for a runner that keeps one world for its run (roadmap, "One runner, one world").

| Part | What | ms (`records/reset.proof.json`) |
|---|---|---|
| index stopped | Ponder sent SIGTERM, so it lets go of its schema lock | 359, 432 |
| database restored | Neon's restore of the world's branch from the snapshot's, in place (same id, compute and connection string, so Hyperdrive and Core carry on) | 1297, 1356 |
| chain reset | the chain's object: alto stopped, `anvil_reset` and `anvil_loadState` of the snapshot's state, which becomes the chain's saved state | 2165, 1814 |
| index resumed | Ponder started again on the restored schema and chain, not waited for here | 239, 242 |
| clock | Core's clock set to read the snapshot's time from now on (`app.clock`) | 1801, 1436 |
| chain mined at the world's time | the next block mined at that time by the chain's object itself, next to anvil (`POST /chain/mine-at`) | 278, 1738 |
| sites | each company site put back to the snapshot's point on the bench, or claimed from its template, then the bench's clock entry set to the world's (`src/things/site/reset.ts`, below) | none: no bench in this proof (see packages/runner's one-world records) |
| index caught up, bundler, Core | side by side: Ponder has the chain's head; alto names the EntryPoint; Core answers | 8694, 6670 (index) |
| **reset** | | **14836, 13690** |

The spike's two hard rules hold by construction. The chain is never put back without its database: the database is
restored first, and a reset that fails after it fails loudly, for its caller to destroy the world. A snapshot never
carries Ponder's lock: `world.snapshot.save` stops Ponder with SIGTERM before it takes the branch and the chain's state,
and resumes it after (`src/account/snapshots.ts`).

**One clock.** Core's clock, the chain's and the bench's entry read the snapshot's time from the reset on. A mine sent
from the caller lagged Core's clock by up to 3 s (the slowest of its three calls through the door); the chain's object
now works the world's time out next to anvil. Measured on Cloudflare's own clock (the chain's time and Core's clock at
the instant the chain's object read it; this machine's clock is some hundreds of ms off Cloudflare's): 348 and 486 ms
apart after the two resets, chain time being whole seconds.

**The destroy-order bug** (spikes/world-speed, 5.10): Neon's restore makes the world's branch a child of the snapshot's,
and the world's old state a branch of its own (`<stage>-pre-<n>`) that the world's other snapshots hang from. A reset
deletes that branch at once when nothing hangs from it; a take-down deletes every branch of the world, children first,
read from the branches themselves, and treats one Neon is already deleting as gone (`dropBranches`). The proof's world,
reset twice, was destroyed in 4.5 s with nothing left.

**Company sites** (`src/things/site/reset.ts`). The bench's door has `POST /world/save` and `POST /world/reset`
(packages/platform, `door/points.py`, step 1.17); `world.snapshot.save` of a world with companies saves a point beside
the backup. A reset of a world with a bench puts its sites where the snapshot had them, then sets the bench's clock
entry to the world's clock (`POST /clock`), since the door puts back the entry as it was saved:

| The snapshot, and the world now | What the reset does |
|---|---|
| no company | removes every site the world holds, so a company founded again makes its own (`site-exists` otherwise) |
| its point holds every one of its sites | puts them back in place (`POST /world/reset`) and removes any site made since |
| its point lost its sites (a site removed by an earlier reset is dropped from every point by the door), or one was made again since (`point-site-missing`, `point-site-changed`) | removes the world's sites, claims them ready from the bench template the caller names (`reset(world, snapshot, template)`, `--template` on the command line: the one the world kept of the snapshot), and saves the point again, so the next reset is in place; with no template named it fails and says so |

The reset answers how it put the sites back (`sites`: `none`, `in place` or `claimed`, with what it removed and
claimed). Run by the runner's one-world rehearsal against a local bench (packages/runner, step 1.18).

**Bench templates never change** (docs/roadmap.md, 14 November 2026; `src/things/site-template/sweep.ts`,
`src/things/site-template/keep.ts`, the door's `door/templates.py`). `keepSitesAsTemplate(world, snapshot, code)` keeps the
world's sites, as its snapshot holds them, as a bench template (`POST /templates`, with a pool of ready copies) named

`<starting world>-<code>-<world>`, for example `payment-drafted-3f9a0c1d-w-tpl-a1b2c3` (at most the door's 40 characters)

- `code`: the first 8 hex digits of `templateCode(root, dirs)`, a sha256 over every file of the code that makes the
  template (the runner names the blueprint's sources, Core's, this package's and its makers') and the apps the bench
  makes sites with, as its door's `GET /health` hashes them (`app`; `unknown` for a door from before it). Changing any
  of it names a new template.
- `world`: the world whose sites it copies. A template's sites hold that world's company facts: the org id Core drew
  at random, the Safe minted under it, its approvals' and payments' ids. Only a world holding that world's database
  and chain state may claim it, which is the world itself, reset to its snapshot; a copy claimed into another world
  answers `org-not-here` for its own company. So the world's name is part of the template's: no other run ever asks
  for it, and two runs at once never touch each other's.

The door never changes a template that exists: a second make of a name makes nothing and answers `made: false`, and
`keepTemplate` fails if that template was made by another world. No world and no run drops a template; its destroy
leaves it. `sweep` removes those unused for `WORLD_TEMPLATE_IDLE` (6 hours, past the 150 minutes a run's world lives),
through the door's `POST /templates/sweep`, which never removes one in use; its report says what it removed, kept and
found busy (`templates`), or why it could not (`detail`: no bench, or a door from before the sweep).
`packages/platform/records/templates/client.json` runs this package's client against the real door on a stand-in bench.

**A local bench.** `WORLD_BENCH=local` names a bench this machine serves itself, not a platform stage: packages/platform's
`bin/pool-bench.sh`, from the images already built. Its door's address and key are given as `WORLD_BENCH_DOOR` and
`WORLD_BENCH_KEY` (the runner's `run.sh` reads the key from the bench's secrets file and never prints it); every site
call of the world is otherwise the same (`src/things/site/bench.ts`, `tokenFor`). Only this machine reaches it.
