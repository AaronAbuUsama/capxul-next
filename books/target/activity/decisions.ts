// Every judgment the activity design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old
// activity's items, overlays and documents, old accounts' balances and summaries, old
// organizations' treasuries, the SDK's activity and accounts reads and the CLI's commands) and the
// frozen book as evidence. The as-is book has no activity folder; its accounts and organizations
// folders record the balance, treasury and deposit-instruction reads.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_activity, concept_budgets } from "../shared/foundation.ts";
import { machine_movement, machine_payment, table_movements, table_payments } from "../payments/data.ts";
import { table_book_annotations, table_book_prices } from "../books/data.ts";
import { table_chain_budgets, table_indexer_progress, table_safe_balances, table_safe_owners } from "../indexing/data.ts";
import { table_activity_changes } from "./data.ts";
import { table_documents } from "./links.ts";
import { rpc_activity_feed_get, rpc_activity_feed_list, rpc_activity_feed_summary } from "./feed.ts";
import { rpc_activity_changes_read } from "./changes.ts";
import { rpc_activity_holdings_address, rpc_activity_holdings_balances } from "./holdings.ts";
import { flow_client_activity_changes } from "./flows.ts";
import * as processes from "./processes.ts";
import {
  OPERATIONS,
  operation_activity_events,
  operation_activity_get,
  operation_activity_list,
  operation_activity_summary,
  operation_address,
  operation_balance,
} from "./operations.ts";

const CLAUDE = "Claude, activity design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const OLD = "packages/backend/src/activity";
const EVENTS_CLI = "apps/cli/src/commands/activity/subcommands/events/execute.ts";

const APPENDERS = Object.values(processes).filter(
  (u): u is typeof processes.workflow_activity_changes_note_payment_open =>
    typeof u === "object" && u !== null && (u as { _kind?: unknown })._kind === "workflow",
);
const FEED_READS = [rpc_activity_feed_list, rpc_activity_feed_get, rpc_activity_feed_summary, rpc_activity_changes_read];
const HOLDINGS = [rpc_activity_holdings_balances, rpc_activity_holdings_address];

// ── the change feed ─────────────────────────────────────────────────────────────────────────

export const decision_activity_change_log = defineDecision({
  id: "activity.change-log",
  title: "`activity events` pages a change log activity appends from payments' transitions",
  question:
    "`activity events` must answer every change after a cursor exactly once: a change to an old Payment however many " +
    "rows are newer, and a Movement indexed late. What does it read in order?",
  options: [
    {
      label: "change-log",
      text:
        "Activity owns `activity-changes`, one row per change per feed with a gap-free `seq`, appended by small workflows " +
        "triggered by payments' transitions through the outbox; the read pages it by `seq` and reads each row as it stands.",
    },
    {
      label: "updated-at",
      text: "Read payments' rows by `updated_at` and Movements by block time live, as the old backend and CLI did, with a replay window.",
    },
    {
      label: "commit-order-column",
      text: "Ask payments to stamp each row with its writing transaction's id and index it, and read rows below the snapshot's horizon.",
    },
    { label: "stored-cursors", text: "Keep each reader's position in a table, written on every read." },
  ],
  chosen: "change-log",
  why:
    "A time column cannot promise exactly once: a transaction that stamps time T can commit after a reader has read past " +
    "T, so a reader skips it, which is why the old CLI replayed fifteen minutes and carried up to 500 row versions in its " +
    "cursor. A `seq` taken under the feed's transaction lock commits in order, so paging by it skips nothing and repeats " +
    "nothing, and a Movement is noted when it is recorded, not dated by its block. P4 names this shape: a projection " +
    "that may lag is a workflow in the reacting concept triggered by the other's transition, and payments' events already " +
    "say activity follows them. A commit-order column would put activity's need into payments' table and indexes. Stored " +
    "cursors would make every read a write. This is the one store activity owns, the 'change cursor' of concepts.activity.",
  source: by(`${EVENTS_CLI}:23 (REPLAY_MS, MAX_SEEN); ${OLD}/items/rules/changes.ts:43; P4; books/target/payments/data.ts (event abouts)`),
  affects: [table_activity_changes, rpc_activity_changes_read, ...APPENDERS, concept_activity],
});

export const decision_activity_followed_transitions = defineDecision({
  id: "activity.followed-transitions",
  title: "Every Payment transition is a change; of a Movement's, only its birth",
  question: "Which of payments' transitions does the change log follow?",
  options: [
    { label: "payments-and-movement-birth", text: "All eleven Payment transitions, and the Movement's `record`." },
    { label: "all", text: "Every Payment and Movement transition, a Movement's removal and restoration included." },
    { label: "status-subset", text: "Only births and settlement-related transitions." },
  ],
  chosen: "payments-and-movement-birth",
  why:
    "The frozen page promises 'new Payments, changed Payments and new Movements'. Every Payment transition changes the " +
    "status a feed row shows, so each is a change a follower must see; skipping one would leave a reader with a stale " +
    "status. A Movement never changes. A reorg's `remove` and `restore` have no event in the frozen vocabulary: a removed " +
    "Movement leaves the feed and `activity get` answers null; a restored one was already reported once. The schema's " +
    "trigger names one transition, so each followed transition is its own small workflow of one shape; two may run out " +
    "of order, so a feed's first change for a row is `new` and the rest `updated`, and no reader sees a row change " +
    "before it is born.",
  source: by("books/frozen/operations.ts (activity.events about and returns); books/target/payments/data.ts (machines payment, movement)"),
  affects: [...APPENDERS, machine_payment, machine_movement],
});

export const decision_activity_sealed_cursors = defineDecision({
  id: "activity.sealed-cursors",
  title: "Cursors are sealed by the backend and stored nowhere",
  question: "How does a read refuse a cursor it did not issue, and where does a reader's position live?",
  options: [
    {
      label: "sealed",
      text:
        "Each cursor is an opaque string the backend seals (an HMAC under its cursor key) over the feed, the read that made it " +
        "and its position: a `seq` for changes; the checkpoint, the last row and the filters for a page.",
    },
    { label: "plain-json", text: "The old JSON positions, checked only for shape." },
    { label: "stored", text: "A cursor table, one row per issued cursor." },
  ],
  chosen: "sealed",
  why:
    "'It refuses a cursor it did not issue' needs a check a client cannot fake; the old JSON cursor passed any well-shaped " +
    "forgery, and one from another feed read that feed's positions. A seal binds the cursor to the feed and the read, so " +
    "a foreign, forged or cross-read cursor is INVALID_INPUT, as the frozen pages name, and the reader keeps it, so a " +
    "read writes nothing. The CLI still refuses a value that is not shaped like a cursor with CLI_USAGE before any call. " +
    "The contacts book's cursors follow the same rule.",
  source: by(`${OLD}/items/rules/pages.ts:56; ${OLD}/items/rules/changes.ts:18; books/target/contacts/book.ts (list cursor)`),
  affects: [rpc_activity_feed_list, rpc_activity_changes_read, operation_activity_events, operation_activity_list],
});

export const decision_activity_one_method_for_events = defineDecision({
  id: "activity.one-method-for-events",
  title: "`activity events` is one SDK flow over one rpc; the CLI composes nothing",
  question: "The old CLI read two SDK methods (changes for Payments, list for Movements) and merged them. What does the target do?",
  options: [
    { label: "one-flow", text: "One Core SDK flow, `client.activity.changes`: the change read, and with `--wait` a five-second wait between reads." },
    { label: "two-calls", text: "Keep the two reads and the CLI's merge, replay window and version list." },
  ],
  chosen: "one-flow",
  why:
    "A4: the CLI calls one SDK method. The change log already holds both kinds of change in one order, so one rpc answers " +
    "them, up to 5,000 per read as the frozen note says, with `truncated` when more wait. `--wait` waits on the host, so " +
    "the method is a flow with a `wait` step rather than the rpc itself. The frozen note that it 'reads two SDK calls " +
    "together' describes the old composition; the text stays as frozen, and the behaviour it promises holds.",
  source: by(`${EVENTS_CLI}:131; A4; books/frozen/operations.ts (activity.events notes)`),
  affects: [flow_client_activity_changes, rpc_activity_changes_read, operation_activity_events],
});

// ── the feed ────────────────────────────────────────────────────────────────────────────────

export const decision_activity_one_read_per_page = defineDecision({
  id: "activity.one-read-per-page",
  title: "A page is one query over payments' three streams, from a fixed checkpoint",
  question: "Where does a page of activity come from, now that the old SDK's merge of Convex rows and Ponder's answer is gone?",
  options: [
    {
      label: "payments-rows",
      text:
        "One query merging the feed's Payments (owner index), those it receives (payee index) and its Movements (by block " +
        "time), newest first, from a checkpoint the first page fixes.",
    },
    { label: "chain-first", text: "Read indexing's Transfers and PaymentSent facts and decorate them with payments' rows." },
  ],
  chosen: "payments-rows",
  why:
    "Payments is the ledger of record: a Payment row exists before anything is on chain (prepared, scheduled), and " +
    "Movements are payments' own classification of outside money. Reading chain facts first would miss unsent Payments " +
    "and re-decide outside money. A fixed checkpoint keeps later pages from repeating or shifting rows. Movements are " +
    "dated by their block, so `--from` and `--to` mean when money moved; a Movement indexed late appears where its block " +
    "puts it, and the change feed reports it once. `readWarning` comes from indexing's progress: when Ponder is " +
    "rebuilding or a minute behind, Movements may be missing and the page says so instead of failing.",
  source: by(`packages/sdk/src/activity/items.ts:1; ${OLD}/items/rules/pages.ts:96; responsibilities.overlays`),
  affects: [rpc_activity_feed_list, rpc_activity_feed_summary, table_payments, table_movements, table_indexer_progress],
});

export const decision_activity_row_shapes = defineDecision({
  id: "activity.row-shapes",
  title: "Feed rows carry the reader's side only; a Payment in full is payments' own view",
  question: "What does a feed row and a row in full show, and what does a payee not see?",
  options: [
    {
      label: "reader-side",
      text:
        "A row is its kind, id, status or direction, an exact amount (asset, token, decimals, raw), the counterparty's label " +
        "and Safe, the receipt and its times. `activity get` shows a Payment as payments' `PaymentView`, from the reader's " +
        "side, with chain evidence, the annotation and, for a Movement, its documents.",
    },
    { label: "old-shapes", text: "The old ActivityItem with its ledger kinds, execution block and deprecated finality fields." },
  ],
  chosen: "reader-side",
  why:
    "Amounts stay in raw units of one exact token, so same-peg tokens never merge and WETH keeps 18 decimals. Reusing " +
    "payments' view keeps `activity get` and `payment get` one answer. A payee sees no approval, proposal or command of the " +
    "payer's: that is the payer's private execution data. Evidence names the Payments contract that emitted the PaymentSent " +
    "and what sent it through (the Safe, Budgets, an escrow, Agreements), and `final` replaces the deprecated always-" +
    "`finalized` fields. Old ledger kinds (Payout, Deposit Payments) are gone with payments' Deposit Payments.",
  source: by("packages/protocol/src/activity/schema.ts:58, :146; books/target/payments/ledger.ts (PaymentView)"),
  affects: [rpc_activity_feed_list, rpc_activity_feed_get, rpc_activity_changes_read, table_book_annotations],
});

export const decision_activity_row_ids = defineDecision({
  id: "activity.row-ids",
  title: "A Movement's id is its Transfer and side; a Payment's is payments' id",
  question: "What id does `activity get --kind movement --id` take, and what does an annotation name?",
  options: [
    { label: "transfer-side", text: "`<chain id>:<tx hash>:<log index>:<side>`, the key of payments' Movement row without its owner." },
    { label: "minted", text: "A new `mov_` id stored on the row." },
  ],
  chosen: "transfer-side",
  why:
    "A Movement is one side of one indexed Transfer for one owner, and payments keys it so; the id repeats that key, so " +
    "no column or lookup is added, and both sides of an internal Transfer have different ids. Books' annotations name the " +
    "same string as their reference. Documents names a Movement's Memo by its Transfer alone (`<chain id>:<tx hash>:<log " +
    "index>`, one Memo for both sides), so `activity get` drops the side to find it. A Payment keeps its `payment_` id.",
  source: by("books/target/payments/data.ts (movements key); books/target/books/data.ts (Reference); books/target/documents/data.ts (by_subject)"),
  affects: [rpc_activity_feed_get, table_activity_changes, table_movements, table_book_annotations, table_documents],
});

export const decision_activity_scope_codes = defineDecision({
  id: "activity.scope-codes",
  title: "A scope you are not in answers as each frozen page names it",
  question: "What does a feed read, `balance` and `address` answer for an Organization the caller has no Seat in?",
  options: [
    {
      label: "per-page",
      text:
        "The feed reads (list, summary, events) refuse INVALID_INPUT ('names nothing you can see'); `activity get` answers " +
        "null, so the CLI says CLI_USAGE; `balance` and `address` refuse ROLE_PERMISSION_DENIED.",
    },
    { label: "one-code", text: "ROLE_PERMISSION_DENIED everywhere." },
  ],
  chosen: "per-page",
  why:
    "The surface is the frozen book's (P10 rung 1). The feed pages list no ROLE_PERMISSION_DENIED and the old feed " +
    "refused a foreign scope as invalid input; `activity get` lists only CLI_USAGE for a row 'this session cannot read'; " +
    "`balance` and `address` name ROLE_PERMISSION_DENIED for a foreign `--org`. Each check is the active Seat of the " +
    "caller's principal, before any row of the Organization is read.",
  source: by(`${OLD}/guards.ts:28; packages/protocol/src/activity/operations.ts:33; books/frozen/operations.ts (refusals)`),
  affects: [...FEED_READS, ...HOLDINGS],
});

// ── holdings ────────────────────────────────────────────────────────────────────────────────

export const decision_activity_balances_from_views = defineDecision({
  id: "activity.balances-from-views",
  title: "A balance is indexing's safe-balances view, refused while Ponder rebuilds",
  question: "Where does `balance` read a Safe's holdings, and what does it answer before the Safe or the indexer is ready?",
  options: [
    {
      label: "views",
      text:
        "Indexing's `safe-balances` for the Safe, one position per admitted asset; no `safe-owners` row is " +
        "SMART_ACCOUNT_MISSING; views not ready is PROVIDER_ERROR.",
    },
    { label: "balance-of", text: "One `balanceOf` per admitted asset over the chain's RPC, as the old action did." },
    { label: "sdk-direct", text: "The SDK reads the indexer itself, as the old SDK did for holdings." },
  ],
  chosen: "views",
  why:
    "Indexing holds every Transfer of every admitted asset from its deployment block, so the view is exact and costs one " +
    "query; a live `balanceOf` per asset is a chain read with its own failures, and the components decision keeps the SDK " +
    "off the indexer. A send that must not overdraw reads `balanceOf` at build time, which is payments', not this read. " +
    "A person's `safe-owners` row is the chain's answer to 'is this Safe claimed'. A view that is rebuilding answers less " +
    "than the chain holds, which is a provider failure to report, not a zero (integrations.indexer).",
  source: by("books/as-is/accounts/balances.ts; books/as-is/organizations/treasuries.ts; books/target/indexing/data.ts (safe-balances, safe-owners)"),
  affects: [rpc_activity_holdings_balances, operation_balance, table_safe_balances, table_safe_owners, table_indexer_progress],
});

export const decision_activity_available = defineDecision({
  id: "activity.available",
  title: "Available is the balance less what is already promised",
  question: "The old balance answered `available` equal to the balance. What does `available` subtract now?",
  options: [
    {
      label: "promised",
      text:
        "Per asset: the Safe's Payments sent and not settled (submitted), its dated Payments held for their day (scheduled, " +
        "due), and for a company Safe what its open budgets hold reserved for agreements (`committed`).",
    },
    { label: "equal", text: "Keep `available` equal to the balance." },
  ],
  chosen: "promised",
  why:
    "concepts.activity places balances above payments because 'available' needs pending payments. A submitted Payment's " +
    "money has not left yet but will; a dated one is signed or reserved for its day; an agreement's reservation in Budgets " +
    "is the payee's to collect. An escrowed Payment has already left the Safe, and a prepared one is not signed, so " +
    "neither is subtracted. Budgets' reservations are chain facts, read from indexing's `chain-budgets`; budgets' own " +
    "tables hold names only, so the budgets dependency is not needed for it (activity.budgets-through-indexing).",
  source: by("packages/sdk/src/accounts/positions.ts:45; packages/protocol/src/accounts/model.ts:29; concepts.activity"),
  affects: [rpc_activity_holdings_balances, table_payments, table_chain_budgets],
});

export const decision_activity_budgets_through_indexing = defineDecision({
  id: "activity.budgets-through-indexing",
  title: "Activity reads what budgets hold through indexing, not budgets' tables",
  question: "The concept map lets activity read budgets for 'what an Organization's budgets have left'. Does any rpc read budgets' tables?",
  options: [
    { label: "indexing", text: "No: the reservation `available` needs is `chain-budgets.committed`, a chain fact in indexing." },
    { label: "budgets", text: "Read budgets' `budgets` table too, to name each budget whose reservation is subtracted." },
  ],
  chosen: "indexing",
  why:
    "Budgets keeps only what the chain cannot name (a budget's key, name and kind); amounts, spends and commitments are " +
    "chain facts in indexing. `balance` answers totals per asset, not per budget, so no name is needed. The dependency " +
    "stays on the map for the day a feed row names the budget it was paid from.",
  source: by("books/target/budgets/data.ts (header); books/target/indexing/data.ts (chain-budgets); dependencies.of-activity"),
  affects: [rpc_activity_holdings_balances, concept_budgets, table_chain_budgets],
});

export const decision_activity_valuation = defineDecision({
  id: "activity.valuation",
  title: "The USD headline uses books' Chainlink prices, valued by the backend",
  question: "Which rates value a balance in USD, and who computes the headline?",
  options: [
    { label: "books-prices", text: "The backend, at the latest rate of each asset's pair in books' `book-prices`." },
    { label: "sdk-rates", text: "The SDK, from rates authored into its code, as the old SDK did." },
  ],
  chosen: "books-prices",
  why:
    "Books' price sync is the one source of USD rates (P3 keeps the Chainlink cron), and its devnet fake answers the " +
    "devnet's scripted rates, so devnet and staging value the same way. Rates in the SDK were a second, unsynced copy. " +
    "Only non-zero positions need a rate; if one has none, both valuations are null and the positions still show.",
  source: by("packages/sdk/src/accounts/positions.ts:84 (MONEY_READ_RATES); books/target/books/data.ts (book-prices)"),
  affects: [rpc_activity_holdings_balances, operation_balance, table_book_prices],
});

export const decision_activity_address_from_principal = defineDecision({
  id: "activity.address-from-principal",
  title: "`address` reads the principal's or the Organization's Safe; nothing is derived",
  question: "Where does `address` get a person's Safe, now that old accounts' smart-account rows are gone?",
  options: [
    { label: "principal", text: "Access' principal row, which holds the email-derived Safe from the first sign-in; the company Safe from organizations." },
    { label: "derive", text: "Derive the Safe from the email on every read when no row exists, as old deposit instructions did." },
  ],
  chosen: "principal",
  why:
    "Access computes a person's Safe from their email with Companies House's pure function when the principal is born, " +
    "so every signed-in person has it before their Safe is claimed, and it never changes. Reading it is the claim's " +
    "outcome without the salt setting at read time. An agent's principal holds its own Safe. The answer's chain is the " +
    "deployment's; the old answer said Base Sepolia even for a row on another chain, and v4 has one chain (P9).",
  source: by("books/as-is/accounts/summaries.ts (deposit-instructions); books/target/access/data.ts (principals)"),
  affects: [rpc_activity_holdings_address, operation_address],
});

export const decision_activity_unreachable_refusals = defineDecision({
  id: "activity.unreachable-refusals",
  title: "Two INVALID_INPUT refusals keep their frozen text and have no world",
  question:
    "`address`'s 'the Safe salt namespace setting is malformed' and `balance`'s 'the chain ID is not positive, or the " +
    "stored Safe does not match the account' name things the target never meets at read time. What becomes of them?",
  options: [
    { label: "keep-no-world", text: "Keep both refusals as frozen, produced by input that does not decode, with world `?`." },
    { label: "drop", text: "Drop the refusals from the two operations." },
  ],
  chosen: "keep-no-world",
  why:
    "The frozen surface keeps its codes (P10 rung 1), and INVALID_INPUT is still what either rpc answers for input that " +
    "does not decode. But the salt namespace is checked when the backend starts and used only when a principal is born, " +
    "the deployment has one chain so `balance` takes no chain id, and the Safe is the principal's own, so no binding can " +
    "disagree. No devnet world can reach the conditions named; the gap `refusal-without-world` says so.",
  source: by("books/frozen/operations.ts (address, balance refusals); books/as-is/accounts/balances.ts (read-binding)"),
  affects: [operation_address, operation_balance, rpc_activity_holdings_address, rpc_activity_holdings_balances],
});

// ── what is not ported ──────────────────────────────────────────────────────────────────────

export const decision_activity_dropped = defineDecision({
  id: "activity.dropped",
  title: "What old activity, balance and treasury code is not ported",
  question: "Which old activity, accounts and organizations functions have no target record here, and why?",
  options: [
    {
      label: "dropped",
      text:
        "activity.overlays.get (responsibilities.overlays); activity.documents.get, verify and render (documents' own " +
        "`document get`, `verify` and `render`); activity.annotations.save, emitSaved and clearRetired (books' " +
        "`activity annotate`; telemetry and retired fields go); accounts.balances.readBinding and " +
        "organizations.treasuries.load (one scope check in each rpc); accounts.summaries.home, me and loadNeedsYou " +
        "(responsibilities.summaries); the `since` input of items.changes; account_balance_read (P7).",
    },
    { label: "port", text: "Port each as an rpc of activity." },
  ],
  chosen: "dropped",
  why:
    "P2: an old function no frozen operation reaches is not ported, and one whose behaviour belongs to another concept " +
    "moves there. The overlay joined two stores; documents owns content and verification; books owns annotations; the " +
    "internal binding and load queries were steps of one read, now its first lines. The `since` time input had no CLI " +
    "flag and is what made changes depend on clocks. A read sends no product event: its wide event is the runtime's (P7).",
  source: by(`${OLD}/README.md:56 (operations table); books/as-is/accounts/summaries.ts; books/as-is/organizations/treasuries.ts`),
  affects: [concept_activity, ...FEED_READS, ...HOLDINGS],
});

export const decision_activity_no_procedures = defineDecision({
  id: "activity.no-procedures",
  title: "Activity's door has no procedures",
  question: "Which procedures do other concepts invoke on activity?",
  options: [
    { label: "none", text: "None: nothing reads or writes activity, and its change log is appended by its own workflows." },
    { label: "append", text: "A procedure payments invokes to append a change in the transition's transaction." },
  ],
  chosen: "none",
  why:
    "A procedure is for a write that is one money fact with its invoker's (rules.procedures); a change log entry is not: " +
    "it may lag its Payment by a second and can be rebuilt from payments' rows. An append procedure would also make " +
    "payments depend on activity, which sits above it. The old door exported the annotation read for payments' Movement " +
    "detail; that read is books' now.",
  source: by(`${OLD}/index.ts:1; rules.procedures; concepts.activity`),
  affects: [concept_activity, table_activity_changes],
});

// ── acceptance and worlds ───────────────────────────────────────────────────────────────────

export const decision_activity_acceptance_rewrites = defineDecision({
  id: "activity.acceptance-rewrites",
  title: "Six acceptance lines rewritten as outcomes",
  question: "Which of the 28 frozen claims of activity's six operations name a mechanism a black box cannot see?",
  options: [
    {
      label: "six",
      text:
        "events #3 ('the newest 100 rows miss it': rows and a page size); get #2 ('the stored evidence'); address #1 ('a " +
        "stored Safe'); address #3 ('writes nothing and schedules nothing'); balance #3 (PostHog and the per-asset event " +
        "P7 drops); balance #4 ('in the backend').",
    },
    { label: "none", text: "Keep every claim word for word." },
  ],
  chosen: "six",
  why:
    "P1 C: a claim keeps its words unless it names a mechanism, and then it becomes an outcome one of the five observers " +
    "can check, with the old line in `was`. Each rewrite still passes against the old system: an old Payment's change " +
    "was read; the payee saw evidence without execution data; the address was lower case and email-derived before setup; " +
    "a read changed nothing; balance did not wait on PostHog and its wide event named the assets; the refusal was " +
    "SMART_ACCOUNT_MISSING. The other 22 lines are kept, with what each observer sees.",
  source: by("docs/decisions/policy-pack.md (P1, the activity.events #3 and balance #3 examples); books/frozen/operations.ts"),
  affects: [operation_activity_events, operation_activity_get, operation_address, operation_balance],
});

export const decision_activity_worlds = defineDecision({
  id: "activity.worlds",
  title: "The devnet worlds activity's refusals and claims start from",
  question: "Which named devnet snapshots do activity's operations need, and which does this concept introduce?",
  options: [
    {
      label: "three-new",
      text:
        "New: person-with-activity (a signed-in person with a live Safe: Payments sent, received, to oneself, settled, " +
        "pending in and cancelled; outside money in and out in USDC, a second USD-pegged token and WETH; one annotated " +
        "row); person-with-long-payment-history (151 Payments, the oldest still waiting); person-with-over-5000-changes " +
        "(more than 5,000 changes after a printed cursor). Reused: signed-out, person-ready, person-unclaimed, " +
        "person-with-funded-safe, person-with-empty-safe, two-people-signed-in, org-with-budgets, person-with-credited-deposit.",
    },
    { label: "per-test", text: "Build each state inside each eval from a fresh devnet." },
  ],
  chosen: "three-new",
  why:
    "A world is one shared snapshot named for what it holds, so names other concepts already made for the same state are " +
    "reused (payments' funded and empty Safes, organizations' and accounts' person states, access' two people, " +
    "payments' org-with-budgets with its signed-in outsider, banking's credited deposit). The three new ones are made by " +
    "running `payment send`, outside transfers from the devnet's funded addresses and `activity annotate` as the " +
    "devnet's fixed identities, then saved. Two refusals keep `?` (activity.unreachable-refusals).",
  source: by("books/target/payments/decisions.ts (payments.worlds); books/target/accounts/decisions.ts (accounts.worlds); spec 30"),
  affects: [...OPERATIONS],
});
