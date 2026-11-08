// Equity's tables, its seven state machines and each machine's one event (P7).
//
// Equity owns what Protocol v4's equity clones cannot name, for one company (concepts.equity): Capxul's
// ids for each instrument, who it is for by Party and mailbox, the documents whose hashes the chain
// stamps, the request a repeat must answer, and which approval or Board proposal carries each chain
// write. What the chain holds (classes, balances, vested and locked shares, the pool, round and SAFE
// positions, the Governor's tally and state) is read from indexing's views or the clones themselves when a
// reader asks, never copied (equity.chain-is-truth). Seven tables:
//
// - `equity-installs`: switching equity on, one live per company, from its deployment to the
//   Board's install batch.
// - `equity-writes`: every chain write equity prepares (a Board proposal or a holder's own approval),
//   until the chain decides it. It replaces old organizations' issue, ballot and execution tables and
//   the carrier columns every other equity row repeated (equity.one-writes-table).
// - `fundraise-rounds` and `fundraise-investments`: priced and SAFE rounds, and each investor's place
//   in one.
// - `equity-grants`: option grants and founders' vesting grants.
// - `share-sales`: secondary sales a holder offers, the Board approves and a buyer pays for.
// - `votes`: shareholder votes Capxul proposed to the company Governor.
//
// Every table is the company's (tenancy organization, `org_id` first). An investor, grantee, seller,
// buyer or voter who is not a member reads their own rows through a second policy on their own Safe
// (`*_safe`), by the cross-tenant index that names it (equity.holder-reads). Amounts are raw token or
// share units as decimal strings; times are Unix ms.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";

const OLD = "packages/backend/src/organizations";
const T = `${OLD}/tables`;
const AS_IS = "docs/as-is/archive/organizations/data.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;

const KEPT =
  "Kept for the company's life: equity rows are the record of what was offered, signed, issued and paid, and the " +
  "documents behind the hashes the chain stamps.";

/** The templates `org equity setup --template` names, in the book's order (surface). */
export const EQUITY_TEMPLATES = ["solo", "co-founders", "pre-safe", "seed", "founder-control", "llc"] as const;

/** A class's transfer rule, as the Captable's `TransferRule` names them. */
export const TRANSFER_RULES = ["deny-all", "allow-all", "to-class-shareholders", "to-any-shareholder"] as const;

/** The reserved matters `org vote create` takes (surface). */
export const VOTE_MATTERS = [
  "create-class",
  "authorise",
  "transfer-rule",
  "freeze-class",
  "board-settings",
  "elect",
  "remove",
  "approve-round",
  "approve-sale",
] as const;

/**
 * What a write reports when it lands, in the old product catalog's words, which the frozen claims quote
 * (`reports equity_set_up once`, `transfer_approved`, `cast`): equity.reports.
 */
export const WRITE_CHANGES = [
  "equity_set_up",
  "issued",
  "granted",
  "ended",
  "accepted",
  "exercised",
  "converted",
  "delegated",
  "sale_requested",
  "transfer_approved",
  "bought",
  "opened",
  "invited",
  "allocated",
  "closed",
  "cancelled",
  "committed",
  "paid",
  "signed",
  "cast",
  "executed",
  "exit_paid",
] as const;

/** The object whose process decides a write; `none` for a write that changes no long-lived object. */
export const WRITE_SUBJECTS = ["install", "grant", "round", "sale", "vote", "none"] as const;

export const WRITE_STATUSES = ["awaiting", "landed", "failed", "abandoned"] as const;

/** Why a write failed (reverted, beaten) or was abandoned (the rest): what became of its carrier. */
export const WRITE_FAILURES = [
  "reverted",
  "beaten",
  "refused",
  "declined",
  "expired",
  "displaced",
  "withdrawn",
  "rejected",
  "replaced",
  "subject_ended",
  "execution_failed",
] as const;

/** One founder at the install, as planned and as the batch issues their shares under vesting. */
const Founder = Schema.Struct({
  party_id: S,
  email: S,
  safe: S,
  shares: S,
  vest_months: Int,
  cliff_months: Int,
  starts_at: N,
  cliff_at: N,
  ends_at: N,
});

/** One class the install creates, as the template plans it. */
const PlannedClass = Schema.Struct({
  name: S,
  ticker_suffix: S,
  weight: Int,
  converts_into: Null(Int),
  transfer_rule: Schema.Literals(TRANSFER_RULES),
  authorised: S,
});

/** A vesting schedule in calendar months, with its dates. */
export const Vesting = Schema.Struct({
  months: Int,
  cliff_months: Int,
  starts_at: N,
  cliff_at: N,
  ends_at: N,
});

// ── installs ────────────────────────────────────────────────────────────────────────────────

export const table_equity_installs = defineTable({
  id: "equity-installs",
  title: "Equity installs: switching a company's equity on",
  about:
    "One row per setup a Director began: the template, the plan it was asked for (classes with their weight, transfer " +
    "rule and authorised amount; the founders by Party, mailbox and Safe with their shares and vesting; the pool and the " +
    "class it grants from; the Governor's voting delay, period, quorum and proposal threshold) and its `terms_digest`, " +
    "so the same terms asked again answer this install and other terms are refused while it lives. The install's process " +
    "has Companies House's tier key send `Installer.deployEquity` (`deploy_tx_hash`, recorded before it is broadcast) and " +
    "then opens the Board's install batch, an equity-write. The clones `EquityDeployed` names are read from indexing's " +
    "chain-deployments, never copied. At most one install per company is live (deploying, proposed or installed); a failed " +
    "or abandoned one stays as history and a new setup may begin. Replaces old `orgEquities`, whose `earlier` clones, " +
    "`capTableJson` and `deployment` copy are gone.",
  was: [`${T}/equity.ts:13`, `${AS_IS}:725`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    install_id: S,
    company_safe: S,
    template: Schema.Literals(EQUITY_TEMPLATES),
    terms_digest: S,
    plan: Schema.Struct({
      classes: Schema.Array(PlannedClass),
      founder_class: Int,
      pool_class: Int,
      pool: S,
      founders: Schema.Array(Founder),
      governor: Schema.Struct({ voting_delay_s: Int, voting_period_s: Int, quorum_bps: Int, proposal_threshold_bps: Int }),
    }),
    summary: S,
    status: Schema.Literals(["deploying", "proposed", "installed", "failed", "abandoned"]),
    deploy_tx_hash: Null(S),
    deployed_block: Null(Int),
    failure: Null(Schema.Literals(["deploy_reverted", "batch_reverted", "rejected", "replaced"])),
    proposed_by: S,
    installed_at: Null(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "install_id"],
  indexes: [
    {
      name: "one_live_per_org",
      fields: ["org_id"],
      unique: true,
      for: "Partial on status in (deploying, proposed, installed): the company's live install, which refuses a second (WRONG_STATE) and every equity command reads first.",
    },
    {
      name: "by_terms",
      fields: ["org_id", "terms_digest"],
      for: "The same terms asked again answer the live install with those terms.",
    },
    {
      name: "by_company_safe",
      fields: ["company_safe", "status"],
      crossTenant: true,
      for: "An indexed EquityDeployed, which names only the company Safe, to the install deploying for it.",
    },
  ],
  retention: KEPT,
});

export const event_equity_install_transitioned = defineEvent({
  id: "equity_install_transitioned",
  about:
    "An install began, was deployed and proposed to the Board, was installed once the Board's batch executed, or failed " +
    "or was abandoned. `occurred_at` is the block's time of the chain fact, or the time the rpc began it.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    install_id: S,
    org_id: S,
    template: Schema.Literals(EQUITY_TEMPLATES),
    occurred_at: N,
  }),
  was: [`${OLD}/equity/events.ts:20`],
});

const EI = [event_equity_install_transitioned];

export const machine_equity_install = defineMachine({
  id: "equity-install",
  title: "Equity install status",
  about:
    "Born `deploying` by the setup rpc; after that only the install's process moves it: deployed and proposed once " +
    "EquityDeployed is indexed and the Board's batch is opened, installed when that batch's write lands, failed when the " +
    "deployment or the batch reverted, abandoned when the Board rejected or replaced the batch.",
  was: [`${OLD}/equity/writes/landed.ts:30`, `${OLD}/equity/operations/setup.ts`],
  table: table_equity_installs,
  field: "status",
  initial: "deploying",
  states: [
    { id: "deploying", about: "Begun: Companies House's tier key sends deployEquity; nothing is proposed yet." },
    { id: "proposed", about: "The clones exist; the Board's install batch waits for the Directors." },
    { id: "installed", about: "The batch executed: classes wired, founders' shares issued under vesting, the pool set.", terminal: true },
    { id: "failed", about: "The deployment or the batch reverted on chain.", terminal: true },
    { id: "abandoned", about: "The Board rejected the batch, or another transaction took its nonce.", terminal: true },
  ],
  transitions: {
    begin: {
      from: [],
      to: "deploying",
      about: "Born by equity.installs.begin with its plan; its birth starts the install's process.",
      guard: "No other live install for the company.",
      emits: EI,
    },
    propose: {
      from: ["deploying"],
      to: "proposed",
      about: "EquityDeployed is indexed at finality; the process opens the batch (board.propose) with each founder's grant born proposed.",
      emits: EI,
    },
    install: {
      from: ["proposed"],
      to: "installed",
      about: "The batch's write landed: the transaction's facts hold the founders' Issued and the pool's PoolSet.",
      emits: EI,
    },
    fail: {
      from: ["deploying", "proposed"],
      to: "failed",
      about: "deployEquity's receipt reverted, or the batch's write failed.",
      emits: EI,
    },
    abandon: {
      from: ["proposed"],
      to: "abandoned",
      about: "The batch's write was abandoned: its proposal rejected or replaced.",
      emits: EI,
    },
  },
});

// ── writes ──────────────────────────────────────────────────────────────────────────────────

export const table_equity_writes = defineTable({
  id: "equity-writes",
  title: "Equity writes: each chain write equity prepares, until the chain decides it",
  about:
    "One chain write: a Board matter (`carrier: board`, opened through `board.propose` with its proposal and the " +
    "proposing Director's approval) or a holder's own call (`carrier: approval`, opened through `approvals.open` from " +
    "their own Safe). `change` is what it reports when it lands, in the catalog's words. `subject_kind` and `subject_id` " +
    "name the long-lived object whose process decides it (an install, a grant, a round, a sale, a vote); `none` for an " +
    "issue, a conversion, a delegation or an exit payout, which equity.writes.follow decides. `investment_id` names the " +
    "investor's place a round write touches. `signer_safe` is the Safe whose call it is (the company Safe for a Board " +
    "matter). `request_digest` hashes the calls and terms, so the same request while it waits answers this write. `args` " +
    "keeps what the calls carry that a reader is told (class, shares, amounts, support, reason). Once decided it keeps the " +
    "transaction, the block's time and, for a write that pays (exercise, round pay, SAFE sign, buy, exit payout), the " +
    "PaymentSent id payments settles. Replaces old `orgEquityIssues`, `orgVoteBallots`, `orgVoteExecutions` and the " +
    "approval, proposal and user-operation columns of every other old equity row.",
  was: [`${T}/equity.ts:57`, `${T}/votes.ts:45`, `${T}/votes.ts:71`, `${T}/share-transfers.ts:9`, `${AS_IS}:764`, `${AS_IS}:988`, `${AS_IS}:1025`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  scope:
    "org_id is the company, even for an investor's, grantee's, holder's or voter's own write; that person reads their own " +
    "by signer_safe (equity.holder-reads).",
  admits: [
    {
      match: "safe",
      field: "signer_safe",
      reads: true,
      writes: false,
      about:
        "The holder whose own write it is (an investor, grantee, seller, buyer or voter), by the tenant that owns " +
        "`signer_safe` in parties' directory, reads it across companies; equity's rpcs and processes write it in the " +
        "company's tenant (equity.holder-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    write_id: S,
    change: Schema.Literals(WRITE_CHANGES),
    subject_kind: Schema.Literals(WRITE_SUBJECTS),
    subject_id: Null(S),
    investment_id: Null(S),
    carrier: Schema.Literals(["board", "approval"]),
    signer_safe: S,
    prepared_by: S,
    request_digest: S,
    approval_id: Null(S),
    proposal_id: Null(S),
    args: Schema.Record(S, Schema.Unknown),
    status: Schema.Literals(WRITE_STATUSES),
    failure: Null(Schema.Literals(WRITE_FAILURES)),
    tx_hash: Null(S),
    landed_at: Null(N),
    payment_id: Null(S),
    opened_at: N,
    updated_at: N,
  }),
  key: ["org_id", "write_id"],
  indexes: [
    {
      name: "one_awaiting_request",
      fields: ["org_id", "request_digest"],
      unique: true,
      for: "Partial on status = awaiting: the same issue, grant, round or ballot asked again answers the write that waits.",
    },
    {
      name: "one_awaiting_per_signer",
      fields: ["org_id", "subject_id", "change", "signer_safe"],
      unique: true,
      for: "Partial on status = awaiting: one write of each change per Safe and object on its way (WRONG_STATE `ballot on its way`).",
    },
    {
      name: "one_awaiting_board_matter",
      fields: ["org_id", "subject_id", "change"],
      unique: true,
      for: "Partial on status = awaiting and carrier = board, or change = executed: one Board matter of a kind per object, one execution per vote.",
    },
    {
      name: "by_subject",
      fields: ["org_id", "subject_kind", "subject_id", "opened_at"],
      for: "An object's writes, oldest first: what its process decides, and what a show reports as waiting.",
    },
    {
      name: "by_approval",
      fields: ["approval_id"],
      crossTenant: true,
      for: "An approval's outcome, delivered with only its id, to the writes it carries.",
    },
    {
      name: "by_proposal",
      fields: ["proposal_id"],
      crossTenant: true,
      for: "A Board proposal's outcome, delivered with only its id, to the writes it carries (a CSV grant carries several).",
    },
    {
      name: "by_signer_safe",
      fields: ["signer_safe", "opened_at"],
      crossTenant: true,
      for: "A holder's own writes across companies: whether they voted, and what of theirs is on its way.",
    },
  ],
  retention: KEPT,
});

export const event_equity_write_transitioned = defineEvent({
  id: "equity_write_transitioned",
  about:
    "A write was opened or decided. `to: landed` with its `change` is what the frozen claims call a report (`reports " +
    "issued once`, `reports cast once with its side`): exactly one per write that reaches the chain, at the block's time, " +
    "attributed to `prepared_by` (equity.reports). `support` is a ballot's side; null otherwise.",
  props: Schema.Struct({
    from: Null(Schema.Literals(WRITE_STATUSES)),
    to: Schema.Literals(WRITE_STATUSES),
    transition: S,
    write_id: S,
    org_id: S,
    change: Schema.Literals(WRITE_CHANGES),
    subject_kind: Schema.Literals(WRITE_SUBJECTS),
    subject_id: Null(S),
    carrier: Schema.Literals(["board", "approval"]),
    support: Null(Schema.Literals(["for", "against", "abstain"])),
    prepared_by: S,
    occurred_at: N,
  }),
  was: [`${OLD}/equity/events.ts:20`, `${OLD}/rounds/events.ts:1`, `${OLD}/votes/events.ts:1`],
});

const EW = [event_equity_write_transitioned];

export const machine_equity_write = defineMachine({
  id: "equity-write",
  title: "Equity write status",
  about:
    "Born `awaiting` with the approval or Board proposal that carries it. Only chain proof lands or fails it: it lands " +
    "when its carrier's transaction holds its own clone event (Issued, OptionsGranted, VoteCast, TransferOffered...), and " +
    "fails when that transaction reverted or ran without it, or its Board proposal ran and failed (board's `fail`: " +
    "`execution_failed`). It is abandoned when its approval ended unsent (refused, " +
    "declined, expired, displaced, withdrawn), its proposal was rejected or replaced, or its object ended first. Its " +
    "deciding process moves it, in the same transaction as the move it makes on its object.",
  was: [`${OLD}/equity/writes/landed.ts:30`, `${OLD}/votes/writes.ts:1`, `${AS_IS}:1452`, `${AS_IS}:1501`, `${AS_IS}:1522`],
  table: table_equity_writes,
  field: "status",
  initial: "awaiting",
  states: [
    { id: "awaiting", about: "Its approval or Board proposal is open, or its operation is on its way; nothing is decided." },
    { id: "landed", about: "Its transaction carried its own clone event: the change happened.", terminal: true },
    { id: "failed", about: "Its transaction reverted, ran without its event because another write beat it, or was a Board proposal that ran and failed.", terminal: true },
    { id: "abandoned", about: "Its carrier ended without running, or its object ended first.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "awaiting",
      about: "Born by the rpc that prepares it, with its approval (approvals.open) or proposal (board.propose).",
      guard: "No write of the same request, Safe and change on the same object awaits.",
      emits: EW,
    },
    land: {
      from: ["awaiting"],
      to: "landed",
      about: "Its carrier executed and the transaction's indexed facts hold its own event.",
      emits: EW,
    },
    fail: {
      from: ["awaiting"],
      to: "failed",
      about: "Its operation reverted, its transaction landed without its own event, or its Board proposal ended `failed`.",
      emits: EW,
    },
    abandon: {
      from: ["awaiting"],
      to: "abandoned",
      about: "Its approval ended unsent, its proposal was rejected or replaced, or its object ended first.",
      emits: EW,
    },
  },
});

// ── rounds ──────────────────────────────────────────────────────────────────────────────────

export const table_fundraise_rounds = defineTable({
  id: "fundraise-rounds",
  title: "Fundraise rounds: a company's priced rounds and SAFE rounds",
  about:
    "One round the Board proposed: a priced round (`rd_`) or a post-money SAFE round (`sr_`). It keeps the terms as " +
    "proposed (a priced round's class, pre-money, raise, the fully diluted shares it is priced over, price, the shares the " +
    "raise buys, pool top-up, SAFEs to convert and pay-by day; a SAFE round's cap, discount, raise, minimum ticket and " +
    "close day), the terms document stored with it (`documents.store`) and its hash, and the Rounds clone and the " +
    "uint256 id the round got on chain (null while proposed). `adjustments` are the anti-dilution changes its close made, " +
    "from RoundClosed. What has been committed, allocated and paid is read from its investments and the chain's " +
    "positions. Its status moves only in the round's process. Replaces old `orgRounds` and `orgSafeRounds`, two copies of " +
    "the same shape.",
  was: [`${T}/rounds.ts:8`, `${T}/equity.ts:79`, `${AS_IS}:796`, `${AS_IS}:909`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    round_id: S,
    kind: Schema.Literals(["priced", "safe"]),
    company_safe: S,
    rounds_address: S,
    chain_round_id: Null(S),
    token: S,
    class_id: Null(Int),
    class_name: Null(S),
    terms: Schema.Struct({
      pre_money: opt(S),
      raise: S,
      fully_diluted: opt(S),
      price: opt(S),
      max_shares: opt(S),
      pool_top_up: opt(S),
      convert_safe_note_ids: opt(Schema.Array(S)),
      pay_by: opt(N),
      valuation_cap: opt(S),
      discount_bps: opt(Int),
      min_ticket: opt(S),
      closes_at: opt(N),
    }),
    terms_document_id: S,
    terms_hash: S,
    status: Schema.Literals(["proposed", "open", "allocated", "closed", "cancelled", "abandoned"]),
    adjustments: Null(Schema.Array(Schema.Struct({ class_name: S, before: S, after: S }))),
    proposed_by: S,
    opened_at: Null(N),
    closed_at: Null(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "round_id"],
  indexes: [
    {
      name: "by_status",
      fields: ["org_id", "kind", "status", "created_at"],
      for: "A company's rounds of a kind in a status: the open SAFE rounds a priced round converts, the rounds a show lists.",
    },
    {
      name: "by_chain_round",
      fields: ["rounds_address", "chain_round_id"],
      unique: true,
      crossTenant: true,
      for: "Any later Rounds event, keyed by the clone and the round's uint256, to its round's process.",
    },
    {
      name: "by_terms_hash",
      fields: ["rounds_address", "terms_hash"],
      crossTenant: true,
      for: "An indexed PricedRoundCreated or SafeRoundCreated, which carries the document hash, to the proposed round it opens.",
    },
  ],
  retention: KEPT,
});

export const event_fundraise_round_transitioned = defineEvent({
  id: "fundraise_round_transitioned",
  about:
    "A round was proposed, opened on chain, allocated, closed, cancelled or abandoned. Keeps the old catalog's name, so " +
    "the funnel and the frozen claims that count it read the same.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    round_id: S,
    org_id: S,
    kind: Schema.Literals(["priced", "safe"]),
    occurred_at: N,
  }),
  was: [`${OLD}/rounds/events.ts:1`],
});

const ER = [event_fundraise_round_transitioned];

export const machine_fundraise_round = defineMachine({
  id: "fundraise-round",
  title: "Fundraise round status",
  about:
    "Born `proposed` with its Board proposal. The round's process opens it when its create write lands with the round's " +
    "creation event, allocates a priced round when the allocation write lands, and closes or cancels it when the close or " +
    "cancel write lands (a full SAFE round may be closed by a Director's own call). A rejected create abandons it.",
  was: [`${OLD}/rounds/writes.ts:1`, `${OLD}/equity/writes/landed.ts:99`],
  table: table_fundraise_rounds,
  field: "status",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Its create waits for the Directors; nothing is on chain." },
    { id: "open", about: "On chain: invited investors commit (priced) or sign and pay (SAFE)." },
    { id: "allocated", about: "A priced round's shares are allocated; allocated investors pay by the pay-by day." },
    { id: "closed", about: "Closed: unpaid allocations and unsigned invitations lapsed, anti-dilution applied.", terminal: true },
    { id: "cancelled", about: "Cancelled before any payment.", terminal: true },
    { id: "abandoned", about: "Its create was rejected, replaced or reverted.", terminal: true },
  ],
  transitions: {
    propose: { from: [], to: "proposed", about: "Born by the create rpc with its write and terms document.", emits: ER },
    open: { from: ["proposed"], to: "open", about: "The create write landed with PricedRoundCreated or SafeRoundCreated; records the uint256 id.", emits: ER },
    allocate: { from: ["open"], to: "allocated", about: "The allocation write landed with each investor's Allocated.", emits: ER },
    close: { from: ["open", "allocated"], to: "closed", about: "The close write landed with RoundClosed or SafeRoundClosed.", emits: ER },
    cancel: {
      from: ["open", "allocated"],
      to: "cancelled",
      about: "The cancel write landed with RoundCancelled.",
      guard: "No investor has paid.",
      emits: ER,
    },
    abandon: { from: ["proposed"], to: "abandoned", about: "The create write failed or was abandoned.", emits: ER },
  },
});

// ── investments ─────────────────────────────────────────────────────────────────────────────

export const table_fundraise_investments = defineTable({
  id: "fundraise-investments",
  title: "Fundraise investments: one investor's place in one round",
  about:
    "Born when the Board proposes an investor's invitation: for a priced round a commitment (`cm_`), for a SAFE round " +
    "a SAFE (`sf_`). The investor by Party, mailbox and Safe (a claimed personal Safe: accounts), the most they were " +
    "invited for, then what they committed or signed, the shares allocated and the pay-by day, the SAFE note's uint256, " +
    "the document whose hash their commit or signature stamps, and the PaymentSent id of what they paid (payments " +
    "settles it). Its status moves only in its round's process.",
  was: [`${T}/rounds.ts:8`, `${T}/equity.ts:79`, "apps/indexer/src/v4/rounds/schema.ts:36"],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the company; the investor reads their own by investor_safe (equity.holder-reads).",
  admits: [
    {
      match: "safe",
      field: "investor_safe",
      reads: true,
      writes: false,
      about:
        "The investor, by the tenant that owns `investor_safe` in parties' directory, reads it across companies; " +
        "equity's rpcs and processes write it in the company's tenant (equity.holder-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    investment_id: S,
    round_id: S,
    kind: Schema.Literals(["priced", "safe"]),
    investor_party_id: S,
    investor_email: Null(S),
    investor_safe: S,
    max_amount: S,
    amount: Null(S),
    shares: Null(S),
    pay_by: Null(N),
    note_id: Null(S),
    document_id: Null(S),
    document_hash: Null(S),
    payment_id: Null(S),
    status: Schema.Literals(["proposed", "invited", "committed", "allocated", "paid", "signed", "lapsed", "abandoned"]),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "investment_id"],
  indexes: [
    { name: "by_round", fields: ["org_id", "round_id", "created_at"], for: "A round's investors, in invitation order: round show, allocate's defaults, close's lapses." },
    {
      name: "one_per_investor",
      fields: ["org_id", "round_id", "investor_safe"],
      unique: true,
      for: "One place per investor and round: inviting again raises nothing new.",
    },
    {
      name: "by_investor_safe",
      fields: ["investor_safe", "created_at"],
      crossTenant: true,
      for: "The rounds and SAFEs one Safe is invited to, across companies: `invest`, `invest show`, `shares`.",
    },
  ],
  retention: KEPT,
});

export const event_fundraise_investment_transitioned = defineEvent({
  id: "fundraise_investment_transitioned",
  about:
    "An investor was proposed, invited, committed, allocated, paid or signed a SAFE, or their place lapsed or was " +
    "abandoned. Notices reacts to `invite` (a round or SAFE invitation, dependencies.of-notices). Keeps the old catalog's name.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    investment_id: S,
    round_id: S,
    org_id: S,
    kind: Schema.Literals(["priced", "safe"]),
    investor_party_id: S,
    occurred_at: N,
  }),
  was: [`${OLD}/rounds/events.ts:1`],
});

const EV = [event_fundraise_investment_transitioned];

export const machine_fundraise_investment = defineMachine({
  id: "fundraise-investment",
  title: "Fundraise investment status",
  about:
    "Born `proposed` with the Board's invitation. The round's process moves it when a write naming it lands: invited " +
    "(Invited or SafeInvited), committed (Committed), allocated (Allocated), paid (Paid) or signed (SafeSigned). At the " +
    "round's close or a SAFE round's close day, a place not paid or signed lapses.",
  was: [`${OLD}/rounds/writes.ts:1`],
  table: table_fundraise_investments,
  field: "status",
  initial: "proposed",
  states: [
    { id: "proposed", about: "The Board's invitation waits for the Directors." },
    { id: "invited", about: "On chain: the investor may commit (priced) or sign and pay (SAFE) up to max_amount." },
    { id: "committed", about: "Committed an amount; no money has moved." },
    { id: "allocated", about: "The Board allocated shares; the investor pays by the pay-by day." },
    { id: "paid", about: "Paid, and received the shares in the same transaction.", terminal: true },
    { id: "signed", about: "Signed and paid a SAFE: an outstanding note until a priced round converts it.", terminal: true },
    { id: "lapsed", about: "The round closed, or its close or pay-by day passed, before the investor paid or signed.", terminal: true },
    { id: "abandoned", about: "Its invitation was rejected, or its round was cancelled or abandoned.", terminal: true },
  ],
  transitions: {
    propose: { from: [], to: "proposed", about: "Born by the invite rpc, with the round's invitation write.", emits: EV },
    invite: { from: ["proposed"], to: "invited", about: "The invitation write landed with Invited or SafeInvited for the investor.", emits: EV },
    commit: { from: ["invited"], to: "committed", about: "The investor's commit write landed with Committed.", emits: EV },
    allocate: { from: ["committed"], to: "allocated", about: "The Board's allocation write landed with Allocated for the investor.", emits: EV },
    pay: { from: ["allocated"], to: "paid", about: "The investor's pay write landed with Paid and its PaymentSent.", emits: EV },
    sign: { from: ["invited"], to: "signed", about: "The investor's SAFE write landed with SafeSigned and its PaymentSent.", emits: EV },
    lapse: {
      from: ["invited", "committed", "allocated"],
      to: "lapsed",
      about: "The round closed, or the timer at its pay-by or close day fired, by the chain's clock.",
      emits: EV,
    },
    abandon: {
      from: ["proposed", "invited", "committed", "allocated"],
      to: "abandoned",
      about: "The invitation write was abandoned or failed, or the round was cancelled or abandoned.",
      emits: EV,
    },
  },
});

// ── grants ──────────────────────────────────────────────────────────────────────────────────

export const table_equity_grants = defineTable({
  id: "equity-grants",
  title: "Equity grants: option grants and founders' vesting grants",
  about:
    "An option grant the Board proposed from the pool (`og_`), or a founder's vesting grant the install's batch issues (`vg_`). " +
    "It keeps the grantee by Party, mailbox and Safe, the class, the shares, an option's strike token and price, the " +
    "vesting in calendar months with its dates, when the offer lapses (30 days on), the expiry (ten years after the " +
    "start), the exercise window after leaving, the agreement stored with it (`documents.store`) and the hash the grantee " +
    "accepts, the Options or Vesting contract and the grant's uint256 there, and once ended the last day and the day " +
    "exercise ends. Vested, exercised and locked are read from the chain (`Options.vestedOf`, `Vesting.lockedOf`) and " +
    "indexing's positions. Its status moves only in the grant's process. Replaces old `orgOptionGrants`.",
  was: [`${T}/equity.ts:104`, `${AS_IS}:831`, `${OLD}/equity/rules/grants.ts`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the company; the grantee reads their own by grantee_safe (equity.holder-reads).",
  admits: [
    {
      match: "safe",
      field: "grantee_safe",
      reads: true,
      writes: false,
      about:
        "The grantee, by the tenant that owns `grantee_safe` in parties' directory, reads it across companies; equity's " +
        "rpcs and processes write it in the company's tenant (equity.holder-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    grant_id: S,
    kind: Schema.Literals(["option", "vesting"]),
    company_safe: S,
    contract_address: S,
    chain_grant_id: Null(S),
    grantee_party_id: S,
    grantee_email: Null(S),
    grantee_safe: S,
    class_id: Int,
    class_name: S,
    shares: S,
    strike: Null(Schema.Struct({ token: S, price: S })),
    vesting: Vesting,
    offer_expires_at: Null(N),
    expires_at: Null(N),
    exercise_window_days: Null(Int),
    agreement_document_id: Null(S),
    agreement_hash: S,
    last_day: Null(N),
    exercise_by: Null(N),
    status: Schema.Literals(["proposed", "offered", "active", "ended", "lapsed", "abandoned"]),
    proposed_by: Null(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "grant_id"],
  indexes: [
    { name: "by_status", fields: ["org_id", "kind", "status", "created_at"], for: "A company's grants: `org options show`, and the pool a cap table reports as granted." },
    {
      name: "by_grantee_safe",
      fields: ["grantee_safe", "created_at"],
      crossTenant: true,
      for: "One Safe's grants across companies: `shares`, `shares accept`, `shares exercise`.",
    },
    {
      name: "by_chain_grant",
      fields: ["contract_address", "chain_grant_id"],
      unique: true,
      crossTenant: true,
      for: "Any later Options or Vesting event, keyed by the contract and the grant's uint256, to its grant's process.",
    },
    {
      name: "by_agreement_hash",
      fields: ["contract_address", "agreement_hash"],
      crossTenant: true,
      for: "An indexed OptionsGranted, which carries the agreement's hash, to the proposed grant it offers.",
    },
  ],
  retention: KEPT,
});

export const event_equity_grant_transitioned = defineEvent({
  id: "equity_grant_transitioned",
  about:
    "A grant was proposed, offered on chain, vested at the install, accepted, ended, lapsed or abandoned. Keeps the old " +
    "catalog's name.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    grant_id: S,
    org_id: S,
    kind: Schema.Literals(["option", "vesting"]),
    grantee_party_id: S,
    occurred_at: N,
  }),
  was: [`${OLD}/equity/events.ts:88`],
});

const EG = [event_equity_grant_transitioned];

export const machine_equity_grant = defineMachine({
  id: "equity-grant",
  title: "Equity grant status",
  about:
    "An option grant is born `proposed` with its Board proposal and offered when that write lands with OptionsGranted; " +
    "the grantee's acceptance makes it active, the Board's end ends it (vested options stay exercisable for the window), " +
    "and its offer lapses unaccepted at offer_expires_at. A founder's vesting grant is born `proposed` with the install's " +
    "batch, which carries its `Vesting.grantAndIssue`, and is active once that batch lands. " +
    "Exercises are writes on an active or ended grant and move no status.",
  was: [`${OLD}/equity/writes/landed.ts:30`, `${OLD}/equity/rules/grants.ts`],
  table: table_equity_grants,
  field: "status",
  initial: "proposed",
  states: [
    { id: "proposed", about: "The Board's grant, or the install batch carrying a founder's grant, waits for the Directors." },
    { id: "offered", about: "On chain: the grantee accepts the exact terms before the offer lapses." },
    { id: "active", about: "Accepted (or a founder's, issued at the install): vesting runs from the start date." },
    { id: "ended", about: "Ended from its last day: unvested returned to the pool; vested exercisable until exercise_by.", terminal: true },
    { id: "lapsed", about: "The offer expired unaccepted; its options are back in the pool.", terminal: true },
    { id: "abandoned", about: "Its proposal was rejected, replaced or reverted.", terminal: true },
  ],
  transitions: {
    propose: { from: [], to: "proposed", about: "Born by equity.grants.propose with its write and agreement.", emits: EG },
    vest: {
      from: ["proposed"],
      to: "active",
      about: "A founder's vesting grant: its write in the install batch landed with Vesting's Granted for it; records the uint256 id.",
      emits: EG,
    },
    offer: { from: ["proposed"], to: "offered", about: "The grant write landed with OptionsGranted carrying the agreement's hash; records the uint256 id.", emits: EG },
    accept: { from: ["offered"], to: "active", about: "The grantee's accept write landed with OptionsAccepted.", emits: EG },
    end: {
      from: ["offered", "active"],
      to: "ended",
      about: "The Board's end write landed with OptionsEnded, or Revoked and RevocationSettled for a founder's grant.",
      emits: EG,
    },
    lapse: {
      from: ["offered"],
      to: "lapsed",
      about: "The process's timer at offer_expires_at, by the chain's clock.",
      guard: "No accept landed by then.",
      emits: EG,
    },
    abandon: { from: ["proposed"], to: "abandoned", about: "The grant write failed or was abandoned.", emits: EG },
  },
});

// ── sales ───────────────────────────────────────────────────────────────────────────────────

export const table_share_sales = defineTable({
  id: "share-sales",
  title: "Share sales: a secondary sale from one holder to a buyer",
  about:
    "One sale (`tr_`) a holder offered from their own Safe: the class, shares, price per share in the token, the total " +
    "the buyer pays, the seller and the buyer by Party, mailbox and Safe, the sale agreement whose hash the consent and " +
    "the offer stamp, when the offer expires, the Exits clone and the offer's uint256 there (`chain_transfer_id`, from " +
    "TransferOffered), and the PaymentSent id of the buyer's payment. Its status moves only in the sale's process. " +
    "Replaces old `orgShareTransfers`, whose calls, approval and user-operation copies move to its writes.",
  was: [`${T}/share-transfers.ts:9`, `${AS_IS}:864`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  scope: "org_id is the company; the seller and the buyer read it by seller_safe and buyer_safe (equity.holder-reads).",
  admits: [
    {
      match: "safe",
      field: "seller_safe",
      reads: true,
      writes: false,
      about:
        "The seller, by the tenant that owns `seller_safe` in parties' directory, reads it across companies; equity's " +
        "rpcs and processes write it in the company's tenant (equity.holder-reads).",
    },
    {
      match: "safe",
      field: "buyer_safe",
      reads: true,
      writes: false,
      about:
        "The buyer, by the tenant that owns `buyer_safe` in parties' directory, reads it across companies; equity's " +
        "rpcs and processes write it in the company's tenant (equity.holder-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    sale_id: S,
    company_safe: S,
    exits_address: S,
    chain_transfer_id: Null(S),
    class_id: Int,
    class_name: S,
    shares: S,
    price: S,
    token: S,
    total: S,
    seller_party_id: S,
    seller_email: Null(S),
    seller_safe: S,
    buyer_party_id: S,
    buyer_email: Null(S),
    buyer_safe: S,
    agreement_document_id: Null(S),
    document_hash: S,
    expires_at: N,
    status: Schema.Literals(["requested", "offered", "approved", "bought", "lapsed", "abandoned"]),
    payment_id: Null(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "sale_id"],
  indexes: [
    { name: "by_status", fields: ["org_id", "status", "created_at"], for: "A company's sales in a status: the offered sales a Director approves." },
    { name: "by_seller_safe", fields: ["seller_safe", "created_at"], crossTenant: true, for: "A seller's sales across companies, and their locked shares at sale." },
    { name: "by_buyer_safe", fields: ["buyer_safe", "created_at"], crossTenant: true, for: "A buyer's sales: `invest pay tr_…` and `shares`." },
    {
      name: "by_chain_transfer",
      fields: ["exits_address", "chain_transfer_id"],
      unique: true,
      crossTenant: true,
      for: "Any later Exits event on the offer (TransferApproved, Bought), keyed by the clone and its uint256, to the sale's process.",
    },
  ],
  retention: KEPT,
});

export const event_share_sale_transitioned = defineEvent({
  id: "share_sale_transitioned",
  about: "A sale was requested, offered on chain, approved by the Board, bought, lapsed or abandoned.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    sale_id: S,
    org_id: S,
    seller_party_id: S,
    buyer_party_id: S,
    occurred_at: N,
  }),
  was: [`${OLD}/equity/events.ts:20`],
});

const ES = [event_share_sale_transitioned];

export const machine_share_sale = defineMachine({
  id: "share-sale",
  title: "Share sale status",
  about:
    "Born `requested` with the seller's own approval. The sale's process moves it as its writes land: offered " +
    "(TransferOffered), approved (TransferApproved, by Board proposal), bought (Bought and its PaymentSent, by the " +
    "buyer's own approval); it lapses at expires_at if the buyer has not bought, and is abandoned when the seller's " +
    "write never reached the chain.",
  was: [`${AS_IS}:1452`, `${OLD}/equity/operations/follow-transfer.ts`],
  table: table_share_sales,
  field: "status",
  initial: "requested",
  states: [
    { id: "requested", about: "The seller's consent and offer wait for their signature and the chain." },
    { id: "offered", about: "Exits holds the offer: it waits for the Board's approval." },
    { id: "approved", about: "The Board approved: the buyer pays and receives the shares in one call." },
    { id: "bought", about: "The buyer paid the seller and the shares moved.", terminal: true },
    { id: "lapsed", about: "The offer expired before the buyer bought.", terminal: true },
    { id: "abandoned", about: "The seller's write failed or ended unsent.", terminal: true },
  ],
  transitions: {
    request: { from: [], to: "requested", about: "Born by equity.sales.offer with the seller's write and agreement.", emits: ES },
    offer: { from: ["requested"], to: "offered", about: "The seller's write landed with TransferConsented and TransferOffered; records the uint256 id.", emits: ES },
    approve: { from: ["offered"], to: "approved", about: "The Board's approval write landed with TransferApproved.", emits: ES },
    buy: { from: ["approved"], to: "bought", about: "The buyer's write landed with Bought, ForcedTransfer and its PaymentSent.", emits: ES },
    lapse: { from: ["offered", "approved"], to: "lapsed", about: "The process's timer at expires_at, by the chain's clock.", emits: ES },
    abandon: { from: ["requested"], to: "abandoned", about: "The seller's write failed or was abandoned.", emits: ES },
  },
});

// ── votes ───────────────────────────────────────────────────────────────────────────────────

export const table_votes = defineTable({
  id: "votes",
  title: "Votes: shareholder votes Capxul proposed to the company Governor",
  about:
    "One vote (`vt_`) a shareholder proposed from their own Safe: the matter, its title and the description the " +
    "Governor holds (and its hash, for execute), the calls built from the matter (targets on the Governor's allowed list " +
    "only), the terms document, the proposal id (OpenZeppelin's hashProposal of the calls and description, known before " +
    "anyone signs), the proposer, and once on chain when voting opens and closes (ProposalCreated's voteStart and " +
    "voteEnd). After `proposed`, where the vote stands (pending, active, succeeded, defeated, executed, canceled) and its " +
    "tally and quorum are the Governor's, read live (`state`, `proposalVotes`, `quorum`). Ballots and executions are its " +
    "writes. Replaces old `orgVotes`; its ballots and executions tables become writes.",
  was: [`${T}/votes.ts:11`, `${AS_IS}:947`],
  concept: concept_equity,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    vote_id: S,
    governor: S,
    proposal_id: S,
    matter: Schema.Literals(VOTE_MATTERS),
    title: S,
    description: S,
    description_hash: S,
    calls: Schema.Array(Schema.Struct({ target: S, value: S, calldata: S })),
    terms_document_id: Null(S),
    proposer_party_id: S,
    proposer_safe: S,
    quorum_bps: Int,
    vote_start: Null(N),
    vote_end: Null(N),
    status: Schema.Literals(["proposing", "proposed", "executed", "lapsed", "failed"]),
    executed_at: Null(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "vote_id"],
  indexes: [
    { name: "by_created", fields: ["org_id", "created_at"], for: "A company's votes, newest first, its newest 50: `org vote list`." },
    {
      name: "by_status_end",
      fields: ["org_id", "status", "vote_end"],
      for: "A company's proposed votes soonest closing first, unknown close last: `vote list` across the voter's companies.",
    },
    {
      name: "by_governor_proposal",
      fields: ["governor", "proposal_id"],
      unique: true,
      crossTenant: true,
      for: "An indexed ProposalCreated, VoteCast or ProposalExecuted, keyed by the Governor and proposal id, to its vote's process.",
    },
  ],
  retention: KEPT,
});

export const event_vote_transitioned = defineEvent({
  id: "vote_transitioned",
  about:
    "A vote was proposed (awaiting its proposer), opened on the Governor, executed, lapsed or failed. Ballots and " +
    "executions report through equity_write_transitioned with their change (`cast`, `executed`). Keeps the old catalog's name.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    vote_id: S,
    org_id: S,
    matter: Schema.Literals(VOTE_MATTERS),
    occurred_at: N,
  }),
  was: [`${OLD}/votes/events.ts:1`],
});

const EVT = [event_vote_transitioned];

export const machine_vote = defineMachine({
  id: "vote",
  title: "Vote status",
  about:
    "Born `proposing` with the proposer's approval. The vote's process opens it when the propose write lands with " +
    "ProposalCreated (recording voteStart and voteEnd), marks it executed when ProposalExecuted is indexed (whoever sent " +
    "it), lapses it when the proposer's approval ended unsigned, and fails it when the proposal reverted.",
  was: [`${AS_IS}:1478`, `${OLD}/votes/rules.ts:73`],
  table: table_votes,
  field: "status",
  initial: "proposing",
  states: [
    { id: "proposing", about: "The proposer's approval waits for their signature and the chain." },
    { id: "proposed", about: "The Governor holds it; its standing and tally are read live." },
    { id: "executed", about: "The Governor ran its calls.", terminal: true },
    { id: "lapsed", about: "Nobody signed it before its sponsorship ended.", terminal: true },
    { id: "failed", about: "The proposal reverted on chain.", terminal: true },
  ],
  transitions: {
    propose: { from: [], to: "proposing", about: "Born by equity.votes.propose with the proposer's write.", emits: EVT },
    open: { from: ["proposing"], to: "proposed", about: "The propose write landed with ProposalCreated for the vote's proposal id.", emits: EVT },
    execute: { from: ["proposed"], to: "executed", about: "ProposalExecuted for the proposal id is indexed at finality.", emits: EVT },
    lapse: { from: ["proposing"], to: "lapsed", about: "The propose write was abandoned: its approval ended unsigned.", emits: EVT },
    fail: { from: ["proposing"], to: "failed", about: "The propose write failed: the proposal reverted.", emits: EVT },
  },
});
