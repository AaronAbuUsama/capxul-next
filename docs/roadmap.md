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

## Risks to spike, and where each stands

| Risk | State |
|---|---|
| Alchemy deploys from an agent's container with no key inside it | Proven (`spikes/hosting`) |
| A world's database as a Neon branch: created, isolated, forked from another world | Proven (`spikes/hosting`) |
| World lifecycle: a world is created, used and destroyed as one unit, with an owner, an expiry and timed steps | Proven (`spikes/hosting`) |
| Deleting expired Cloudflare resources without anyone remembering to | Open |
| One operation from contract to a passing scenario | Next |
| Chain, Ponder and Core as Cloudflare Containers against a world's Neon branch | Open |
| Two worlds at different clocks on one Frappe bench | Open |
| Alchemy state shared between containers | Open |
| How long a scenario run takes from a template world | Open |
| Real sign-in and signing for people | Open |
| Bridge banking | Open |
