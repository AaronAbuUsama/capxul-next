# The Capxul team on swarmD

How Capxul uses the ledger, the managers and the pairs. Namespace `capxul`,
project `capxul-next`.

## The task tree

```
K-1  Capxul rebuilt                         evals: ok:K-1 (aaron)                     owner: capxul/lead
├─ K-2  Spine                                evals: sys:*, three pilot operations      owner: capxul/build
├─ K-3  Area: payments                       evals: jrn:pay_someone, fun:pay_someone   owner: capxul/build
│  ├─ K-40 Design payment.send               evals: des:payment.send, doc:payment.send owner: capxul/design
│  └─ K-41 Build payment.send  needs K-40    evals: acc:payment.send/*, ret:, ref:*/…, evt:*, spn:, bud:*, rev:K-41
│  … one design task and one build task per operation
├─ K-9  Area: equity                         priority: low (off the critical path; directors and voting too)
└─ K-12 Live on staging                      evals: live:*                             owner: capxul/measure
```

**Labels:** `area:<area>` (the old book's 11 areas), `kind:design`,
`kind:operation`, `kind:journey`, `kind:system`.

**Priority:** the equity area, `org.director.*`, `org.board.*`, `org.vote.*`
and `vote.*` are `low`. Everything else is `normal`. The spine and its pilots
are `critical`.

## Managers

| Manager | Template | Room | Owns | Pairs (maker + checkers) |
|---|---|---|---|---|
| `capxul/lead` | lead | Slack `#capxul` | K-1 and the top-level tasks, their order, and the matters a person must decide | none: it delegates to the other managers |
| `capxul/design` | build | thread per task in `#capxul-design` | `kind:design` tasks | `designer` + `design-reviewer` |
| `capxul/build` | build | `#capxul-build` | `kind:operation`, `kind:journey`, `kind:system` | `builder` + `reviewer`; the machine evals are run by the engine |
| `capxul/measure` | build | `#capxul-measure` | the L4 evals, the old-system baseline, and regression tasks it opens itself | `scout` + `reviewer` for fixes; opens build tasks for others |

**Mission Control** is the Claude session started from
[`docs/mission/initializer.md`](../mission/initializer.md). It acts as
`capxul/lead` through the control plane until the lead manager runs on
swarmD, and then hands over to it.

There is no `verifier` worker. The pair engine runs the machine evals itself
and posts their verdicts, so a separate agent re-running checks adds cost and
no trust.

## Workers

| Worker | Model (tier) | Input | Result | Sandbox | Tools and grants |
|---|---|---|---|---|---|
| `designer` | strong | `{task, operation, book: <old record>, legacy: <paths>}` | via `submit`: a definition file, an evals file and the world it needs | repo + old repo read-only + legacy devnet | `run_evals` (`--target legacy`, to check claims against the old system), github read, posthog read |
| `design-reviewer` | strong, another family | via `check` | `approve` / `changes` with findings keyed to `des:` | repo | github read |
| `builder` | strong (`gpt-6.1-sol`) | `{task, goal, evals: EvalDef[], openFindings, handover?}` | via `submit` | repo + devnet | `run_evals`, git push to its branch, github read |
| `reviewer` | strong, another family | via `check`: version, diff or delta, findings, verdicts | `approve` / `changes` | repo | github read |
| `diagnoser` | strong | `{pair, signal, history: entries, findings}` | `{cause, kind, ripple, options, recommendation}` | repo read | ledger read |
| `researcher` | cheap | `{question, context?}` | `{answer, sources}` | repo + old repo read-only | posthog read, github read, web |
| `scout` | cheap; strong on a finding | `{evals: live:*, window}` | via `run_evals` (HogQL in the sandbox); opens tasks through the manager | posthog read | posthog read |

**"Another family" for checkers.** This follows the swarmD Zen: a checker
should run on a different model family from the maker. That needs a second
provider key: `ANTHROPIC_API_KEY`, which is a slot in swarmD today, or another
gateway model. [Decision for Aaron.]

## Connectors, secrets and egress

| Need | Used by | Connector or egress | Secret (swarmD Worker secret or egress credential) |
|---|---|---|---|
| Git host: clone, push, PR, merge, CI and ref events | all sandboxes, the managers | GitHub connector (built) or swarmD git | the GitHub App (exists), granted on the new repo |
| The old repo, read only | designer, researcher | GitHub connector, `sandbox.repo("github:Xelmar-tech/infrastructure#integration/factory")` | the App installed on that repo |
| PostHog: HogQL queries, events, insights | scout, designer, researcher (read); the measure manager (writes the generated funnels later) | a PostHog connector: tools generated from PostHog's OpenAPI, as GitHub's are; granted per method pattern | `POSTHOG_PERSONAL_API_KEY`, and project ids for the old staging and production and the new staging |
| Slack: the managers' rooms | managers | Slack connector (code only today); connect the app | Slack app tokens |
| Chain: Base Sepolia RPC for the devnet fork and staging | sandboxes | egress | `BASE_SEPOLIA_RPC_URL` (an Alchemy key) |
| Bundler and paymaster | sandboxes (devnet uses a mock), staging | egress | the provider key the stack decision picks |
| Bridge sandbox (banking) | sandboxes for the banking operations | egress | `BRIDGE_SANDBOX_API_KEY` |
| Email | devnet uses the mail sink; staging uses Resend | egress | `RESEND_API_KEY` (staging only) |
| Hosting for the stack | managers' `deploy` | the Cloudflare API or Convex deploy, per C1 | `CLOUDFLARE_API_TOKEN` or `CONVEX_DEPLOY_KEY` |
| npm, pnpm, foundry | sandboxes | egress to the registries | none |

**Linear is not used.** The ledger is the tracker. [Confirm with Aaron.]

## The devnet in a sandbox

This is a risk on the critical path. Every machine eval runs on a devnet: anvil
forking Base Sepolia, the v4 contracts, the backend, the indexer, a mock
bundler and the mail sink. A Cloudflare container must hold it, or reach it.
The first task of the spine (K-2.1) is a **spike**. Boot the devnet in a
`standard-3`-or-larger sandbox from a golden snapshot, restore a world, and run
one `acc` eval. Measure the boot time and the time per eval.

- **Exit:** boot takes ≤ 2 min from the snapshot, and an L1 eval takes ≤ 10 s.
- **If it fails,** the fallback is one long-lived devnet host per project,
  outside the sandboxes, with a world restored per pair under a lock.

## Prompt skeletons

These are appended to swarmD's built-in role prompts. Each is short. Its rules
are assumptions to test and delete (Zen rule 6).

**`capxul/lead`**

```md
You answer for K-1: Capxul rebuilt behind the frozen CLI and book, measured by its evals.
- Keep the critical path moving: order top-level tasks by `needs`, keep the low-priority areas off it.
- Child managers own their tasks. You act on what bubbles up: signals they could not settle, matters for a person.
- Bring Aaron only product or architecture decisions, irreversible steps, and what only he can do. Each as a matter with options and a recommendation.
- Never report "tried N times". Report the diagnosis and what happens next.
```

**`capxul/build`**

```md
You turn operation tasks green. One pair per task: builder + reviewer. The engine runs the machine evals.
- Open a build task only when its design task is done.
- On a signal, choose the cheapest action that changes the outcome: a fresh maker, a diagnosis, or a split. Raise a matter only when none fits.
- Merge only what the engine marks converged. Deploy the devnet after each merge to integration.
```

**`designer`**

```md
Turn one operation from the old book into its definition and evals.
- The book record's command, returns, refusals and acceptance text are frozen: copy them, never improve them.
- Run every claim against the old system (`run_evals --target legacy`). A claim the old system fails is a finding: say whether the claim or the old system is wrong.
- Fill events, spans and budget by the rules in docs/decisions/measurement.md and budgets.md.
```

**`builder`**

```md
Make the task's evals pass. They are the definition of done: choose the steps yourself.
- Write the operation as named steps in its entry file. Put the detail in its kind files.
- Run `run_evals` before you submit. L0 must pass, or the engine returns your submission.
- Address every open finding, or say in `submit` why it is wrong. Never weaken an eval.
```

**`reviewer`**

```md
Check one version against the task's evals and the repository rules. Change nothing.
- From round 2 you see only the delta: say which earlier findings are fixed.
- A blocking finding names the eval it threatens, or the rule it breaks, and where.
- Approve when nothing blocking remains. Style preferences are advisory.
```

## Proof that the team works

The pilot is the spine's three operations, designed and built end to end on
swarmD:
- each task is `done` on `integration`
- its timeline shows every assignment, round and cost
- the artifact shows the scoreboard live
- no person acts except to answer matters

That is the exit of K-2.
