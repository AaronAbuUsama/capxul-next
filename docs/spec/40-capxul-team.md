# The Capxul team on swarmD

How Capxul uses swarmD's ledger, manager and pairs. Namespace `capxul`, project `capxul-next`. This page is the short
form; the design is [`docs/design/swarm.md`](../design/swarm.md) (topology, the schemas, the task tree, the pair
protocol, the briefs for swarmD) and [`docs/design/swarm-templates.md`](../design/swarm-templates.md) (every template,
and the team as swarmD declares it). Where they differ from this page, they win.

**Revised 8 November 2026** to the swarm design. The four managers, the designer, the design reviewer, the scout before
B5, the old-system baseline and the copied frozen text of the first version are replaced; the table at the end says by
what.

## The task tree

Derived from the book by `packages/plan/src/tasks.ts` into `docs/mission/tasks.json` (`swarm.task-tree`; swarm.md section 5).
Nobody writes a task by hand, except a defect from a finding or a red head, and a review task from an answer
(`swarm.hand-tasks`).

```text
capxul                       Capxul rebuilt                       evals: ok:capxul (Aaron)          owner: capxul/master
├─ milestone:T0 … B5         each milestone                       done by its steps' roll-up
│  └─ step:B3.spine …        a milestone's work                   evals: its exit lines, ms:<M>/<slug>
├─ lane:payments             a concept                            evals: sys:imports/payments
│  ├─ door:payments          its tables, machines, procedures     tbl:, trn:, prc:, inv:
│  ├─ workflow:payments.…    each durable process                 wfl:, bud:
│  └─ operation:payment.send each of the 215 operations           acc:, ret:, ref:, evt:, spn:, bud:, doc:, des:, flw:, rpc:
├─ lane:integrations         the 11 integrations                  int:
└─ lane:journeys             the 13 journeys (watch tasks)        jrn:, fun:
```

438 tasks on the book of 8 November 2026. 405 are working tasks: 390 get a pair at $5 (across all their pairs), and 15
are watch tasks with no paths (the journeys, B3.pilots, B5.week), never paired and done by their evals
(`swarm.watch-tasks`). The operation is the unit (`swarm.task-unit`). Labels come from the plan: `kind:`, `lane:`,
`layer:`, `area:`, `money`, `pilot`, `pilot-closure`, `after:`, `watch`.
Priority is the record's own; milestones and steps are critical; equity and board's director and vote commands are low
(`system.build-order`).

## The manager

One swarmD manager, **`capxul/master`**, on the `build` template (`swarm.start-small`). Its instructions are the goal
prompt whole, followed by the operating skeleton in swarm.md section 1b (`swarm.master-prompt`). It owns every task,
starts the pairs, answers the signals, merges through the release gate, promotes `integration/build` to `main` at each
milestone's exit, and brings Aaron only decision packs (`swarm.escalation`). Its room is Pi now, and a Slack channel
once the app is connected.

| Stage | Who runs the loop | Where the state is |
|---|---|---|
| 0 | **Mission Control**: the Claude session started from the goal prompt, with the profiles in `.claude/agents/` | `docs/mission/tasks.json`, `docs/mission/progress.md`, task cards and matters as GitHub issues |
| 1 | `capxul/master` on swarmD, once swarm.md 1.2's entry criteria hold (expected at B3) | the ledger |
| 2 | `capxul/master` as a lead over lane managers, only on `swarm.nested-entry`'s evidence | the ledger |

## Workers

| Worker | Role | Model (tier) | Concurrency | Sandbox | Tools | Returns |
|---|---|---|---|---|---|---|
| `builder` | maker | gateway/gpt-6.1-sol (strong) | 4 | the repository and, from B3, a devnet | `run_evals`, `submit`, `handover`, `ask`; GitHub `pulls.create`, `pulls.get`, `pulls.update`, `issues.createComment` | the Handback |
| `reviewer` | checker | anthropic/claude-sonnet-5-5 (strong, other family) | 4 | the repository, read-only | `run_evals`, `check`, `ask`; GitHub `pulls.get`, `pulls.listFiles` | a check, with the `des:` verdicts |
| `adversary` | second checker on money tasks | anthropic/claude-sonnet-5-5 | 2 | read-only | as the reviewer | a check |
| `diagnoser` | diagnoser | anthropic/claude-sonnet-5-5 | 1 | read-only | none | a diagnosis |
| `researcher` | none | anthropic/claude-haiku-5-5 (cheap) | 1 | read-only | none | an answer, a recommendation, sources |

The manager runs on claude-haiku-5-5. At most 4 pairs in flight and 6 agents at once, one task per lane; at stage 0, 2
pairs, since there the subscription's usage window is the limit (`swarm.pacing`). There is no verifier: the engine runs the machine evals in the sandbox. The models are
`swarm.checker-family`, Aaron's to fund; the recommendation stands until he answers.

## The pair

Every task with checkers is a pair (swarm.md section 6): the builder makes, the reviewer checks (and the adversary on
the seven money lanes and B0.once), the engine runs the gate and the machine evals. A merged task is never paired
again unless an eval fails at the head, and the tasks after it start at its merge; a stopped task waits for its cause,
then gets one more pair within what is left of its budget (`swarm.merged-tasks`). Limits: 5 rounds (the round signal
at 3), $5 a task (the budget signal at half), a fresh maker and a delta review each round, stalled after 30 minutes
(`swarm.pair-limits`). Only the manager merges, in code, when every checker approves, no machine eval failed and the
required CI is green; unverifiable evals are listed under After merge (`swarm.merge`). No sandbox may push
`integration/build` or `main` (SD-28; until it lands, branch protection, which needs GitHub Pro: `swarm.accounts`).

## Connectors, secrets and egress

| Need | Used by | Connector or egress | Secret | State |
|---|---|---|---|---|
| The repository: clone, push, pull requests, CI, the merge | builder, the master | the GitHub connector and `sandbox.repo("github:AaronAbuUsama/capxul-next")` | the swarmd-agent App, installed with write (`swarm.accounts`) | built |
| The old system, read only | every sandbox | cloned in `.swarmd/sandbox.ts`'s `prepare` | the same App, installed read-only on `Xelmar-tech/infrastructure` | built |
| Models | every agent | the `gateway` and `anthropic` providers | `GATEWAY_API_KEY`, `ANTHROPIC_API_KEY` (Worker secrets) | built |
| PostHog: the live evals | a scout, from B5 only | an MCP connector | `POSTHOG_API_KEY`, held by swarmD | planned |
| Chain: Base Sepolia for staging | B5 | egress | `BASE_SEPOLIA_RPC_URL` | built (egress) |
| Bridge sandbox (banking) | sandboxes running the banking evals | egress | `BRIDGE_SANDBOX_API_KEY` | built (egress) |
| Email | the devnet uses the mail sink; staging uses Resend | egress | `RESEND_API_KEY` (staging only) | built (egress) |
| npm | every sandbox | egress to `registry.npmjs.org` | none | built |

The ledger is the tracker; Linear is not used (spec 00, decision 8). Keys are asked for through the credential form,
never in chat.

## The devnet in a sandbox

Every machine eval runs on a devnet: anvil with the v4 contracts, Postgres, Ponder, the backend, a mock bundler and
paymaster, and the mail sink. Step `B3.sandbox` boots it in a `standard-3` sandbox from a golden snapshot, restores a
world and runs one eval, and measures both (`swarm.sandbox`).

- **Exit:** boot within 2 minutes from the snapshot, and an L1 eval within 10 seconds.
- **If it fails,** the fallback is one long-lived devnet host per project, outside the sandboxes, with a world restored
  per pair under a lock.

## Prompts and templates

Each role's prompt, its swarmD definition (in the documented API and in today's), its JSON Schemas and its Claude Code
profile are in [`docs/design/swarm-templates.md`](../design/swarm-templates.md) sections 10 and 11. Every artifact an
agent produces (the pull request, the handback, the check, the diagnosis, a matter, an issue) has its template there.

## Proof that the team works

1. **The dry run** (swarmD post-mortem O1): one Capxul task end to end on the deployed swarm, on the cheap tier, with
   today's API (swarm-templates.md 10.4).
2. **Stage 1's entry** (swarm.md 1.2): swarmD's planned pieces built and passing their docs' acceptance lines; the
   needed briefs without which the master cannot run (SD-2, SD-3, SD-4, SD-21, SD-22, SD-26, SD-27, SD-28) and those
   for safe running (SD-1, SD-5, SD-6, SD-14, SD-15); and spec 20's S3: one task with 5 evals converging with no person,
   5 runs of 5.
3. **The pilots** (B3): the pilot closure's 46 tasks merged on `integration/build`, their evals passing except those whose world is not buildable yet, each with its timeline of
   assignments, rounds and cost, the board live, and no person acting except to answer matters.

## What the swarm design replaced

| The first version of this page | Now | Decision |
|---|---|---|
| Four managers: `capxul/lead`, `capxul/design`, `capxul/build`, `capxul/measure` | One manager, `capxul/master`; lane managers only at stage 2 | `swarm.start-small`, `swarm.nested-entry` |
| `designer` and `design-reviewer`, a design task per operation (`K-40`) | None: the book is the design; its records are already built and checked | `swarm.workers` |
| `rev:K-41` on every build task | No `rev:` evals: the checkers' approval is convergence; the reviewer posts `des:` | `swarm.review-evals` |
| `ok:K-1` | `ok:capxul` on the root, the only person eval; milestones exit on `ms:` evals | `swarm.milestone-evals` |
| `run_evals --target legacy`, an old-system baseline | The old system is a reference for behaviour, never a baseline | the goal prompt; `system.frozen-behaviour` |
| "Copy the frozen text, never improve it" | Behaviour, not spelling: the target designs the surface | `system.frozen-behaviour` |
| A `scout` from the start | A scout only from B5, for the live evals | `swarm.workers` |
| Labels `area:` and `kind:design`, `kind:operation`, `kind:journey`, `kind:system` | The plan's labels (`kind:<task kind>`, `lane:`, `layer:`, `area:`, `money`, `pilot`) | `swarm.task-tree` |
| A hand-written tree, one design and one build task per operation | Derived by `packages/plan/src/tasks.ts`; one task per operation | `swarm.task-tree`, `swarm.task-unit` |
| "Linear is not used [confirm with Aaron]" | Confirmed: the ledger is the tracker (spec 00, decision 8) | — |
| The second family as "a decision for Aaron" | `swarm.checker-family`: gateway makers, Anthropic checkers, for Aaron | `swarm.checker-family` |
| Prompt skeletons for the lead, the build manager, the designer, the builder and the reviewer | The master's skeleton (swarm.md 1b) and each role's prompt (swarm-templates.md 10.5) | `swarm.master-prompt`, `swarm.templates` |
