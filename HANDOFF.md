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
   the ten policies), accepted by Aaron on 7 November 2026, and his decisions of 8 November (the
   freeze keeps behaviour, not spelling; the old system is not a baseline; the as-is book is
   closed).
3. `docs/spec/50-design-book.md`: the record schema; code in `packages/book`.
4. `books/target/CONVENTIONS.md` and `docs/decisions/target-architecture.md`: the target concept
   map and the rules every target concept follows.
5. `docs/mission/findings.md` and `docs/as-is/payments.md`: what is wrong with the old system. The
   old system is a reference for behaviour (edge cases, contract reverts, money paths,
   permissions), never ported and never run as a baseline.

## Set up a session

```bash
git clone https://github.com/AaronAbuUsama/capxul-next /home/user/capxul-next
cd /home/user/capxul-next && git checkout claude/infrastructure-refactor-plan-v41iue && pnpm install
# the old system, read only, as a reference for behaviour (agents read it at this path):
git clone --branch integration/factory --depth 1 https://github.com/Xelmar-tech/infrastructure /home/user/factory
pnpm exec tsc -p packages/book && pnpm test   # 21 tests
pnpm exec tsc -p books                                      # the books typecheck
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
| 3 | Target architecture: concept map (23 concepts, no cycles), components, kept errors, integrations, v4 contracts, decisions | done: `books/target/shared/` and `docs/decisions/target-architecture.md` |
| 4 | Target design of each concept | done: all 23 concepts, each with its decisions (projects came with the Frappe redesign) |
| 5 | Target book assembled and built with the target rules | done: 3,255 records, 0 problems, 8,027 evals, 1,005 decisions; 13 journeys; the row-policy admissions and wait keys the generators need; `tools/check-frozen.ts` 0 breaches (every operation booked once, every behaviour kept, 165 operations beyond the 215, each serving an Aaron ruling); 79 known gaps, each owned (listed in the goal prompt) |
| 6 | The goal prompt | done: `docs/mission/initializer.md` |
| 7 | Design lanes for the build's own machinery | done: tooling (`docs/design/tooling.md`), the portal (`portal.md`), the swarm (`swarm.md`, `swarm-templates.md`, `.claude/agents/`, `.github/` templates, `tools/plan-tasks.ts` and `docs/mission/tasks.json`) and the one clock (`time.md`) |
| 8 | Aaron's rulings of 8 November 2026 | recorded in `books/target/shared/rulings.ts` and applied: seats, contact permissions, money-waiting email and reminders, machine login, the portal generator, claim trust, budget payments to someone with no account, buying seats |
| 9 | The Frappe redesign | done: books in ERPNext accounting's shapes, payroll in Frappe HR's, the CRM in Frappe CRM's, a new projects concept, organization start-up with its FDE agent, and the head integration (`docs/design/frappe/`); the cross-concept assembly in `docs/design/frappe/assembly-items.md` |
| 10 | The hill-climbing starter kit | built and verified from a fresh clone; kept as `kit/hillclimb-kit.bundle` (`kit/README.md`). The build starts from it |
| 11 | The new commands and the general escrow (Aaron's sixth and seventh batches) | done: one grammar for every command beyond the 215 (`docs/design/new-commands.md`), 90 booked under `rules.new-operations`; the general escrow (`docs/design/escrow.md`); authority by department (`docs/design/authority.md`) |
| 12 | The world pass (Aaron's eighth batch, 9 November 2026) | done: the world clock's rate and world-owned channels (`dev time set --rate`, the shared world, `docs/design/time.md` section 7); the document family over the Core SDK and the CLI (`org doc`, `org doctype`, `org doc-call`); the CRM's conversations (email, WhatsApp, calls, notes and tasks on one timeline); HR in payroll (holidays, leave, shifts and attendance, expense claims and advances); `payment claim`; anyone may ask the FDE, which acts as its asker. 165 commands beyond the 215 in all; open questions 39 to 49 in `docs/decisions/open-for-aaron.md` |

This work **prepares** the rebuild; it does not run it. No product code is written here. To start
the build, open a session on this repository and give it `docs/mission/initializer.md` as its goal.
Its first task is the B0 spike, which proves Effect Workflow on Postgres (kill and resume, a signal,
a timer, wake routing).

## Checks

```bash
pnpm exec tsc -p packages/book && pnpm test
pnpm exec tsc -p books
node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target   # 0 problems
node --experimental-strip-types tools/check-frozen.ts                                           # 0 breaches: every behaviour kept, every new operation booked by a ruling
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
- `handoff-cold-read.js`: a cold-start build session and a fact checker, reading the handoff.
- `handoff-freeze-flags-and-journeys.js`: the old CLI's flags into `books/frozen/flags.ts`
  (reference), and the 13 journeys into `books/target/journeys.ts`, each with a reviewer.
- `book-returns-and-generation-fields.js`: the row-policy admissions and wait routing keys the
  generators need, with an adversarial reviewer. Its `returns` task was never run: Aaron's
  `system.frozen-behaviour` made the old `--json` shapes free.

Later scripts:

- `design-*.js`: the design lanes (tooling, portal, swarm, time), Aaron's rulings and the vision,
  and the Frappe lanes (`design-frappe.js`, its lanes given as arguments), each a designer and an
  adversarial reviewer.
- `frappe-assembly.js`: the Frappe lanes' cross-concept items and the follow-up rulings, by owning
  group, then a builder.
- `commands-and-escrow.js`: the one grammar, the authority audit, the general escrow and the five
  command packs, each a designer with two reviewers, then a builder.
- `world-pass.js`: Aaron's eighth batch (the world clock, the document family, the CRM's
  conversations, HR, `payment claim`, the FDE for anyone), a designer and two reviewers per lane, then
  a builder.
- `build-hillclimb-kit*.js`, `kit-swarm-dx.js` and `kit-provable-evals.js`: the starter kit.

The as-is scripts (`book-as-is-*.js`, `book-payments-assemble.js`) are kept as history. They
write to `books/as-is/`, which is now archived in `docs/as-is/archive/`.

The designers' and the assembly's reports are in `docs/decisions/concept-reports.json` and
`docs/decisions/assembly-items.md`. Every judgment is a decision record, and the judgments report
(`docs/decisions/judgments.md`) lists them all, with the ones for Aaron first.

## Lessons that save usage

- Use a workflow only for workflow-shaped work: independent pieces that run in parallel, or a
  maker followed by a reviewer. Do single edits, checks, reconciling, commits and merges directly.

- Sixteen agents at once spent a five-hour usage window in about 36 minutes. Run 4 to 6 at a time.
- A writer followed by an adversarial reviewer found real errors in every file it reviewed. For
  money concepts (payments, books, banking, requests, payroll, budgets) a reviewer is worth it.
- Commit and push after every finished lane: a stopped agent loses only its own unwritten work.
- Agent reports are exported into `docs/as-is/lane-reports/` so findings survive the session.

## Not in this repository

- The decision board was a claude.ai page in Aaron's account; every answer on it is recorded in
  `docs/decisions/README.md`.
- The starter kit has no repository yet; `kit/hillclimb-kit.bundle` is a git bundle of it, and
  `git clone kit/hillclimb-kit.bundle /home/user/hillclimb-kit` restores it with its history.
- swarmD (`AaronAbuUsama/swarmd`) is a separate repository. Its specs for the ledger, managers and
  pairs are here in `docs/spec/10-swarmd-ledger.md` and `20-swarmd-managers-and-pairs.md`.
