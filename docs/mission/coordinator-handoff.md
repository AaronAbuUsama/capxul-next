# Coordinator handoff, 10 November 2026

Written by the coordinator session that ran 9 and 10 November, for the coordinator that takes over. Aaron asked for a
clean handoff: everything open is listed here with where it stands and what it needs. The plan is still the source of
truth; this page is the part the plan does not hold.

**Read `docs/mission/post-mortem-2026-11-10.md` before starting a loop run.** One tool call in five was refused by the
loop's own policy, the agents' instructions are for a system that no longer exists, and the one account behind the
local proxy failed at three agents. Do not start a batch until the first three changes in that page are made.

**Everything is stopped**, on Aaron's instruction at the end of 10 November: no loop run, no host, no portal, and the
turns of the two working sessions (run-observability, agents-rollup) were stopped. Start nothing until he says so.

## Start

```bash
pnpm plan show          # the goal, the critical path, every task
pnpm loop status        # every loop run and how it ended
```

Then read `CLAUDE.md`. Work on `integration/build` (push freely, never force, never push `main`).

## Where it stands

| | |
|---|---|
| Branch | `integration/build`, pushed, every check passing at the time of writing |
| Blueprint | 2,646 records, 0 problems, 20 open gaps, 127 standing on a recorded reason |
| Plan | Milestone 1 of 6. 36 tasks done, 18 to do, 2 blocked, 1 in progress |
| Scoreboard | 8 evals bound to a check that runs, of about 5,175. This is the weak spot |
| Loop | Finished 9 tasks on 10 November, all reviewed and merged by hand |
| Machine on AWS | Up and idle (`worlds-host-ireland`); nothing deployed |

## Open, and whose move it is

| Item | State | Needs |
|---|---|---|
| `m1-entry-docs` | Run ready, **not merged**. Branch `lane/m1-entry-docs`, run `m1-entry-docs-11101507` | **Aaron's yes or no.** It rewrites `CLAUDE.md`'s banner and replaces `START-HERE.md` with a one-page entry (the original kept whole in `archive/`). Blocked on him in the plan, so it is a card in Questions |
| `m1-old-decisions` | Run ready after three rounds, **held**. Branch `lane/m1-old-decisions`, run `m1-old-decisions-11101649`, 30 files | **The coordinator's review.** It rewrites Aaron's own rulings in `blueprint/shared/rulings.ts` (new chosen option, new source, dated 11 November). Only Aaron changes a ruling of his. Split it: merge what is not his; bring him each ruling it would change, before and after. It conflicts with `integration/build` in `blueprint/shared/index.ts` |
| `m1-run-observability` | In progress in the session "Run observability in the portal and loop DX" (worktree `.claude/worktrees/run-observability-30638e`). It started a second session, agents-rollup ("Agents roll-up: definitions, code mode, PostHog, enrichment"), whose first slice is **uncommitted** in its worktree on `claude/agents-rollup-91c899`. Both sessions are stopped and waiting for Aaron's word | Asked for next, in order: the steer and queue box wired and Stop tested from the page; the portal rebuilding its generated pages when the plan or blueprint changes. Its latest finding: the missing keystone is an agent definition as a record |
| `m1-model-gateway` | The loop's default gateway is the CLI proxy on this Mac (`http://127.0.0.1:8317/v1`, VibeProxy, no key). Not done: a ramp test for the ceiling, the gateway as a blueprint record | A key for Capxul's hosted CLI proxy (`cliproxy.capxul.com`) in `~/.zshenv` as `CLIPROXY_API_KEY`, for runs on another machine. Aaron has not supplied it |
| `m1-loop-hardening` | Not started as a task; many fixes landed through the observability session | A lane still cannot prepare what a task's checks need (the spike's dependencies, its secret, the test sites). This blocks the next two |
| `m1-eval-coverage`, `m1-time-proof` | Not started | Both need the loop to run the spike and its Docker sites in a lane |
| The remaining 20 gaps | 9 `unproduced-error`, 6 `no-acceptance`, 5 `refusal-without-world` | A small loop task; no task exists yet |
| Evidence in hand-backs | Merged (`packages/loop/src/modules/evidence`, decision `loop.evidence`) | No real model has used the tools yet; watch the first run that does. Not decided: which evals need a capture to pass |
| Takeover brief for a "Claude project" | Aaron asked for the work to move to a Claude project that owns the hill climb and the merging | He has not said whether that is a new session in this repository or something else. This page is the brief |
| Key rotation | The CLI proxy key pasted on 8 November | Aaron rotates it after milestone 1 and gives a heads-up first. No loop run may be in flight then |

Critical path as written in the plan: `m1-loop-hardening`, `m1-eval-coverage`, `m1-time-proof`, `m1-old-decisions`,
`m1-entry-docs`, `m1-aaron-accepts`. Beside it: the first shared world on the machine (milestone 3b), not started.

## The merge routine

A run that says ready is a report, not proof. For each one:

1. Read the diff (`git diff integration/build...lane/<task>`). Look for work that satisfies the words of the task and
   not its point: boilerplate reasons, removed content, a rule weakened to pass.
2. Merge without committing, or on a side worktree when the main checkout must not move.
3. Run every check: `pnpm check`, `pnpm test`, `pnpm exec tsc -p blueprint`, `pnpm blueprint` (0 problems),
   `pnpm frozen` (0 breaches), `pnpm contracts:check-blueprint`, `pnpm portal:check`, `pnpm loop:test`.
4. Commit, `pnpm plan task done <id> --evidence <commit>`, set the path again if a path task was closed, push.
5. `pnpm loop clean <run>`.

A change to `CLAUDE.md`, or to one of Aaron's rulings, is shown to him first, as a diff.

## Running the loop

```bash
source ~/.zshenv
LOOP_MAX_AGENTS=3 pnpm loop run <task id> --timeout-min 60     # one run; several in parallel as separate processes
pnpm loop show <run id> --json                                 # what happened inside
```

- Gateway: the local proxy is the default. It did **not** run clean at three agents: two of four runs had 8 and 6
  failures, "no auth available", because its one OpenAI account was cooling down. Seven agents through the old LiteLLM
  gateway made its container unreachable. The account is shared with Aaron's own tools.
- Models: any model the gateway lists (Aaron, 10 November). `gpt-6.1-sol` builds and `gpt-6.1-terra` reviews by default.
- `pnpm loop work --task …` resumes a task's stopped or failed run. If that run's lane was cleaned, it fails; use
  `pnpm loop run <task>` for a fresh run.
- Start each run in the background and review when it ends. Do not start a run on a task that is already in flight.

## Processes this session owned

They were started from the session's launcher and may stop with it. To bring them back, from `.claude/launch.json`:

| Name | What | Port |
|---|---|---|
| `portal` | The generated portal and the answers endpoint. Run `pnpm portal` first to regenerate the pages; they do not rebuild by themselves | 4391 |
| `host` | The loop's host: the live Runs pages under `/runs/`. Run `pnpm --filter @capxul/loop-ui build` first | 4392 |

Aaron reaches both at `https://macbook.tail4b9a40.ts.net:8443` (tailnet only; port 443 of that name is his own public
share and must not be touched). His answers are saved to `plan/answers.jsonl`; `pnpm plan answers` lists the ones to
apply. Add an accepted decision to `ACCEPTED` in `blueprint/shared/rulings.ts` **before** running
`pnpm plan answers apply`, or the plan check fails.

## What Aaron has ruled, that is easy to get wrong

- He signs off visual designs himself. Do not accept one for him: one was accepted for him on 10 November and he
  called it really bad.
- An answer of his is recorded only when he gives it, on the real portal or in his own words. A relayed sentence from
  another session is checked against what he actually wrote.
- Questions for him belong in the plan as blocked tasks, so they are cards in Questions, with the code shown first
  (his global instructions). Lead with one recommendation.
- Report when an exit condition is met, the score moves, or he is needed. He asked for fewer updates.
- No IAM users or keys, nothing opened to the internet, his live front door and existing cloud untouched.
- The cost audit is a separate session's; do not relay it.

## Left behind, on purpose

| Thing | Why it is still there |
|---|---|
| Branches `kept/m1-gaps-contracts-11101507`, `kept/m1-old-decisions-11101555`, `kept/m1-thin-line-journey-11101507` | Unmerged work of runs that were refused or replaced; the loop keeps it when a lane is cleaned |
| Branches `attempt/m1-dev-commands-1`, `lane/tidy-2`, `lane/tidy-blueprint`, `lane/tidy-blueprint-v1` | Superseded; nothing unmerged that matters, not deleted without a look |
| Worktrees `.claude/worktrees/agent-acbc44ab48a759e46` (`lane/examples`) and `agent-ad4ba6461c6d0ffa6` (`lane/loop`) | Their branches are merged, but they hold modified or untracked files, so they were not removed by force |
| The lane of `m1-dev-commands-11101323` under `var/runs/` | Merged; `loop clean` said there was nothing to clean but the worktree remains |
| `packages/loop/examples/` (untracked) | Written by another agent Aaron was working with on the workflow DX; not this session's |
| `var/leftover/tools/explorer/book.json` | A 2.8 MB generated export from the old explorer, moved out of the top level |
| The AWS machine | Idle at about $84 a month. Its certificate for `worlds.capxul.com` runs to 8 February 2027; renew by about 9 January |

## What this session learned, worth keeping

- A run's own verdict was right most of the time, and the reviewer (Terra) refused weak work correctly three times.
  The diffs still had to be read: one ready run rewrote the owner's rulings.
- Stopping runs to "save rounds" on a guess cost more than it saved. Look inside a run (`loop show`) before stopping it.
- Parallel lanes shared one build output folder until the build was moved to `var/blueprint`. Anything a lane writes
  must be inside the lane.
- The generated portal is stale between builds. Rebuild it before telling Aaron to look.
