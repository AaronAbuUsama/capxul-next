# Hosting spike

Throwaway code that answers one question at a time about where a Capxul world is hosted. It is deployed with
Alchemy (infrastructure as Effect code, `alchemy` 2.0.0-beta.85 on Effect 4.1.2) from an agent's container.
Nothing here is product code.

## What is proven (13 November 2026, from a Claude cloud container)

| Question | Result |
|---|---|
| Can an agent's container deploy to Cloudflare with Alchemy, with no key in the container? | Yes. The session's network proxy adds the key to requests; the variables only need to exist. A Worker deployed in 9 s, answered on its address, and was destroyed in 2 s. |
| Can a world's one database be created as a Neon branch that borrows a shared project? | Yes. Stage `platform` owns the project; each world stage creates a branch by reference. A branch took 8 to 10 s. |
| Does one world database hold both the `app` data and the `ponder` index, joined in one query? | Yes, on a world's branch. Other worlds and the platform's own branch saw none of it. |
| Can a world start as a copy of another world? | Yes. `WORLD_PARENT=world-a` forked `world-c` from `world-a` in 10 s with its rows. A later write in `world-c` was not seen by `world-a`. |
| Does destroy leave anything behind? | No. Worlds were destroyed in 2 to 8 s each, the project in 2 s; the account's own projects and Workers were untouched. |

| Is a world destroyed whatever happens to its run? | Yes. `src/world.ts` creates a world, runs a step in it, writes the run's record outside the world and destroys it, as one unit. Three runs, one passing, one failing and one hitting its declared 3 s timeout, each ended with the world destroyed and a record with the duration of every step (create 8 to 10 s, destroy 6 s). Every world also carries an owner in its name and an expiry that Neon enforces by itself. |

A query over Neon's HTTPS endpoint took 350 to 450 ms from this container, including waking the branch's compute.

## What was learned on the way

- Neon's free plan allows at most 6 hours of history, and Alchemy's default asks for 24. The project sets
  `historyRetentionSeconds: 21600`.
- A create that fails part-way can still leave the resource in the cloud. Alchemy then refuses to continue
  (`OwnedBySomeoneElse`) until the deploy is run once with `--adopt`. Only adopt a resource whose name is this stack's.
- Alchemy state is kept on local disk here (`.alchemy/`, not committed). A container that dies loses it, so every run
  ends with a destroy. Shared state (`Cloudflare.state()`) is the next thing to try.
- Alchemy asks for Node 24.11 or Bun; this container has Node 22, so `run.sh` uses Bun.

## Known hazard

A world stage's stack output carries the database connection string (`database`). The lifecycle code reads it without
printing it, but `./run.sh deploy --stage <world>` prints every output in plain text. Do not deploy a world stage with
the CLI; the one-command world of roadmap step 1.3 must not put the connection string in its outputs.

## Not yet proven

- Keeping a failed world until its expiry (`keepOnFailure`) is written but has not been run.
- Deleting expired Cloudflare resources. Neon expires a branch by itself; nothing yet does the same for a Worker.

- Anvil, Ponder and Core as Cloudflare Containers that stop when a world is idle, with Anvil's state kept in R2.
- Ponder indexing into a world's Neon branch.
- Two worlds at different clocks on one Frappe bench.
- State shared between containers.

## Run it

`./run.sh deploy --stage platform --yes`, then `./run.sh deploy --stage <world> --yes` (add `WORLD_PARENT=<world>` to
fork; world stages also need `WORLD_OWNER` and `WORLD_EXPIRES_AT`, an RFC 3339 time). `python3 sql.py <stage> "<sql>"` runs a statement on that stage's database. Finish with
`./run.sh destroy --stage <stage> --yes` for every stage, worlds before `platform`. Never run `alchemy nuke`: it deletes
every resource in the account, not only this stack's.

Lifecycle: with `platform` deployed and the variables `run.sh` sets exported, `bun src/run-world.ts` runs the three
cases and writes `records/<world>.json` for each.
