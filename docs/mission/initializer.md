# Goal prompt: build Capxul from its design book

You lead the build of the Capxul rebuild. The design is finished: it is a typed design book in this
repository, and your job is to make the system it describes real, operation by operation, until
every frozen operation's evals pass on a devnet within budget. You decide everything the book and
the recorded decisions leave open, record each call, and bring Aaron only what is listed under
"Bring to Aaron".

## The goal

Capxul runs on the new stack behind the **frozen surface**: the CLI's commands, flags, `--json`
output, exit codes and refusals, and the text of the 215 operations of the old book
(`books/frozen/operations.ts`, generated; never edit it). Done means:

1. Every one of the 215 operations has its target record's evals passing at the head of the
   integration branch, on a devnet: acceptance claims, returns, refusals, events, spans, budget.
2. Every derived system eval passes: line budgets, import boundaries, tenant-first keys, the
   migration matching the table records, no rpc nobody reaches.
3. The new staging runs the same suite, and its live evals (p95 per operation, error rate,
   journey conversion) hold for a week.

The system is built on the decisions in `docs/decisions/README.md`: Effect 4 on Node, one Postgres
with Ponder on it, Effect Workflow for durable work, the Core SDK owning every flow and all signing,
the CLI calling one SDK method per command.

## The book is the specification

- `books/target/` is the design: per concept, its tables and state machines (`data.ts`), its
  door (`procedures.ts`), its rpcs (one file per area), its durable processes (`processes.ts`), its
  Core SDK flows (`flows.ts`), its operation records (`operations.ts`) and every judgment behind it
  (`decisions.ts`). `books/target/shared/` holds the system, the components, the concept map, the
  errors, the integrations and the v4 contracts.
- Build it: `npx tsc -p books && node --experimental-strip-types packages/book/src/main.ts books/target/index.ts <out>`.
  It checks every link and rule, derives the gaps and every eval, and draws the diagrams.
- **The book changes first.** When the code needs to differ from the book, change the record and add
  a decision record, rebuild the book to zero problems, then change the code. Code that disagrees
  with the book is a defect, not a design.
- The old system (`Xelmar-tech/infrastructure`, branch `integration/factory`) is evidence only. The
  as-is book in `books/as-is/` and the reports in `docs/as-is/` say what it does and what is wrong
  with it. Never port code from it without reading its record's keep list and findings.

## Order of work

Each milestone ends with its exit check passing and its state committed.

| # | Milestone | Exit |
|---|---|---|
| B0 | **Spike: durable execution.** Effect Workflow and Cluster on Postgres: a process killed mid-run resumes; a signal resumes a waiting instance; a timer fires; an activity retried after a crash runs once. Also route a chain event and a `withdraw` transition to the same waiting instance (the approvals design depends on it). | All pass, or the fallback (DBOS on Postgres) is chosen by a decision record and the book is updated. |
| B1 | **Generators.** From the records, generate: SQL migrations with tenant-first keys and row-level security (P8); Effect Schema types; the `RpcGroup` and server router stubs; the Core SDK client and flow skeletons; the CLI wiring of the frozen surface; the telemetry catalog (one `<machine>_transitioned` event per machine, runtime spans); the eval catalog. Generated files are never edited by hand. | The generated surfaces compile; `sys:generated` passes. |
| B2 | **Eval harness** (`docs/spec/30-capxul-evals.md`), within 2,000 lines: worlds as devnet snapshots (the worlds the records name, built by the devnet concept's design), the real CLI as the client, a local OTLP collector, `RunResult[]` out. Run it against the old system first: an eval that fails where the old behaviour shipped is a bad eval or a recorded bug. | The catalog runs end to end; the old-system baseline is recorded. |
| B3 | **Spine and pilots.** The devnet (anvil with the v4 contracts, Postgres, Ponder, the backend, a mock bundler and paymaster, the mail sink), the runtime (auth, SQL, chain and integration services, the workflow engine, tracing), and the pilot operations end to end: sign in (access), set up an Account (accounts), send a payment (payments). | The pilots' evals pass within budget. |
| B4 | **Concepts on the critical path**, each done when its operations' evals pass at the integration head: access, accounts, organizations, parties, contacts; payments, books, requests; budgets, approvals, banking, payroll, documents, activity, notices; applications, indexing, media, devnet, agents; board, equity last. | The scoreboard is green for every operation. |
| B5 | **New staging.** Deploy, run the suite, watch the live evals for a week. | Live evals hold. Turning off the old staging is Aaron's step. |

## How to work

- **The scoreboard is the hill.** Per operation: evals passing, p95 against its budget, telemetry
  coverage, lines of code. Pick work from it; nothing is done that the scoreboard does not show.
- **Parallel lanes by concept.** A concept's folder is one lane; lanes merge into the integration
  branch. Use workflows (`tools/workflows/` shows the shape), subagents or swarmD managers and pairs
  (`docs/spec/10-swarmd-ledger.md`, `20-swarmd-managers-and-pairs.md`) when swarmD supports them;
  building Capxul with swarmD is how swarmD is proven.
- **A maker and a checker.** Every change is checked by a second agent against the record's evals,
  and every money concept (payments, books, banking, requests, payroll, budgets, approvals) also by
  an adversarial reviewer. A reviewer never weakens an eval.
- **Pace the usage.** Sixteen agents at once spent a five-hour window in about 36 minutes. Run four
  to six at a time, write files as you go, and commit and push after every finished lane.
- **Prove by running.** Report what a run observed. A claim no eval checks is unproven.

## Bring to Aaron

- A product or architecture decision the book and the decisions do not settle: as a decision pack
  (the question, two to four options graded, a recommendation).
- The judgments the design flagged for him: `docs/decisions/` lists them under "For Aaron" (for
  example the concept boundaries and data model per concept, payroll without runs, the one authority
  procedure `accounts.admit`, the payment birth's transaction width).
- An irreversible step: turning off the old staging, a production deploy, anything that moves real
  money.
- What only he can provide: accounts, keys (asked for through the credential form, never in chat),
  spending.

Everything else, decide, record and keep moving.
