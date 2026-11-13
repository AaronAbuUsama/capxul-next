# Roadmap for the rebuild line (`master`)

Agreed with Aaron on 13 November 2026. This page is the plan this line sticks to. It changes only when Aaron agrees a
change, and the change is written here with its date.

**Goal.** Capxul's own company runs on Capxul.

## What was decided on 13 November 2026

| Decision | In plain words |
|---|---|
| The blueprint is Effect code | An operation, its errors, its events and its logs are Effect declarations that the product imports. The server does not compile until every declared operation has a handler. The old records under `blueprint/` are reference, ported one journey at a time. |
| Three kinds of check | The compiler (shapes, error codes, a handler exists). A generic runner on every scenario (declared events sent, spans and logs present, speed). Written scenarios that run through the door against a world. Internals are the code's business and are covered by package tests. |
| The scenario author is not the builder | A scenario is written before the build by a different agent, and CI rejects one that already passes against an empty handler. |
| Measurement is part of the contract | Every proven run stores timings and outcomes per operation, so speed and cost are climbed as well as correctness. |
| The world is the unit | All companies on one chain with one clock and one record. People, agents, tests and deployments enter through a named world. Three grades: private, shared, real. |
| Infrastructure is Alchemy | One stack per world, deployed many times, borrowing a platform stack. `capxul world create` is a deploy. |
| Hosting | Cloudflare for compute, one Neon branch per world for its one database (app data and the index together), one server for the Frappe bench only. |
| Site creation on a shared bench | Each world holds a token minted when it is created, limited to that world, a site quota and its lifetime. A world whose change touches the Frappe app brings its own bench. |
| Effect everywhere it can be | TypeScript is Effect, measured by two counts that may only fall: non-Effect constructs outside entry files, and non-Effect runtime dependencies. Frappe (Python) and the contracts (Solidity) are outside this. |
| Convergence | The threads on `main` continue until phase 1 passes here. Then `master` becomes the trunk and they move over journey by journey. |

## World lifecycle rules, enforced by code

Learned from worlds piling up on one machine on the other line.

1. A run is one unit: create the world, test, copy the record out, destroy. The destroy happens even when the run fails
   or is interrupted.
2. Every world has an owner and an expiry. What has expired is deleted without anyone remembering to.
3. Keeping a world to debug it is explicit, costs nothing while parked, and is time-limited.
4. Destroy removes everything the world created.
5. A world never lives on the agent's own machine.
6. Timeouts are declared settings, and each step's duration is recorded.

## Phases

| Phase | What it delivers | Done when | State |
|---|---|---|---|
| 0. Shape | The remaining spikes and the decisions they settle | Each risk has a run that proves or kills it | In progress |
| 1. Walking pipeline | The thin line in the new shape: contract, scenarios, a world created and destroyed by one command, timings stored, Effect lint, CI on `master` | The thin line's scenarios pass in CI in a fresh private world | Not started |
| 2. Staging | The same line on a shared hosted world, deployed by Alchemy | The scenarios pass there after a deploy, and the drift check is clean | Not started |
| 3. Breadth | Journeys ported one at a time, in the order Capxul's own company needs them | Each journey is green in a private world, then on staging | Not started |
| 4. Real world | Production platform, real sign-in and signing, Bridge, public chain | Capxul's company runs a month on it | Not started |

Phase 1 is narrow and done by few agents. Parallel agents start at phase 3, one journey each.

## Steps to the goal of phases 0 to 2

Progress is counted from this table and nothing else. A step is Done only when a run proves it; the run or pull
request is named under Evidence. `Needs` lists the steps that must be Done first. `Count` is used where a step is
several like things (twelve scenarios); every other step counts as one. `Waits on` names a person when only they can
unblock it.

| Step | Milestone | What | Needs | State | Count | Waits on | Done at (UTC) | Evidence |
|---|---|---|---|---|---|---|---|---|
| 0.1 | 0 | Alchemy deploys from an agent's container with no key inside it | | Done | | | 2026-11-13T06:55Z | `spikes/hosting`, PR 142 |
| 0.2 | 0 | A world's one database is a Neon branch: created, isolated, forked from another world | | Done | | | 2026-11-13T06:59Z | `spikes/hosting`, PR 142 |
| 0.3 | 0 | A world is created, used and destroyed as one unit, with an owner, an expiry and timed steps | 0.2 | Done | | | 2026-11-13T07:23Z | `spikes/hosting`, PR 142 |
| 0.4 | 0 | Alchemy state is shared, so any container can see and destroy any world | 0.1 | Done |  |  | 2026-11-13T07:47Z | `spikes/state`: deployed from one copy, planned and destroyed from a fresh one. No lock: two deploys of one stage at once leave an orphan |
| 0.5 | 0 | Expired worlds are deleted without anyone remembering to, Cloudflare resources included | 0.4 | Done |  |  | 2026-11-13T07:49Z | `spikes/state`: the sweeper destroyed an expired stage and kept the others. Nothing schedules it yet |
| 0.6 | 0 | A world's chain and index run as Cloudflare Containers against its Neon branch and stop when idle | 0.2 | Done |  |  | 2026-11-13T08:20Z | `spikes/containers`, `records/ct-w3.prove.txt`: Anvil with the seeded state and Ponder ran as containers against the world's Neon branch, state survived a stop through R2, both stopped when idle and woke in 1.6 s. Core and the real indexer package were not tried |
| 0.7 | 0 | One operation goes from an Effect contract, to a scenario that fails on an empty handler, to a pass | 0.2 | In progress | | | | |
| 0.8 | 0 | Two worlds at different clocks share one Frappe bench |  | Done |  |  | 2026-11-13T09:05Z | `spikes/bench-clocks`, `observed.txt`: three sites of two worlds on one bench read their own world's time in bench commands, web requests, worker jobs and the scheduler. Four gaps to close in step 1.4: the web process must load the app at start, plain Python processes read host time, a running clock is an hour out across daylight saving, and Frappe caches a site's config for 60 s |
| 0.9 | 0 | A scenario run from a template world is timed end to end | 0.6, 0.7 | Not started | | | | |
| 1.1 | 1 | The thin line's operations are declared in the contract and the server compiles with empty handlers | 0.7 | In progress | 0/12 |  |  |  |
| 1.2 | 1 | The scenario runner checks declared events, spans and speed on every run and stores the timings | 0.7 | Not started | | | | |
| 1.3 | 1 | One command creates and destroys a private world: chain, index, Core and database | 0.4, 0.5, 0.6 | In progress |  |  |  |  |
| 1.4 | 1 | A company's Frappe site in a private world is reached through the door | 0.8, 1.3 | Not started | | | | |
| 1.5 | 1 | The thin line's scenarios are written by a separate agent and fail on empty handlers | 1.1, 1.2 | Not started | 0/12 | | | |
| 1.6 | 1 | The thin line's scenarios pass in a fresh private world | 1.3, 1.4, 1.5 | Not started | 0/12 | | | |
| 1.7 | 1 | CI fails when the two Effect counts rise |  | Done |  |  | 2026-11-13T07:58Z | `packages/effect-counts`, PR 160: the CI gate ran the check and passed; a rising count exits 1 |
| 1.8 | 1 | CI on `master` creates a world, runs the thin line and destroys the world | 1.6 | Not started | | Aaron: Cloudflare and Neon keys as CI secrets | | |
| 2.1 | 2 | A host for the Frappe bench and a domain on Cloudflare exist | | Not started | | Aaron: a host account and a domain | | |
| 2.2 | 2 | The platform (bench, tunnel, shared state) is deployed by Alchemy | 2.1, 0.4 | Not started | | | | |
| 2.3 | 2 | A shared world exists whose sites are created with a per-world token | 2.2, 1.6 | Not started | | | | |
| 2.4 | 2 | The thin line's scenarios pass on the shared world after a deploy | 2.3 | Not started | 0/12 | | | |
| 2.5 | 2 | The drift check runs on a schedule and is clean | 2.2 | Not started | | | | |

## Risks, proven or killed

Every step of milestone 0 is a risk: it is Proven when its step is Done, and Killed when a run shows it cannot work
(the step's State is then `Killed` and the decision that replaces it is recorded above). These risks belong to later
phases and are not counted in the progress to milestone 2:

| Risk | State |
|---|---|
| Real sign-in and signing for people | Open |
| Bridge banking | Open |
