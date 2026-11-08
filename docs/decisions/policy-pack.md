# Policy pack: the rules that turn the design book from judgement into checks

Status: **proposed, 7 November 2026.** Each policy is a decision for Aaron. The
recommendations are what the design threads follow until he rules otherwise.
Each ruling becomes a `defineDecision` record in the book and, where it says
so, a rule or a gap in `packages/book/src/build.ts`.

## How to read this pack

- **The old system** is `Xelmar-tech/infrastructure` on branch
  `integration/factory`, head `0d2be303e`, checked out at `/home/user/factory`.
  Paths below are relative to that checkout unless they start with
  `capxul-next/`.
- **Counts** come from scripts over that checkout (grep, YAML and JSON
  parsing), run on 7 November 2026. They are close, not exact. Where a count
  differs from [findings.md](../mission/findings.md), both are given.
- **The fixed points.** The CLI and the old book's operations
  (`apps/docs/factory/operations/*.yaml`, 215 records) are frozen. The new
  system is Effect 4 on Node with Postgres, with Ponder on the same Postgres,
  built from the typed book in `capxul-next/packages/book`.

### The rubric

Every option is graded A (best) to D (worst) on five criteria. Each grade has
a reason.

| Criterion | What it asks |
|---|---|
| **Code size** | How many lines the option adds to the new repository: runtime, book, generated code and evals. |
| **Money** | How likely the option is to let a balance, a payment and the books disagree, or money move twice. |
| **Measurability** | Whether an eval, a span or a book rule can check the option mechanically. |
| **Effort** | The work to apply it now, across 215 operations. |
| **Reversibility** | The cost of undoing it later. |

---

## P1. Frozen acceptance text versus black-box claims

### Question

The old book's 733 acceptance lines become `acc` evals "verbatim, numbered as
they stand" ([30](../spec/30-capxul-evals.md)). Many of them describe the old
code's internals, and every `acc` eval runs through the CLI as a black box. Do
we freeze the text exactly, or freeze the claim and rewrite the lines that a
black box cannot check?

### Why it matters

- **All 733 lines end with a test-file citation** (the lines sit in 180
  records; 35 records have none). By the package they cite: backend 542,
  CLI 154, SDK 36, devnet 1. The cited files will not exist in the new
  repository. Findings adds that 445 lines cite a basename that is not
  unique, so the citation does not even locate the old test.
- **About 148 lines (20%) name a mechanism, not an outcome.** By marker
  (overlapping): process words such as "asks", "forwarded", "retried", "lane"
  or "schedules" in 56; storage words such as "row", "cursor", "stored" or
  "written" in 55; a contract function by name in 22; telemetry in 21; a
  hidden negative such as "sends nothing" in 13; a component by name ("the
  backend", "the SDK", "PostHog") in 11. The other ~585 lines read as
  outcomes once the citation is gone. The 148 depends on the word list: a
  wider list (adding "write", "table", "the CLI", "Convex") flags about 200,
  so the `acceptance-internal` gap below, not this count, decides which
  lines are rewritten.
- **Real lines that cite internals:**

  | Line | Text (citation dropped) | What a black box sees |
  |---|---|---|
  | `activity.events` #3 | "A change to the 150th newest Payment is read, though the newest 100 rows miss it." | Nothing about rows. It can see that the change appears in the page. |
  | `payment.send` #9 | "Once its Board proposal executes, each item's Budgets id is found by the job nonce its `Budgets.schedule` carried, and never one on another budget; a chain read that fails is tried again, not given up." | The lookup key and the retry are internal. It can see the right budget item settle while the RPC fails once. |
  | `balance` #3 | "It answers without waiting on PostHog, and its delivery carries one event per asset." | It can see the events in the local collector, and that the command does not slow down when PostHog is down. |
  | `payment.retry` #1 | "A personal payment whose approval lapsed is retried on its own nonce lane." | "Nonce lane" is internal. It can see the retry succeed while another payment is pending. |
  | `auth.logout` #1 | "It removes the current person's session here and asks the backend to revoke it." | It can see that the old token is refused afterwards. |
  | `service.revise` #4 | "The exact expected revision is forwarded, and a revision conflict is not retried." | It can see a stale revision refused once, with its code. |
  | `org.department.list` #6 | "A list schedules no event." | It can see that the collector received no product event. |
  | `org.board.director.remove` #1 | "Removing Sam is `setHatWearerStatus(director, sam, false, true)` then the Gate's `removeSigner`, never a call into the company Safe." | It can see this in the devnet transaction's calldata and logs, which is still outside the code. |

### Options

- **A. Freeze every line verbatim, citation included.** The eval body
  interprets the line as best it can.
- **B. Freeze the claim, strip the citation mechanically.** Move each
  `(backend save.test.ts)` into the record's `was`. Keep every word of the
  claim. The eval body may use any outside observer.
- **C. B, plus rewrite the internal lines into black-box claims.** About 148
  lines. The number is kept, the old text moves to `was`, and the design
  review (`des:`) checks each rewrite. Aaron sees the rewrites as one matter
  per area, as [30](../spec/30-capxul-evals.md) already does for new lines.
- **D. Discard the lines and let designers write new ones.**

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | C: eval bodies grow workarounds for unobservable words | C: a money claim such as `payment.send` #9 gets checked loosely or not at all | D: 148 lines cannot be decided by a black box, so they sit at `unverifiable`, and each needs a person's waiver before its unit is `done` ([10](../spec/10-swarmd-ledger.md), the `done` row) | A: no edits | A: nothing changed |
| B | A: one script | B: every claim survives; the internal ones are still loose | B: about 585 lines become checkable; 148 stay hard | A: one script, 733 lines | A: `was` keeps the original |
| C | A: same script, plus about 148 hand edits | A: each money rewrite names the outcome to check | A: every line is decidable by the CLI, a read, the chain or the collector | B: about 148 edits, reviewed per area | A: `was` keeps the original, and the number never moves |
| D | B: new lines, no baggage | D: loses checked behaviour the old system shipped | B: new lines are checkable, but the old system's behaviour is no longer the baseline | D: 733 lines rewritten | C: the old claims are no longer the spine |

### Recommendation

**C.** Strip all 733 citations mechanically. Keep about 585 lines word for
word. Rewrite the ~148 internal lines into claims that one of five observers
can check, and keep each original in `was`. A run against the old system
(`--target legacy`) must pass a rewritten line, or the rewrite is wrong. A
loses because 20% of the spine becomes `unverifiable` by construction. B loses
on the same lines with less noise. D throws away the one shipped
specification.

### What changes in the book

```ts
// records/behaviour.ts: an acceptance line names what observes it, and keeps its source
const Observer = Schema.Literals(["cli", "read", "chain", "trace", "world"]);
//   cli: output and exit · read: a read operation · chain: devnet state, calldata and logs
//   trace: the local OTLP collector · world: a before-and-after diff of the world snapshot
acceptance: Schema.Array(Schema.NullOr(Schema.Struct({
  claim: Line,
  observes: Schema.Array(Observer),
  was: Schema.optionalKey(Line),       // the old line, verbatim, when rewritten
}))),
```

- **New rule `acceptance-citation`:** a claim containing `(<pkg> <file>.test.ts)`
  is a problem.
- **New gap `acceptance-internal`:** a claim with an internal word (row,
  cursor, lane, scheduled, mutation, InTx, Convex, PostHog, retried,
  forwarded) is a gap until the `des:` review approves it.

---

## P2. Orphan SDK methods and unreached protocol rows

### Question

About 184 SDK methods back no book operation, and about 117 of 285 protocol
rows are reached by no operation. For each one: keep it as is, make it an operation,
make it an SDK flow, or delete it?

### Why it matters

- **The SDK surface.** The generated SDK reference has 348 methods
  (`apps/docs/content/docs/reference/sdk/reference/api/**/*.mdx`). Book
  records name 164 of them in `sdk:` or `designed.method`, which leaves **184
  orphans**. Findings says about 189 of 349.
  - By shape: 81 commands, 62 reads, 23 flow steps (`prepare*`,
    `submit`, `approve`, `review`, `reconcile*`), 15 waits and 3 subscriptions.
  - The largest groups are `checkouts` (17), `me` (15), `org.board` (13),
    `org.banking` (10) and `org.payments` (9).
  - Callers outside tests, by grep of the method path: the CLI calls 83 (as
    steps inside commands), `packages/sdk-react` calls 18 and scenarios call
    78. **61 have no non-test caller** in the CLI, React or scenarios, for
    example `client.checkouts.*` (17), `client.destinations.*`,
    `client.media.setOrgLogo`, `client.approvals.reject`. A second grep
    (`client.org(<id>)` normalised, test files excluded) finds CLI 65,
    React 20, scenarios 74 and **71** with none of those callers, so treat
    the no-caller set as 61 to 71 and confirm each method when classifying.
    Three more callers are in this checkout: `apps/mcp` (an MCP server, 5
    orphans, for example `client.me.get`), `packages/vending-bench` (8) and
    `apps/plugin` (2). The React web app (30 pages) is not in this checkout,
    so some of the no-caller set may have a caller there.
- **The row surface.** `packages/protocol/src` declares 285 typed rows (87
  `Operation.query`, 63 `Operation.mutation`, 135 `Operation.action`; two of
  the actions, `organizations.members.grant` and `.revoke`, come from the
  `seatPermissionChange` factory at `organizations/operations.ts:168-171`).
  `apps/docs/factory/status.json` (`backend.row` and `reaches[]`) reaches 168,
  which leaves **117 unreached**. Findings says about 134 of 285, with a
  shallower reach.
  - 83 are called by SDK code: an orphan method or a step of one.
  - 12 are `operator.*` devnet and proof probes, such as
    `operator.receipts.hold` and `operator.probes.seedBackendTenancy`.
  - 5 are called only inside the backend.
  - 17 have no non-test caller, for example
    `payments.commands.prepareOfferCheckout`, `requests.receivables.list`
    and `applications.registrations.create`.
- **The cost of keeping them.** Every kept method carries its SDK types,
  error copy and telemetry names. Findings counts one operation described
  about six times, and 933 SDK types re-declared.

### Options

- **A. Keep all of it.** Port all 348 methods and 285 rows one to one.
- **B. Make every kept method an operation.** The CLI is frozen, so most of
  these would be operations without a command.
- **C. Classify, and delete by default.**
  - A step of an existing operation (prepare, submit, approve, wait) becomes
    a step of that operation's `flow`.
  - A method a named surface uses (React, the approval page, checkout) becomes
    a `flow` that declares that surface.
  - An `operator.*` probe becomes a devnet-only rpc in the `devnet` concept.
  - Anything with no caller is deleted. A method comes back only with a named
    caller.
- **D. Delete every orphan now.** Add methods back when something breaks.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | D: about 184 methods and 117 rows with no spec, no evals and no owner | C: unspecified paths that touch money (checkout pay, approvals) run with no eval | D: by definition no eval reaches them | B: porting is mechanical but large | B: deleting later is easy, but every port is wasted work |
| B | C: about 184 new operation records with no command and no old behaviour | B: everything gets evals | A: everything is measured | D: 184 new definitions with no frozen text to copy | C: operations are the stable unit, and removing one is a product change |
| C | A: about 61 to 71 methods and 17 rows go; steps fold into flows | A: every money path that survives has an operation or a surface, and its evals | A: a new rule makes an unreached rpc a problem | B: one pass of classification, mostly by grep | B: a deleted method is in git and comes back as a flow |
| D | A: smallest | C: may delete a step that a frozen command needs, found only by a failing eval | B: failures show up as `acc` and `jrn` fails | A: no classification | B: as C, but more of it comes back |

### Recommendation

**C.** A step method belongs to its operation's flow. A surface method needs a
named surface. Everything else needs a caller to exist. This brings the step-2
decision forward that [50](../spec/50-design-book.md) left open ("React hook
records"): it records only the consumer, not a new record kind. A loses
because about half of the surface (184 of 348 methods, 117 of 285 rows) would
have no definition of done. B
invents about 184 commands' worth of spec with nothing to copy. D finds
mistakes late, through failing journeys.

### What changes in the book

```ts
// records/behaviour.ts: every flow says who it is for
export const FlowSpec = Schema.Struct({
  ...,
  for: Schema.Union([
    Ref("operation"),                                   // the operation it implements
    Schema.Struct({ surface: Schema.Literals(["react", "approval-page", "checkout", "mcp"]), why: Line }),
  ]),
});
```

- **New rule `unreached-rpc`** (a problem in a `target` book, a gap in an
  `as-is` book): no operation, flow or workflow reaches the rpc.
- **New rule `orphan-flow`:** a flow whose `for` is a surface that no
  environment hosts.
- **The `devnet` concept** may own rpcs with `who: "devnet only"`. A new rule
  `devnet-in-production` refuses them in a staging or production environment.

---

## P3. What counts as a workflow, and what old plumbing disappears

### Question

Which pieces of the old backend become `workflow` records, which become steps
inside one rpc, and which disappear?

### Why it matters

Convex forced one shape on every write that also calls the outside world:
a query to load (`load-*`), a mutation to write before the call (`*-intent`),
an action for the call, a mutation to write after it (`record-*`), and a
scheduled action to send telemetry (`emit-*`). The work is spread over four
or five functions, and each one is its own hop. On Node with Postgres, one rpc
handler can read, call out and write in sequence.

- **Internal operations:** 442 files declare `internalOperation(` (findings:
  456 internal against 285 public). By kind: 231 `"mutation"`, 111 `"query"`,
  116 `"action"`.
- **Plumbing, by file name under `*/operations/`:**

  | Prefix | Files | What it is |
  |---|---|---|
  | `emit-*` | 37 | Telemetry only, e.g. `payroll/agreements/operations/emit-transitioned.ts`, an action that posts `payroll_agreement_transitioned` |
  | `*-intent` | 12 | The write before an outside call, e.g. `payments/commands/operations/prepare-intent.ts` |
  | `load-*` | 34 | The read before it, e.g. `permissions/grants/operations/load-signed.ts`, a 17-line query wrapper |
  | `record-*`, `record` | 61 (44 `record-*` and 17 `record.ts`) | The write after it, e.g. `payments/executions/operations/record-send-attempt.ts`, `payroll/agreements/operations/record.ts` |
  | `notice-facts`, `notify-*` | about 22 | Reads and actions that build emails |

  Together that is about 166 of 442 files, before counting the
  `FunctionReference`s that wire them (findings: 257, hand-typed).
- **Scheduling.** Findings counts 134 `runAfter` and `runAt` calls. A grep
  finds 103 call sites outside tests: 76 direct `scheduler.runAfter` or
  `runAt` calls and 27 through the `platform/schedule.ts` wrappers
  (`runAfterBusinessDelay` 21, `runAtBusinessTime` 4, `runAtWallTime` 2).
  By purpose:
  - about 47 retry, verify or follow loops, e.g.
    `permissions/grants/writes/drives.ts:65`, a `runAfter(delayMs, …,
    { retryCount: retryCount + 1 })`
  - about 20 notifications, e.g. `parties/verifications/writes/people.ts:99`
  - about 26 other follow-ons, e.g. `payments/schedules/operations/send-due.ts:53`
  - 8 telemetry deliveries, through `platform/observation/telemetry.ts:66`
    and `wide-event.ts:224`
- **Crons:** 15 named jobs in `platform/jobs.ts:57-162`. 12 are always
  registered; 3 only when money writes are on and a PaymentsV2 address is
  set (`:87-112`); and one `scan Movement <chain>:<token>` job per scanned
  asset is added when the movement scanner is compiled on (`:125-134`).
  - every minute: recover Bridge events, sync feature flags from PostHog,
    pay out funded Invoice escrows, scan added tokens, observe Books money
    in the indexer, reconcile indexer drift, recover Organization setup
  - every 5 or 10 minutes: watch bank payout timers, sync Books prices from
    Chainlink
  - daily: sweep expired native client authorizations, expire pending org
    invitations, send payment agreement notices
  - PaymentsV2 only: recover Payment settlement verification, send scheduled
    payments that are due, settle Payments from the indexer

### Options

- **A. Port what was scheduled.** Every `runAfter` target and every cron
  becomes a workflow, and the internal operations become internal rpcs.
- **B. A workflow is durable work that no caller waits for.** It qualifies if
  all three hold:
  1. its trigger is a transition commit, a chain event, a timer or a cron,
     not a person's request;
  2. it must happen even if the process dies;
  3. it may wait (a durable sleep, or a retry over seconds or more).

  Everything else is a step inside one rpc. Telemetry is never a workflow:
  the runtime exports spans and events itself, and transition events leave
  through one generic outbox relay.
- **C. Only chain events and crons are workflows.** Retries run inside the
  rpc with `Effect.retry`, and emails go out inline before the response.
- **D. Every write is a workflow,** in the style of Temporal or Effect
  Workflow for all mutations.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | D: keeps about 166 plumbing units and about 100 scheduled targets | C: a split write keeps the gaps between intent and record, which the old system needed recovery crons for | C: each hop is measured, but the operation is not | B: mechanical | B: can be collapsed later, at the cost of the work |
| B | A: about 166 files become steps; one outbox relay replaces 37 `emit-*` | A: a settlement after a chain event, and a verify loop, survive a crash with an idempotency key | A: `wfl:<id>/idempotent`, `/resume` and `bud:` apply only where they mean something | B: each scheduled site is classified once with the three-part test | A: a step can be promoted to a workflow later without changing the operation |
| C | A: smallest | D: an in-process retry is lost on a crash, and money waits on a verify that never resumes | B: fewer workflows to measure, but lost work is invisible | A: least work | C: durability added later means a data migration |
| D | C: a workflow engine on every write | B: durable, but a person's synchronous write gains queue latency | B: everything has a trace, and budgets suffer | D: every operation is redesigned around the engine | D: hard to leave |

### Recommendation

**B.** The test is mechanical, so the designer applies it without asking.
Expected outcome:

- 37 `emit-*` → **0.** Transition events go to an outbox row in the same
  transaction, and one relay workflow delivers them.
- 12 `*-intent`, 34 `load-*` and 61 `record-*` and `record` → **steps** inside their rpc
  or workflow.
- About 47 retry and verify loops → **steps of a workflow**, with a durable
  retry schedule.
- About 20 notifications → **after-commit workflows** fed by the outbox, one
  per notice kind.
- 15 crons → **about 6,** plus indexer drift while it is needed.
  - Stay: Bridge catch-up, Chainlink prices, feature flags, the daily
    authorization sweep and the daily agreement notices (calendar work with
    no single trigger), and "scan added tokens". The last stays because the
    indexer has no source for a token added at run time
    (`platform/jobs.ts:135-139`, ADR-0042); it moves to Ponder only if the
    stack thread shows Ponder indexing every Transfer to a charted Safe.
  - Go to a workflow's own durable timer or resume: "watch bank payout
    timers", "recover Organization setup", "send scheduled payments that are
    due" (one timer per dated payment) and "expire pending org invitations"
    (one timer per invitation, or an expiry read from `expires_at`).
  - Go to chain-event triggers on Ponder's tables: "observe Books money in
    the indexer", "settle Payments from the indexer", "pay out funded
    Invoice escrows" and the per-asset Movement scanners.
  - Go with pre-v4 (P9): "recover Payment settlement verification", which a
    verify workflow's own resume replaces.

A keeps the Convex shape the rebuild exists to remove. C loses money work on
a crash. D charges every synchronous write for durability that only a few
need.

### What changes in the book

- **New rule `workflow-trigger`:** a workflow whose trigger is `{ after: rpc }`
  must say why it cannot be a step: `durable: "crash" | "wait" | "retry"`.
- **New rule `emit-only`:** an rpc or workflow whose only touch is `emits` is
  a problem. Telemetry is not an operation.
- **`Touches.emits`** stays only for events that are not on a transition, and
  P7 narrows those to none.
- **The workflow engine** is the stack thread's (C1) choice: Effect's workflow
  module on Postgres storage, or a Postgres job table. This policy fixes only
  what counts.

---

## P4. Writes across concepts inside one transaction

### Question

When one change must update tables in two concepts, does the owning concept
expose a **procedure** on its door that the caller invokes in its own
transaction, does the caller publish an **event** that the other concept
consumes later, or do the two concepts **merge**?

### Why it matters

- **The settlement transaction writes four concepts.**
  `payments/writes/settlements.ts:84`, `applyChainSettlementInTx`, settles a
  Payment from an indexed chain fact. In the same Convex mutation it calls:

  ```ts
  // packages/backend/src/payments/writes/settlements.ts:143-146
  await settleRunForSettledPayment(ctx, changed);                        // payroll
  await scheduleRequestPaidNoticeInTx(ctx, changed);                     // requests
  await recordSettledPaymentInTx(ctx, changed, fact.blockTimestamp * 1000); // books
  await scheduleWriterTelemetry(ctx, { event: "payment_transitioned", … });  // telemetry
  ```

- **`books.recordSettledPaymentInTx` writes Books' own facts.**
  `books/facts/writes/money.ts:98` inserts into `bookFacts`, keyed by
  `moneyFactId(side.kind, payment.paymentId)`. That key already makes a
  second write of the same fact detectable. Its callers:
  - `payments/writes/settlements.ts:145`: a chain settlement
  - `payments/writes/deposits.ts:117`: a deposit
  - `payments/writes/rails.ts:62`: a bank-rail delivery
  - `payments/verifications/writes/sends.ts:228`: send evidence
  - `payments/verifications/writes/commitments.ts:173`: a commitment claim
  - `books/facts/writes/backfill.ts:47`: Books' own chart backfill
- **Aaron already ruled this for Books.** ADR-0042 decision 1 (accepted
  23 October 2026): "Other concepts reach it through its door, in the same
  transaction as their own write, so a fact is never lost or doubled."
- **The door exists but nobody uses it.** `books/index.ts:10-18` exports
  `recordSettledPaymentInTx` with the reason ("in the same transaction (A2)").
  `package.json` maps `#books` to it. Yet every one of the 5 callers imports
  the deep path `#books/facts/writes/money`. Across the backend, 0 imports use
  a door (`from "#<concept>"`), and all 402 import statements that bring an
  `InTx` function across concepts use a deep path.
- **How much crosses.** 858 cross-concept import statements. 452 imported
  names end in `InTx`. About 30 distinct write-shaped functions (named
  record, apply, schedule, reverse or ensure) cross a concept boundary, and
  they are imported 45 times. The largest pairs are payments→books (6: the
  record and reverse of settled payments, commitment claims and outside
  money), permissions→organizations (4) and payments→requests (3). The
  cycles that findings names, organizations↔permissions and
  accounts↔payments, run through these calls.

### Options

- **A. Procedures on a door, invoked in the caller's transaction.** This is
  what `capxul-next/packages/book/src/records/behaviour.ts` already sketches:
  a `procedure` "runs inside the invoker's transaction", and an rpc lists it
  in `invokes`. All writes commit together, or none do.
- **B. Events through an outbox.** Payments commits the settlement and an
  outbox row. Books, payroll and requests each consume
  `payment_transitioned(to: settled)` in their own transaction, through a
  workflow with an idempotency key.
- **C. Merge concepts** that write together, for example payments and books
  into `money`.
- **D. Split by kind.** Use a procedure when the other write is part of the
  **same money fact** and must never disagree at a commit. Use an event when
  it is a notice or a projection that may lag and can be rebuilt.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | A: one function call per crossing, listed in `invokes` | A: payment and books facts commit together | B: `write-boundary` and `invokes` check it statically; the time inside the transaction adds up | A: matches the old code's shape | B: a procedure can become an event consumer later |
| B | C: one consumer workflow per crossing, plus an outbox and idempotency per consumer | B: no double write, thanks to the fact key, but the books can lag a settled payment and a reconcile invariant is needed | A: each consumer has its own `wfl:` and `bud:` evals | C: every money crossing is redesigned | B: going back to a procedure is easy |
| C | B: removes the boundary code, but makes a large concept | A: one transaction | D: a merged concept breaks its `sys:loc` line budget and hides who owns what | C: re-cuts 17 concepts | D: splitting later is the hard direction |
| D | A: procedures for the few atomic facts, the outbox (already needed for P7) for the rest | A: money facts are atomic; notices may lag, which is harmless | A: each crossing is a declared procedure or a declared event consumer, and both are checkable | B: each of the about 30 crossings is sorted once | A: per crossing |

### Recommendation

**D.** In the settlement:

- `books.record-settled-payment` and `payroll.settle-run` stay **procedures**.
  A Payment that is settled with no book fact, or a run still open, is a money
  bug.
- `requests.schedule-paid-notice` and `payment_transitioned` move to the
  **outbox.** A notice that arrives a second late is not.

A is what D does for money, but it would also pull notices and telemetry into
every money transaction. B makes the books eventually consistent for no gain
the business needs, and it would reverse ADR-0042's accepted decision 1. C
gives up the concept boundary that the book exists to enforce.

### What changes in the book

```ts
// records/behaviour.ts
export const ProcedureSpec = Schema.Struct({
  ...,
  /** Why this must commit with its invoker; a procedure that is only a notice is a problem. */
  atomic: Line,       // "a settled Payment always has its book facts"
});
```

- **The `dependsOn` check already exists:** `invoke-boundary` in
  `capxul-next/packages/book/src/build.ts:159-163` refuses an invoke of a
  procedure whose concept the invoker does not depend on. What is new is
  only that the generated code imports procedures from the door, never a
  deep path, so the old "0 door imports" cannot recur.
- **New rule `notice-in-transaction`:** a procedure whose only writes are a
  notice or outbox table is a problem. Use an event consumer.
- **New eval** `sys:tx-width/<rpc>`: a transaction invokes at most 3
  procedures from at most 2 other concepts. A wider one needs a decision
  record.
- **Each atomic procedure** gets an invariant, for example
  `inv:books.settled-payment-has-facts`, checked by `reconcile`.

---

## P5. Budget classes and the default p50 and p95 per class

### Question

What is the default system-time budget for each of the eight budget classes in
`capxul-next/packages/book/src/records/base.ts` (`read`, `live-read`, `write`,
`chain-read`, `chain-submit`, `chain-settle`, `vendor`, `background`)? When
may an operation override it?

### Why it matters

The old system has no runtime latency budget that fails a check. It gates only
the bundle size and 800 ms of CLI start-up CPU. Its operations are slow:

- **Old devnet proofs.** `apps/docs/factory/proofs/*.json` holds 1,410 runs
  and 24,190 steps. 23,272 steps have a CLI surface, whose verdicts are
  21,091 PASS, 2,122 NOT BUILT, 49 BLOCKED and 10 FAIL (the step verdicts,
  which also cover 918 steps with no CLI surface, are 21,818, 2,122, 181 and
  69). About 20,000 passing CLI samples match 189 operations. A sample's
  `durationMs` is the step's wall time: process start, every hop, devnet
  auto-approval and anvil confirmation. **955 passing samples come from a
  step that runs two or more commands,** and the sample is recorded against
  the last one only, so match per-command tails to single-command steps.
  Grouped by the command's verb and the record's `designed.signs` (medians
  of per-operation medians, which those 955 barely move):

  | Class (old) | Operations | Samples | p50 (median of the operations' p50s) | p95 (median of the operations' p95s) |
  |---|---|---|---|---|
  | local only (no backend) | 21 | 4,626 | 830 ms | 1,476 ms |
  | read | 53 | 4,024 | 1,164 ms | 2,047 ms |
  | write, no signature | 59 | 3,586 | 1,466 ms | 3,207 ms |
  | chain submit, signed | 52 | 8,162 | 6,422 ms | 10,054 ms |
  | wait | 4 | 325 | 1,315 ms | 2,766 ms |

  - **The floor.** A local-only command takes about 600 ms: `schema` p50
    581 ms, `use env` p50 604 ms.
  - **The slowest:** `org allowance create` p50 17,070 ms and p95 24,151 ms,
    `org create` p50 15,886 ms, and `org department ceiling freeze` p50
    17,771 ms.
  - **Reads that hit the chain,** single-command steps only: `org department
    show` p50 3,444 ms and p95 6,080 ms; `org proposal get` p50 1,384 ms and
    p95 2,212 ms. Counting every sample gives `org department show` a p95 of
    about 20.5 s, but that tail is steps that run `org department budget
    set`, then `org proposal approve` with two devnet approvals, then `show`:
    one such step records 20,031 ms against `show`.
- **Old staging.** `docs/research/performance-baseline-2026-10.md:588-600`
  times each read command at 5.4–6.5 s (several of them refusals, such as
  `SMART_ACCOUNT_MISSING`), and a 9-command session at 49.4 s. On
  the same page, JWKS fetches had p50 250 ms and p95 1,329 ms, and
  `convex/token` had p50 332 ms and p95 2,127 ms. Every authenticated call
  paid for them before CAP-585.

### The hops, from first principles

Staging runs in one region. Each CLI command is a new process, so it opens a
new connection.

| Hop | Cost |
|---|---|
| CLI process start (Node, one bundle) | 300 ms target; the old floor is about 600 ms |
| Connect, TLS and one request | 3 round trips, about 90 ms at 30 ms each (about 0 on a devnet) |
| Verify the session token against a cached JWKS | about 1 ms |
| One indexed Postgres statement in region | 0.5–2 ms; a transaction of 3–10 statements is 10–30 ms |
| One `eth_call` to the RPC provider | 80–150 ms p50, 400 ms p95; anvil 2–10 ms |
| The bundler: estimate, sponsor and send | 3 calls, about 450 ms p50 |
| Local signing with the agent or CLI key | under 20 ms; a person signing is `wait.person`, excluded |
| Chain confirmation | a 2 s block on Base: `chain.confirm`, excluded |
| Ponder sees a block | polling every 2,000 ms (`apps/indexer/ponder.config.ts:106`), so 1 s on average |
| One vendor call (Bridge, Resend, Openfort) | 300–600 ms p50, 2 s p95 |

### Options

- **A. Per-operation budgets from the old system,** for example its p95 less
  20%.
- **B. Class defaults from the hops,** with a per-operation override that
  carries a one-line reason.
- **C. One global budget,** for example p95 2 s, with chain classes exempt.
- **D. No budgets until the new system has been measured.**

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | B: 215 numbers to keep | B: neutral | B: measurable, but it anchors on a system 2–10 times too slow | B: needs a mapping of 189 operations | A: numbers change freely |
| B | A: 8 defaults plus a few overrides | A: the chain-submit class separates system time from confirmation, so slow money paths are visible without pressure to skip waits | A: `bud:` and `live:bud:` evals derive from the class | A: the designer picks a class, not a number | A: a default can move in one line |
| C | A: one number | C: forces chain and vendor paths into exemptions | C: too loose for reads, impossible for submits | A: none | A |
| D | A | B | D: `bud:` evals cannot exist until M5, and slow designs ship first | A | A |

### Recommendation

**B, with these defaults.** Each is for the whole CLI command, measured as the
operation span minus `wait.*` and `chain.confirm`. Each rpc and flow also gets
the server or client share shown. Devnet must beat these numbers; staging is
measured by `live:bud:`.

| Class | Unavoidable hops | Floor | Operation p50 | Operation p95 | rpc server p50 / p95 | Old devnet p50 / p95 |
|---|---|---|---|---|---|---|
| `read` | start + connect + 1 rpc with 1–3 indexed reads | about 400 ms | 600 ms | 1,200 ms | 20 / 100 ms | 1,164 / 2,047 |
| `live-read` | first frame as `read`; an update goes from commit to notify to push | about 50 ms per push | 300 ms per push | 1,000 ms per push | as `read` | none; 27 Convex subscriptions, dashboard LCP p50 22.2 s |
| `write` | `read` + 1 transaction with an idempotency check | about 450 ms | 700 ms | 1,500 ms | 50 / 250 ms | 1,466 / 3,207 |
| `chain-read` | `read` + 1–3 parallel `eth_call`s | about 600 ms | 900 ms | 2,000 ms | 250 / 900 ms | `org department show` 3,444 / 6,080 |
| `chain-submit` | prepare rpc (transaction, nonce and gas reads) + local sign + 3 bundler calls + record rpc | about 1,100 ms | 2,000 ms | 4,000 ms | prepare 300 / 1,200 ms | 6,422 / 10,054, which includes confirmation |
| `chain-settle` | from the block's time: Ponder poll, handler, workflow transaction, event | about 1,200 ms | 3,000 ms | 8,000 ms | workflow step 50 / 250 ms | receipt waits up to 120 s (findings) |
| `vendor` | `write` + 1 vendor call | about 900 ms | 1,500 ms | 4,000 ms | 700 / 3,000 ms | `bank settle` 4,838 / 13,113 |
| `background` | from trigger to done, excluding durable sleeps | none | 2,000 ms | 15,000 ms | per step, by its class | drift reconcile 2.4 s per run (Oct baseline) |

- **The CLI's own start** becomes its own eval, `sys:cli-start`, with a 300 ms
  wall target. The old 800 ms CPU gate stays as a ceiling.
- **An override** needs `budget.why`, for example "reads 3 contracts in
  sequence because each address depends on the last". `sys:p95-regression`
  (+20% against `main`) still applies to it.

### What changes in the book

```ts
// records/base.ts
export const Budget = Schema.Struct({
  class: BudgetClass,
  p50Ms: Schema.optionalKey(Ms),     // absent: the class default from book/src/budgets.ts
  p95Ms: Schema.optionalKey(Ms),
  why: Schema.optionalKey(Line),     // required when either number is set
  excludes: Schema.optionalKey(Schema.Array(Schema.String)),  // default ["wait.*", "chain.confirm"]
});
```

- **New file `packages/book/src/budgets.ts`** holds the table above as data.
- **New rule `budget-override-why`:** a number without a `why` is a problem.
- **New rule `budget-class-fit`:** an rpc or flow whose `chain` or `calls`
  touch the chain or a vendor cannot take `read` or `write`.
- **Gap `no-budget`** in a target book: an operation, rpc, flow or workflow
  with no `budget`.

---

## P6. Required child spans

### Question

Which child spans must every trace contain, so that `spn:` evals can check them
and per-step p95 exists?

### Why it matters

- **Spans are rare.** Spans are created in 7 places in the backend, 6 in the
  SDK, 4 in the CLI and 1 in the indexer:
  - backend: `platform/observation/engineering-trace.ts:135,205`,
    `platform/provider-observation.ts:54`,
    `integrations/chain-rpc/internal/requests.ts:79,255` (`chain.attempt`
    and `chain.read <method>`), `openfort/betterAuthClient.ts:92` and one
    proof span
  - CLI: `observability/index.ts:248` (`cli.command.<command>`)
- **No database spans exist.** Findings adds that a query makes neither a span
  nor a log, and a failing mutation makes nothing.
- **Per operation,** `status.json` lists 2 spans for 164 operations (the
  command and one backend row), 1 for 27 and 0 for 24. Per-step time does not
  exist.
- **10 integrations** (`packages/backend/src/integrations/*`) export 186
  functions. Only the chain RPC and the provider wrapper have spans.
- **The weight.** `platform/observation/*.ts` is 4,288 lines. The error code
  has three names (`error_kind`, `failure_code`, `error_code`), and duration
  is recorded twice with different sampling.

### Options

- **A. The operation span only,** carrying every fact as attributes.
- **B. Boundary spans, derived from the book.** One span for each crossing
  the book already declares:
  - `db.tx` for each transaction
  - `call.<integration>.<call>` for each outside call, including
    `chain.read`, `bundler.send` and Bridge
  - `workflow.step.<name>` for each durable step
  - `wait.person` and `wait.chain` for each local `wait` or `prompt` step

  The runtime layers make these spans, so no author writes a span.
- **C. Every named step,** a span for each step in an entry file.
- **D. OpenTelemetry auto-instrumentation** (pg, http, undici) plus the
  operation span.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | A: smallest | C: a slow or failing chain call inside a money path is invisible | D: no per-step p95, and `bud` cannot exclude `wait.*` | A | B: adding spans later means touching every operation |
| B | A: about 4 wrappers (rpc, Sql transaction, integration call, flow step) make every span | A: every chain, bundler and transaction step is timed and carries its outcome | A: the `spn:` tree is computed from `touches`, `calls` and `steps`, so it cannot drift | A: authors write nothing | A: a span name is generated from a record id |
| C | C: span calls in every entry file | B | B: more detail, but names drift from the book | C: 215 entry files | B |
| D | B: little code, but one span per SQL statement | B | C: noisy; names come from SQL, not from records, so evals cannot name them | A | B |

### Recommendation

**B.** The required tree for every trace:

```
cli.<command>                         operation span: operation, outcome, error.code, error.class, retryable, exit
└─ sdk.<flow>                         one per flow
   ├─ sdk.step.<name>                 only for the local kinds sign, build and encrypt
   ├─ wait.person | wait.chain        for wait, poll and prompt steps; excluded from budgets
   └─ rpc.<id> (client) → rpc.<id> (server, continues traceparent)
      ├─ db.tx                        each transaction: statements, rows written, serialization retries
      └─ call.<integration>.<call>    each outside call: attempt, timeout, outcome
workflow.<id>                         its own trace, with a span link to the trigger's trace
├─ workflow.step.<name>
│  ├─ db.tx
│  └─ call.<integration>.<call>
```

- **Required attributes** on every operation, rpc and workflow span:
  - `organization_id` or `person_id`, by the tenancy it touches (P8)
  - `operation`
  - `outcome`: succeeded, refused or failed
  - on a failure: `error.code`, `error.class` (ADR-0039) and `retryable`

  There is **one** name for the error code: `error.code`.
- **Not required:** `db.query` per statement and `procedure.<id>`. They may be
  turned on with sampling to diagnose a problem.

A cannot measure steps or exclude waits. C writes by hand what the book
already knows. D floods the trace with names no eval can refer to.

### What changes in the book

- **`spans` on `rpc` and `flow` becomes derived.** The build computes the
  required tree from `invokes`, `calls`, `chain` and `steps`. Authors list
  only extra local spans, in a field renamed `extraSpans`.
- **New rule `span-name`:** an extra span must match
  `^(sdk\.step|call|workflow\.step|wait)\.[a-z0-9._-]+$`.
- **New gap `uninstrumented-call`:** an integration call with no timeout or
  failure mapping, so its span cannot carry an outcome.
- **The `spn:<op>` eval** compares the observed trace with the computed tree.

---

## P7. Which of the 109 catalog events survive

### Question

`@capxul/observability` lists 109 product events. Which of them does the new
book keep? Is "product events only for state changes"
([initializer](../mission/initializer.md), design 4) the whole rule?

### Why it matters

- **The catalog.** The 109 names are in
  `packages/observability/src/catalog/domains/*.ts`, joined in
  `catalog/events.ts`. Classified by hand:

  | Group | Count | Examples | Named by a journey contract |
  |---|---|---|---|
  | A stored state changed | 55 | 23 generic `*_transitioned` or `*_changed` (`payment_transitioned`, `payroll_run_transitioned`); 32 named, such as `books_account_added`, `books_account_renamed`, `books_account_archived`, `deposit_initiated`, `deposit_settled`, `invoice_issued` and `verification_approved` | 30 |
  | A flow step with no stored state | 20 | `organization_creation_started`, `verification_submitted`, `onboarding_profile_submitted`, `cli_first_used` | 11 |
  | Plumbing or diagnostics | 13 | `movement_scan_window`, `indexer_drift_corrected`, `payment_verification_retry`, `chain_upstream_fallback`, `receipt_pending` | 1 (`account_balance_read`) |
  | Failure | 9 | `auth_failed`, `bundler_error`, `organization_creation_failed` | 1 |
  | Web UI (`ui_*`) | 9 | `ui_treasury_step_completed`, `ui_route_wait_observed` | 1 |
  | CLI | 3 | `cli_command_started`, `cli_command_completed`, `cli_diagnostic_completed` | 2 |

- **The journeys.** The 13 journey contracts (12 in
  `packages/tools/src/modules/analytics/internal/*-contract.ts`, and the
  activation journey inline in `internal/contracts.ts`) name about 46 of the
  109 events: 43 as steps, 49 counting the events named only as a step's
  `drop_reasons`.
- **No producer here.** 16 events have no producer file in the backend, SDK,
  CLI, React package or indexer: mostly the `ui_*` and onboarding events of
  the web app, which is not in this checkout.
- **Duplication.** One failure is recorded up to four times: product event,
  wide event, `$exception` and `*_expected_outcome`. 52 operations declare
  their events in the book; 163 have them derived from the code after the
  fact.

### Options

- **A. Keep all 109,** ported as they are.
- **B. Transitions only: one event per state machine.** Each machine sends
  `<machine>_transitioned { from, to, transition, ids, trace_id }`. Its
  transitions emit it, and the outbox delivers it (P3).
  - Flow steps and failures become the operation's span and its one wide
    event, with its outcome.
  - Plumbing becomes spans and logs.
  - `ui_*` and onboarding events belong to the web surface's own catalog,
    outside the backend book.
- **C. B, plus an allow-list of funnel signals:** events a journey needs that
  no stored state change and no operation outcome can prove. Each needs a
  decision record.
- **D. No product events.** Funnels are built from the operation wide events
  only.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | D: 109 schemas and about 63 producer files, many of them duplicates | C: four records of one failure can disagree | C: 163 events are known only after the fact | B | B |
| B | A: about 36 machine events, emitted by the generated transition code | A: one event per money state change, sent once through the outbox, and `evt:` checks "once" | A: `evt:` and `trn:` are generated from machines | B: the 32 named state events fold into their machines, and journeys re-point | A: a machine can split its event later |
| C | A: B plus a few | A | B: each signal is an exception to remember | B | A |
| D | A: smallest | B | C: a funnel on wide events cannot see state changes made by workflows, such as a settlement | A | B: events can return |

### Recommendation

**B, with C's escape hatch kept empty until a journey proves it needs one.**

- **What survives.** The 55 state-change events fold into **about 36 machine
  events:** the 23 existing generic ones, plus about 13 new machines that the
  32 named events reveal, among them `session`, `native_authorization`,
  `safe`, `book_account`, `book_asset`, `verification`, `proposal` and
  `permission_command`.
- **What goes:** 54 events, the flow steps, failures, plumbing, CLI and UI
  events.
- **The journeys.** The steps proved by 30 of the 46 journey events
  re-point to a machine event and its `to` state. The steps proved by the
  other 16 use the operation's wide event with `outcome = succeeded`. A
  failure event named as a `drop_reasons` entry moves to the wide event's
  `error.code` (P6).

A keeps the duplication the findings call out. D cannot see the steps that
happen without a person in a request: settlements, payouts, verifications.

### What changes in the book

```ts
// records/outcomes.ts: a journey step is proved by a transition or by an operation's success
proves: Schema.optionalKey(Schema.Union([
  Schema.Struct({ event: Ref("event"), to: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ succeeded: Ref("operation") }),
])),
```

- **New rule `event-not-on-transition`:** an event that no machine transition
  lists in `emits` is a problem. The only exception is one linked from a
  decision record (C's hatch).
- **New rule `one-event-per-machine`:** all transitions of a machine emit the
  same event.
- **The `emits` field on `Touches`** is removed once the rule holds.
- **The `evt:` eval** checks "once per state change, with `trace_id`" against
  the outbox and the collector.

---

## P8. The tenancy model in one Postgres with Ponder

### Question

How is one Organization's data kept from another's, and from a person's, in one
Postgres database that Ponder also writes to?

### Why it matters

- **Owner keys come in six shapes.** Of the old 106 tables:
  - `orgId` in 36, `organizationId` in 4 and `orgPartyId` in 1
  - `authUserId` in 25
  - polymorphic `actorKind` and `actorId` in 11, for example `payments` and
    `paymentCommands`
  - `partyId` in 12, `safeAddress` in 8 and `accountId` in 8
  - **42 have no owner key at all,** and reach their owner through a join,
    for example `payrollItems`, `payouts`, `movements` and `paymentDocuments`.
  Only 30 tables have an index that starts with the organization id.
- **Tenancy is checked in code, case by case.** The guards are in
  `access/sessions/guards.ts:130-150` (`requireConsentedUser`). There are
  also probes, `operator.probes.seedBackendTenancy` and
  `revokeBackendTenancyConsent`, that exist only to test it.
- **The indexer is scoped by Safe address.** The old Ponder service already
  runs on Postgres (`apps/indexer/ponder.config.ts:96`, `database: { kind:
  "postgres" }`), with 9 legacy tables (and 2 views) and 28 v4 tables (one
  `v4_<contract>_event` evidence table for each of 15 contracts, and 13 read
  models). It authorizes each
  query against a signed `safes` claim in the session token
  (`apps/indexer/src/auth.ts:145-176`, ruling CAP-587). It matches the query
  against compiled shapes (`src/query-authorization.ts`).
- **Ponder owns its schema.** It rebuilds its tables on a reindex, so
  application tables cannot hold foreign keys into them.
- **Test tables sit in the production schema** (`e2eReceiptHolds`,
  `devnetMail`, `devnetMailFaults`).

### Options

- **A. Shared tables with a tenant column, enforced in generated code.** Every
  `organization` table has `org_id NOT NULL` as the first column of its key
  and of every index. Every generated query takes the tenant from an Effect
  service.
- **B. A, plus Postgres row-level security as a backstop.** The generated
  policies read `current_setting('app.org_id')`, which each transaction sets
  with `SET LOCAL`. The application connects as a role without `BYPASSRLS`.
  Ponder writes its own schema. The application reads chain facts only
  through views joined to the Safe-ownership table.
- **C. One Postgres schema per Organization.**
- **D. One database per Organization.**

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | A: generated; one `Tenant` service | B: a hand-written query that forgets the tenant leaks or moves another Organization's data | B: `tbl:<t>/tenancy` cross-tenant evals, but only for generated paths | A | A |
| B | A: A plus about 2 generated policy lines per table | A: a forgotten tenant returns no rows instead of the wrong rows | A: the same evals, and a static check that every `organization` table has a policy | B: a `SET LOCAL` in the transaction wrapper, and care with pooled connections | A: policies can be dropped in one migration |
| C | C: migrations run once per Organization | B | C: a cross-tenant check needs N schemas | D: Ponder cannot split by tenant; chain facts would be copied | D |
| D | D | B | D | D: Ponder and joins across Organizations, such as an Organization paying another, become remote | D |

### Recommendation

**B.** The book gets five tenancy values:

- `organization`: `org_id`
- `person`: `person_id`
- `owner`: `owner_kind` and `owner_id`, for the 11 tables that an
  Organization or a person can own, with an RLS policy for each kind
- `global`: written only by the system, for example prices and feature flags
- `chain`: Ponder's views, read only through a declared scope join on the
  Safe-ownership table

**No tenancy by join:** a child row carries its own `org_id`, even when its
parent has one. Test tables move to the `devnet` concept, on an environment
that production never runs.

C and D break Ponder and every payment between Organizations. A depends on
every hand-written query being right; B makes a mistake fail closed for about
two lines per table.

### What changes in the book

```ts
// records/data.ts
tenancy: Schema.Literals(["organization", "person", "owner", "global", "chain"]),
/** For `chain` tables: the join that scopes a read to the caller's Safes. */
scope: Schema.optionalKey(Schema.Struct({ via: Ref("table"), on: Schema.String })),
```

- **New rule `tenant-key`:** an `organization`, `person` or `owner` table's
  key and every index start with its tenant column(s).
- **New rule `tenancy-by-join`:** a table with one of those tenancies but no
  tenant field is a problem.
- **New rule `chain-read-scope`:** a read of a `chain` table needs `scope`;
  a write to it is a problem, because only Ponder writes.
- **Generated per table:** the migration, its RLS policy and the eval
  `tbl:<t>/tenancy`. The eval reads and writes as another Organization's
  member and expects nothing.
- **This resolves the Ponder question in [50](../spec/50-design-book.md)**
  (`source: "indexer"` tenancy) as `tenancy: "chain"`.

---

## P9. Dropping pre-v4 contracts, tables and code paths entirely

### Question

Does the rebuild carry anything from before Protocol v4: the V2 and V3
contracts, their tables, their code paths and the book text that describes
them?

### Why it matters

- **Pre-v4 Solidity.** `packages/contracts/src` holds 9 files:
  `CapxulPaymentsV2`, `CapxulPaymentsV3`, `CapxulEscrow`,
  `CapxulEscrowFactory`, `PayrollDepartments`, `PayrollCalendar`,
  `CompaniesHouseClaimer` and two test tokens. There are also 28 test and 6
  script `.sol` files. v4 (`packages/contracts/v4`) has 50 source files;
  findings counts 49 files and 17 contracts.
- **Pre-v4 TypeScript** (`git grep` over `*.ts` and `*.tsx`, tests
  excluded).
  - 33 files and 113 lines name `PaymentsV2` or `PaymentsV3` (51 files
    counting tests; 45 files matching any case, such as `paymentsV2`).
  - 27 files name `PayrollDepartments` (41 counting tests), whose ABI alone
    is 1,213 lines (`protocol/src/evm/payroll-departments-abi.ts`).
  - 13 sites branch on `protocolV4()` being null (7 `=== null`, 6
    `!== null`), for example `payroll/agreements/external.ts:116` and `:244`
    (`readAgreementsV3` against `readAgreementsV4`).
- **Deployments.** v4 is deployed on the devnet only
  (`protocol/src/evm/protocol-v4-addresses.ts:39-40` lists only `devnet`).
  Old staging runs V2 and V3. Every one of the 1,377 devnet proofs that
  records a protocol ran `"v4"`.
- **The book.**
  - Version tags: 100 operations are tagged `pre-v4` only, 91 both and 24
    `v4` only. The 100 are mostly off-chain (payments 26, accounts 18,
    books 16, devnet 15), so the tag mostly means "no v4 slice yet".
  - 36 acceptance lines mention v4. 29 of them open with "On v4" (18), "On
    Protocol v4" (3) or "On a v4" (8).
  - 2 lines describe pre-v4 behaviour only: `org.department.close` #5 ("A
    department before v4 is refused with `WRONG_STATE` `pre_v4`") and
    `org.board.show` #3 ("A verified pre-v4 Organization is refused before
    any chain read"). 2 more end with a pre-v4 refusal clause:
    `org.allowance.list` #1 and `org.member.grant` #8.
  - **81 operations have a `designed:` block,** the v4 design, beside
    top-level text that often describes pre-v4.
- **The database** keeps pre-v4 and v4 shapes side by side. Findings counts
  626 optional fields and `v.any` bags marked "needs a data migration".

### Options

- **A. Drop it all.**
  - No V2 or V3 contracts, tables, branches or ABIs.
  - The new staging gets a first v4 deployment on Base Sepolia.
  - Nothing is migrated from old staging.
- **B. Read-only history.** Index old V3 events into a `chain` table so that
  old payments still display. No writes.
- **C. Port both behind a protocol flag,** as the old code does today.
- **D. Migrate pre-v4 state into v4:** balances, Organizations and payment
  history.

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | A: removes the 13 branches, about 33 files, 1.2k lines of ABI and the dual-shape fields | A: one contract set, one path to check | A: every `acc` runs on one protocol | A: nothing to port | B: the old system still runs until old staging is turned off; after that, history is gone |
| B | B: one indexer source and one read model | B: read-only, so it cannot move money | B: one more read to test | B | A |
| C | D: two of everything | C: two paths that can disagree on the same command | C: every eval is doubled or one path goes unchecked | D | C |
| D | C: a one-off migration | C: testnet balances re-minted, with a chance of mistakes | B | C | D |

### Recommendation

**A.** Base Sepolia is a testnet, v4 is the only version any devnet proof has
run, and the 100 "pre-v4 only" operations are mostly off-chain. They are
protocol-free, not pre-v4.

**One step is Aaron's,** because it cannot be undone: turning off old staging.
That ends access to pre-v4 testnet history for any beta user. Until then the
old system keeps running, so A is reversible.

C doubles every eval for a protocol nobody will run. D spends effort on
testnet balances. B is the fallback if Aaron rules that beta users need their
old history.

### What changes in the book

- **New rule `contract-v4`:** a `contract` record needs an address in the v4
  address book. A pre-v4 contract is a problem.
- **The old `version` tag is not carried over.** It is recorded only in
  `was`.
- **Where an operation has `designed:`,** its v4 text is the frozen text (see
  P10).
- **Mechanical edits under P1's script:** the 29 "On v4", "On Protocol v4"
  and "On a v4" openings are stripped, and the 2 pre-v4-only lines are
  retired as `null`, with their numbers kept. The 2 lines with a pre-v4
  clause go through P1's rewrite: the clause is cut, the old line moves to
  `was`, and the v4 claim stays.
- **The `pre_v4` reason** of `WRONG_STATE` is retired from the error records.

---

## P10. When the old book and the old code disagree, which wins

> **Superseded for spelling (8 November 2026).** Aaron's decision `system.frozen-behaviour` frees
> the spelling of the surface: commands, flags, `--json` shapes, refusal codes and wording. The
> target book designs them as one consistent system, so the first rung ("surface → book") no
> longer makes the frozen text win on spelling. What each acceptance claim requires still holds.
> The rungs below still decide behaviour, money and internals. The legacy run (`--target legacy`)
> is no longer a baseline: the old system is read for behaviour, not run against.

### Question

The book is frozen and the old code is the baseline (`--target legacy`). Where
they disagree, which one is the specification for the rebuild?

### Why it matters

They disagree often, and in several ways:

- **The book disagrees with itself.** 81 operations carry a current text and
  a `designed:` (v4) text. In 73 of them `designed.who` differs from `who`. In
  63 the refusal codes differ. In 34 the SDK method is named differently, for
  example `agent.show`: `client.me.agents.show` against
  `client.me.agents.get`; 16 more name a method only in `designed`.
- **The book is ahead of the code.** The funnel in `status.json` has 161
  operations `built`, 35 only `defined` and 19 only `specified`. The proofs
  record 2,122 `NOT BUILT` verdicts on 64 distinct steps: 1,742 name one of
  26 book commands, for example `shares exercise`, `invest pay`, `org
  options end` and `org exit pay`, and 380 are steps with no command yet
  (reason "future (CAP-1182)" and the like). The
  `payment.send` notes say "A dated `--org` payment is not built yet
  (CAP-1238)".
- **The code is ahead of the book.**
  - 35 exemptions (`apps/docs/factory/exemptions/*.yaml`) are code changes
    that asserted no book change, for example
    `cap-1236-payments-router.yaml`.
  - 163 operations' events were derived from the code after the fact; 52
    were written in the book.
  - 27 operations' backend rows are hand-overridden in the book, because the
    code could not be traced to them (`backend.source: "override"`).
- **The rule kept them aligned only at merge time.** `docs/rules/code.md:283-302`
  ("Every change updates the book") holds at each pull request. Nothing
  re-checks behaviour afterwards: findings counts 0 proven operations in the
  funnel.
- **Even the audit disagrees.** Findings says "the indexer reads no v4
  events". At head, `apps/indexer/ponder.config.ts:142-143` spreads `V4_SOURCES`
  (CAP-1096), and `apps/indexer/src/v4` defines 28 tables.

### Options

- **A. The book always wins.** Code that disagrees is a bug in the old
  system.
- **B. The shipped code always wins.** The book is corrected to what runs.
- **C. A ladder by kind of fact, refereed by a legacy run:**
  1. **Surface** (command, flags, the `--json` shape, refusal codes and exit
     codes): the book wins. Where `designed:` exists, its v4 text wins over
     the top-level text (P9).
  2. **Behaviour** (acceptance lines): run the line against the old system.
     If it passes, it is settled. If it fails and the behaviour shipped, the
     code wins and the line is corrected through a matter. If it fails and the
     old code is wrong, the book wins and the old behaviour is recorded as a
     known bug.
  3. **Money and authority:** whichever version is stricter wins until a
     matter rules. The rebuild never becomes less safe on the strength of a
     tie.
  4. **Internals** (tables, scheduling, event names, rows): neither wins. P3
     to P8 decide.
  5. **What the book never says** (35 records with no acceptance line, and
     behaviour no line covers): the code is evidence, not specification. The designer
     writes the claim, and `des:` and the per-area matter review it.
- **D. Aaron decides each disagreement.**

### Grades

| Option | Code size | Money | Measurability | Effort | Reversibility |
|---|---|---|---|---|---|
| A | B: the rebuild implements 54 unbuilt designs at once | C: a book line no one ran becomes a money path with no shipped behaviour behind it | B: every claim is an eval, but 81 operations have two texts, so "the book" is ambiguous | C | B |
| B | B | C: copies the old code's bugs into the new money paths | C: the code has no claims to check | B: designers transcribe behaviour | B |
| C | A: no extra machinery; the legacy run already exists in [30](../spec/30-capxul-evals.md) | A: rung 3 is a ratchet towards safety | A: each disagreement ends as an eval that passes on one side, or as a recorded matter | B: one legacy run per line, already planned in M3 | A: each ruling is a matter with a record |
| D | A | A | B | D: hundreds of questions for one person | A |

### Recommendation

**C.** A and B each pick a side for every kind of fact, and the evidence says
the right side differs by kind. D cannot scale: 81 operations alone have two
texts.

The ladder turns most disagreements into a legacy run, and leaves Aaron only
the ones in rung 3 and the per-area matters that [30](../spec/30-capxul-evals.md)
already plans. This pack is itself evidence for the ladder: P1 (rung 2), P9
(rung 1) and P3 to P8 (rung 4) are each one rung applied to a whole class of
facts.

### What changes in the book

```ts
// records/outcomes.ts: a decision records which rung settled it
export const DecisionSpec = Schema.Struct({
  ...,
  rung: Schema.optionalKey(Schema.Literals(["surface", "behaviour", "money", "internal", "unspecified"])),
  legacy: Schema.optionalKey(Schema.Literals(["pass", "fail", "not-run"])),   // the referee's result
});
```

- **New gap `two-texts`:** an operation imported from an old record with a
  `designed:` block keeps the designed text. The current text goes to `was`
  until `des:` approves.
- **New rule `money-weakened`:** a decision with rung `money` that loosens a
  refusal or a guard must link a person's signoff (`ok:`).
- **The `des:` eval** adds a check that every acceptance line has a legacy
  result (`pass`, `fail` with a matter, or `not-run` with a reason).

---

## Summary

| # | Policy | Recommendation | Main evidence | Book change |
|---|---|---|---|---|
| P1 | Frozen text or black-box claims | **Freeze the claim.** Strip the 733 test citations into `was`; keep about 585 lines verbatim; rewrite about 148 internal lines into observable claims, reviewed per area | All 733 lines cite a test file; about 148 name a mechanism, such as `activity.events` #3's "the newest 100 rows" | `acceptance` items become `{claim, observes, was}`; rule `acceptance-citation`; gap `acceptance-internal` |
| P2 | Orphan SDK methods and unreached rows | **Classify, delete by default.** Steps fold into their operation's flow; surface methods name their surface; probes go to `devnet`; about 61 to 71 methods and 17 rows with no caller go | 184 of 348 methods and 117 of 285 rows are outside the book; 61 to 71 and 17 have no caller | `flow.for`; rules `unreached-rpc`, `orphan-flow`, `devnet-in-production` |
| P3 | What a workflow is | **Durable work that no caller waits on:** a transition, chain, timer or cron trigger that must survive a crash or may wait. Everything else is a step | 37 `emit-*`, 12 `*-intent`, 34 `load-*` and 61 `record-*` or `record` files; 103 scheduler sites; 15 crons, about 6 of which stay | rules `workflow-trigger` (with `durable`) and `emit-only` |
| P4 | Writes across concepts | **Procedures for the same money fact, the outbox for the rest** | `applyChainSettlementInTx` writes payments, payroll, requests and books in one transaction; 0 door imports; 402 deep `InTx` imports; ADR-0042 decision 1 already puts Books writes in the caller's transaction | `procedure.atomic`; door-only procedure imports (beside the existing `invoke-boundary`); rule `notice-in-transaction`; eval `sys:tx-width` |
| P5 | Budgets | **Class defaults from hops,** overrides with a reason. Operation p50/p95: read 600/1,200 ms; write 700/1,500; chain-read 900/2,000; chain-submit 2,000/4,000; chain-settle 3,000/8,000; vendor 1,500/4,000; background 2,000/15,000; live push 300/1,000 | Old devnet medians: read 1,164/2,047 ms, write 1,466/3,207, signed 6,422/10,054; staging reads 5.4–6.5 s; per-command tails only from single-command steps | `budgets.ts` defaults; `budget.why`; rules `budget-override-why` and `budget-class-fit`; gap `no-budget` |
| P6 | Required child spans | **Boundary spans made by the runtime:** `db.tx`, `call.<integration>.<call>`, `workflow.step.*` and `wait.*`, plus one `error.code` | 18 span sites in the whole system; no database spans; 3 names for the error code | `spans` derived and `extraSpans` hand-listed; rule `span-name`; gap `uninstrumented-call` |
| P7 | Which events survive | **One `<machine>_transitioned` per state machine,** about 36 events; 54 go; the steps of 16 journey events prove by the operation's success | 109 events: 55 state, 20 steps, 13 plumbing, 9 failures, 9 UI, 3 CLI; 46 named by journeys | `journey.proves` takes an event or an operation's success; rules `event-not-on-transition` and `one-event-per-machine` |
| P8 | Tenancy | **Tenant column first in every key and index, plus generated row-level security;** Ponder read through Safe-scoped views | 6 owner-key shapes; 42 tables with no owner key; the indexer is scoped by a signed `safes` claim | tenancy `organization`, `person`, `owner`, `global` or `chain`; `scope`; rules `tenant-key`, `tenancy-by-join` and `chain-read-scope` |
| P9 | Pre-v4 | **Drop it all.** A fresh v4 deployment on the new staging. Turning off old staging is Aaron's irreversible step | 13 v4/pre-v4 branches; 33 files name V2/V3; v4 is on the devnet only; every proof ran v4 | rule `contract-v4`; the `version` tag dropped; the `designed` text is the frozen text |
| P10 | Book against code | **A ladder by kind of fact,** refereed by a legacy run: surface → book (designed first); behaviour → legacy run; money → the stricter; internals → the target design; unspecified → code as evidence | 81 operations with two texts; 54 designed but unbuilt; 35 exemptions; 163 events derived from code | `decision.rung` and `decision.legacy`; gap `two-texts`; rule `money-weakened` (superseded for spelling and the legacy run: `system.frozen-behaviour`) |

### What was not measured here

- **Staging p95 per operation** from PostHog (`capxul_backend_operation`
  `duration_ms`) was not read, because this run had no PostHog access. P5
  rests on the devnet proofs and the October baseline. `capxul/measure`
  should read it before M3.
- **The React web app** (30 pages) is not in the old checkout. P2 counts
  React callers only through `packages/sdk-react`, so some of the 61
  methods with no caller may have one there.
- **The SDK count** comes from the generated SDK reference pages, not from a
  TypeScript walk. It agrees with findings within 1 (348 against 349).
