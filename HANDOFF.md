# Handoff: continue the Capxul rebuild design from any account

This repository is everything. Nothing needed lives outside it: the decisions, the evidence, the
scripts and the state are all committed on the branch `claude/infrastructure-refactor-plan-v41iue`.
A new session needs no access to the conversation that made it.

## What this is

Capxul is being rebuilt from first principles. The old book's 215 operations are kept as the list
of capabilities, and what each acceptance claim requires to happen is kept as its evals. The
spelling is not frozen: flags, `--json` shapes, refusal codes and wording are the new design's
(Aaron's decision `system.frozen-behaviour`). The rebuild is specified as a **design book**: typed records (in Effect
Schema) for every part of the system, linked by import, checked by a build that enforces the
accepted policies and derives the gaps and the evals. Building the code comes after the book.

Read, in order:

1. `docs/design-book.md`: how the book works, how its pieces fit, and how it is used end to end
   (design, generate, evaluate, the factory, the docs site).
2. `docs/decisions/README.md`: every accepted decision (stack, durable execution, decomposition,
   the ten policies), all accepted by Aaron on 7 November 2026.
3. `docs/spec/50-design-book.md`: the record schema; code in `packages/book`.
4. `books/target/CONVENTIONS.md` and `docs/decisions/target-architecture.md`: the target concept
   map and the rules every target concept follows.
5. `docs/mission/findings.md` and `docs/as-is/payments.md`: what is wrong with the old system. The
   old system is a reference for behaviour (edge cases, contract reverts, money paths,
   permissions), never ported and never run as a baseline.

## Set up a session

```bash
git clone https://github.com/AaronAbuUsama/capxul-next /home/user/capxul-next
cd /home/user/capxul-next && git checkout claude/infrastructure-refactor-plan-v41iue && npm install
# the old system, read only, as a reference for behaviour (agents read it at this path):
git clone --branch integration/factory --depth 1 https://github.com/Xelmar-tech/infrastructure /home/user/factory
npx tsc -p packages/book && npm test -w @capxul/book   # 16 tests
npx tsc -p books                                      # the books typecheck
node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target
```

A throwaway Postgres for the B0 spike, before the devnet exists (initdb refuses root, so it runs
as the `postgres` user; clients connect with host `/tmp/pg-spike` and port 55432):

```bash
mkdir -p /tmp/pg-spike && chown postgres /tmp/pg-spike
su postgres -s /bin/sh -c '/usr/lib/postgresql/16/bin/initdb -D /tmp/pg-spike/data -A trust -U postgres'
su postgres -s /bin/sh -c '/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg-spike/data -o "-k /tmp/pg-spike -p 55432 -c listen_addresses=" -l /tmp/pg-spike/log -w start'
psql -h /tmp/pg-spike -p 55432 -U postgres -c 'select 1'
```

The prompts in `tools/workflows/` use the absolute paths `/home/user/capxul-next` and
`/home/user/factory`. Clone to those paths, or change them in the scripts.

## Where it stands

| # | Milestone | State |
|---|---|---|
| 1 | Schema for the accepted decisions; the old text of all 215 operations, and the old CLI's flags, as reference; conventions | done |
| 2 | As-is book of the old system | closed: the reviewed payments lane (`docs/as-is/payments.md`, K1 to K18), `docs/mission/findings.md` and the lane reports are kept; the unfinished lanes are archived in `docs/as-is/archive/`, outside every typecheck |
| 3 | Target architecture: concept map (22 concepts, no cycles), components, kept errors, integrations, v4 contracts, decisions | done: `books/target/shared/` and `docs/decisions/target-architecture.md` |
| 4 | Target design of each concept | done: all 22 concepts, each with its decisions |
| 5 | Target book assembled and built with the target rules | done: 0 problems; `tools/check-frozen.ts` 0 breaches (every operation booked once, every behaviour kept); the known gaps are listed in the goal prompt |
| 6 | The goal prompt | done: `docs/mission/initializer.md` |

This work **prepares** the rebuild; it does not run it. No product code is written here. To start
the build, open a session on this repository and give it `docs/mission/initializer.md` as its goal.
Its first task is the B0 spike, which proves Effect Workflow on Postgres (kill and resume, a signal,
a timer, wake routing).

## Checks

```bash
npx tsc -p packages/book && npm test -w @capxul/book
npx tsc -p books
node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target   # 0 problems
node --experimental-strip-types tools/check-frozen.ts                                           # 0 breaches: every behaviour kept
node --experimental-strip-types tools/report-judgments.ts > docs/decisions/judgments.md        # regenerate
```

## How the book was made

The scripts in `tools/workflows/` wrote the book with the Workflow tool, and are kept to show the
shape:

- `book-target-architecture.js`: the architecture.
- `book-target-concepts.js`: concept designers, two to four per run, critical path first.
- `book-target-assemble.js`: the cross-concept items, resolved by owning group, then a builder to
  zero problems.
- `book-frozen-refusals.js`: a fixer and an adversarial reviewer per concept for the refusals
  `check-frozen` found dropped.

The designers' and the assembly's reports are in `docs/decisions/concept-reports.json` and
`docs/decisions/assembly-items.md`. Every judgment is a decision record, and the judgments report
(`docs/decisions/judgments.md`) lists them all, with the ones for Aaron first.

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
