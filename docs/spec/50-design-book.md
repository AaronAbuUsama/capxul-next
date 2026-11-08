# The design book

The book holds the whole design, not only operations. Every part of the system is a record:
typed, checked, linked to the records it depends on, and carrying the evals that say when it
is done. The code is in [`packages/book`](../../packages/book), about 1,500 lines; its tests pass. How the book
fits into the wider system, and how it is used end to end, is in [`docs/design-book.md`](../design-book.md).

This page is the schema's reading guide. The schema itself is
`packages/book/src/records/*.ts`, written in Effect Schema, and where they differ the code wins.

## Records are TypeScript, links are imports

```ts
export const invitations = defineTable({ id: "invitations", concept: organizations, tenancy: "organization", tenantField: "org_id", fields: Schema.Struct({ … }), … });
export const lifecycle = defineMachine({ id: "invitation", table: invitations, field: "status", initial: "pending", states: [ … ],
  transitions: { accept: { from: ["pending"], to: "accepted", emits: [invitation_transitioned] } } });
export const acceptRpc = defineRpc({ id: "organizations.invitations.accept", concept: organizations, kind: "mutation", writes: [invitations], drives: [lifecycle.t.accept], … });
export const accept = defineOperation({ ...frozenText("invite.accept"), implementedBy: acceptRpc, acceptance: [ … ], refusals: [ … ], budget: budget("write") });
```

- **Checks at two points.** Each `define*` validates its fields against the record's Effect
  Schema when the record is created, so a bad id or an over-long line throws at once. The
  compiler checks the kind of every link: `writes` takes tables, `drives` takes transitions.
- **No string references.** A link holds the record itself, so a rename is a refactor the
  compiler follows.
- **Schemas are values.** An operation's input and output, a table's fields and an event's
  properties are Effect Schemas held in the record. Code is generated from those same values.

## Layers: links only point down

```
System → Component → Concept → Table → State machine (transitions) → Event, Error
Integration (calls) under Component        Contract (functions, chain events)
Procedure → Concept, Table, Transition, Procedure, Event, Error          (in-transaction; no outside calls)
Rpc, Workflow → Concept, Table, Transition, Procedure, Call, Function, Event, Error
Flow → Component (the Core SDK), Rpc, Call, Error
Operation → Rpc or Flow (implementedBy), Error (refusals)                 (one of the 215 capabilities)
Journey → Operation        Invariant → Table, Machine, Workflow        Environment → Component
Decision → any record
```

Because links only point down, the book has no cycles. A record never lists who uses it.
"Which operations drive this transition" is a reverse link that the build computes.

## Record kinds

| Kind | Defined by | What it pins down |
|---|---|---|
| `system` | `defineSystem` | actors (person, agent, system) and surfaces |
| `component` | `defineComponent` | a running piece: runtime, what it exposes, `dependsOn`, budgets |
| `concept` | `defineConcept` | a domain module: its component, the concepts it may depend on, its line budget |
| `error` | `defineError` | code, class (ADR-0039), who acts, message, whether it can be retried, CLI exit code |
| `event` | `defineEvent` | name and its property schema |
| `table` | `defineTable` | owner concept, tenancy (organization, person, owner, global or chain), fields, key, indexes (each with the query it serves), retention, and `admits`: each party the row-level policy admits besides the tenant (for a chain table, all it admits), as one clause: how the session is matched (`tenant`, `safe` through parties' directory, `own-safe`, `email`, `anyone`), the column or a one-hop join (`via`), the rows (`where`), and whether it `reads` and `writes` |
| `machine` | `defineMachine` | the table and its state column, the states, and transitions (from, to, guard, events); each transition can be linked as `machine.t.<name>` |
| `integration` | `defineIntegration` | the outside system behind an Effect service: calls with timeout, retries, p95 and failures mapped to errors; the devnet fake; secret names. Each call can be linked as `integration.c.<name>` |
| `contract` | `defineContract` | addresses, functions (`contract.f.<name>`) and chain events (`contract.e.<name>`) |
| `procedure` | `defineProcedure` | a concept's in-transaction entry point, listed on its door: input, output, errors, what it touches. Another concept writes this concept's tables only by invoking one |
| `rpc` | `defineRpc` | one server endpoint (query, live, mutation, action): who, input, output, errors, what it touches (reads, writes, drives, invokes, calls, chain, emits), server spans, server budget. The generated `RpcGroup` comes from these |
| `flow` | `defineFlow` | a Core SDK composition: its SDK method, steps (an rpc, or a local step: sign, build, encrypt, wait, poll, prompt, cache), its own errors, client-side calls, spans, client budget, and `surfaces` when a surface other than the CLI calls it (the approval page, checkout or the web app on `react`, an agent's SDK host on `sdk`) |
| `operation` | `defineOperation` | **one of the 215 kept capabilities**: the old book's text as its starting point, its acceptance claims numbered (a retired line stays `null`), what `--json` returns, refusals with their `given` world, the end-to-end budget, and `implementedBy` one rpc or one flow. The capability and what its acceptance claims require are kept; its command, `--json` shape and refusal codes are the target's to design, and a change carries a decision (`system.frozen-behaviour`) |
| `workflow` | `defineWorkflow` | its trigger (after an rpc, a transition, a chain event, an indexer event or a cron), steps, what it touches, its waits (a wait on the chain or the indexer lists the chain events that end it in `events`; every wait but a timer names its `key`: each way it is woken, by its carriers (a product event, a chain event, a table's row, a signal rpc, or the instance's own call) and the properties they carry, with `reaches` for Ponder's progress passing a block), idempotency key, timeout, retries, compensation, budget |
| `journey` | `defineJourney` | ordered steps: operation, actor, proving event |
| `invariant` | `defineInvariant` | a statement over tables and machines; checked by property test, fuzz, reconciliation (`by` a workflow) or static check |
| `environment` | `defineEnvironment` | which components run where, config and secret names, deploy, boot budget |
| `decision` | `defineDecision` | question, options, choice, why, source, the records it affects |

## Rules: a broken one is a problem, and the book does not build

| Rule | When |
|---|---|
| `duplicate` | two records share a kind and an id |
| `dangling` | a link points at a record the book does not list |
| `undefined-link` | a link is `undefined` (an import cycle or a missing export) |
| `machine-initial`, `machine-state` | a state machine names a state it does not have |
| `write-boundary` | an rpc, workflow or procedure writes a table another concept owns (invoke that concept's procedure instead) |
| `read-boundary` | it reads a table from a concept its own concept does not depend on |
| `invoke-boundary` | it invokes a procedure of a concept its own concept does not depend on |
| `drives-without-write` | it drives a transition on a table it does not write |
| `call-error-not-declared` | an rpc calls an integration whose failure maps to an error the rpc does not declare |
| `refusal-not-produced` | an operation's refusal is an error its rpc or flow cannot produce (its own, its procedures', its steps', its calls' failures) |
| `flow-surface` | (target) a flow that implements an operation, a CLI command, names `surfaces` without `cli` |
| `event-not-on-transition` | (target) an rpc, workflow or procedure sends an event itself: a target event is sent by a transition (P7) |
| `one-event-per-machine` | (target) a machine sends an event other than its own `<machine>_transitioned` (P7) |
| `unreached-rpc` | (target) no operation, flow step, signal or trigger reaches an rpc (P2) |
| `no-budget` | (target) an operation, rpc, flow or workflow has no budget (P5) |
| `budget-override-why` | (target) a budget leaves its class default without saying why (P5) |
| `tenant-key` | (target) a tenant table's key or an index does not start with its tenant column, unless the index is `crossTenant` (P8) |
| `acceptance-claim` | (target) an acceptance line is plain text instead of `{claim, observes, was}` (P1) |
| `admission` | a table's admission names a column it lacks (its `field`, `kindField` or `where`, or the joined table's `via` columns), limits its rows by a `where` value its column cannot hold, matches `anyone` by a column or another match by none, lets `anyone` write, neither reads nor writes, gives a kind column to a match other than `tenant`, or sits on a `global` table |
| `chain-admits` | (target) a `chain` table has no `admits`, or one of its admissions writes: its scope is its whole policy, and only Ponder writes it |
| `wait-key` | a wait's key routes by a property its carrier does not carry (a product event's props, a chain event's arguments or its log's `chain_id`, `contract_address`, `block_number`, `block_hash`, `tx_hash`, `log_index`, a table's columns, a signal's input, or its instance's columns when the signal reads or writes the instance's table), names an rpc that is not one of its signals or a call that is not one of its calls, waits on an event or a row of a concept its own does not depend on, or sits on a timer |
| `wait-without-key` | (target) a wait other than a timer names no `key` |
| `cycle` | concepts or components depend on each other in a loop |
| `unknown-actor` | a journey step is taken by someone the system does not list |

## Gaps: derived, never written

| Gap | When |
|---|---|
| `unwritten-table` | no operation or workflow writes it |
| `undriven-transition` | nothing drives it |
| `unreachable-state` | no transition reaches it |
| `unsent-event` | no transition, operation or workflow sends it (a wait that is woken by it listens; it does not send) |
| `unproduced-error` | no operation or integration produces it |
| `unused-call`, `uncalled-function`, `unconsumed-chain-event` | an integration call, a contract function or a chain event that nothing uses (a chain event is used by a workflow it triggers or a wait that lists it) |
| `empty-concept` | it owns no tables, operations or workflows |
| `unhosted-component` | no environment runs it |
| `no-acceptance` | an operation has no acceptance lines |
| `unused-rpc`, `unused-flow`, `uninvoked-procedure` | nothing uses it: the old system's orphan rows show up here (a flow whose `surfaces` leave out the CLI is used by those surfaces, which the book does not model) |
| `no-budget` | an operation, rpc, flow or workflow says nothing about how fast it must be (in a target book this is a problem instead) |
| `refusal-without-world` | a refusal's `given` is `?`: no devnet world reaches it yet |
| `unproven-step` | a journey step has no proving event |
| `unchecked-invariant` | a reconcile check names no workflow |
| `admission-in-prose` | (target) a table with no `admits` whose scope or about says its row policy admits a party beyond the tenant (`ADMISSION_PROSE` in `build.ts`: a gap, because it reads words) |

## Evals: derived from records

The kinds in [30](30-capxul-evals.md) are derived from operations and journeys. The design
book adds evals for the other record kinds:

| Id | From | Claim |
|---|---|---|
| `rpc:<rpc>/budget`, `/spans`, `/errors` | rpc | server p95; its span tree; it fails only with its declared errors |
| `flw:<flow>/budget`, `/spans` | flow | client p95 excluding waits; one span per step |
| `prc:<procedure>/atomic` | procedure | its writes commit with its invoker's transaction or not at all |
| `tbl:<table>/schema` | table | the migration creates exactly these fields, key and indexes |
| `tbl:<table>/writers` | table | only the listed writers change it |
| `tbl:<table>/tenancy` | table | a second tenant reads and writes none of the first's rows, unless an admission names it |
| `tbl:<table>/admits/<n>` | table | the party admission n matches reads (and writes) exactly the rows it names, and a session that neither the row's tenant nor any admission matches sees none |
| `trn:<machine>.<transition>` | transition | an eval run observes it, with its events |
| `wfl:<workflow>/idempotent`, `/resume` | workflow | a second run is a no-op; a killed run resumes |
| `bud:<workflow>/p95` | workflow | from trigger to done, within budget |
| `wfl:<workflow>/wake/<wait>` | workflow | an event matching the wait's key wakes this instance, and one that differs wakes no other |
| `int:<integration>/conformance` | integration | the fake and the real service pass the same suite |
| `int:<integration>.<call>/<CODE>` | integration | each failure surfaces as its error |
| `sys:imports/<concept>`, `sys:loc/<concept>` | concept | its imports and its line budget |
| `inv:<invariant>` | invariant | its statement |
| `env:<env>/boot`, `/smoke` | environment | it boots within budget; a smoke journey passes |

## Views: generated, never drawn

`node --experimental-strip-types packages/book/src/main.ts <book module> <out>` writes:

- `README.md`: counts, the component diagram, the concept diagram, problems, gaps by rule
- `concepts/<id>.md`: per concept, its tables, its state diagrams, operations, workflows and gaps
- `evals.json` and `findings.json`

It exits with 1 if the book has problems.

## Deliberately not in the schema yet: the step-2 slice decides

- **React hook records.** The Core SDK is covered by flows and the generated RPC client. React
  hooks come later; if they are not one-to-one with live rpcs, they get their own record.
- **Index-to-query linking.** An index names its query in words. If operations name the
  queries they use, an index nobody uses becomes a gap.
- **Ponder.** Done: Ponder's indexed tables have the `chain` tenancy, are owned by indexing, and
  declare read-only `admits` (rule `chain-admits`).
- **Generated code.** Step 2 proves the records can drive code: one table migration and one
  RPC group, generated from the payments or books slice.
