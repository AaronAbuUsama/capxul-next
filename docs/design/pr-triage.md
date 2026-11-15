# Triage of the old open pull requests

**Status, 15 November 2026, 16:40 UTC: closed 0; open 58 (#145 to be kept; the other 57 waiting).** The conductor
relayed Aaron's answer: close groups 1, 2, 3 and 5, and keep #145. The triage session closes them only on Aaron's
own written yes, given in its session or on #285, and none has come yet. The closing comments are ready: each names
the pull request's idea and where it went (group 5: the blueprint backlog, per the conductor) or why it is closed.

Made on 15 November 2026, at Aaron's request, by the pull-request triage session. It covers the 57 pull requests still
open from the old product line's wave 0 (12 and 13 November 2026, into `integration/wave-0` and
`lane/activity-movements`), and #229, the one old pull request into `master`. In-flight work on `master` (#280 and
today's `slice/`, `work/`, `design/` and `fix/` branches) is left out.

The roadmap's decision "The Amp wave" kept these pull requests open as reference for porting, each closed once
`master` replaces it. This page says, for each one, whether it has been replaced, holds an idea `master` still lacks,
or is dead. Nothing here is merged. A closed pull request and its branch can be reopened, and no branch is deleted.

Classes:

- **(a) Overtaken:** the rebuild already does it, or decided otherwise. The reason names the decision or the code.
- **(b) Idea to carry:** what it proves or handles is not yet in the rebuild. The last column says where it belongs.
- **(c) Dead:** a superseded approach, or a fix to code that no longer exists (`packages/backend`, `packages/evals`,
  `devnet/`, the old blueprint records, the supervisor).

Words are the glossary's (`docs/design/blueprint.md`, part 12): the **api** is what the code still calls Core, the
**site service** what it calls the site door, the **cluster** the fleet hub, a **promise** an acceptance claim, an
**item** a roadmap step.

## Group 1: #229, into `master`

| # | Title | Class | Reason | Where the idea goes |
|---|---|---|---|---|
| 229 | Site door: removing sites runs in the background | a | `master`'s site service already runs `DELETE /world` and `DELETE /sites/<site>` as background jobs when the caller sends `Prefer: respond-async` (`packages/platform/door/jobs.py`, from #242 and #243), and the world's `removeSites` and `Points` already ask for them (`doorJob`, `packages/world/src/site/call.ts`). The one thing #229 has that `master` lacks: a removal cut short by a restart of the site service is resumed, where `master` marks the site `failed` | Small follow-up for the sites lane: on start, resume a `removing` site instead of failing it (`door.py`, its start-up loop) |

To bring the remaining idea over: one change to the start-up loop of `packages/platform/door/door.py`, calling
`remove_site` in a thread for each entry left `removing`, with the test from #229's `door/tests/test_removal.py`. No
change to the world is needed: it already polls jobs.

## Group 2: dead (old wiring and review follow-ups)

Wiring of the old backend, its eval framework, its supervisor and its blueprint records, or review follow-ups to
them. None of that code is on `master`.

| # | Title | Class | Reason |
|---|---|---|---|
| 179 | ci: type-check `packages/evals` | c | The old eval package; `pnpm types` (rung 4) checks every package |
| 175 | Organizations: setup process follow-ups | c | Fixes the old setup process; `org.create` founds in one step and Directors sign through `approval.sign` |
| 172 | Documents: a Movement's Memo keyed by its log id | c | Old blueprint records; its key rule is carried with #124 |
| 171 | Documents/media: cross-concept tests leave the concept folders | c | Moves tests in `packages/backend`, to satisfy the old import checker |
| 169 | Sites: `readSiteHosts` door | c | Old store plumbing; the api keeps a company's site on its organization row |
| 163 | Activity: native regression controls | c | Old eval harness over the old outbox; its id rule is carried with #124 |
| 158 | Notices: an empty `person_id` is no owner | c | Follow-up to old notices code |
| 157 | evals, devnet, engine: pre-attempt follow-ups | c | Old framework; a budget is a target and never fails a run |
| 150 | Compose Access' gate catalogue into the approval carrier | c | Old carrier wiring; feature gates are already a parity row |
| 146 | contracts: move the genesis to the general escrow (draft) | c | A hand-made `core.json`; the seeded chain is rebuilt by `pnpm seed` (item 3.2) |
| 144 | Access/accounts: #123 review wording | c | Wording on old records |
| 143 | Supervisor: a clean child stop is never unclean | c | The old supervisor; worlds are Alchemy stacks on the cluster |
| 141 | Evals: Organizations and Parties table checks | c | Checks old backend tables; the api keeps no second copy of what Frappe owns |
| 140 | Compose the approval carrier's chain half in Core | c | Old carrier assembly; its idea is carried with #127 |
| 133 | Trace: #118 review follow-ups | c | Wording and test cleanup |
| 126 | Activity: Movement record check | c | Old eval check over the old outbox |
| 115 | Finalized Safe and hat readers for Board | c | Old indexing readers for #106; the api reads the chain through the endpoint |
| 108 | Access/Accounts composition | c | Old sign-in wiring; sign-in is item 5.2 ("Account identity") |
| 104 | Compose approvals, payments and requests in migration and worker | c | Old backend composition |
| 98 | Budgets' executor on the service signer's durable lane | c | Old signer plumbing serving #128; carried with it |
| 92 | Compose Activity: migrations and change-log relay | c | Old composition and a Postgres feed |
| 81 | Party profiles and native Hat authority | c | Old profile store; profiles are parity row J25; a world's chain never reorganises |
| 61 | Close parked hosted-FDE blueprint dependencies | c | Surgery on old records for a parked feature |
| 164 | Sites: raw handlers tell Core when their caller is admitted | c | A hook for the old signals rows; telemetry is declared spans (4.1, 4.4) |

## Group 3: overtaken by `master`

| # | Title | Class | Reason |
|---|---|---|---|
| 173 | generate: `packages/generate` with the facts target | a | Item 3.1 is Done: `pnpm generate` and `generate:check` in CI |
| 167 | Core: records take the caller's world instant only | a | The history stamps entries with world time (`packages/core/src/site-ops/record.ts`) |
| 165 | Shared checks: PR91 follow-ups | a | `approval.sign`'s promises cover a bad signature (`SignatureInvalid`, nothing sent) |
| 161 | Outbox host stamps | a | Elapsed time is carried by spans ("Measurement is declared", 4.1, 4.4); no outbox on `master` |
| 156 | world stop takes down the world's MariaDB and Redis | a | A world has no bench of its own ("Sites from a pool"); it is destroyed after its run |
| 154 | Plugs takes world time from composition | a | `WorldClock` is an Effect service; `capxul/import-door` keeps imports to each package's door |
| 153 | Sites: Core mounts the document door and the site lifecycle | a | `doc.create`, `doc.submit` and the site's `reconcile` are on `master`; who may call is item 5.1 |
| 152 | Notices: the world clock from composition | a | As #154 |
| 147 | evals: one static checker for imports and generated files | a | `capxul/import-door` and `generate:check` |
| 138 | Sites: provisioning waits past Node fetch's 300 s limit | a | Long site work answers 202 or runs as a job; but see the two risks under "Found while reading" |
| 136 | Sponsorship expiry is its own outcome | a | Expiry is checked once, in world time, before sending (`ApprovalExpired`); no window in the UserOperation |
| 132 | Route sponsorship expiry to the lapse | a | As #136 |
| 130 | SDK and CLI: one trace from the command to Core | a | The SDK sends `traceparent` from each call's span; the runner checks the CLI path |
| 125 | Shared signals in Core: rpc spans, wide rows, alerts | a | One span per call under the caller's trace; OTLP and monitors are 4.4 and part 10 |
| 121 | Evals: one checker for event promises against the outbox | a | The runner's generic events check (`packages/runner/src/checks/events.ts`) |
| 120 | Compose the sponsor on the world clock | a | As #136 |
| 116 | Sites: provision through an Access Bearer | a | The site is made inside `org.create` with the world's own token ("Site creation on a shared bench") |
| 113 | Snapshot doors refuse with declared errors | a | `world.snapshot.save` and `restore` declare their refusals |
| 80 | Provisioner: every world an Alchemy stage | a | `packages/world`: a world is a stack on the cluster plus a Neon branch |
| 77 | Story 1: the supplier payment end to end | a | The journey `pay-and-branch` passes; its Frappe fixes are on `master` |
| 63 | Books/Budgets: same-transaction evidence doors | a | `org.budget.create` refuses before approvals open and settles from the landed log; books are Frappe's |

## Group 4: escrow, kept for its revisit

| # | Title | Class | Reason |
|---|---|---|---|
| 145 | contracts: general escrow and escrow factory (E1) | a | Decided otherwise for now: "Escrow stays as it is on `master` for now and is revisited later" ("Every payment settles one sealed document"); held payments come with the invoice ledger (6.2). Its invariants G1 to G11, its 12 mutation checks and its Certora spec are worth reading at that revisit |

## Group 5: ideas to carry

Each is dead as code (it is written against the old backend) but proves or handles something `master` does not yet.

| # | Title | Class | The idea, in one line | Where it goes |
|---|---|---|---|---|
| 166 | Approvals: the signer's routes; world-time `created_at` | b | A signer can read an approval and decline it; `ApprovalClosed` names `declined`, but no operation reaches it | Blueprint: `approval.show`, `approval.decline` (event `approval_declined`); moves of the approval machine (7.3) |
| 127 | Core's bundler door for the approval carrier | b | A send whose answer was lost is never sent again: it is found by its expected hash; a bundler's validation rejection is a declared refusal, not `ChainFailed` | A promise on `approval.sign`; a refusal such as `BundlerRefused`; the approval machine's `sending` to `sent` (7.3) |
| 106 | Board: carry proposals to the transaction at their Safe nonce | b | A queued company transaction ends by what actually used its nonce: executed, failed, rejected or replaced; the other approvals are withdrawn | The approval machine (7.3), moves `failed` and `replaced`; a promise on `org.budget.create` |
| 176 | World clock warp through Core's due stops | b | A warp stops at each of the api's own due times; a part failing mid-warp is a declared refusal naming the stop; a second warp at once is refused | `world.clock.warp`: refusals `WarpFollowerFailed`, `WarpInProgress`, and a promise; the due stops come with the first operation that has due work |
| 151 | Host clock scan hardening (with #167) | b | Product code reads time only from the world clock: a check over the api's `Clock` reads, SQL `now()` and the Frappe app's Python | A lint rule (item 3.3) with today's hits on an `unmigrated` ratchet (3.6); `found.ts` writes `founded_ms` from host time today |
| 102 | Mount the resume fault between a consumer's effect and its ACK | b | A test world can stop the api between a delivery's effect and its ACK, and a journey proves it is delivered again exactly once | Parity journey J21 "stays true when broken"; a fault control in the `pipeline` domain |
| 148 | Trace: refuse all-zero ids, check the bench's trace id | b | The Frappe site joins the caller's W3C trace; today `trace.py` accepts only `tr_…` ids, so a document's trace never matches the api's span | Item 4.4, the site as a producer; the id's format generated from the blueprint's `TraceId` (as 3.1 does for `site.py`) |
| 170 | Indexer: `awaitBlock` and `factsOf` | b | A read from the index says "not yet" until the index has reached the block asked about; never an empty answer | A data refusal such as `IndexBehind` and a `wait` span (4.1) for the first operation that reads the index (`activity.list`, J17) |
| 124 | Movements: outside money with book facts, Memo and events | b | A Transfer into a Safe that no Capxul payment explains becomes a Movement, one per side, with a Memo; removed and restored across a reorganisation | Parity row "Movements (outside money)", J17: a `movement` machine, `movement_recorded`, `activity.get`; the book entry a Frappe document |
| 128 | Payments: a budget's dated payment executed on its day | b | A dated payment is paid on its day exactly once: refused `NotDue` before it, a late answer changes nothing | Parity row "Scheduled payments" (streaming dropped by "No streaming pay"); `payment.schedule` for J23, after 6.2 |
| 94 | Books: public annotation save | b | A member gives an activity row its account, checked against the site's own chart, with authority checked again just before the write | Parity row "Annotate a row with its account", J6: `activity.annotate`, writing the Frappe document; refusal `AccountNotInChart`; the caller's hat (5.1) |

## Found while reading

Two risks on `master` itself, found while checking #138:

1. The api's `SiteDoor.clock` (`packages/core/src/site/SiteDoor.ts`, used by `world.clock.warp`) posts `/clock`
   without `Prefer: respond-async`, though the site service says `/clock` can wait on other worlds' locks. On a busy
   bench it can outlast Cloudflare's 100 s and fail with 524.
2. `world.create` and `world.snapshot.restore` answer in one response after minutes (starting points took 256 to 287 s;
   a site restore may take 8 minutes). The CLI runs on Node's fetch (`packages/cli/src/bin.ts`), whose 300 s header
   limit would cut such a call, as #138 found. This matters for the journeys through the CLI (item 1.10).

## Recommendation

| Group | Recommendation |
|---|---|
| 1. #229 | Close: overtaken by door jobs; the restart follow-up goes to the sites lane |
| 2. Dead | Close |
| 3. Overtaken | Close |
| 4. Escrow | Keep #145 open until the escrow revisit; it is the reference for it |
| 5. Ideas | Close, once the conductor has routed each idea; this page keeps each idea with its pull request. Closing them before `master` builds the idea amends "The Amp wave", so it needs Aaron's written yes |
