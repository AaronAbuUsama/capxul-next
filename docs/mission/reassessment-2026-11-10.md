# Reassessment, 10 November 2026, evening

Aaron asked what the previous coordinator's threads were doing, why there was no proper observability of the durable
agents, and what it takes to restart. Every line here was read from the records: the two sessions' transcripts and
worktrees, `var/runs`, the branches and the plan. Nothing was restarted.

## What was in flight

| Item | What it was building | How far it got | Recommendation |
|---|---|---|---|
| Session "Run observability in the portal and loop DX" (`.claude/worktrees/run-observability-30638e`) | The Runs app (`packages/loop-ui`), the loop's host, evidence (recorded commands, screenshots, claims in the structured output) | **Merged** up to `0f03218`. **Uncommitted** (19 files, saved to `var/stranded/run-observability-30638e.patch`, applies cleanly): notes sent to a running agent and queued for it, a Stop confirm bar, a fix for a real bug (Stop left a recorded command running, so the run did not end), a `door` module. The Stop fix was not retested and the full checks were not run | **Fold** into `m1-loop-steer-stop`, done here. Do not restart the session |
| Session "Agents roll-up" (`.claude/worktrees/agents-rollup-91c899`) | Aaron's roll-up: agents created in the UI, code mode, the PostHog MCP, enrichment agents, datasets. Slice 1 is the keystone: an agent as a record | **Nothing merged.** Slice 1 is **uncommitted** (18 files plus `loops/agents/` and `modules/definitions`, saved to `var/stranded/agents-rollup-91c899.patch`); the loop's tests passed in its worktree, the other checks were not run. It conflicts with the new command policy (`be9a917`) in 2 places | **Fold** into `m1-agent-definitions`, after the watched run. Slices 2 to 5 (code mode, PostHog, enrichment, datasets) stay unwritten until then |
| 23 loop runs of 10 November | 11 tasks | 9 tasks merged, plus `m1-entry-docs` merged tonight (`58a0f58`). `m1-old-decisions-11101649` is ready but rewrites Aaron's rulings | Split `m1-old-decisions` (his rulings to Questions); retire the rest in `m1-loop-visibility` |
| Branches `kept/…` (3), `attempt/m1-dev-commands-1`, `lane/tidy-2`, `lane/tidy-blueprint-v1` | Unmerged work of refused or replaced runs | 1 to 4 commits each, all superseded by merged runs | Leave until the visibility task retires runs, then delete with a look |
| Worktrees `lane/examples`, `lane/loop`, `lane/tidy-3`, `var/runs/m1-dev-commands-11101323/lane` | Merged branches | One stray file in each of the first two | Remove after a look |

## Why the coordinator could not see inside the agents

The data was always there. Each refused call and each model failure is an entry in the run's own storage
(`var/runs/<run>/run.sqlite`), and the run detail counts them per agent (`AgentUsage.refused`, `.errors` in
`packages/loop/src/modules/inspect/types.ts`). Nothing added them up:

- `pnpm loop status` and the Runs page's list (`/runs/summary.json`) carry a status, a round and a token count per run,
  and nothing about refusals or failures. A run with 28 refused calls of 86 looked the same as a clean one.
- Nothing marks a run superseded, so failed and stopped runs of finished tasks stayed on the "needs you" list.
- Nothing tells the coordinator when a run ends or goes wrong. The sweep is meant to be woken by runs, and nothing wakes it.
- The previous coordinator read statuses and diffs, never the conversations.

## What has to exist to run and watch durable agents from the portal

1. **Health in the summary** (`m1-loop-visibility`): refused calls and model failures per run in `loop status`, in its
   json, and on the Runs page, plus superseded runs retired.
2. **Control from the page** (`m1-loop-steer-stop`): Stop that really stops, and notes to a running agent.
3. **Being told** (`m1-loop-watch`): `pnpm loop watch` prints a line per event (start, end, refusal, model failure, a
   refusal rate over one in twenty), so the coordinator is woken instead of polling.
4. **One watched run** (`m1-loop-watched-run`), with Aaron's go-ahead: under one refusal in twenty, no model failure,
   ready in one round.
5. **A measured gateway** (`m1-model-gateway`): one OpenAI account behind the proxy failed at three agents.
6. **Agents as records** (`m1-agent-definitions`): what an agent is, in one file, so they can be made and listed in the UI.

Done tonight: the command policy (`m1-loop-policy`, `be9a917`). Of the 226 refused calls, 203 are allowed now, and 23
are refused with a reason that says what to do instead.
