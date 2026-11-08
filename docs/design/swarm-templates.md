# The swarm's templates: every artifact an agent produces

[`docs/design/swarm.md`](swarm.md) designs how the build runs and the schemas of everything that flows in it (its
section 4). This page gives every artifact an agent produces **one template**, field for field against those schemas,
so that nothing is freestyled: the task brief a maker reads, the submit and handover it returns, the pull request, the
check and its findings, the agent verdicts, a question, a diagnosis, a research answer, the master's decisions, matters
and the tasks it opens by hand, the cards and comments code posts, the board, and the team's own definitions on swarmD.

The files that carry the templates:

| File | Holds |
|---|---|
| this page | every template, its schema, who fills it and where it lands; the team as swarmD declares it |
| [`.github/pull_request_template.md`](../../.github/pull_request_template.md) | the task's pull request: the Handback (section 3.3) |
| [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE/) | the review answer, the decision pack, the defect, and one task card per kind that gets a pair (sections 7 and 8) |
| [`.claude/agents/`](../../.claude/agents/) | the six roles as Claude Code profiles for stage 0 (section 11) |
| [`docs/spec/40-capxul-team.md`](../spec/40-capxul-team.md) | the team in short, and what this design replaced |

Every judgment here is a decision record in [`books/target/shared/swarm.ts`](../../books/target/shared/swarm.ts)
(section 13). The swarmD pieces each template relies on are marked **built**, **planned** (in swarmD's docs, which since
swarmD #91 are its specification) or **needed** (in neither: a brief, SD-1 to SD-20 and SD-26 to SD-28 in swarm.md section 7, and
SD-21 to SD-25 in section 12 here). Where swarmD's docs and its code differ, the template follows the docs and says what runs
today.

## Contents

0. [Rules every template follows](#0-rules-every-template-follows)
1. [Inventory](#1-inventory)
2. [What a worker receives](#2-what-a-worker-receives)
3. [The maker's output: submit, handover, pull request, commits](#3-the-makers-output-submit-handover-pull-request-commits)
4. [The checker's output: check, findings, agent verdicts](#4-the-checkers-output-check-findings-agent-verdicts)
5. [A question](#5-a-question)
6. [The diagnosis and the research answer](#6-the-diagnosis-and-the-research-answer)
7. [The master's output: decide, matters, review answers](#7-the-masters-output-decide-matters-review-answers)
8. [Tasks opened outside the plan, and task cards](#8-tasks-opened-outside-the-plan-and-task-cards)
9. [What code renders: status card, mirror comments, board, room](#9-what-code-renders-status-card-mirror-comments-board-room)
10. [The team on swarmD](#10-the-team-on-swarmd)
11. [The Claude Code profiles (stage 0)](#11-the-claude-code-profiles-stage-0)
12. [Briefs for swarmD this page adds](#12-briefs-for-swarmd-this-page-adds)
13. [The decisions](#13-the-decisions)
14. [Open items for other owners](#14-open-items-for-other-owners)

## 0. Rules every template follows

These hold for every artifact below (`swarm.templates`).

1. **One artifact, one template, one schema.** A template's fields are its schema's fields from swarm.md section 4, in
   the same order and with the same names. A field the schema lacks is not added; a field swarmD's docs lack is marked
   needed and named by its brief.
2. **A GitHub body is the schema rendered.** Each field sits under a fixed heading, `### <Label>`, in schema order; a
   list field holds one item per line (`- <item>`, or a bare line in an issue form); an empty optional field is
   `_none_`. An issue form renders exactly this, so an issue a person fills in and one Mission Control writes through
   the API parse alike, by heading.
3. **A worker's answer is one typed message.** At stage 0 a worker's last message is its message as one fenced `json`
   block, and nothing after it; Mission Control reads only that block. At stage 1 the same object is the arguments of
   the worker's tool call (`submit`, `handover`, `check`, `ask`) or its typed result (the diagnosis, the research
   answer). The rendered forms below are what people read; the JSON is what counts.
4. **Limits are the schemas'.** Title 80 characters, goal 1,000, submit note 600, handover 1,500 rendered, finding 600,
   a verdict's detail 600, a question 400, an entry's summary 200, a brief's context 4,000. Over a limit is refused,
   by the engine at stage 1 and by Mission Control at stage 0, never cut silently.
5. **Ids verbatim.** Eval ids, task keys, record keys, decision ids, finding, pair, matter and task ids exactly as the
   ledger or the book writes them, in backticks in prose. A commit is 40 hex characters in JSON and its first 7 in
   prose. Times are ISO 8601 in UTC. Money is `$1.84`.
6. **Words.** Plain English, one claim a sentence. Report what a run printed, with the command; a claim no eval checks
   is unproven. Never "tried N times": a diagnosis and what happens next. No praise and no apology.
7. **Nothing secret.** No token, key, password or cookie in any body, message or block; a person is their GitHub login
   or ledger member, an environment variable is its name only.
8. **Workers ask the manager, never a person.** A worker's question goes to `manager` (or `pair`); only the master
   raises a matter, and only for the goal prompt's four kinds (`swarm.escalation`).

## 1. Inventory

| # | Artifact | Written by | Schema (swarm.md) | Template | Stage 0: lands in | Stage 1: lands in |
|---|---|---|---|---|---|---|
| 1 | Task brief | Mission Control; the engine | `MakerInput` 4.5 | 2.1 | the builder's prompt | the maker's pair input |
| 2 | Checker's input | Mission Control; the engine | `CheckerInput` 4.5 | 2.2 | the checker's prompt | the checker's pair input |
| 3 | Diagnoser's and researcher's input | Mission Control; the engine, `assign` | 4.8; own schema | 2.3 | the prompt | the role or assignment input |
| 4 | Submit | builder | `PairMessage` submit, `Handback.submit` 4.6 | 3.1 | json block | `submit` tool |
| 5 | Handover | builder | `Handback.handover` (typed: SD-20) | 3.2 | json block, PR body | `handover` tool |
| 6 | The task's pull request | builder | `Handback` 4.6 | 3.3, `pull_request_template.md` | GitHub | GitHub |
| 7 | Commits, branch, merge commit | builder; the merge | — | 3.4 | git | git |
| 8 | Check | reviewer, adversary | `PairMessage` check 4.5, `Finding` 4.7 | 4.1 to 4.3 | json block | `check` tool |
| 9 | Agent verdict (`des:`) | reviewer | `Verdict` 4.7 | 4.4 | json block, PR comment | `check.verdicts` (SD-21) |
| 10 | Question | any worker | `PairMessage` question | 5 | json block | `ask` tool |
| 10a | Progress | any worker | the `progress` tool's `{ now, done, next }` | 5.1 | none: Mission Control writes the status card | `progress` tool |
| 10b | The master's answer to a question | master | `decide` continue, until SD-25 a thread post | 5.2 | the `ANSWER` comment on the pull request | a `post` in the task's thread |
| 11 | Diagnosis | diagnoser | `Diagnosis` 4.8 | 6.1 | json block | the role's result |
| 12 | Research answer | researcher | its own result | 6.2 | json block | `report ready` result |
| 13 | Decide | master | `DecideAction` 4.8 | 7.1 | PR comment, card | `decide` tool |
| 14 | Matter, decision pack | master | `Matter` 4.9 | 7.2, `decision-pack.yml` | a GitHub issue | a ledger matter, the room |
| 15 | Matter resolved | master (applying an answer) | `Matter.resolution` | 7.3 | issue comment, closed | `matter_resolve` |
| 16 | Review answer | the reviewer of a decision, on the portal | `ReviewAnswer` (portal.md) | 7.4, `review-answer.yml` | a GitHub issue | a GitHub issue; later a matter (SD-23) |
| 17 | Review task | master | `TaskDef` 4.2, kind review | 8.2, `task-review.yml` | a task card | a ledger task |
| 18 | Defect task | master; a person | `TaskDef` 4.2, kind defect | 8.1, `defect.yml` | a task card | a ledger task |
| 19 | Task card | Mission Control | `TaskDef` 4.2 and `TaskBrief` 4.3 | 8.3, `task-<kind>.yml` | a GitHub issue, for a task that gets a pair | none: the ledger task and its room thread |
| 19a | A split's children | master (`decide` split) | `TaskDef` 4.2, key `<parent key>/split-<n>` | 8.4 | task cards | ledger tasks opened by the split |
| 20 | Status card | Mission Control; the chat template | `PairView` 4.10 | 9.1 | the card's first comment | the task's thread |
| 21 | Mirror comments | Mission Control; code (SD-13) | `PairMessage`, `Signal`, the gate, the merge | 9.2 | the pull request | the pull request |
| 22 | The board | swarmD (code) | `ManagerState` 4.10 | 9.3 | — | the artifact (web, Slack, Pi) |
| 23 | Room messages | master | `post` | 9.4 | the session's reply | the room |
| 24 | Promotion pull request | master | — | 3.5 | GitHub | GitHub |
| 25 | Progress line | Mission Control | — | 9.5 | `docs/mission/progress.md` | — |
| 26 | The team's definitions | the build, at stage 1's entry | swarmD's `defineManager`, `defineWorker` | 10 | — | `.swarmd/` |

## 2. What a worker receives

A worker's input is not freestyled either: Mission Control (stage 0) and the engine (stage 1) build it from the plan,
the book and the pair, never from memory. At stage 0 the prompt is the rendering below followed by the exact input as a
`json` block; when they disagree, the block wins. Each brief's fields come from the sources in swarm.md section 4.3
(`brief`: `record` and `paths` from the `TaskDef`, `decisions` from the decision records that affect the record,
`context` the portal page and the record's `was`).

### 2.1 The task brief (`MakerInput`)

```md
# Task `operation:payment.send`: payment send: Send a payment
Round 2 of at most 5 · budget $5.00, spent $2.10 · target integration/build · branch lane/payments · PR #57
Revise: changes. The reviewer asked for changes at e7f8a9b: 2 blocking findings.

## Goal
`capxul payment send` does what operation payment.send promises: its 9 acceptance claims and 9 refusals hold, …

## Evals
Done when every one passes at the head of integration/build. You never change one.
| Eval | Decider | Claim | Last seen |
|---|---|---|---|
| `acc:payment.send/1` | machine | A signed personal payment is sent once and records its one Payment. | pass at e7f8a9b |
| `ref:payment.send/INSUFFICIENT_BALANCE` | machine | … | fail at e7f8a9b |
| `des:payment.send` | agent | its record is complete and consistent with the old book and the old behaviour | unknown |
| … 35 more | | | |

## Brief
- Record: `operation:payment.send` (books/target/payments/operations.ts)
- Paths you may change: books/target/payments/, packages/backend/src/payments/, packages/sdk/src/payments/
- Decisions that settle it: `payments.birth-width`, `payments.prepare-command`, `payments.dated`
- Out of scope: _none_
- Context: portal page operation/payment.send; was: apps/backend/convex/payments/send.ts

## Open findings
- F-12 blocking `ref:payment.send/INSUFFICIENT_BALANCE` at packages/backend/src/payments/commands.ts:88: Seen: exit 1 and
  INTERNAL. Expected: exit 4 and INSUFFICIENT_BALANCE. Fix: map the balance read's shortfall to the declared error.
- F-13 …

## Handover from the last maker
Done:
- …
Left:
- …
Decisions:
- …
Where:
- …
```

| Line | From |
|---|---|
| Heading | `task.title`; the key from the task's `key:` label |
| Round, budget, target | `round`; `PairSettings.maxRounds`; the task's `budgetUsd` and the pair's `spentUsd`; `task.target` |
| Branch, PR | the pair's branch and bound pull request (needed: SD-24) |
| Revise | `revise.reason` and `revise.detail` (needed: SD-20); absent in round 1 |
| Goal | `task.goal` |
| Evals | `checks[]`: `id`, `decider`, `claim`, `lastSeen` |
| Brief | `task.brief` (needed: SD-3) |
| Open findings | `openFindings[]`, each rendered as in 4.2 |
| Handover | `handover`, the four parts of 3.2; absent in round 1 |

### 2.2 The checker's input (`CheckerInput`)

```md
# Check `operation:payment.send` at e7f8a9b, round 2
You are the reviewer | the adversary. Delta review: read `git diff b4c5d6e..e7f8a9b`, plus whether each open finding is fixed.

## Goal
…
## Evals
| Eval | Decider | Claim | Verdict at e7f8a9b |
|---|---|---|---|
| `acc:payment.send/1` | machine | … | pass |
| `ref:payment.send/INSUFFICIENT_BALANCE` | machine | … | pass |
| `des:payment.send` | agent: you post it (reviewer only) | … | — |

## Brief
(as in 2.1)

## Open findings
(as in 2.1)

## The maker's note
Changed: … Should move: … Ran: … Disputes: …
```

| Line | From |
|---|---|
| Heading | `task.id` and its key, `version`, the round |
| Delta | `diff.from` (the version it last checked) and `diff.to`; round 1 has no `from` and reads the whole change from the task's base |
| Evals | `task.checks` with the catalogue's claims and `verdicts[]` (`check`, `result`, `detail`) |
| Brief | `task.brief` (SD-3) |
| Open findings | `openFindings[]` |
| Note | the round's `submit.note` |

The adversary's input is the same, and also lists the money-path files the delta touches, which it reads whole
(`swarm.money`, swarm.md 6.2).

### 2.3 The diagnoser's and the researcher's input

The diagnoser gets the pair, the signal and its history (its role's input, planned). At stage 0, and in today's API
(section 10.3), it is this object:

```json
{
  "task": { "key": "operation:payment.send", "title": "payment send: Send a payment", "goal": "…", "brief": { "record": "operation:payment.send", "paths": ["books/target/payments/"] } },
  "pair": { "round": 3, "state": "signalled", "spentUsd": 2.6, "budgetUsd": 5 },
  "signal": { "kind": "round", "round": 3 },
  "history": ["r1 submit b4c5d6e: …", "r1 check reviewer changes: F-7, F-8", "r2 submit e7f8a9b: addresses F-7, F-8", "…"],
  "findings": [],
  "verdicts": [],
  "handovers": ["Done: … Left: … Decisions: … Where: …"]
}
```

The researcher's input is its own schema (section 10.3): `{ "question": "…", "context": "…", "task": "operation:payment.send" }`.
A question is one sentence ending in `?`; `context` holds facts and links, never the answer the asker hopes for.

## 3. The maker's output: submit, handover, pull request, commits

A maker never reports done: verdicts do (`swarm.handback`). What it returns is the **Handback** (swarm.md 4.6): a
submit, its pull request, a handover and its own run. At stage 0 the builder's json block is the whole Handback, with
the handover in every round, because a Claude subagent ends with its answer and cannot be asked for one afterwards
(Mission Control uses it only if another round follows); in today's API it is the builder's `result`. At stage 1 it is
two tool calls: `submit { addresses, note }` (the engine adds the version, `pr` comes from the binding and `ran` from
the sandbox's summary) and, when the engine asks between rounds, `handover`.

```json
{
  "submit": {
    "version": { "kind": "commit", "repo": "AaronAbuUsama/capxul-next", "commit": "e7f8a9b0c1d2e3f405162738495a6b7c8d9e0f12" },
    "addresses": ["F-12", "F-13"],
    "note": "Changed: commands.prepare maps a balance shortfall to INSUFFICIENT_BALANCE before it builds the operation. Should move: ref:payment.send/INSUFFICIENT_BALANCE, acc:payment.send/3. Ran: 36 pass, 0 fail, 2 unverifiable, 0 error (npm run --silent eval -- run --json -- <task evals>). Disputes: none."
  },
  "pr": 57,
  "handover": {
    "done": ["commands.prepare refuses a shortfall with INSUFFICIENT_BALANCE (ref:payment.send/INSUFFICIENT_BALANCE pass in my run)"],
    "left": ["acc:payment.send/9 is unverifiable: the devnet's Board fixture has no executed proposal yet (B3 world)", "outside packages/devnet/: the world 'board-executed' is missing"],
    "decisions": ["payments.birth-width: kept the one-transaction birth"],
    "where": ["packages/backend/src/payments/commands.ts:72 the shortfall check", "packages/sdk/src/payments/pay.ts:40 the follow step"]
  },
  "ran": { "pass": 36, "fail": 0, "unverifiable": 2, "error": 0 }
}
```

### 3.1 Submit

| Field | Rule |
|---|---|
| `submit.version` | the commit the maker pushed to its branch; at stage 1 `submit` commits and pushes the head and fills it |
| `submit.addresses` | open findings it claims to fix; the engine refuses one that is not open |
| `submit.note` | at most 600 characters, in four labelled parts, in this order: `Changed:` one or two sentences, what changed; `Should move:` the eval ids it expects to pass now; `Ran:` its own counts and the command; `Disputes:` each finding it thinks wrong, `F-n (why, one sentence)`, or `none` |
| `pr` | the task's pull request, opened at the first submit |
| `ran` | its own `run_evals`, for information only: the verdicts that count come from the sandbox |

### 3.2 Handover

The `handover` part is rendered as the `handover` tool's `text` (at most 1,500 characters) until SD-20 types it, in
exactly this layout:

```text
Done:
- <what is built, with the evals it passed in its own run>
Left:
- <what is not, and why>
- outside <path>: <what is needed there>
Decisions:
- <decision record id or matter id>: <what it settled, one line>
Where:
- <path>:<line> <why to look there first>
```

| Part | Rule |
|---|---|
| `done` | what is built, each with the evals its own run passed; never "done" without an eval |
| `left` | what is not, and why. Empty only when the maker believes every eval passes (SD-20 refuses an empty `left` on a round that is not final). Something needed outside the task's paths is a line `outside <path>: <what>`: the checker turns it into an advisory finding there, which the master opens as a defect (`swarm.findings`). A task never grows |
| `decisions` | each a decision record id (an existing one it followed, or the one it added, book first) or a matter id; nothing settled only in prose |
| `where` | files and lines to look at first, at most 6 |

### 3.3 The task's pull request

One per task, from its branch into `integration/build`, opened by the builder at its first submit and updated (title and
body) at every submit; the template is [`.github/pull_request_template.md`](../../.github/pull_request_template.md).

- **Title:** `[<key>] <task title>`, for example `[operation:payment.send] payment send: Send a payment`.
- **Body:** the Handback, in this order:

| Heading | Holds | From |
|---|---|---|
| (the first lines) | `Task:` the key and the ledger id; `Round:` the round, head, spend; `Checkers:`; `Task card:` (stage 0) | the brief |
| `## Submit` | `Version`, `Addresses`, `Note` | `submit` (3.1) |
| `## Evals` | one row per task eval: id, claim, its own run; then its own counts and command | `MakerInput.checks`, `ran` |
| `## Handover` | `### Done`, `### Left`, `### Decisions`, `### Where` | `handover` (3.2) |
| `## Book first` | records and decision records changed in the concept's folder, or "No record changed"; whether `tasks.json` was regenerated; the four book checks with what they printed | the maker's own run |
| `## Findings` | each finding open at the round's start: `fixed:` how, or `disputed:` why | `addresses`, `Disputes` |
| `## After merge` | evals that came back `unverifiable`, each with why; they do not block (D7), and a person on `waive` may waive them | the sandbox's verdicts; the maker's run at stage 0 |

The body holds only what the maker writes. Everything else on the pull request (each round's gate, evals, checks,
signals, decisions and the merge) is a mirror comment (9.2), and the status card is on the task card or the room thread.
A person's comment on the pull request reaches the current maker as steering (built, T12 `bind`), and the maker answers
it in its next submit's note.

### 3.4 Commits, branches and the merge commit

- **Branch** (`swarm.branches`): `lane/<concept>` for a lane task, cut from the head of `integration/build` when its pair
  starts and deleted at the squash merge; `lane/integrations`; `lane/journeys`; `ms/<step>` with the step's key after
  `step:`, lower case (`ms/b1.data`); `review/<decision>`. A defect uses its lane's branch. A fresh maker continues on
  the same branch.
- **A maker's commit:** subject `<lane or step>: <what changed>` (at most 72 characters), a body only if a reason does
  not fit, and the trailers `Task: <key>` and `Round: <n>`. Commit as often as useful; push once per submit (each push
  is a round's version).
- **The merge commit** (written by code at the merge, stage 1; by Mission Control at stage 0), squash:

```text
[operation:payment.send] payment send: Send a payment (#57)

Changed: commands.prepare maps a balance shortfall to INSUFFICIENT_BALANCE before it builds the operation.

Task: operation:payment.send
Ledger-Task: K-212
Pair: P-44
Rounds: 2
Cost-Usd: 1.84
Evals: 37 pass, 0 fail, 1 unverifiable
Approved-By: reviewer#9 (anthropic/claude-sonnet-5-5), adversary#3 (anthropic/claude-sonnet-5-5)
```

The body is the last submit's `Changed:` part; at stage 0 `Ledger-Task` and `Pair` are omitted.

### 3.5 The promotion pull request

At a milestone's exit the master opens and merges `integration/build` into `main` (`swarm.merge`; the `promote` release
kind is needed, SD-18). Title `[milestone:<M>] Promote integration/build to main: <milestone title>`. Body:

```md
Milestone: `milestone:B3` · every exit eval passes at integration/build `a1b2c3d`

## Exit evals
| Eval | Claim | Verdict |
|---|---|---|
| `ms:B3/runtime` | The runtime's services (…) start on the devnet. | pass |

## Score at the head
4,102 pass · 31 fail · 18 unverifiable · 643 unknown · 0 error (run at 2026-11-24T14:02:00Z)

## The milestone
Tasks done: 46 of 46 · spend $61.20 of $230.00 · rounds: median 1, 90th percentile 3

## Unverifiable, listed and not blocking
- `acc:payment.send/9`: … 
```

It is a merge commit, not a squash, so `main` keeps each task's commit.

## 4. The checker's output: check, findings, agent verdicts

### 4.1 Check

The checker's json block at stage 0, its `result` in today's API, and its `check` call at stage 1 (where the engine
adds `from`):

```json
{
  "version": { "kind": "commit", "repo": "AaronAbuUsama/capxul-next", "commit": "e7f8a9b0c1d2e3f405162738495a6b7c8d9e0f12" },
  "verdict": "changes",
  "findings": [
    {
      "check": "acc:payment.send/2",
      "severity": "blocking",
      "where": { "path": "packages/backend/src/payments/commands.ts", "line": 131 },
      "text": "Seen: a replayed signature after a crash between submit and record sends a second UserOperation, because the claim row is written after the bundler call. Expected: the replay answers with the same hash and sends nothing. Fix: write the claim before the call (rules.activity-once)."
    },
    {
      "severity": "advisory",
      "where": { "path": "packages/devnet/src/worlds/board.ts" },
      "text": "Outside this task's paths: the world 'board-executed' is missing, so acc:payment.send/9 cannot run. Owner: devnet."
    }
  ],
  "fixed": ["F-12"],
  "ran": { "pass": 36, "fail": 0, "unverifiable": 2 },
  "verdicts": [
    { "check": "des:payment.send", "result": "pass", "detail": "Record and code agree on all 9 claims and 9 refusals; the --json shape matches ret:payment.send; behaviour matches apps/backend/convex/payments/send.ts for the shortfall and replay cases." }
  ]
}
```

| Field | Rule |
|---|---|
| `version` | the pair's head; a check at another version is refused (planned) |
| `verdict` | `changes` when any blocking finding is open (new, or old and not in `fixed`); otherwise `approve`. Never `approve` with a blocking finding open |
| `findings` | new findings only; an old one still open is not repeated (it stays open unless listed in `fixed`) |
| `fixed` | open findings this version fixes; from round 2 the delta review answers every open finding as fixed or not |
| `ran` | its own exploratory run, if any; information only |
| `verdicts` | the reviewer's agent verdicts (4.4): needed, SD-21. The adversary posts none |

At stage 1 the tool is `check { verdict, findings, fixed }` (planned) plus `verdicts` (SD-21).

### 4.2 A finding

| Field | Rule |
|---|---|
| `check` | the eval it threatens. A blocking finding names one, or names the rule it breaks first in `text`: `Rule <id>:` (`system.layout`, `swarm.scope`, `system.frozen-behaviour`, a policy P1 to P10, or a repository rule) |
| `severity` | `blocking`: a defect that would make an eval fail or pass wrongly, an eval the change does not meet, a broken rule, or a weakened eval. `advisory`: anything else, and **always** a finding outside the task's paths, which this task cannot fix |
| `where` | `path` and, when there is one, `line`. Outside the task's paths: the path where the fix belongs, which names the owning lane |
| `text` | at most 600 characters, in three parts: `Seen:` what the code does or the run printed; `Expected:` what the eval, the record or the rule requires; `Fix:` one sentence. The adversary adds `Attack:` first (4.3). An advisory finding outside the paths starts `Outside this task's paths:` and ends `Owner: <lane>` |

Rendered on the pull request and in a brief as one line:

```text
F-14 blocking `acc:payment.send/2` at packages/backend/src/payments/commands.ts:131: Seen: … Expected: … Fix: …
```

**What a checker never does** (the work contract's spirit: a reviewer never weakens an eval): propose changing,
skipping or retiring an eval to make work pass; approve a change that edits `packages/evals`, `packages/book` or another
concept's records from a lane task, or a rewritten claim without its decision and its frozen claim kept first in `was`;
or accept a pass no run printed.

### 4.3 The adversary's findings

The adversary is a second checker on every money task (`swarm.money`). It tries to break the money paths, and reports
only attacks that land, each as a blocking finding whose text starts `Attack:` with the steps, then `Seen:`,
`Expected:` and `Fix:`, and names the property:

| Property | It tries |
|---|---|
| idempotency | a crash or retry between an activity's side effect and its record; a replayed request, signature or webhook |
| authorization | a caller without the seat, role or allowance; another tenant's row; a counterparty reading beyond its admission (`rules.counterparty-reads`) |
| double spend | two concurrent sends from one allowance or balance; a reschedule racing its execution |
| rounding | amounts not in minor units; a float; a currency or decimals mismatch |
| chain reverts | a reverted UserOperation, a receipt that does not match, a nonce gap, a reorg (`payments.reorg`) |
| the kept behaviour | K1 to K18 of `docs/as-is/payments.md` |

It approves only when no attack lands. It writes no `des:` verdict.

### 4.4 The agent verdict: `des:<operation>`

`des:` is the book's one agent eval per operation. The catalogue names its checker as the reviewer and carries this
rubric (B2's runner prints it in the `CheckDef`'s `check.rubric`):

```text
des:<operation>: its record is complete and consistent with the old book and the old behaviour.
Pass when: (1) every acceptance claim, refusal, the --json shape and the flags in the record are implemented as the
record says; (2) the code does nothing the record does not describe; (3) the record keeps the old behaviour: a frozen
claim is kept, or rewritten or retired with a decision and the frozen claim first in its was, and the old code at the
record's was agrees on the edge cases (contract reverts, money paths, permissions).
Fail names the first disagreement: what the record says, what the code or the old system does, and where.
Unverifiable only when the code it needs is not built yet.
```

The reviewer posts it in its check's `verdicts` (SD-21), as `{ check, result, detail }`; code adds `by` (the reviewer's
actor), `version`, `at` and the evidence (`kind: "review"`, the check's text as the blob). The release gate needs it at the
version that merges, so the reviewer posts it in every check it approves. From round 2 it judges only the delta against
its own earlier `des:` of this pair, and reads the whole operation again only when the delta touches a claim, a refusal
or the `--json` shape, so `des:` does not undo the delta review. It counts at the head after
the merge until a commit changes one of its task's paths (SD-22, `swarm.agent-verdicts`). `ok:capxul` is Aaron's and
has no template here: he signs it on the board.

## 5. A question

A question takes the place of the worker's answer: at stage 0 its json block is `{ "ask": … }` instead of its message,
and the run ends; in today's API it is `report blocked` with `attention: { question, options }` (built); at stage 1 the
`ask` tool (planned), and the worker waits at no cost.

```json
{ "ask": { "to": "manager", "text": "acc:payment.send/9 needs the 'board-executed' world, which devnet has not built: should I leave it unverifiable or wait? Recommend: leave it unverifiable and list it under After merge. Blocks: nothing else.", "options": ["leave it unverifiable", "wait for devnet"] } }
```

| Field | Rule |
|---|---|
| `to` | `manager` (or `pair`, to the other side of the pair); never `person` (rule 8) |
| `text` | at most 400 characters, in three parts: the question, one sentence ending `?`; `Recommend:` the option it would pick and why; `Blocks:` what waits on the answer |
| `options` | at most 6, short; the recommended one first |

Ask only about a real fork the brief, the book and the decisions do not settle. The master answers from the book or the
ledger, or assigns the researcher; it raises a matter only for the four kinds. Until the `decide` answer reaches the
worker (SD-25), the master's answer is a `post` in the task's thread, which reaches the asking worker as steering, in the
form of 5.2.

### 5.1 Progress

A worker's `progress` call (stage 1; planned) updates its status card's `Now` and `Next` lines and appends a `progress`
entry. Each field is one line of at most 200 characters, the entry summary's limit: `now` what it is doing, with the
file or eval; `done` what it finished since the last call, with the evals its own run passed, or `_none_`; `next` its
next step. It calls `progress` at most once per 10 minutes of work and never to report done. At stage 0 a subagent has no
such call; Mission Control writes the status card from each returned message.

```json
{ "now": "mapping the balance shortfall in packages/backend/src/payments/commands.ts", "done": "ref:payment.send/INSUFFICIENT_BALANCE passes in my run", "next": "run the task's evals, then submit" }
```

### 5.2 The master's answer to a question

One post in the task's thread (stage 1) or comment on the pull request (stage 0), marker first:

```text
ANSWER · <P-n> · capxul/master · to <assignment or builder#n>
<the chosen option, or the answer in one or two sentences>. Because: <the book record, decision id or ledger entry it
rests on>. <If a researcher answered: Source: <its sources>.>
```

It answers only the question asked, names the option by its words when the question had options, and never widens the
task: something outside the task's paths is a defect (8.1).

## 6. The diagnosis and the research answer

### 6.1 Diagnosis

```json
{
  "cause": "The record of acc:payment.send/2 assumes the bundler call is idempotent by its operation hash, but the old system's bundler and the mock re-submit on a new nonce (apps/backend/convex/payments/submit.ts:88). Three rounds fixed symptoms in commands.ts (F-7, F-14, F-19), each in lines the previous fix wrote.",
  "kind": "plan",
  "ripple": ["operation:payment.retry", "workflow:payments.lifecycle.payment", "lane:payroll (payroll.run.pay sends the same way)"],
  "options": [
    { "label": "claim-row", "text": "Change the record: a claim row before the call carries the idempotency (rules.activity-once). A book change task in payments; the pair stops." },
    { "label": "split", "text": "Split the replay claim (acc:payment.send/2, /3) from the rest; the rest converges now." }
  ],
  "recommendation": "claim-row"
}
```

| Field | Rule |
|---|---|
| `cause` | at most 600 characters: what went wrong and why, with its evidence (finding, verdict and entry ids, `path:line`); never "the maker failed" |
| `kind` | `execution` (the work on the task is wrong), `plan` (the task or its record cannot be built as written: in Capxul usually the book), `environment` (a sandbox, the devnet or a provider; needed, SD-11) |
| `ripple` | task keys, record keys and lanes the cause also touches; `[]` when none |
| `options` | 2 to 4, each `{ label, text }`: a kebab-case label and what happens if chosen. For `plan`, one option names the record and its owning lane; for `environment`, whether code can fix it (a fresh sandbox) or only a person can |
| `recommendation` | one option's label |

The diagnoser reads the evidence first and the makers' handovers last, so it does not inherit their framing (retro brief
04).

### 6.2 Research answer

```json
{
  "answer": "The old system signs Board payments through the Safe's execTransaction with the proposal's calldata, never a UserOperation (apps/backend/convex/board/execute.ts:51).",
  "recommendation": "Keep acc:payment.send/8 as written; the record's Budgets.schedule path matches the old behaviour.",
  "sources": ["factory:apps/backend/convex/board/execute.ts:51", "books/target/payments/operations.ts:212", "https://docs.safe.global/…"]
}
```

| Field | Rule |
|---|---|
| `answer` | at most 2,000 characters; facts only, each traceable to a source |
| `recommendation` | one sentence: what the asker should do |
| `sources` | `path:line` in this repository, `factory:<path>:<line>` in the old system, or a URL; at least one |

## 7. The master's output: decide, matters, review answers

### 7.1 Decide

One `decide { pair, action }` per signal, by swarm.md's decision table (`swarm.signals`). The action's own fields are
the template; the reason is the diagnosis or the table's row, never free text:

| Signal | The call |
|---|---|
| `round`, `regression`, `defect_in_fix`, `budget` at half | `{ "kind": "diagnose" }` |
| a diagnosis of kind `execution` | `{ "kind": "fresh_maker", "note": "Diagnosis (execution): <cause, at most 300 characters>. Do: <the recommended option's text>." }` |
| a diagnosis of kind `plan`, evals divide | `{ "kind": "split", "tasks": [{ "title": "…", "goal": "…", "checks": ["acc:payment.send/2", "acc:payment.send/3"] }, …] }`, every task check in exactly one child |
| a diagnosis of kind `plan`, they do not | `{ "kind": "stop", "reason": "Plan: <cause, one line>. Book change opened: defect:<lane>/<slug>." }` and the defect (8.1, labelled `book-change`) |
| a diagnosis of kind `environment`, code can fix it | `{ "kind": "fresh_maker", "note": "Environment: <what was broken>; a fresh sandbox." }` |
| a diagnosis of kind `environment`, only a person can | `{ "kind": "raise", "matter": { "kind": "question", "title": "…", "recommendation": "…" } }`, with the full matter (7.2) through `matter_raise` |
| `budget` at all of it | `split` along the diagnosis, or `{ "kind": "stop", "reason": "Budget: $5.00 spent; <cause>; reopens when <what>." }` |
| `stalled` | `{ "kind": "continue" }` after reading the sandbox and the assignment, or `fresh_maker` with the note `Stalled <n> min: <what the sandbox showed>.` |
| `question` | `continue`, with the answer posted in the task's thread (until SD-25) |
| `provider` | none: code paused the pair |
| `sandbox` (SD-14) | none for two failures; then `diagnose` |
| `head_regression` (SD-6) | none on the pair: the red-head rule opens a defect (8.1) |

### 7.2 Matter: the decision pack

```json
{
  "kind": "decision",
  "title": "Fund the adversary on Sonnet or Opus?",
  "body": "The adversary found 0 attacks on 12 money tasks in a row; swarm.checker-family puts it on claude-sonnet-5-5. The retro's strong-model finding on #46 suggests a stronger model finds what a cheaper one misses.",
  "options": [
    { "label": "sonnet", "text": "Keep the adversary on anthropic/claude-sonnet-5-5.", "grade": "recommended", "cost": "about $0.40 a money task", "risk": "a missed attack class" },
    { "label": "opus", "text": "Move the adversary to anthropic/claude-opus-5-5.", "grade": "viable", "cost": "about $1.60 a money task, $180 over the build", "risk": "budget signals on money tasks" }
  ],
  "recommendation": "sonnet",
  "default": "sonnet stands; the build continues.",
  "bring": "decision",
  "records": ["swarm.checker-family", ".swarmd/workers/adversary.ts"],
  "decider": "aaron",
  "task": "K-1"
}
```

| Field | Rule |
|---|---|
| `kind` | `decision` (a decision pack: never blocks, `swarm.matters-dont-block`), `question` (blocks its task only: an irreversible step, a missing key or account, or spending past the envelope), `risk` or `commitment` (recorded on the board, not brought) |
| `title` | the question itself, at most 80 characters, ending `?` |
| `body` | the context: what the book says, what the diagnosis found, with ids; at most 2,000 characters |
| `options` | for a decision 2 to 4, each `{ label, text, grade, cost, risk }` (grade, cost, risk needed: SD-10). Exactly one `recommended`; the others `viable` or `weak`. A question may have none |
| `recommendation` | the recommended option's label |
| `default` | what stands meanwhile (SD-10): for a decision, the recommendation and "the build continues"; for a question, "<task key> waits; nothing else does" |
| `bring` | which of the goal prompt's four kinds: `decision`, `flagged`, `irreversible`, `owner-only` (SD-10); absent on a risk or commitment (the form's `not brought`) |
| `records` | the book keys and repository paths it touches (SD-10); for a judgment the book flags, the decision id first |
| `decider` | `aaron` |
| `task` | a question names the task it blocks; a decision may name the task it came from |

Rendered in the room, on the board and (stage 0) as the issue body of
[`decision-pack.yml`](../../.github/ISSUE_TEMPLATE/decision-pack.yml):

```text
M-11 · decision · bring: decision · for @aaron
Fund the adversary on Sonnet or Opus?
The adversary found 0 attacks on 12 money tasks in a row; …
Options
  sonnet (recommended): Keep the adversary on anthropic/claude-sonnet-5-5. Cost: about $0.40 a money task. Risk: a missed attack class.
  opus (viable): Move the adversary to anthropic/claude-opus-5-5. Cost: … Risk: …
Recommendation: sonnet. Meanwhile: sonnet stands; the build continues.
Touches: swarm.checker-family, .swarmd/workers/adversary.ts
Answer with an option's label, or in your own words.
```

**A reversible decision does not wait:** when the master raises it, the recommendation goes into the book as the chosen
option through a review task (8.2) and the matter is its review. **Never a stuck pair:** a matter carries the
diagnosis, never "tried N times".

### 7.3 Resolving a matter

The answer (a reply in the matter's thread, an issue comment at stage 0, or `matter.resolve` on the board) becomes its
`resolution`, and the master records it in one line, on the issue at stage 0 and as `matter_resolve` text at stage 1:

```text
RESOLVED · M-11 · opus · by @AaronAbuUsama · record: swarm.checker-family (review task review:swarm.checker-family)
```

Then it opens the review task that carries the answer into the book (8.2), critical, taken at the next free slot
(`swarm.review-answers`). An answer in a person's own words that leaves a judgment open goes back as a new decision pack,
never a guess.

### 7.4 The review answer

The portal's Review buttons open [`review-answer.yml`](../../.github/ISSUE_TEMPLATE/review-answer.yml) prefilled through
its URL (portal.md, "Where it goes"). Its fields are the portal's `ReviewAnswer`:

| Form field (id) | `ReviewAnswer` | Filled by |
|---|---|---|
| `decision` | `decision`: the decision id, or `surface` | the portal |
| `answer` | `accept`, `choose` or `change` | the portal |
| `option` | `option`: an existing option's label (`choose`) | the portal |
| `text` | `text`: what he wants instead (`change`), or a note | the reviewer, at most 1,000 characters |
| (the issue's author) | `by` | GitHub |
| (the issue's creation) | `at` | GitHub |
| `seenAt` | `seenAt`: the commit the page was built from | the portal |

The title is `review: <decision>`; the labels `review` and `swarmd` (the `swarmd` label addresses the master through the
GitHub source, built). The master applies an issue only when its author is the decision's reviewer (`review.by`, mapped
to a GitHub login); any other author's issue gets one comment, `WAITING · only the decision's reviewer can answer it`,
and waits. Once swarmD's matters carry a subject and a typed resolution (SD-23), the same answer is a resolved matter.

## 8. Tasks opened outside the plan, and task cards

Only two kinds of task are opened by hand, both by the master (`swarm.task-tree`): a **defect** and a **review** task.
A split's children (8.4) are opened by the split itself. Their keys and evals are fixed (`swarm.hand-tasks`), so the
plan's reconcile can tell them from derived tasks and never drops them.

### 8.1 Defect

| `TaskDef` field | For a defect |
|---|---|
| `key` | `defect:<lane>/<slug>` (slug kebab-case, at most 40 characters); a red head: `defect:<lane>/head-<7 hex>` |
| `kind` | `defect` |
| `title` | `Defect: <what is wrong, as the outcome to restore>`, at most 80 characters |
| `goal` | the outcome, no steps: "`<eval>` passes again at integration/build: <one sentence>" |
| `parent` | `lane:<lane>` |
| `lane`, `layer` | the lane that owns the path (from `where.path`, `system.layout`), and its layer |
| `priority` | `critical` for a red head (`swarm.head-red`) and a money lane's attack; otherwise the finding's task's |
| `evals` | existing eval ids that fail, error or are unknown at the integration head, or that its finding names; at least one. They may also belong to a derived task: one owner binds only the plan |
| `needs` | none, unless the fix needs an open task first |
| `labels` | `kind:defect`, `lane:<lane>`, `layer:<n>`, `money` on a money lane, and one of `from:finding`, `from:red-head`, `from:person`, `book-change` |
| `budgetUsd` | 5 |
| `checkers` | `reviewer`, and `adversary` on a money lane |
| `paths` | the lane's paths (as its operation tasks') |
| `record` | the record it restores, if one |
| `brief.context` | first line `From: <F-n on P-n at <7 hex> | head regression at <7 hex> after <task keys> | @<login>>`; then what was observed, with ids and times, and why it matters |

A finding that names no eval is advisory and opens nothing. A **book change** (a diagnosis of kind `plan`, 7.1) is a
defect labelled `book-change` in the lane that owns the record: its evals are the stopped task's evals the record
governs, and its maker changes the record first (with its decision record), then the code, in one pull request.
At stage 0 it is the issue form [`defect.yml`](../../.github/ISSUE_TEMPLATE/defect.yml); a person may open one the same
way, and Mission Control checks its evals before a pair starts.

### 8.2 Review task

| Field | For a review task |
|---|---|
| `key` | `review:<decision>` (`review:surface` for the CLI surface) |
| `kind` | `review` |
| `title` | `Review: <decision>: <accept | choose <option> | change>` |
| `goal` | "Decision `<id>` records the answer of #<issue> (seen at `<7 hex>`), and every record it ripples to says the same; the book builds to 0 problems and check-frozen reports 0 breaches." |
| `parent` | `capxul` |
| `priority` | `critical` (`swarm.review-answers`) |
| `evals` | `dec:<decision>/review` (`swarm.hand-tasks`; derived by the book from D0's `review` field: open item, section 14). Until it exists, Mission Control counts the task done at its merge |
| `labels` | `kind:review` (not `review`, which marks an answer, not the task that applies it) |
| `budgetUsd` | 5 |
| `checkers` | `reviewer`: it confirms the records say what the answer says |
| `paths` | the book folders of the decision and the records it ripples to; `docs/decisions/accepted-surface.json` for `surface`. Code changes later, through the lanes the plan reopens |
| `record` | `decision:<id>` |
| The answer | `answer issue`, `decision`, `answer`, `option`, `text`, `seenAt`, `by`, `at`: the `ReviewAnswer` |

Its pull request goes from `review/<decision>` and carries the portal preview of the changed pages (portal.md). The
form is [`task-review.yml`](../../.github/ISSUE_TEMPLATE/task-review.yml).

### 8.3 Task cards (stage 0)

At stage 0 there is no ledger task and no room thread. **A task card** is a GitHub issue Mission Control opens from
`docs/mission/tasks.json` when a task's pair starts: it is the task's thread (a person steers or says `stop` there) and
holds the status card (9.1) as its first comment (`swarm.task-cards`). It is closed at the merge (`MERGED`) or the drop
(with the reason). At stage 1 the ledger task and the room thread replace it, and no card is opened.

There is one form per working kind, each rendering `TaskDef` (4.2) and `TaskBrief` (4.3) field for field:
[`task-step.yml`](../../.github/ISSUE_TEMPLATE/task-step.yml), `task-integration.yml`, `task-door.yml`,
`task-process.yml`, `task-rpc.yml`, `task-flow.yml`, `task-operation.yml`, plus `task-review.yml` (8.2) and
`defect.yml` (8.1). The root, the milestones and the lanes have none: they are done by roll-up and never get a pair. Nor
do the 15 watch tasks (label `watch`: the journeys, `step:B3.pilots`, `step:B5.week`), which have no paths and are done
by their evals (`swarm.watch-tasks`); a journey that fails becomes a defect in the lane its diagnosis names. The card's title is `[<key>] <title>`; its labels are `task`, `kind:<kind>` and the `TaskDef`'s own labels.

| Form field (id) | `TaskDef` / `TaskBrief` | Rendered as |
|---|---|---|
| `key` | `key` | the key |
| `kind` | `kind` | one value, fixed by the form |
| (the issue title) | `title` | `[<key>] <title>` |
| `goal` | `goal` | the text |
| `parent` | `parent` | a key |
| `lane`, `layer` | `lane`, `layer` | the value |
| `priority` | `priority` | `critical`, `normal` or `low` |
| `evals` | `evals` | one id per line |
| `exit` | `exit` (steps) | one `<id> — <claim>` per line |
| `needs` | `needs` | one key per line |
| `labels` | `labels` | one per line |
| `budgetUsd` | `budgetUsd` | a number |
| `checkers` | `checkers` | `reviewer`, `adversary` |
| `paths` | `paths` (`brief.paths`) | one prefix per line |
| `record` | `record` (`brief.record`) | a record key |
| `decisions` | `brief.decisions` | one decision id per line |
| `outOfScope` | `brief.outOfScope` | one per line |
| `context` | `brief.context` | the text, at most 4,000 characters |

### 8.4 A split's children

`decide { kind: "split" }` (7.1) opens the children; swarmD drops the parent's own checks onto them and keeps the parent
open until they pass (reference/pairs.md). Their `TaskDef` fields (`swarm.hand-tasks`):

| Field | For a split child |
|---|---|
| `key` | `<parent key>/split-<n>`, `n` from 1 in the order of the split's `tasks` |
| `kind`, `lane`, `layer`, `paths`, `checkers`, `record` | the parent's |
| `title`, `goal` | the split's `title` and `goal` for it, at most 80 and 1,000 characters |
| `parent` | the parent's key |
| `priority` | the parent's |
| `evals` | its part of the parent's evals: every parent eval in exactly one child, none added |
| `needs` | the parent's needs; a later child may need an earlier one when its evals build on it |
| `labels` | the parent's, plus `from:split` |
| `budgetUsd` | what is left of the parent's budget, divided evenly, in cents |
| `brief.context` | first line `Split of <parent key> at <7 hex>: <the diagnosis's cause, one line>` |

The reconcile keeps the parent's evals on its children and never restores them from the plan; when the book changes the
parent's evals, the new ones go to the last child.

## 9. What code renders: status card, mirror comments, board, room

### 9.1 The status card

One per task in flight, edited in place on every change, never reposted: the task card's first comment at stage 0, the
chat template's card in the task's thread at stage 1 (planned).

```text
STATUS · `operation:payment.send` · checking · round 2 of 5 · $2.10 of $5.00
Now: reviewer and adversary checking e7f8a9b
Done: gate ✅ · evals 36 of 38 pass, 2 unverifiable · reviewer changes (F-14) · adversary pending
Next: converge, or round 3 from a fresh maker
Pair: P-44 · maker builder#12 (gateway/gpt-6.1-sol) · checkers reviewer#9, adversary#3 · PR #57 · lane/payments
Updated 2026-11-20T14:02:00Z
```

| Line | From |
|---|---|
| First | the marker, the key, `PairState`, `round` and `maxRounds`, `spentUsd` and `budgetUsd` |
| `Now` / `Next` | the latest `progress` (`now`, `next`) or the engine's state |
| `Done` | the gate, the machine verdicts at the head, each checker's last verdict |
| `Pair` | `PairView` (4.10), the bound pull request and the branch; at stage 0 `Pair: stage 0` |

The states shown are `PairState`'s, plus `blocked: <why>` (SD-8's `BlockedWhy`) and `done` (merged).

### 9.2 Mirror comments on the pull request

Each pair event is one comment whose **first line is a marker** that people and scripts read; detail goes below it
(`swarm.pr-mirror`). At stage 1 code posts them under each actor's name (SD-13); at stage 0 Mission Control posts them
from each worker's returned message. Workers post none, except in today's API for the dry run (10.4), where nothing else
can: there each checker posts its own CHECK comment from its result, in this same form.

| Marker (first line) | Below it | From |
|---|---|---|
| `SUBMIT · round <n> · <7 hex> · <actor> (<model>)` | the note; addresses | `submit` |
| `GATE failed · <7 hex> · <the first failing gate>` | its last 40 lines of output; "back to the same maker; no round counted" | the gate |
| `CI red · <7 hex> · <check name>` | the failing step and its link | the GitHub source (SD-5) |
| `EVALS · <7 hex> · <pass> pass · <fail> fail · <unverifiable> unverifiable · <error> error` | each fail and error: id, `detail` | the sandbox's verdicts |
| `CHECK <approve|changes> · round <n> · <7 hex> · <actor> (<model>) · <b> blocking, <a> advisory · fixed <F-ids or none>` | each new finding as one line (4.2); the agent verdicts | `check` |
| `SIGNAL <kind> · <P-n> · <the signal's fields>` | — | the engine |
| `DECIDE <action> · <P-n> · capxul/master` | the action's note, reason or children | `decide` |
| `DIAGNOSIS <kind> · <P-n> · <actor>` | cause, ripple, options, recommendation | the diagnosis |
| `MERGED · integration/build <7 hex> · <P-n> · <rounds> rounds · $<cost>` | the evals' final counts; unverifiable listed | the merge |
| `STOPPED · <P-n> · <reason>` | "the task stays open, off the frontier until <its cause> is done" | `stop` |
| `ANSWER · <P-n> · capxul/master · to <assignment>` | the answer (5.2) | the master, until SD-25 |

### 9.3 The board (the master's artifact)

The master's artifact is the `build` template's base sections plus Capxul's additions (`swarm.artifact`). As
`defineManager` declares them (planned; the kinds marked needed are SD-8 and SD-9):

```ts
artifact: {
  add: [
    { kind: "refs" },                                              // needed (SD-9): heads, last run, CI, merge freeze
    { kind: "scoreboard", group: "label:lane", measures: ["p95_ms"] },   // planned; lanes ordered by label layer:<n>, budget column needed (SD-9)
    { kind: "blocked" },                                           // needed (SD-8): each blocked task with its reason
    { kind: "frontier", limit: 10 },                               // needed (SD-9): open tasks in the loop's order
    { kind: "budget", envelopeUsd: 2500 },                         // needed (SD-9): spend, committed, today, manager, providers
    { kind: "timeline", limit: 50 },                               // planned
  ],
},
```

The base sections (header, tasks by state, matters, timeline, scoreboard by `label:area`, pairs in flight, failing) are
the template's and cannot be removed. Rendered as text in Slack and Pi, and as the same rows on the web, all at one ledger
`seq` (planned):

```text
📋 capxul/master · build · stage 1 · milestone:B4 Concepts on the critical path · updated 2m ago · needs a person: 2
Heads
  integration/build  a1b2c3d  run 14:02  4,102 pass · 31 fail · 18 unverifiable · 643 unknown · 0 error  CI ✅
  main               9f8e7d6  milestone:B3 promoted 2026-11-24                                              CI ✅
Lanes (by layer)              tasks done/all   evals at head   stands (ops)          spend / budget
  -1 integrations             11/11 ✅          133/133          —                     $19.40 / $55.00
  9  payments                 3/12 🟡 P-44      58/209           build 9 · observe 1   $18.20 / $60.00
  14 equity                   0/45 ⏸ layer      0/698            build 23              $0.00 / $225.00
Pairs in flight (3 of 4)
  P-41 approvals  workflow:approvals.lifecycle.carry  round 2 · checking · $2.10 of $5.00 · reviewer, adversary
  P-45 board      door:board                          round 3 · signalled: round
Blocked (2)
  K-212 operation:bank.match  needs K-198 operation:bank.pay (open)
  K-301 step:B5.deploy        matter M-9 (question: Staging deploy token?)
Frontier (25 open) · next: door:requests, operation:payroll.run.create, operation:notices.list
Matters waiting for a person (2)
  M-9  question  Staging deploy token? (owner-only) · 3h
  M-11 decision  Fund the adversary on Sonnet or Opus? (decision) · 1d · recommendation stands: sonnet
Spend  $812 of $2,500 (32%) · committed $11.20 · today $46 · manager $31 (3.8%) · gateway up · anthropic up
Failing (10 of 31)
  ref:payment.send/WRONG_STATE at integration/build · expected exit 4, saw 0
Timeline
  #4412 manager capxul/master  merged  e7f8a9b operation:payroll.run.list into integration/build · $1.84
```

| Line | Grammar |
|---|---|
| Header | `📋 <manager> · <template> · stage <n> · <milestone key> <title> · updated <age> · needs a person: <n>` |
| Head | `<ref> <7 hex> run <HH:MM> <Score> CI <✅ | ❌ | ⏳> [🧊 frozen: <defect key>]` |
| Lane | `<layer> <lane> <done>/<all> <✅ | 🟡 <pair> | ⏸ <why> | 🔴 red> <pass>/<evals> <stands> $<spent> / $<budget>` |
| Pair | `<P-n> <lane> <key> round <n> · <state> · $<spent> of $<budget> · <checkers> [· signalled: <kind>]` |
| Blocked | `<K-n> <key> <why>`: `needs <K-n> <key> (<state>)`, `matter <M-n> (<kind>: <title>)`, `signal <kind> on <P-n>, unanswered <age>`, `provider <name> paused`, `merges frozen: <defect key>` |
| Frontier | `Frontier (<n> open) · next: <key>, <key>, <key>` |
| Matter | `<M-n> <kind> <title> (<bring>) · <age> [· recommendation stands: <label>]` |
| Spend | `Spend $<spent> of $<envelope> (<pct>%) · committed $<x> · today $<x> · manager $<x> (<pct>%) · <provider> <up | paused> …` |
| Failing | `<eval id> at <ref> · <detail, at most 80 characters>` |
| Timeline | `#<seq> <actor kind> <actor> <entry kind> <summary> · $<cost>` |

### 9.4 The master's room messages

Quiet by default: progress is the board. The master speaks in its room only on these, each in one fixed form:

| Occasion | Message |
|---|---|
| A person's request became a task | `K-<n> · <title> · opened for @<login> · <n> evals · <position: "next" or "after <n> tasks">` |
| A question about the build | the answer, then `(board at seq <n>)` |
| A matter | the matter's render (7.2) |
| A matter resolved | the resolution line (7.3) |
| A milestone's exit | `<milestone key> done: <n> exit evals pass at integration/build <7 hex>; promoted to main as #<pr> <7 hex>. Next: <next milestone title>.` |
| Spend at 75% of the envelope | the spending matter (7.2), kind `question`, bring `owner-only` |
| A stop | `Stopped <P-n> on <key> for @<login>; the task stays open.` |
| Something outside the goal | `That is outside the build's goal; raised as M-<n>.` and the matter |

### 9.5 The progress line (stage 0)

One row of `docs/mission/progress.md` per finished step or lane, in its columns:

```text
| 2026-11-12 | step:T0.tooling T0 Tooling | 2 of 2: ms:T0/check, ms:T0/hooks | a1b2c3d (#3) |
```

`Evals passing` lists the ids when there are at most five, otherwise `<n> of <n>, all of the task's`. The commit is the
merge commit on `integration/build` and its pull request.

### 9.6 GitHub labels

Mission Control creates them once at T0 (`gh label create`); an issue form applies only labels that exist.

| Label | Meaning |
|---|---|
| `task` | a task card (stage 0) |
| `kind:<kind>` | step, integration, door, process, rpc, flow, operation, journey, review, defect |
| `lane:<lane>`, `layer:<n>`, `area:<area>`, `money`, `pilot`, `pilot-closure`, `after:<lane>`, `builds-on-events:<lane>` | copied from the `TaskDef`'s labels |
| `from:finding`, `from:red-head`, `from:person`, `book-change` | a defect's origin |
| `watch` | a task with no paths: never paired, done by its evals (copied from the `TaskDef`) |
| `from:split` | a child of a split (8.4) |
| `matter`, `matter:decision`, `matter:question`, `matter:risk`, `matter:commitment` | a matter (stage 0) |
| `bring:decision`, `bring:flagged`, `bring:irreversible`, `bring:owner-only` | which of the four kinds |
| `review` | a review answer from the portal (portal.md) |
| `swarmd` | addresses capxul/master through the GitHub source (built) |

## 10. The team on swarmD

The team is one manager and five workers (`swarm.workers`, `swarm.team-definition`). This section declares them twice:
in **swarmD's documented API** (the target: swarmD's how-to "Define a manager", whose code still says `defineRouter`,
and the references `manager.md` and `worker.md`), which the build runs on at stage 1; and in **today's API**
(`packages/agent`'s `defineRouter` and `defineWorker`, as `examples/api-team` and swarmD's own `dogfood/` use them),
for the dry run (swarm.md 1.2). The today form below typechecks against `packages/agent/src/modules/define/types.ts`.

### 10.1 The folder

```text
.swarmd/
  project.ts            defineProject (planned): swarm.md 2.5
  models.ts             model objects (planned)
  policy.ts             definePolicy (planned)
  sandbox.ts            how the repository sets itself up (built)
  schemas.ts            the typed messages as JSON Schema: today's inputs and results, the researcher's always
  managers/master.ts
  workers/builder.ts  reviewer.ts  adversary.ts  diagnoser.ts  researcher.ts
  prompts/master.md  builder.md  reviewer.md  adversary.md  diagnoser.md  researcher.md
  skills/book/  evals/  lane/  money/  old-system/      each a SKILL.md (planned; pass-through needed, SD-16)
  today/master.ts  builder.ts  reviewer.ts  adversary.ts  diagnoser.ts  researcher.ts   today's API, for the dry run
  package.json          { "private": true, "type": "module" }
```

| Piece | State |
|---|---|
| `sandbox.ts`, `sandbox.repo("github:…")`, golden snapshot, egress with secrets, `standard-3` | built (a real eviction not yet proven) |
| `defineWorker`, `defineRouter`, `input`/`result` schemas, `concurrency`, `connectors`, sources `pi`, `api`, `github`, `schedule`, rules | built |
| `defineManager`, `template: "build"`, roles, `workers` by import, model objects, `tools`, `skills`, `scope`, `pairs`, `artifact`, `policy`, `project` | planned |
| Read-only sandboxes (`sandbox.repo(…, { readOnly: true })`) | planned |
| `limits: { running, pairs }` on a manager | needed (SD-1) |
| `skills` passed through to Pi | needed (SD-16) |

### 10.2 The documented API (stage 1)

```ts
// .swarmd/models.ts (planned: how-to/choose-models)
import { anthropic, provider } from "@swarmd/agent/models";

const gateway = provider({ name: "gateway", api: "openai", baseUrl: "https://cliproxy.capxul.com/v1", secret: "GATEWAY_API_KEY" });
export const sol = gateway("gpt-6.1-sol", { thinking: "high" });              // makers (strong tier)
export const sonnet = anthropic("claude-sonnet-5-5", { thinking: "high" });   // checkers, adversary, diagnoser (strong, other family)
export const haiku = anthropic("claude-haiku-5-5", { thinking: "low" });      // the manager, the researcher (cheap)
```

```ts
// .swarmd/sandbox.ts (built)
import { sandbox } from "@swarmd/agent";

export default sandbox({
  cwd: "/workspace/repo",
  prepare: [
    "npm ci",
    "git clone -q --depth 1 --branch integration/factory https://github.com/Xelmar-tech/infrastructure /workspace/factory && chmod -R a-w /workspace/factory",
    // from B3 (ms:B3/sandbox): "npm run --silent devnet -- snapshot base"
  ],
  egress: {
    "registry.npmjs.org": {},
    "github.com": { basic: { user: "x-access-token", secret: "GITHUB_TOKEN" } },   // the App's token, both repositories (swarm.accounts)
  },
  // `basic` is built in code (packages/agent define/types.ts); the docs show only `bearer`, which git over HTTPS refuses.
  // The token can write every branch: SD-28 (needed) holds a maker's push to its task's branch and gives the read-only
  // sandboxes no write credential. Until then, nothing but the prompts keeps a push off integration/build (swarm.md 2.3).
});
```

```ts
// .swarmd/policy.ts (planned: concepts/policy)
import { definePolicy, hook, schedule } from "@swarmd/agent";

export default definePolicy({
  ask: { all: ["@maintainers"] },                                   // Aaron: the room, the GitHub issues labelled swarmd, Pi
  rules: [],                                                        // nothing starts on its own but the plan and these hooks
  hooks: [
    hook("nightly", { on: schedule.every("1d"), open: { title: "Every eval passes at integration/build", checks: "all", target: "integration" } }),
  ],
});
```

```ts
// .swarmd/managers/master.ts (planned: reference/manager). swarm.md 2.5, with the board and the cap.
import { defineManager, github, pi } from "@swarmd/agent";
import { haiku, sol } from "../models";
import adversary from "../workers/adversary";
import builder from "../workers/builder";
import diagnoser from "../workers/diagnoser";
import researcher from "../workers/researcher";
import reviewer from "../workers/reviewer";

export default defineManager({
  name: "master",
  description: "Builds Capxul from its design book: every eval of docs/mission/tasks.json green at integration/build.",
  template: "build",
  project: "capxul-next",
  model: haiku,
  instructions: "../prompts/master.md",                                   // docs/mission/initializer.md whole, then swarm.md 1b's skeleton
  scope: { root: "K-1" },
  workers: [
    { worker: builder, role: "maker", models: [sol] },
    { worker: reviewer, role: "checker" },
    { worker: adversary, role: "checker" },
    { worker: diagnoser, role: "diagnoser" },
    { worker: researcher },
  ],
  pairs: { maxRounds: 5, budgetUsd: 5, freshMakerEachRound: true, deltaReview: true, staleAfterMinutes: 30 },
  limits: { running: 6, pairs: 4 },                                       // needed (SD-1)
  sources: [pi(), github({ repo: "AaronAbuUsama/capxul-next" })],
  policy: "../policy.ts",
  tools: { github: ["issues.get", "issues.listComments", "issues.createComment", "issues.addLabels", "pulls.get", "pulls.list", "pulls.listFiles", "pulls.create", "pulls.merge", "checks.listForRef", "repos.getContent"] },
  artifact: { add: [ /* section 9.3 */ ] },
  icon: ":building_construction:",
});
```

Each worker is its own file with a default export; they are shown in one block, and each imports `defineWorker` and
`sandbox` from `@swarmd/agent` and its model from `../models`.

```ts
// .swarmd/workers/builder.ts (planned: reference/worker). A maker: no input or result of its own.
import { defineWorker, sandbox } from "@swarmd/agent";
import { sol } from "../models";

export default defineWorker({
  name: "builder",
  description: "Makes one Capxul task's evals pass on its lane branch, book first, inside the task's paths, and opens the task's pull request.",
  model: sol,
  instructions: "../prompts/builder.md",
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next"),
  skills: ["../skills/book", "../skills/evals", "../skills/lane", "../skills/money", "../skills/old-system"],
  tools: { github: ["pulls.create", "pulls.get", "pulls.update", "issues.createComment"] },
  concurrency: 4,
  icon: ":hammer_and_wrench:",
});

// .swarmd/workers/reviewer.ts: a checker on another family; posts the des: verdicts.
export default defineWorker({
  name: "reviewer",
  description: "Checks one version of a Capxul task against its evals and the repository's rules, on another model family, and decides des:. Changes nothing.",
  model: sonnet,
  instructions: "../prompts/reviewer.md",
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next", { readOnly: true }),
  skills: ["../skills/book", "../skills/evals", "../skills/lane", "../skills/old-system"],
  tools: { github: ["pulls.get", "pulls.listFiles"] },
  concurrency: 4,
  icon: ":mag:",
});

// .swarmd/workers/adversary.ts: a second checker on money tasks.
export default defineWorker({
  name: "adversary",
  description: "Tries to break the money paths of one version of a Capxul money task: idempotency, authorization, double spend, rounding, chain reverts. Changes nothing.",
  model: sonnet,
  instructions: "../prompts/adversary.md",
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next", { readOnly: true }),
  skills: ["../skills/money", "../skills/evals", "../skills/old-system"],
  tools: { github: ["pulls.get", "pulls.listFiles"] },
  concurrency: 2,
  icon: ":crossed_swords:",
});

// .swarmd/workers/diagnoser.ts: fresh context on a signal.
export default defineWorker({
  name: "diagnoser",
  description: "Diagnoses a Capxul pair that stopped converging: the cause, plan, execution or environment, what it touches, and graded options. Changes nothing.",
  model: sonnet,
  instructions: "../prompts/diagnoser.md",
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next", { readOnly: true }),
  skills: ["../skills/book", "../skills/evals", "../skills/old-system"],
  concurrency: 1,
  icon: ":stethoscope:",
});

// .swarmd/workers/researcher.ts: no role, its own schemas.
import { researchInput, researchResult } from "../schemas";
export default defineWorker({
  name: "researcher",
  description: "Answers one question about the book, the old system or a library, with sources and a recommendation. Writes no code.",
  model: haiku,
  instructions: "../prompts/researcher.md",
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next", { readOnly: true }),
  skills: ["../skills/book", "../skills/old-system"],
  input: researchInput,
  result: researchResult,
  concurrency: 1,
  icon: ":books:",
});
```

| Worker | Role | Model (tier) | Concurrency | Sandbox | Tools | Output |
|---|---|---|---|---|---|---|
| builder | maker | `sol` (strong) | 4 | the repository, writable, devnet from B3 | `pulls.create`, `pulls.get`, `pulls.update`, `issues.createComment`; `run_evals`, `submit`, `handover`, `ask`, `progress` | submit (3.1), handover (3.2), the pull request (3.3) |
| reviewer | checker | `sonnet` (strong, other family) | 4 | read-only (planned) | `pulls.get`, `pulls.listFiles`; `run_evals`, `check`, `ask`, `progress` | check (4.1) with `des:` verdicts (4.4) |
| adversary | checker | `sonnet` (strong, other family) | 2 | read-only (planned) | as the reviewer | check (4.1, 4.3) |
| diagnoser | diagnoser | `sonnet` (strong, the checkers' family) | 1 | read-only (planned) | none | diagnosis (6.1) |
| researcher | none | `haiku` (cheap) | 1 | read-only (planned) | none | its result (6.2) |
| master | manager | `haiku` (cheap) | one, always on | none | the `build` template's manager tools; the GitHub grant above | decide (7.1), matters (7.2), tasks (8), room messages (9.4) |

Each worker's grant is its own (since swarmD #54): no worker holds `pulls.merge`, and the master's `pulls.merge` reaches
only `integration/build` and `main` once #85's base allowlist lands (planned). The researcher's "web" is the sandbox's
egress: only the hosts `sandbox.ts` lists, so a library's documentation host is added there when a question needs it.

### 10.3 The schemas (`.swarmd/schemas.ts`)

The typed messages of swarm.md section 4 as JSON Schema, field for field, with `additionalProperties: false` at every
level so a manager cannot invent a field and a worker cannot skip one (how-to/define-a-manager). Today's workers use
them as their `input` and `result`; in the documented API only the researcher does, since a role sets the others.

```ts
// .swarmd/schemas.ts
type Schema = Record<string, unknown>;
const text = (description: string, maxLength?: number): Schema => ({ type: "string", description, ...(maxLength ? { maxLength } : {}) });
const list = (items: Schema, description: string): Schema => ({ type: "array", items, description });
const texts = (description: string): Schema => list({ type: "string" }, description);
const oneOf = (values: string[], description: string): Schema => ({ type: "string", enum: values, description });
const count = (description: string): Schema => ({ type: "integer", minimum: 0, description });
const object = (properties: Record<string, Schema>, required: string[]): Schema => ({ type: "object", properties, required, additionalProperties: false });

export const version = object({
  kind: oneOf(["commit"], "a commit; a deploy from B5"),
  repo: text("AaronAbuUsama/capxul-next"),
  commit: { type: "string", pattern: "^[0-9a-f]{40}$", description: "40 hex characters" },
}, ["kind", "repo", "commit"]);
const result = oneOf(["pass", "fail", "unverifiable", "error"], "error: the check broke, not the claim");
const ran = object({ pass: count("pass"), fail: count("fail"), unverifiable: count("unverifiable"), error: count("error") }, ["pass", "fail", "unverifiable", "error"]);
export const brief = object({
  record: text("the book record it builds, e.g. operation:payment.send"),
  context: text("facts and links, never steps", 4000),
  decisions: texts("decision ids that settle it"),
  outOfScope: texts("what is left out on purpose"),
  paths: texts("path prefixes the maker may change"),
}, ["paths"]);
const where = object({ path: text("repository path"), line: count("line") }, ["path"]);
export const findingInput = object({
  check: text("the eval it threatens"),
  severity: oneOf(["blocking", "advisory"], "advisory never blocks; outside the task's paths is always advisory"),
  where,
  text: text("Seen: … Expected: … Fix: … (the adversary starts with Attack: …)", 600),
}, ["severity", "text"]);
export const finding = object({
  id: text("F-n"), check: text("the eval it threatens"), severity: oneOf(["blocking", "advisory"], "severity"),
  where, text: text("the finding", 600), raisedAt: version, fixedAt: version, reopenedAt: list(version, "a regression"),
}, ["id", "severity", "text", "raisedAt"]);
const handover = object({
  done: texts("what is built, with the evals it passed in its own run"),
  left: texts("what is not, and why; 'outside <path>: <what>' for work outside the task's paths"),
  decisions: texts("decision record ids or matter ids, each with what it settled"),
  where: texts("path:line and why to look there first; at most 6"),
}, ["done", "left", "decisions", "where"]);

/** MakerInput (swarm.md 4.5), plus the branch and pull request a fresh maker needs (SD-24). */
export const makerInput = object({
  task: object({ id: text("K-n, or the key at stage 0"), key: text("the plan's key"), title: text("title", 80), goal: text("goal", 1000), target: text("integration/build"), brief }, ["key", "title", "goal", "target", "brief"]),
  checks: list(object({ id: text("eval id"), claim: text("its claim"), decider: oneOf(["machine", "agent", "person"], "decider"), lastSeen: result }, ["id", "claim", "decider"]), "the task's evals"),
  openFindings: list(finding, "findings still open"),
  handover: text("the last maker's handover, in the four parts", 1500),
  revise: object({ reason: oneOf(["gate_failed", "changes", "regression", "decided"], "why this round"), detail: text("detail", 600) }, ["reason", "detail"]),
  round: { type: "integer", minimum: 1, description: "the round" },
  branch: text("lane/<concept>, ms/<step> or review/<decision>"),
  pr: count("the task's pull request, from round 2"),
}, ["task", "checks", "openFindings", "round", "branch"]);

/** Handback (swarm.md 4.6): the builder's result in today's API. */
export const handback = object({
  submit: object({ version, addresses: texts("F-ids it fixes"), note: text("Changed: … Should move: … Ran: … Disputes: …", 600) }, ["version", "addresses", "note"]),
  pr: count("the task's pull request"),
  handover,
  ran,
}, ["submit", "pr", "handover"]);

/** CheckerInput (swarm.md 4.5). */
export const checkerInput = object({
  version,
  diff: object({ from: version, to: version }, ["to"]),
  openFindings: list(finding, "findings still open"),
  verdicts: list(object({ check: text("eval id"), result, detail: text("detail", 600) }, ["check", "result"]), "machine verdicts at the version"),
  task: object({ id: text("K-n, or the key"), key: text("the plan's key"), goal: text("goal", 1000), checks: texts("eval ids"), brief }, ["key", "goal", "checks", "brief"]),
  pr: count("the task's pull request"),
  note: text("the round's submit note", 600),
}, ["version", "diff", "openFindings", "verdicts", "task", "pr"]);

/** The check message (swarm.md 4.5), with the agent verdicts the reviewer decides (SD-21). */
export const check = object({
  version,
  verdict: oneOf(["approve", "changes"], "changes if any blocking finding is open"),
  findings: list(findingInput, "new findings"),
  fixed: texts("open findings this version fixes"),
  ran: object({ pass: count("pass"), fail: count("fail"), unverifiable: count("unverifiable") }, ["pass", "fail", "unverifiable"]),
  verdicts: list(object({ check: text("an agent eval it is the named checker of, e.g. des:payment.send"), result, detail: text("expected and seen", 600) }, ["check", "result", "detail"]), "agent verdicts (reviewer only)"),
}, ["version", "verdict", "findings", "fixed"]);

/** The diagnoser's input at stage 0 and in today's API; its role's input at stage 1. */
export const diagnoserInput = object({
  task: object({ id: text("K-n, or the key"), key: text("the plan's key"), title: text("title", 80), goal: text("goal", 1000), brief }, ["key", "title", "goal", "brief"]),
  pair: object({ id: text("P-n"), round: count("round"), state: oneOf(["making", "gating", "checking", "converged", "signalled", "diagnosing", "merged", "stopped"], "PairState"), spentUsd: { type: "number", minimum: 0 }, budgetUsd: { type: "number", minimum: 0 } }, ["round", "state", "spentUsd", "budgetUsd"]),
  signal: object({
    kind: oneOf(["regression", "defect_in_fix", "round", "budget", "stalled", "provider", "question", "sandbox", "head_regression"], "Signal.kind"),
    finding: text("F-n"), check: text("eval id"), round: count("round"), spentUsd: { type: "number" }, budgetUsd: { type: "number" },
    minutes: count("minutes"), provider: text("provider"), error: text("error"), text: text("question"), detail: text("detail"),
    checks: texts("regressed evals"), merged: texts("tasks merged in between"),
  }, ["kind"]),
  history: texts("the pair's entries, one line each, oldest first"),
  findings: list(finding, "every finding of the pair"),
  verdicts: list(object({ check: text("eval id"), result, version, detail: text("detail", 600) }, ["check", "result", "version"]), "the pair's verdicts"),
  handovers: texts("each maker's handover, oldest first"),
}, ["task", "pair", "signal", "history", "findings", "verdicts", "handovers"]);

/** Diagnosis (swarm.md 4.8); kind environment is needed (SD-11). */
export const diagnosis = object({
  cause: text("what went wrong and why, with evidence ids", 600),
  kind: oneOf(["plan", "execution", "environment"], "plan: the task or its record; execution: the work; environment: sandbox, devnet, provider"),
  ripple: texts("task keys, record keys and lanes it also touches"),
  options: { ...list(object({ label: text("kebab-case"), text: text("what happens if chosen") }, ["label", "text"]), "2 to 4"), minItems: 2, maxItems: 4 },
  recommendation: text("one option's label"),
}, ["cause", "kind", "ripple", "options", "recommendation"]);

/** The researcher's own input and result. */
export const researchInput = object({ question: text("one sentence ending in ?"), context: text("facts and links", 4000), task: text("the task key it serves") }, ["question"]);
export const researchResult = object({
  answer: text("facts, each traceable to a source", 2000),
  recommendation: text("one sentence: what to do"),
  sources: { ...texts("path:line, factory:<path>:<line>, or a URL"), minItems: 1 },
}, ["answer", "recommendation", "sources"]);
```

### 10.4 Today's API (the dry run)

Today a manager is a router, workers are named by string, every worker has its own `input` and `result`, and rounds
are driven by CI and a rule, as swarmD's own team runs (how-to/run-a-pair, "Today: CI drives the rounds"). This form
exists for the dry run only (swarm.md 1.2, post-mortem O1): one Capxul task end to end on the deployed swarm, on the
cheap tier. It has no fresh maker, no delta review, no engine gate and no ledger; its builder keeps one conversation per
task, bound to the pull request, and checker findings come back to it as notes.

```ts
// .swarmd/today/master.ts (built: reference/manager "defineRouter")
import { api, defineRouter, github, pi, schedule } from "@swarmd/agent";

export default defineRouter({
  name: "master",
  description: "Builds Capxul from its design book: one task of docs/mission/tasks.json per lane, built, checked and merged into integration/build.",
  model: { tier: "cheap", thinking: "low" },
  instructions: "../prompts/master.md",
  dispatches: [
    { worker: "builder", models: ["gateway/gpt-6.1-sol"] },
    { worker: "reviewer" },
    { worker: "adversary" },
    { worker: "diagnoser" },
    { worker: "researcher" },
  ],
  sources: [
    pi({ allow: ["@maintainers"] }),
    github({ repos: ["AaronAbuUsama/capxul-next"], allow: ["@maintainers"] }),
    api({ allow: ["@maintainers", "ci-bot"] }),
    schedule({ schedules: [{ name: "sweep", every: "30m", text: "Sweep: a pair with no message for 30 minutes is stalled; a matter waiting over 4 hours gets one reminder; fill free pair slots from the frontier." }] }),
  ],
  rules: [
    { name: "pr-checks", when: "CI says a pull request the builder opened was opened or updated: check it with the reviewer, and the adversary on a money task.", mode: "auto", sources: ["api"], limits: { acceptsPerDay: 48, maxOpen: 6 } },
  ],
  connectors: {
    github: ["issues.get", "issues.listComments", "issues.createComment", "issues.addLabels", "pulls.get", "pulls.list", "pulls.listFiles", "checks.listForRef", "repos.getContent"],
  },
  icon: ":building_construction:",
});
```

The dry run's router holds no `pulls.merge`. Today a router can merge only by its model's judgment, which is the retro's
D7 failure: it merged on a condition that ignored unverifiable lines. So the dry run ends at a converged pull request,
and Mission Control merges it through the release gate (swarm.md section 6), as at stage 0.

```ts
// .swarmd/today/builder.ts (built: reference/worker)
import { defineWorker, sandbox } from "@swarmd/agent";
import { handback, makerInput } from "../schemas.ts";

export default defineWorker({
  name: "builder",
  description: "Makes one Capxul task's evals pass on its lane branch, book first, inside the task's paths, and opens the task's pull request.",
  model: { provider: "gateway", modelId: "gpt-6.1-sol", thinking: "high" },
  instructions: "../prompts/builder.md",
  concurrency: 4,
  input: makerInput,
  result: handback,
  sandbox: sandbox.repo("github:AaronAbuUsama/capxul-next"),
  connectors: { github: ["pulls.create", "pulls.get", "pulls.update", "issues.createComment"] },
  icon: ":hammer_and_wrench:",
});
```

```ts
// .swarmd/today/reviewer.ts, adversary.ts, diagnoser.ts, researcher.ts (built)
import { defineWorker, sandbox } from "@swarmd/agent";
import { check, checkerInput, diagnoserInput, diagnosis, researchInput, researchResult } from "../schemas.ts";

const sonnet = { provider: "anthropic", modelId: "claude-sonnet-5-5", thinking: "high" } as const;
const repo = sandbox.repo("github:AaronAbuUsama/capxul-next");          // read-only is planned; the prompt forbids writes

export const reviewer = defineWorker({
  name: "reviewer",
  description: "Checks one version of a Capxul task against its evals and the repository's rules, on another model family, and decides des:. Changes nothing.",
  model: sonnet, instructions: "../prompts/reviewer.md", concurrency: 4,
  input: checkerInput, result: check, sandbox: repo,
  connectors: { github: ["pulls.get", "pulls.listFiles", "issues.createComment"] },   // posts its CHECK comment until SD-13
});
export const adversary = defineWorker({
  name: "adversary",
  description: "Tries to break the money paths of one version of a Capxul money task. Changes nothing.",
  model: sonnet, instructions: "../prompts/adversary.md", concurrency: 2,
  input: checkerInput, result: check, sandbox: repo,
  connectors: { github: ["pulls.get", "pulls.listFiles", "issues.createComment"] },
});
export const diagnoser = defineWorker({
  name: "diagnoser",
  description: "Diagnoses a Capxul pair that stopped converging. Changes nothing.",
  model: sonnet, instructions: "../prompts/diagnoser.md", concurrency: 1,
  input: diagnoserInput, result: diagnosis, sandbox: repo,
});
export const researcher = defineWorker({
  name: "researcher",
  description: "Answers one question about the book, the old system or a library, with sources and a recommendation. Writes no code.",
  model: { tier: "cheap", thinking: "medium" }, instructions: "../prompts/researcher.md", concurrency: 1,
  input: researchInput, result: researchResult, sandbox: repo,
});
```

In `.swarmd/today/` each is its own file with that worker as its default export, as `swarmd up` takes one definition
per file; they are shown here as named exports in one block.

### 10.5 The prompts

swarmD prepends its built-in prompt (and, for the master, the `build` template's); each file below holds only the role.
Their rules are assumptions to test and delete (swarmD's Zen, rule 6). The Claude Code profiles (section 11) carry the
same text, with a section on where they run at stage 0.

**`prompts/master.md`** is `docs/mission/initializer.md` whole, followed by swarm.md section 1b's skeleton
(`swarm.master-prompt`), followed by: "Every artifact you produce follows docs/design/swarm-templates.md: decide 7.1,
matters 7.2 and 7.3, tasks 8, room messages 9.4."

**`prompts/builder.md`**

```md
You make one Capxul task's evals pass. They are the definition of done; the steps are yours. You never report done:
verdicts do.
- Read the brief: the goal, the evals with their claims, the record, the paths, the decisions, the open findings and
  the last handover. Load the book, evals and lane skills; the money skill on a money task.
- Work on your branch, inside the task's paths. Book first: if the code must differ from the record, change the record
  in its concept's folder with a decision record, rebuild the book to 0 problems, regenerate tasks.json, then the code.
- Never change packages/evals, packages/book, src/generated/ by hand, or another concept's records. Never weaken,
  skip or retire an eval. Read the old system for behaviour; never port it. Regenerate src/generated/ and tasks.json
  with their generators after a record changes; those are the only files outside your paths you may change.
- Push only your task's branch. Never push integration/build or main, change a pull request's base, or merge.
- Run the gates (npm run --silent check) and your evals (run_evals) before you submit. Address every open finding, or
  dispute it in your note with why.
- At your first submit open the task's pull request (pulls.create, base integration/build) with the body of
  .github/pull_request_template.md; update it at every submit (pulls.update).
- submit: the note in its four parts (Changed, Should move, Ran, Disputes). handover, when asked: Done, Left, Decisions,
  Where. Something needed outside your paths is a Left line "outside <path>: <what>", never a change.
- Ask the manager only about a real fork the brief, the book and the decisions leave open: the question, your
  recommendation, what it blocks.
```

**`prompts/reviewer.md`**

```md
You check one version of a Capxul task. You change nothing and merge nothing.
- From round 2 read the delta since the version you last checked, the code around each change, and whether each open
  finding is fixed. In round 1 read the whole change.
- Check, in order: each eval (does the code make its claim true, and would the eval fail if it were not); book first
  (a record change has its decision, a rewritten claim keeps the frozen claim first in was); the repository's rules
  (system.layout: doors, generated files, tenant-first keys; swarm.scope: only the task's paths); and that no eval is
  weakened. Run evals to settle a doubt rather than guess.
- A finding: the eval it threatens or the rule it breaks, where, then Seen, Expected, Fix. Blocking if it threatens an
  eval or breaks a rule; advisory otherwise, and always advisory outside the task's paths ("Outside this task's
  paths: … Owner: <lane>").
- On an operation task decide des:<operation> by its rubric and put it in your check's verdicts.
- changes if any blocking finding is open; otherwise approve. Never approve with one open, never suggest weakening an
  eval, no praise.
```

**`prompts/adversary.md`**

```md
You are the adversary on one version of a Capxul money task. You change nothing. Break the money paths.
- Read the delta, and the whole of each money-path file it touches. Load the money skill: K1 to K18 of
  docs/as-is/payments.md, and the old system's money code for its edge cases.
- Try: idempotency (a crash or a retry between a side effect and its record; a replay), authorization (a caller
  without the seat, role or allowance; another tenant; a counterparty beyond its admission), double spend, rounding
  (minor units, decimals), chain reverts (a reverted operation, a mismatched receipt, a nonce gap, a reorg).
- Report only attacks that land: a blocking finding whose text starts "Attack:" with the steps, then Seen, Expected,
  Fix, naming the eval it threatens. Run the evals or a script to show it.
- approve only when no attack lands. You post no des: verdict.
```

**`prompts/diagnoser.md`**

```md
A Capxul pair stopped converging. Find out why before anyone spends more. You change nothing.
- Read the evidence first: the signal, the verdicts, the findings with their versions, the diffs, the record and the
  old system's code at its was. Read the makers' handovers last, so you do not inherit their framing.
- Return one diagnosis: the cause with its evidence ids; its kind (execution: the work on the task; plan: the task or
  its record cannot be built as written; environment: the sandbox, the devnet or a provider); its ripple; two to four
  options; your recommendation. Never "try again" without a cause, and never an option that weakens an eval.
```

**`prompts/researcher.md`**

```md
Answer one question about Capxul's design book, the old system or a library. Write no code and change nothing.
- Read the book and its decisions first, then the old system (factory:<path>), then documentation the sandbox reaches.
- Return the answer (facts, each with a source), one recommendation, and the sources (path:line or a URL).
```

### 10.6 The skills

Repository knowledge, loaded when needed (`swarm.skills`; planned, pass-through needed, SD-16). Each is a folder with a
`SKILL.md` that points at the repository's own documents rather than copying them:

| Skill | Holds | Points at |
|---|---|---|
| `book` | how records, links, decisions and the build work; book first; the four book checks | `docs/design-book.md`, `books/target/CONVENTIONS.md`, `docs/decisions/README.md` |
| `evals` | the eval kinds and ids, the worlds, how to run them (`npm run eval`), what each result means, never weakening one | `docs/spec/30-capxul-evals.md`, the B2 harness |
| `lane` | the layout (`system.layout`), doors, generated files, branches, the pull request template, the gate's scope rule | `books/target/shared/decisions.ts` (`system.layout`), this page |
| `money` | the money paths, K1 to K18, activities at least once, claim-before-call, the adversary's properties | `docs/as-is/payments.md`, `rules.activity-once`, section 4.3 |
| `old-system` | where the old code lives, how to read a record's `was`, never porting it | `/workspace/factory` (stage 1), `/home/user/factory` (stage 0), `docs/mission/findings.md` |

## 11. The Claude Code profiles (stage 0)

At stage 0 Mission Control runs the loop with the same roles as Claude Code agent profiles in `.claude/agents/`
(`swarm.stage0-profiles`). Each profile's body is the role's prompt (10.5) with what it reads, does, may not do and
returns, and a section on where it runs before swarmD.

| Profile | Role | Model | Tools | Returns (one json block) |
|---|---|---|---|---|
| [`master`](../../.claude/agents/master.md) | capxul/master as Mission Control | the session's | Read, Grep, Glob, Bash, Edit, Write, Agent, GitHub (issues, pull requests, merge) | — (it writes the artifacts of 7, 8 and 9) |
| [`builder`](../../.claude/agents/builder.md) | maker | opus | Read, Grep, Glob, Bash, Edit, Write, GitHub (create and update a pull request) | submit with its handover (3.1, 3.2) |
| [`reviewer`](../../.claude/agents/reviewer.md) | checker | sonnet | Read, Grep, Glob, Bash, GitHub (read a pull request) | check with `des:` verdicts (4.1, 4.4) |
| [`adversary`](../../.claude/agents/adversary.md) | checker on money tasks | sonnet | as the reviewer | check (4.1, 4.3) |
| [`diagnoser`](../../.claude/agents/diagnoser.md) | diagnoser | sonnet | Read, Grep, Glob, Bash, GitHub (read) | diagnosis (6.1) |
| [`researcher`](../../.claude/agents/researcher.md) | researcher | haiku | Read, Grep, Glob, Bash, WebFetch, WebSearch | research answer (6.2) |

At stage 0 a checker runs on a different model of the same family as the maker: the only family the Claude session
has. Another family arrives at stage 1 (`swarm.checker-family`).

## 12. Briefs for swarmD this page adds

In neither swarmD's docs nor its code; each is written for swarmD's orchestrator to file, beside SD-1 to SD-20 and SD-26 to SD-28 (swarm.md section 7).

| # | Brief | Acceptance |
|---|---|---|
| SD-21 | **A checker posts its agent verdicts through its check.** `check` gains `verdicts: { check, result, detail }[]` for the agent checks the checker is the named checker of; the engine posts each as `verdict.post` under the checker's actor, with the check's text as `review` evidence. Today no worker tool posts an agent verdict, though the ledger says only the named checker may. | A reviewer's check with a `des:` verdict appends that verdict by the reviewer's actor; a `des:` verdict in the adversary's check, or one for a machine check, is refused |
| SD-22 | **Agent and person verdicts carry across merges.** At a merge, each agent and person verdict at the converged version is carried to the merge commit, and it stays current at later heads of the target until a commit changes a path of its task's (`brief.paths`), or its check's definition changes in the catalogue. Today a verdict counts only at the exact head, so after a squash merge, or any later merge, every agent check is `unknown` and no task with one is ever `done`. | After a merge, `des:x` reads pass at the new head; after a later merge touching only another lane's paths, still pass; after a commit to its task's paths, `unknown` |
| SD-23 | **A matter names its subject and takes a typed resolution.** `Matter.subject` (`"decision:<id>"`, so the portal and the applier find it) and `resolution.answer` (the portal's `ReviewAnswer`: `answer`, `option`, `text`, `seenAt`), where `matter.resolve` takes only text today (portal.md, "What other designs provide"). | A decision matter resolved with `{ answer: "choose", option: "opus" }` reads back typed, and `matters?subject=decision:x` finds it |
| SD-24 | **A fresh maker gets the pair's branch and pull request.** `MakerInput` gains `branch` and `pr`, `CheckerInput` gains `pr` and the round's submit `note`, and the pull request's thread binding moves from each maker's ticket to the next, so a person's comment on the pull request reaches the current maker and its merge ends the pair, not a superseded ticket. | In a two-round pair, round 2's maker updates the same pull request, and a comment there after round 2 starts reaches round 2's maker |
| SD-25 | **`decide` can answer a question.** `continue` takes an optional `note` (at most 600 characters) that reaches the asking assignment as its answer, so a worker's `question` to the manager is answered in the pair, not only by a post in the thread. | A question signal answered with `continue` and a note resumes the worker with the note as its input |

## 13. The decisions

All in [`books/target/shared/swarm.ts`](../../books/target/shared/swarm.ts), section "the templates".

| Id | Choice |
|---|---|
| `swarm.templates` | Every artifact has one template, field for field its schema; bodies render fixed headings; a worker's answer is one json block; workers ask the manager, never a person |
| `swarm.task-cards` | One issue form per kind that gets a pair (no journey card: journeys are watch tasks); at stage 0 Mission Control opens a card per task in flight, at stage 1 none; people open only review answers, decision packs and defects |
| `swarm.hand-tasks` | Defects are `defect:<lane>/<slug>` with existing failing or threatened evals; review tasks `review:<decision>` with `dec:<decision>/review`; a split's children `<parent key>/split-<n>`, every parent eval in one child; a finding with no eval opens nothing |
| `swarm.pr-mirror` | The builder writes the pull request body; every other event is a marked comment posted by code (Mission Control at stage 0) |
| `swarm.agent-verdicts` | The reviewer posts `des:` through its check (SD-21), and it counts at the head until its task's paths change (SD-22) |
| `swarm.stage0-profiles` | At stage 0 the roles run as Claude Code profiles with the swarmD prompts: opus maker, sonnet checkers and diagnoser, haiku researcher |
| `swarm.team-definition` | The team declared in swarmD's documented API for stage 1, and in today's API for the dry run, with its models, grants, limits and schemas |

## 14. Open items for other owners

- **The swarm design and `tools/plan-tasks.ts`:** a `--brief <key>` mode that prints a task's `MakerInput` (2.1) from
  the plan and the book (its claims, deciders, decisions and `was`), so Mission Control never composes a brief by hand;
  and leave `dec:<decision>/review` evals unowned by any derived task (`swarm.hand-tasks`), since only review tasks name
  them.
- **D0 (`packages/book`, the portal design):** with the decision's `review` field (`portal.review-state`), derive one
  machine eval per reviewed decision, `dec:<id>/review`, passing when its state is `accepted` or `changed` with a `ref`.
  A review task needs it to be done by its eval rather than by its merge.
- **B2 (`packages/evals`, spec 30):** the runner's `list` prints `des:` with `check: { checker: "reviewer", rubric }`,
  the rubric of 4.4.
- **T0 (the tooling design):** create the labels of 9.6 once, beside branch protection.
- **swarmD's orchestrator:** the briefs SD-21 to SD-25, beside SD-1 to SD-20 and SD-26 to SD-28. swarmD's software-factory domain page still
  shows four managers, a designer and a legacy baseline; spec 40 now says what replaced them.
