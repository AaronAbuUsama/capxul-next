# Handoff: continue the Capxul rebuild design from any account

This repository is everything. Nothing needed lives outside it: the decisions, the evidence, the
scripts and the state are all committed on the branch `claude/infrastructure-refactor-plan-v41iue`.
A new session needs no access to the conversation that made it.

## What this is

Capxul is being rebuilt from first principles behind a frozen surface: the CLI and the 215
operations of the old book. The rebuild is specified as a **design book**: typed records (in Effect
Schema) for every part of the system, linked by import, checked by a build that enforces the
accepted policies and derives the gaps and the evals. Building the code comes after the book.

Read, in order:

1. `docs/decisions/README.md`: every accepted decision (stack, durable execution, decomposition,
   the ten policies), all accepted by Aaron on 7 November 2026.
2. `docs/spec/50-design-book.md`: the record schema; code in `packages/book`.
3. `books/target/CONVENTIONS.md` and `docs/decisions/target-architecture.md`: the target concept
   map and the rules every target concept follows.
4. `docs/mission/findings.md` and `docs/as-is/payments.md`: what is wrong with the old system.

## Set up a session

```bash
git clone https://github.com/AaronAbuUsama/capxul-next /home/user/capxul-next
cd /home/user/capxul-next && git checkout claude/infrastructure-refactor-plan-v41iue && npm install
# the old system, read only, for evidence (agents read it at this path):
git clone --branch integration/factory --depth 1 https://github.com/Xelmar-tech/infrastructure /home/user/factory
npx tsc -p packages/book && npm test -w @capxul/book   # 14 tests
npx tsc -p books                                      # the books typecheck
node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target
```

The prompts in `tools/workflows/` use the absolute paths `/home/user/capxul-next` and
`/home/user/factory`. Clone to those paths, or change them in the scripts.

## Where it stands

| # | Milestone | State |
|---|---|---|
| 1 | Schema for the accepted decisions; frozen text of all 215 operations; conventions | done |
| 2 | As-is book of the old system | paused on purpose: 15 of 21 lanes written, payments fully reviewed. It is evidence only; target designers read the old code where it has gaps. Remaining lanes: `docs/mission/remaining-work.md` |
| 3 | Target architecture: concept map (22 concepts, no cycles), components, kept errors, integrations, v4 contracts, decisions | see `books/target/shared/` and `docs/decisions/target-architecture.md` |
| 4 | Target design of each concept | next, in the order below |
| 5 | Target book built with the target rules, zero problems | after 4 |
| 6 | Spike: Effect Workflow on Postgres survives kill and resume, a signal and a timer | after 5, needs Postgres |
| 7 | Rewrite `docs/mission/initializer.md` around the finished book for the build phase | last |

## How to continue milestone 4

Run `tools/workflows/book-target-concepts.js` with the Workflow tool (`scriptPath`), passing
`{ concepts: [{ id, brief }] }`, two to four concepts per run. Each designer writes
`books/target/<concept>/`, records every judgment in its `decisions.ts`, and checks itself with the
target build. Order, critical path first:

1. access, accounts, organizations, parties, contacts
2. payments (one durable process per Payment), books, requests
3. budgets, approvals, banking, payroll, documents, activity, notices
4. applications, indexing, media, devnet, agents
5. board, equity (low priority: directors and voting are off the critical path)

Without the Workflow tool, run each concept's prompt (the `CONTEXT` text in the script plus
`YOUR CONCEPT: <id>`) as a subagent or a separate session; the instructions are self-contained.

Then milestone 5: build `books/target/index.ts` with all concepts, fix every problem, and report
the evals, the gaps, the decisions and the size of the target against the old system.

## Lessons that save usage

- Sixteen agents at once spent a five-hour usage window in about 36 minutes. Run 4 to 6 at a time.
- A writer followed by an adversarial reviewer found real errors in every file it reviewed. For
  money concepts (payments, books, banking, requests, payroll, budgets) a reviewer is worth it.
- Commit and push after every finished lane: a stopped agent loses only its own unwritten work.
- Agent reports are exported into `docs/as-is/lane-reports/` so findings survive the session.

## Not in this repository

- The decision board was a claude.ai page in Aaron's account; every answer on it is recorded in
  `docs/decisions/README.md`.
- swarmD (`AaronAbuUsama/swarmd`) is a separate repository. Its specs for the ledger, managers and
  pairs are here in `docs/spec/10-swarmd-ledger.md` and `20-swarmd-managers-and-pairs.md`.
