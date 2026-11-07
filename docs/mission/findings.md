# Findings: the old system and swarmD (7 November 2026)

An audit of `Xelmar-tech/infrastructure` on branch `integration/factory` (head
`0d2be303e`, 3,336 commits ahead of `master`) and of `aaronabuusama/swarmd` on
`main`. Counts come from grep and wc, so they are close, not exact. Use them as
a baseline and a list of what not to repeat. They are not a specification.

## Size

The repository is about 1M lines of TypeScript and Solidity:

| Package | Lines |
|---|---|
| backend | 368k (47% tests) |
| SDK | 132k |
| CLI | 91k |
| contracts | 85k |
| protocol | 73k (14.8k is one ABI file) |
| scenarios | 66k |
| tools | 68k |
| observability | 16k |

There are 156k lines of Markdown on top of that. For comparison, swarmD's
server is 3.7k lines and has a line budget.

## The book (`apps/docs/factory/`)

- **Records:**
  - operations: 215, of which 180 carry `acceptance:` lines
  - areas: 11
  - journeys: 13
  - slices: W0–W10
  - contracts: 22
  - components: 7
  - decisions: 30
  - exemptions: 35
  - evidence: 1,453 JSON files
  - proofs: 1,410 devnet JSON files
- **Schema:** `packages/tools/src/modules/docs/internal/book/fields*.ts`.
- **Operations per area:**

  | Area | Operations |
  |---|---|
  | governance | 43 |
  | accounts | 36 |
  | payments | 33 |
  | equity | 30 |
  | books | 16 |
  | devnet | 15 |
  | departments | 12 |
  | payroll | 11 |
  | banking | 8 |
  | organizations | 6 |
  | activity | 5 |

- **Acceptance lines:** 733 in all. Each names a test file, for example
  `(backend save.test.ts)`, and the line resolves to the whole file, never to a
  test case.
  - In effect that is 152 file-level pass bits.
  - 445 of the lines name a file whose basename is not unique.
  - No line is tied to the assertion it describes.
- **Status is derived three ways, and they disagree:**
  - layer readiness: 97 done
  - the funnel: 161 built, 0 proven, because every unit run makes every older
    devnet proof stale
  - `apps/factory` evals: unused; no record writes `evals:`
- **The contract layer has no evidence producer,** so it can never go green.
- **Evidence and proofs are committed to git:** 209 MB and 100 MB.
  - Of 1,550 commits to the book in five days, about 650 are bot commits and
    344 are merge commits.
  - Most of the recent `apps/factory` work was about proof staleness.
- **The book does not specify:**
  - latency budgets
  - the events or spans an operation emits (52 records list events; the rest
    are derived after the fact)
  - failures other than refusals
  - the database tables an operation touches
  - the contract calls an operation makes (only prose in `designed.call`)
- **Worth keeping:**
  - The operation record as the hub, with its command, sdk, returns, refusals,
    mistakes, who and the designed example.
  - Decisions as records.
  - Status derived from evidence, never typed.
  - Evidence keyed to file hashes.
  - "The list only shrinks."
  - Exemptions that must name a ticket.

## Backend (`packages/backend`, Convex and Effect)

- **Layout:** ADR-0031's concept and area shape
  (`docs/adr/0031-concept-modules-and-operation-rows.md`), with 17 concepts.
- **The good template:** `organizations/invitations/operations/invite.ts`, an
  entry file of 27 lines whose steps read top to bottom:
  `signedIn → requireAdmin → findReplay → ensureGrantee → createInvitation → admitInvitee → inviteSent → viewAs`.
  Even so, one operation touches 7–8 files, and about two thirds of the area is
  ceremony.
- **Two code styles stacked:**
  - 876 legacy `async …InTx` functions run under Effect wrappers, joined by 996
    `attempt(` bridges. 449 of those are `attempt([], …)`.
  - There are 692 `throw`s.
  - Input is decoded twice: Convex `v.*` (about 2,456 uses) and Effect Schema.
- **Plumbing spelled out by hand:**
  - 456 internal operations against 285 public ones
  - 257 hand-typed `FunctionReference`s
  - 46 `*-intent` and `load-*` mutations
  - 37 `emit-*` operations whose only job is to send telemetry
  - 410 `runQuery`, `runMutation` and `runAction` calls
  - 134 `runAfter` and `runAt` calls
- **Copy-paste:**
  - `decodeUserOp` is copied ×10, `withChain` ×11, `CHAIN_FAILURES` ×14.
  - There are 858 imports across concepts.
  - Cycles: organizations↔permissions (76 and 37 imports) and accounts↔payments
    (21 each).
- **Long functions:** 103 non-test files are over 250 lines, and 158
  functions are over 80 lines. All of the longest are legacy async.
- **The database:**
  - 106 tables and 299 indexes, with pre-v4 and v4 shapes side by side.
  - 626 optional fields.
  - `v.any` bags marked "needs a data migration".
  - Test tables (`devnetMail`, `e2eReceiptHolds`) sit in the production schema.
- **Speed:**
  - Convex has a 4 s module-load limit, and the bundle budget is 3.1 MB for the
    largest entry and 1.7 MB median.
  - Actions nest mutations, and every hop is its own function with its own
    load.
  - User reads call the chain, with a 10 s budget.
  - Receipt waits run up to 120 s.
- **What the platform core does:** `platform/operation.ts`
  (`implement(row, recipe)`) and `execute.ts` together make a good, small
  core. Observation, at 4.7k lines in the platform, is where the weight is.

## Public API and layering

- **The surfaces:**
  - CLI: 191 commands (`capxul schema`, `apps/cli/src/commands/schema/catalog.ts`)
  - Core SDK: 349 methods
  - React: 30 pages
  - MCP: 11 tools
  - HTTP: 15 routes, plus `/api/auth/*` from BetterAuth
  - error codes: 61 (`packages/protocol/src/errors/codes.ts`)
  - Convex functions: 748 exported, of which 285 are typed protocol rows
- **How the book maps onto them:**
  - All 191 CLI commands have a record, and 24 records have no command.
  - Book to SDK covers about 160 of 349 methods.
  - Book to rows reaches about 151 of 285 rows.
- **One operation is described about six times:** the row, the book record,
  the CLI help, the SDK types (933 re-declared), the error copy (CLI refusal
  mapping 1.5k lines, SDK 1.4k) and the telemetry names
  (`packages/observability/src/operations/*`).
- **The CLI holds orchestration logic** that duplicates the SDK: about 20k lines
  of helpers. 64 CLI files import the protocol package directly, around the SDK.
- **The SDK has real logic of its own:** signing and UserOperations (1.9k),
  transport (6.3k), observability (2.7k) and test harness (5.6k). It also uses
  27 live subscriptions, over Convex `convex/browser`.
- **Convex features used:**
  - live queries for the React hooks
  - the scheduler (134 call sites)
  - file storage (13)
  - `"use node"` actions (4)
  - `@convex-dev/better-auth` (BetterAuth with an OIDC provider and bearer
    tokens)
  - `@convex-dev/resend`
  - HTTP routes, including the Bridge webhook

## Contracts

- **v4** (`packages/contracts/v4`) has 49 `.sol` files (about 9.7k lines): 17
  contracts in money, equity, authority, companies-house, agents and libraries.
- **Its tests:** 392 test files (about 43k lines), 154 bulloak trees and 14
  Certora specs.
- **Deployment:** devnet only (`v4/deployments/devnet.json`).
- **Old contracts still live:** V2 and V3 (`CapxulPaymentsV3`,
  `CapxulEscrowFactory`, `PayrollDepartments`) are on devnet and staging beside
  v4. The indexer reads no v4 events.
- **The build discipline, in `docs/planning/protocol-v4/`:**
  - a behaviour tree per function
  - every test red on stubs that revert
  - green through numbered gates (`verification-loop.md`)
  - independent review
  - a port record per PR

  13 of 13 merged.

## Telemetry, events and errors

- **The names:**
  - one catalog, `@capxul/observability`, with 109 product events and 13
    journeys
  - about 63 `events.ts` producer files
  - wide events per operation: backend, SDK and CLI
- **It reaches PostHog through about eight channels:**
  - product events
  - one wide event per operation
  - `$exception` for defects
  - `*_expected_outcome` for refusals
  - OTLP spans from four services
  - console markers
  - a few metrics
  - a telemetry relay
- **Duplication:**
  - One failure is recorded up to four times.
  - Duration is recorded twice, with different sampling.
  - The error code has three names: `error_kind`, `failure_code` and
    `error_code`.
  - Journeys are defined twice, in two vocabularies (backend operation names in
    the catalog, CLI ids in the book), and nothing checks one against the
    other.
- **Tracing:**
  - A W3C `traceparent` travels from the CLI to the SDK and on into the Convex
    call args, and the backend continues it.
  - Child spans exist only for chain and provider calls (7 `withSpan` in the
    backend).
  - Queries make neither a span nor a log. A failing mutation makes nothing.
- **p95:**
  - Per operation, only after the fact in PostHog: `duration_ms` on
    `capxul_backend_operation`, read by `scout-slow-ops`.
  - None per step or per query.
  - No runtime latency budget fails a check. Only the bundle size and the
    800 ms of CLI start-up CPU are gated.
- **The error contract is the strongest part:**
  - one code catalog
  - a failure class derived from code and mode that says who acts
  - refusal versus defect, decided by `EXPECTED_OPERATION_OUTCOMES`
  - one failure row, `failureProperties`

  See ADR-0023 and ADR-0039 and `packages/protocol/src/errors/`.
- **Baseline:** `docs/research/performance-baseline-2026-10.md` is a one-off
  study of staging with re-runnable SQL. Its 9-command CLI session took 49.4 s,
  and real-user LCP p50 was 22.2 s on the organization dashboard.
- **Self-driving scouts:** 12 scheduled agents (`docs/canon/self-driving.md`,
  `.agents/skills/scout-*`) read PostHog and GitHub after the fact and file
  issues or open one fix PR each. Most of them run variants of three queries.

## The old repo's swarm runs

- The branches `swarm/w1-*` to `swarm/w4-*` (5–6 November) ran one operation
  per branch, on models named `-sol` and `-flash`. They were committed as
  "Capxul swarm" through `apps/factory`, a Pi-durable spike running in E2B
  sandboxes.
- They ran into proof staleness and evidence churn.

## swarmD (`aaronabuusama/swarmd`)

- **What it is:** durable agent organizations on Cloudflare (Durable Objects,
  containers, R2), built on pi-durable. It is deployed at
  `https://swarmd-server.thedao.workers.dev`, with docs at
  `https://swarmd-docs.thedao.workers.dev`.
- **A router** is always on, small in context, and opens tickets; it never does
  the work. **Workers** finish one ticket each, against an input and result
  JSON Schema, in a sandbox. The model is set per ticket from tiers.
- **The dogfood team is in `dogfood/`:** the router `swarmd`, with builder,
  reviewer, verifier and researcher workers, running on `openai/gpt-6.1-sol`.
- **How the merge works today:**
  1. A builder's PR targets `agent/integration`.
  2. CI asks the router for a reviewer and a verifier at each head.
  3. Their findings go back to the builder.
  4. The router merges into `agent/integration`.
  5. An orchestrator takes it into `main`.
  - This depends on GitHub: the PRs, CI, `swarmd-checks.yml` and the App token.
  - A sandbox is a copy of the folder at `up`, or a `github:` clone.
- **What is built:** gate, tickets, containers with snapshots and R2 backup,
  crash recovery, versions, the control plane (HTTP and WebSocket, CLI,
  client), Pi views, rules, `schedule` and `conditions` sources, metrics, the
  model registry and tiers, the GitHub connector (live) and Slack (code only).
- **Pairs:** builder with reviewer and verifier is built and proven once (#53:
  one round, $0.77). The loop itself is planned: the router cannot yet open
  the next ticket from a ticket's result, so CI drives the rounds.
- **Not built:**
  - hierarchy: routers of routers, the `swarm` source, attention bubbling up,
    metric roll-up
  - budget enforcement
  - persistent workers and artifacts
  - MCP for workers
  - sandbox prebuild (a cold golden build of a monorepo takes about 8 minutes)
- **The retro of 6 November** (`docs/planning/swarm-retro-2026-11-06.md`, Aaron's
  decisions D1–D9):
  - #46 went 4 rounds for $4.92 without converging.
  - The swarm stalled silently when the OpenAI credit ran out.
  - Nine ranked fixes, briefs 01–09 in `docs/planning/swarm-retro-briefs/`:
    1. merge past `unverifiable` lines
    2. a fresh builder each round, and delta review
    3. units and a design stage
    4. convergence signals and diagnosis
    5. a mission ledger
    6. a $5 budget per mission
    7. GitHub connector retries
    8. the CLI drains stdout before exiting
    9. a provider outage pauses the namespace and says so
- **D3 is the same idea as this rebuild.** A mission goes to a designer, which
  writes the docs and splits the work into units, usually operations, each with
  evals:
  - the DX
  - the operation's signature and return
  - its events, declared in an event library
  - its spans and logs
  - its errors, each reachable
  - the evidence kind
  - what it depends on

  A design reviewer approves the design, and each unit becomes one builder
  ticket.
