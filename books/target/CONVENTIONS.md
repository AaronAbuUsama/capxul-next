# Designing the target: conventions for every concept designer

The **target** book is the design of the rebuilt Capxul: Effect 4 on Node with one Postgres, Ponder
on the same Postgres, Protocol v4 only, every one of the 215 operations kept as a capability, with
its behaviour (`system.frozen-behaviour`: the freeze keeps behaviour, not spelling). It is built with stage
`"target"`, which turns the accepted policies into build rules (`checkTargetRules` in
`packages/book/src/build.ts`). A target book with a problem does not build.

Read first, in this order:

1. `books/target/shared/foundation.ts`: the 22 concepts, what each owns and what it may depend on,
   and `OPERATION_OWNERS`, which names the concept that designs each frozen operation.
2. `docs/decisions/target-architecture.md`: why the map is this way. Its judgments are the
   decision records in `books/target/shared/decisions.ts`.
3. `docs/decisions/policy-pack.md` (P1 to P10, accepted) and `docs/decisions/README.md` (A1 to A4).
4. The schema, `packages/book/src/records/*.ts`, with its reading guide `docs/spec/50-design-book.md`.
5. The evidence: the old code, read only, at `/home/user/factory` (branch `integration/factory`),
   read for behaviour and edge cases (contract reverts, money paths, permissions), never ported;
   `docs/mission/findings.md`; `docs/as-is/payments.md` (the reviewed payments lane, K1 to K18);
   and, as an archive, the unfinished as-is records in `docs/as-is/archive/`. `OLD_AREAS` in `books/target/shared/landings.ts` lists every old area
   folder, the target concepts it lands in and the decision that put it there: design every area
   that lands in your concept, and nothing that does not.

The target records what will be. Never copy old code or an archived as-is record: design the
target one, and point its `was` at what it replaces.

## Folders

| What | File |
|---|---|
| system, components, concepts, environments, `OPERATION_OWNERS` | `shared/foundation.ts` (exists) |
| every error code | `shared/vocabulary.ts` (exists) |
| integrations and the v4 contracts | `shared/external.ts` (exists) |
| the architecture's decisions, including one `dependencies.of-<concept>` per concept | `shared/decisions.ts` (exists) |
| where every old area lands (`OLD_AREAS`) | `shared/landings.ts` (exists) |
| a concept's tables, state machines and each machine's event | `<concept>/data.ts` |
| a concept's door: the procedures other concepts invoke | `<concept>/procedures.ts` |
| a concept's rpcs, one file per area of the concept | `<concept>/<area>.ts` |
| a concept's durable processes (workflows) | `<concept>/processes.ts` |
| the Core SDK flows of a concept | `<concept>/flows.ts` |
| the operation records of the frozen operations the concept owns | `<concept>/operations.ts` |
| the concept's own judgments | `<concept>/decisions.ts` |
| the concept's module list | `<concept>/index.ts`: `export const modules = [data, procedures, …] as const;` |

Then add the concept to `books/target/index.ts` (`conceptModules`), in the order of
`shared/foundation.ts`.

## Imports

- The schema and the budget helper: `import { budget, defineTable, … } from "../../../packages/book/src/index.ts";`
- Effect: `import { Schema } from "effect";`
- Shared records: `../shared/foundation.ts`, `../shared/vocabulary.ts`, `../shared/external.ts`.
- Frozen text: `import { frozen, frozenText } from "../../frozen/index.ts";`
- Another concept's records, **only if your concept's `dependsOn` lists it**: from
  `../<concept>/<file>.ts`, by the conventional export name below, even while that file is being
  written. A procedure is imported only from `../<concept>/procedures.ts`, the door.
- Each file has one writer. Never define a record another file owns.

## Ids and export names

Ids match `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$`: lowercase, no camelCase. Codes are UPPER_SNAKE.

| Kind | id | export name |
|---|---|---|
| table | a plural noun, kebab: `payment-commands` | `table_<id, - → _>` |
| machine | the entity, kebab: `payment`, `approval` | `machine_<id, - → _>` |
| transition | the change, a verb in snake_case: `settle`, `mark_returned` | `machine_x.t.<name>` |
| event | `<machine id, - → _>_transitioned` | `event_<id>` |
| procedure | `<concept>.<verb-noun>`: `books.record-money-fact` | `procedure_<id, . and - → _>` |
| rpc | `<concept>.<area>.<verb>`: `payments.commands.prepare` | `rpc_<id, . and - → _>` |
| workflow | `<concept>.<area>.<name>`: `payments.dated.pay-on-date` | `workflow_<id, . and - → _>` |
| flow | the SDK method, kebab-cased, without `(orgId)`: `client.org.books.accounts.add` | `flow_<id, . and - → _>` |
| operation | the frozen id: `payment.send` | `operation_<id, . and - → _>` |
| decision | `<concept>.<topic>`: `payments.one-settlement-path` | `decision_<id, . and - → _>` |
| error, integration, call, contract | shared: import them | `error_<CODE>`, `integration_x.c.<call>`, `contract_x.f.<fn>`, `contract_x.e.<Event>` |

Columns are Postgres columns, in snake_case: `org_id`, `person_id`, `created_at`.

## The target rules

Each rule says what it enforces and whether the build checks it today (**built**) or a reviewer
does until its rule lands (**review**, with the rule's name from the policy pack).

### 1. Events: one per machine, defined beside it (P7) — built

- Every state machine sends exactly one event, `<machine>_transitioned`, from every transition
  that changes state. Define it in the same `data.ts`, just above its machine, with
  `defineEvent({ id: "payment_transitioned", props: Schema.Struct({ from, to, transition, … }) })`.
  Its props are `from`, `to`, `transition` and the ids a reader of the funnel needs (the row's id
  and its tenant: `org_id` or `person_id`); the envelope (trace_id, actor, environment) is added by
  the runtime.
- No rpc, workflow or procedure sends an event: their `emits` is `[]` (rule
  `event-not-on-transition`). Telemetry is never an operation: an rpc or workflow whose only effect
  would be an event does not exist (review: `emit-only`).
- The runtime writes the event to the outbox in the transition's transaction, and one relay sends
  it on. Do not book the outbox or a telemetry workflow (decision `rules.outbox`).

### 2. Budgets from the class defaults (P5) — built

- Every operation, rpc, flow and workflow has a `budget`. Take the class default:
  `budget: budget("write")`. The classes are `read`, `live-read`, `write`, `chain-read`,
  `chain-submit`, `chain-settle`, `vendor` and `background`; the numbers are in
  `packages/book/src/budgets.ts`.
- To leave the default, set the numbers and say why in one line:
  `budget: { ...budget("chain-read"), p95Ms: 2_500, why: "reads three contracts in sequence: each address depends on the last" }`
  (rule `budget-override-why`).
- An rpc, flow or workflow that calls the chain, the bundler or a vendor cannot take `read` or
  `write` (review: `budget-class-fit`). An operation's class is its CLI command's; an rpc's is its
  server share. A person's wait (`wait.person`) and chain confirmation (`chain.confirm`) are never
  system time.

### 3. Tenant first (P8) — built

- Every table names its `tenancy`: `organization` (column `org_id`), `person` (`person_id`),
  `owner` (`owner_kind`, `owner_id`, for a row a person or an Organization can own), `global`
  (no tenant column: every tenant may read every row, nothing private is in it, and only the owning
  concept's own procedures, rpcs and workflows write it: prices, flags, the directory of Parties;
  decision `rules.global-tenancy`) or `chain`.
- An `organization`, `person` or `owner` table names its `tenantField`, and its `key` and every
  index start with it (rule `tenant-key`). An index that must look across tenants (by a hash, by an
  address) says `crossTenant: true` and its `for` says why.
- No tenancy by join: a child row carries its own tenant column, even when its parent has one
  (review: `tenancy-by-join`).
- `chain` tables are Ponder's and belong to indexing only. Their `scope` says the join to parties'
  directory that scopes them to the caller's Safes. Nothing but Ponder writes them (review:
  `chain-read-scope`).
- Every index's `for` names the query it serves.
- A table that admits anyone besides its own tenant says so in `admits`, one clause each: who is
  matched, on which column or one-hop join, which rows, and whether they read or write. Examples
  are a Payment's payee, a request's paying Safe, a kept image and a payee's agreement writes. A
  `chain` table must have `admits`, and none of its clauses may write (rule `chain-admits`). Every
  clause is an eval, `tbl:<t>/admits/<n>`. A counterparty without a Seat reads a company's rows
  only through such a clause, never with elevated rights (decisions
  `rules.admissions-and-wait-keys` and `rules.counterparty-reads`).

### 4. Acceptance lines are claims (P1) — built

- An operation's `acceptance` is the frozen list, in order, each line
  `{ claim, observes, was }`; a retired line stays `null` so numbers never move (rule
  `acceptance-claim`).
- What each claim requires to happen is kept: that is the hill (`system.frozen-behaviour`). Its
  words may change. Keep the frozen claim where it reads as an outcome. Rewrite it where it names a
  mechanism a black box cannot see (a row, a cursor, a lane, a retry, a Convex function, PostHog),
  or where the target's own spelling (a command, a flag, an output field, an error code) differs.
  A rewritten line keeps the frozen claim first in `was`, and a decision on the operation says
  what changed. A retired line also has a decision. The old system is not run against: a rewritten
  line need not pass there.
- `observes` says which observers check it and what each sees: `cli` (output and exit), `read` (a
  read operation), `chain` (devnet state, calldata, logs), `trace` (the local collector) and
  `world` (a before-and-after diff of the world snapshot).
- On v4, the 29 lines opening "On v4", "On Protocol v4" or "On a v4" lose the opening; the two
  pre-v4-only lines are retired as `null` (P9).
- Build every operation from the frozen text, never retyped:
  `defineOperation({ ...frozenText("payment.send"), priority, implementedBy, acceptance, returns, refusals, errors, budget })`.
  Where the frozen record has a `designed` block, its v4 text is the best evidence of the
  intended behaviour.
- The spelling is the target's to design as one consistent system: the command (a rename has a
  decision), its flags (`books/frozen/flags.ts` is reference only; B1 designs them in the book),
  the `--json` shape (`returns`), and the refusal codes from the target's error vocabulary. A
  refusal is a behaviour, such as "a signed-out caller is refused": keep every frozen refusal's
  behaviour, under its code where the vocabulary keeps it, or name it in a decision.
- Priority: `low` for equity, `org.director.*`, `org.board.*`, `org.vote.*` and `vote.*`; `critical`
  for the B3 pilots' operations (`auth.login`, `auth.verify`, `account.retry`, `payment.send`);
  `normal` for the rest.

### 5. One durable process per long-lived object (A3, P3) — review

- An rpc is one transaction. Anything that waits (a signature, the chain, a date, a person, Bridge)
  or must survive a crash is a workflow.
- A long-lived business object is one workflow instance that owns its machine:
  `instance: { per: table_x }`, the rpcs that resume it in `signals`, what it waits on in `waits`
  (each wait is its own span and never system time), and its `idempotency` key. Decision
  `rules.durable-processes` lists the objects that must have one: an approval, a Payment (one
  process for its command and its date), a Board proposal, an Organization's setup, a personal
  Safe's setup, an agreement, a request, an invitation, a bank payout, a verification, an agent
  change and a round; and, added by their designers, an assistant grant, an identity document, a
  budget change, and an equity install, grant, sale and vote.
- Every wait except a timer has a `key`: what wakes it (an event, a chain event, a table, a signal
  rpc or the process's own call) and the properties that route it to exactly one instance. Examples
  are the opener and subject on `approval_transitioned` and `proposal_transitioned`, or the key
  Ponder's row carries (chain, sender, nonce; a payment id). The build checks that the carrier
  really carries those properties (rule `wait-key`; target rule `wait-without-key`), and each keyed
  wait is an eval, `wfl:<w>/wake/<wait>` (decisions `rules.process-wakeups` and
  `rules.admissions-and-wait-keys`).
- A `chain` or `indexer` wait lists the chain events that end it in `events`
  (`events: [contract_safe.e.ExecutionSuccess]`), so the book links the process to what it consumes
  (decision `rules.surfaces-and-wait-events`).
- A workflow's trigger is a transition (the outbox), a chain event (`contract_x.e.<Event>`, from
  Ponder), a timer of its own, or a cron. Only P3's crons survive: Bridge catch-up, Chainlink
  prices, feature flags, the daily client-grant sweep (now access' daily sweep of sessions, codes
  and assistant grants), the daily agreement notices and books' added-token scan. Everything the
  old system swept for is a process's own timer or a chain event.
- A workflow triggered `{ after: rpc }` says in its `about` why it cannot be a step: it must
  survive a crash, wait, or retry over seconds or more (review: `workflow-trigger`).

### 6. Procedures only for one money fact; the outbox for the rest (P4) — review

- A procedure is the only way to write another concept's table, inside the invoker's transaction,
  and only when both writes are **one money fact**: money moved, reserved, routed or owned. The
  accepted reading is decision `rules.procedures`. The procedures the architecture already names:
  `approvals.open`, `board.propose`, `parties.register`, `documents.store`,
  `books.record-money-fact`, `books.reverse-money-fact`, `payments.prepare-command` and
  `banking.match-deposit`, and one authority fact, `accounts.admit` (an Organization invitation
  admits its invitee to the beta; decision `procedures.accounts-admit`). A concept designer may add
  one only with a decision record that names its money fact.
- A procedure's `about` begins with `Money fact:` and the fact, for example
  `Money fact: a settled Payment always has its book fact.` (`accounts.admit` begins
  `Authority fact:`.) It makes no outside call.
- Everything else that must follow another concept's change (a notice, a projection, a state
  that may lag) is a workflow in the reacting concept, triggered by the other concept's
  transition. The reacting concept depends on the one that changed, never the reverse.
- A transaction invokes at most 3 procedures from at most 2 other concepts (review:
  `sys:tx-width`). Count what one run of the rpc or workflow invokes itself (its widest branch,
  where a person's branch opens an approval and an Organization's a proposal); a door's own
  invocations (`board.propose` opening `approvals.open`) count against the door. A wider
  transaction needs a decision record in the invoking concept, as `payments.birth-width` is
  (decision `rules.transaction-width`).

### 7. No unreached rpc (P2) — built

- Every rpc is reached by an operation (`implementedBy`), a flow's step, a workflow's `signals` or
  a `trigger` (rule `unreached-rpc`). An old method or row with no caller is not ported. A flow
  that serves a surface other than the CLI (the approval page, checkout, the web app, MCP) says
  which in its `about` and names it in `surfaces` (`["react"]`, `["sdk"]`), which the build reads
  instead of reporting it as an `unused-flow`; a flow that implements an operation keeps `cli`
  (rule `flow-surface`).
- Devnet-only rpcs live in the devnet concept, `who` starting `devnet only:`, and so does every
  devnet-only operation, even one that reads another concept's records (`dev mail notices` reads
  notices' delivery records; decision `operations.dev-mail-notices-in-devnet`).

### 8. One SDK flow per multi-step operation; the CLI calls one SDK method (A4) — review

- An operation is implemented by exactly one rpc or one flow. If its SDK method is one rpc call, it
  is `implementedBy` that rpc. If it composes rpcs and local steps (sign, wait, poll, prompt,
  build, cache), it is one flow in `<concept>/flows.ts`, with `component: component_core_sdk`.
- The CLI calls exactly that one SDK method and nothing else. The flow owns all signing: a
  `local: "sign"` step, then a `local: "wait"` for the person or the chain.
- A flow's steps may call rpcs of other concepts only through those concepts' rpcs, and its
  concept must depend on them. That is why a few operations live outside their area's concept:
  `auth login` and `auth verify` in accounts, `org member invite` in budgets (its grants include
  allowances), `invite accept` and `contact get` in banking (decisions `operations.*`). If your
  operation's flow needs a concept yours does not depend on, the flow belongs higher up: say so
  with a decision, never add the edge yourself.
- `spans` lists only extra local spans, named `sdk.step.*`, `call.*`, `workflow.step.*` or `wait.*`;
  the runtime derives the rest of the tree (P6).

### 9. The shared records are shared

- Every error code is in `shared/vocabulary.ts`; a concept never defines one (decision
  `vocabulary.shared-only`). An rpc lists in `errors` every error it raises and every failure of
  every call it makes (rule `call-error-not-declared`). An operation's refusals must be errors its
  implementation can produce (rule `refusal-not-produced`); `CLI_USAGE` and the CLI's own codes go
  in the operation's `errors`.
- A person who answers no to a terminal preview ends the command with `CANCELLED` (exit 130) and
  nothing is written; a script without `--confirm` is `CLI_USAGE` (decision
  `vocabulary.declined-preview-cancelled`). The flow whose `local: "prompt"` step asks lists
  `CANCELLED` in its `errors`.
- Outside calls name `integration_x.c.<call>` in `calls`; contract calls an rpc builds or sends
  name `contract_x.f.<fn>` in `chain`. A call or function you need that is not in
  `shared/external.ts` is a change to that file, with a decision.

### 10. Every judgment is a decision

- Each concept's own judgments (a table's shape, a machine's states, a dropped old operation, an
  override, a procedure) are `defineDecision` records in `<concept>/decisions.ts`, whose `affects`
  lists the records they shape.
- `was` on a target record points at what it replaces: old code (`<path>:<line>` in
  `/home/user/factory`) or an archived as-is record (`docs/as-is/archive/<concept>/<file>.ts`).

## Check your work

- Typecheck: `cd /home/user/capxul-next && pnpm exec tsc -p books 2>&1 | grep "books/target/<concept>"`.
  Fix every error in your files except unresolved imports of sibling files being written now.
- Build: `node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target`.
  It must report 0 problems. Gaps are expected until every concept lands, and are never written by
  hand.
- Keep prose short: `title` ≤ 80, `about` ≤ 2000, a line ≤ 300 characters. Write for a reader who
  has not seen the old system.
