# Goal prompt: build Capxul from its design book

You lead the build of the Capxul rebuild. The design is finished: it is a typed design book in this
repository. Your job is to make the system it describes real, operation by operation, until every
frozen operation's evals pass on a devnet within budget. You decide everything the book and the
recorded decisions leave open, record each call, and bring Aaron only what is listed under "Bring
to Aaron".

Start by reading `docs/design-book.md`. It explains how the book works, how its pieces fit and how
it is used from a record to production. Then read `HANDOFF.md` to set up the session.

## The goal

Capxul runs on the new stack behind the **frozen surface**, which is:

- the CLI's commands, flags, `--json` output, exit codes and refusals;
- the text of the old book's 215 operations, in `books/frozen/operations.ts`. That file is
  generated: never edit it.

Done means all four of these hold:

1. **Every operation passes.** Each of the 215 operations has its target record's evals passing at
   the head of the integration branch, on a devnet: acceptance claims, returns, refusals, events,
   spans and budget.
2. **Every system eval passes:**
   - import boundaries and tenant-first keys;
   - the migration matches the table records;
   - no rpc that nothing reaches;
   - each concept within its line budget.
3. **The code is small.** Hand-written product code is at most 100,000 non-test, non-generated
   lines, about a quarter of the old system's 400,000. The decision is `system.size`. You set each
   concept's own line budget after the pilots, from what they measure.
4. **Staging holds.** The new staging runs the same suite, and its live evals hold for a week: p95
   per operation, error rate and journey conversion.

The system is built on the decisions in `docs/decisions/README.md`:

- Effect 4 on Node;
- one Postgres, with Ponder on it;
- Effect Workflow for durable work;
- the Core SDK owning every flow and all signing;
- the CLI calling one SDK method per command.

## The book is the specification

- **Where the design is.** `books/target/` is the design. Each concept folder holds:
  - its tables and state machines (`data.ts`);
  - its door, the procedures other concepts invoke (`procedures.ts`);
  - its rpcs and durable processes, one file per area;
  - its Core SDK flows (`flows.ts`);
  - its operation records (`operations.ts`);
  - every judgment behind it (`decisions.ts`).

  `books/target/shared/` holds the system, the components, the concept map, the errors, the
  integrations and the v4 contracts.
- **The checks.** These must all pass before any change merges:

  ```bash
  npx tsc -p packages/book && npm test -w @capxul/book          # the record system
  npx tsc -p books                                                # the target and frozen books typecheck
  node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target   # 0 problems
  node --experimental-strip-types tools/check-frozen.ts           # 0 breaches of the frozen surface
  ```

  - The build checks every link and rule, derives the gaps and every eval, and draws the diagrams.
  - `check-frozen` checks four things:
    - every frozen operation has its record, with the frozen command and title;
    - every acceptance line is kept word for word, or changed with the frozen claim kept in its
      `was`;
    - every refusal is still a refusal, both the page's and those of its designed v4 block;
    - a dropped refusal is allowed only when a decision on the operation names it.
- **The book changes first.** When the code needs to differ from the book:
  1. change the record and add a decision record;
  2. rebuild the book to zero problems;
  3. change the code.

  Code that disagrees with the book is a defect, not a design.
- **The old system is evidence only.** It is `Xelmar-tech/infrastructure`, branch
  `integration/factory`. The as-is book in `books/as-is/` and the reports in `docs/as-is/` say what
  it does and what is wrong with it. Never port code from it without reading its record's keep list
  and findings.

## Where the book stands at handoff

| | |
|---|---|
| Records | 2,098 in the target book: 22 concepts, 215 operations, 606 decision records and every table, machine, process, rpc, procedure and flow under them |
| Derived evals | 4,534 |
| Problems | 0, with the target rules on |
| Frozen surface | All 215 operations are booked once each. Of the 733 acceptance lines, 547 are kept word for word, 173 are changed with the frozen claim kept, and 13 are retired. `check-frozen` reports 0 breaches. |
| Gaps | 72, listed below, each known and owned |

The 72 gaps, and who closes them:

| Gap | Count | What it is | Who closes it |
|---|---|---|---|
| `no-acceptance` | 35 | Equity and devnet pages that had no acceptance lines in the old book, plus `dev.fund` and `waitlist.invites.grant` | Their returns, refusals and events are still evals. New acceptance lines need Aaron (decision `equity.acceptance`). |
| `unconsumed-chain-event` | 14 | Chain events that only indexing's views read, or that nothing uses yet | You, when a process or view needs them. Otherwise leave them. |
| `uncalled-function` | 13 | Hats Elections and the Installer's calls, which wait for the board's seat groups; `budgets.setHat`; `escrow-factory.predictAddress`; `governor.castVote`; the vesting grant calls | Board and equity (low priority) |
| `refusal-without-world` | 6 | Refusals no devnet world can reach yet: unreachable or staging-only paths, each recorded by its concept | Devnet, at B2, when it builds the worlds |
| `unused-call` | 3 | PostHog capture and telemetry export (the outbox relay, `rules.outbox`), and `chain-rpc.getTransactionReceipt` | The runtime, at B3 |
| `unwritten-table` | 1 | Devnet's `mail-messages`, which the mail sink writes, not the backend | Devnet |

The assembly also left these open outside the book:
- **Runtime:** the row-level security clause for `verification-people`.
- **The B0 spike:** proving wake routing (`rules.process-wakeups`).
- **`packages/devnet`:** the supervisor controls, including `bridge return`, `gates seed` and the
  CLI-home snapshot.
- **Protocol:** the email template renderers.
- **Backend HTTP layer:** `applications.origin-token`.
- **Reviewer:** sign-off on `payments.birth-width`, which is wider than the transaction-width rule
  allows.

## Order of work

Each milestone ends with its exit check passing and its state committed.

| # | Milestone | Exit |
|---|---|---|
| B0 | **Spike: durable execution.** Effect Workflow and Cluster on Postgres. Prove that: a process killed mid-run resumes; a signal resumes a waiting instance; a timer fires; an activity retried after a crash runs once. Also route a chain event and a `withdraw` transition, by their routing keys, to the same waiting instance (`rules.process-wakeups`; the approvals design depends on it). | All pass. Otherwise a decision record chooses the fallback (DBOS on Postgres), and the book is updated. |
| B1 | **Generators.** From the records, generate: SQL migrations with tenant-first keys and row-level security (P8); Effect Schema types; the `RpcGroup` and the server router stubs; the Core SDK client and flow skeletons; the CLI wiring of the frozen surface; the telemetry catalogue (one `<machine>_transitioned` event per machine, plus runtime spans); the eval catalogue. Nobody edits generated files by hand. | The generated surfaces compile, and `sys:generated` passes. |
| B2 | **Eval harness** (`docs/spec/30-capxul-evals.md`), within 2,000 lines. Its worlds are devnet snapshots: the worlds the records name, built by the devnet concept's design. It drives the real CLI as the client, uses a local OTLP collector, and outputs `RunResult[]`. Run it against the old system first: an eval that fails where the old behaviour shipped is either a bad eval or a recorded bug. | The catalogue runs end to end, and the old-system baseline is recorded. |
| B3 | **Spine and pilots.** The devnet: anvil with the v4 contracts, Postgres, Ponder, the backend, a mock bundler and paymaster, and the mail sink. The runtime: auth, SQL, chain and integration services, the workflow engine and tracing. Then the pilot operations end to end: sign in (access), set up an Account (accounts) and send a payment (payments). From the pilots' measured lines per operation, set each concept's line budget (`system.size`). | The pilots' evals pass within budget, and the line budgets are recorded. |
| B4 | **Concepts on the critical path.** Each concept is done when its operations' evals pass at the integration head. The order: access, accounts, organizations, parties, contacts; payments, books, requests; budgets, approvals, banking, payroll, documents, activity, notices; applications, indexing, media, devnet, agents; board and equity last. | The scoreboard is green for every operation. |
| B5 | **New staging.** Deploy, run the suite and watch the live evals for a week. | The live evals hold. Turning off the old staging is Aaron's step. |

## How to work

- **The scoreboard is the hill.** For each operation it shows:
  - the evals passing;
  - p95 against its budget;
  - telemetry coverage;
  - lines of code.

  Pick work from it. Nothing is done that the scoreboard does not show.
- **Run parallel lanes, one per concept.** A concept's folder is one lane, and lanes merge into the
  integration branch. Use workflows (`tools/workflows/` shows the shape) or subagents. When swarmD
  supports them, use swarmD managers and pairs (`docs/spec/10-swarmd-ledger.md` and
  `20-swarmd-managers-and-pairs.md`): building Capxul with swarmD is how swarmD is proven. The link
  graph gives each lane's order: an operation's flow, its rpcs, their procedures and their tables.
- **Pair a maker with a checker.** A second agent checks every change against the record's evals.
  Every money concept (payments, books, banking, requests, payroll, budgets and approvals) also gets
  an adversarial reviewer. A reviewer never weakens an eval.
- **Pace the usage.** Sixteen agents at once spent a five-hour usage window in about 36 minutes. Run
  four to six at a time, write files as you go, and commit and push after every finished lane.
- **Prove by running.** Report what a run observed. A claim no eval checks is unproven.

## Bring to Aaron

- **Open product or architecture decisions.** Bring any decision the book and the recorded
  decisions do not settle as a decision pack: the question, two to four graded options and a
  recommendation.
- **The judgments flagged for him.** `docs/decisions/judgments.md` lists 15 under "For Aaron".
  Among them:
  - payroll without runs or groups (`payroll.scope`);
  - the payment birth's transaction width (`payments.birth-width`);
  - a global directory of Parties (`parties.directory-tenancy`);
  - the one authority procedure (`procedures.accounts-admit`);
  - Organization-owned agents (`agents.org-owned`);
  - the Board's `failed` status (`board.failed-proposal`);
  - members writing the books (`contacts.members-write`);
  - equity's operations with no acceptance lines (`equity.acceptance`);
  - the size budget (`system.size`).

  Each recorded choice stands, and you build to it, until he changes it. His change goes into the
  record first.
- **Irreversible steps.** For example: turning off the old staging, a production deploy, or
  anything that moves real money.
- **What only he can provide:** accounts, keys and spending. Ask for keys through the credential
  form, never in chat.

Everything else, decide, record and keep moving.
