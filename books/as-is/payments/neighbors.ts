// Records of the OTHER concepts the old payments concept touches, as the old code has them
// (factory, branch integration/factory). Evidence, not the target design.
//
// (1) Tables another concept owns that payments code reads or writes directly, and the tables
//     payments reaches through another concept's door (the reads and writes of the procedures
//     below). Each is owned by its own concept. Big tables are summarized with their main columns;
//     their `about` says so.
// (2) The in-transaction functions of other concepts that payments calls through their doors, as
//     procedures owned by that concept, with the tables they read and write and the codes they
//     throw. `reads`/`writes` list what the function's own concept code touches, and what helpers
//     of a third concept that has no procedure here touch. A call into another procedure booked in
//     this file is an `invokes` link.
//
// Work a neighbor does back through payments' OWN door (`preparePaymentCommandInTx`,
// `isPayrollBatchSettledInTx`, `captureMemoConflictRemovalInTx`, ...) is named in `about` and not
// linked: those procedures live in procedures.ts, which imports this file, so a link back would
// be a circular import. Direct reads a neighbor makes of payments tables are listed in `reads`.
//
// Not booked here, because they are not in-transaction functions: pure rules payments imports
// (`e2eAuthVerdict`, `recipientObservation`, `isDepartmentId`, `assertConfirmedRequestBirth`,
// `requestMemoSnapshot`), telemetry (`payoutSendRefusalObserved`), and the Permissions
// completions the recovery action runs (`internal.permissions.*`). Two action-side door functions
// are booked as procedures because siblings link them, and their `about` says they run outside the
// invoker's transaction: `requireFeatureFromAction` and `requireAuthenticatedUser`.
//
// Inputs that are a whole stored row, a protocol command or a wire value are `Schema.Unknown`.

import { Schema } from "effect";
import { defineProcedure, defineTable } from "../../../packages/book/src/index.ts";
import {
  concept_access,
  concept_accounts,
  concept_activity,
  concept_banking,
  concept_books,
  concept_documents,
  concept_organizations,
  concept_parties,
  concept_payroll,
  concept_permissions,
  concept_profiles,
  concept_requests,
} from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_invoice_request_transitioned,
  event_payout_transitioned,
  event_payroll_run_transitioned,
} from "../shared/vocabulary.ts";
import { table_money_executions, table_movements, table_payment_commands, table_payments } from "./data.ts";

const SRC = "packages/backend/src";
const PAY = `${SRC}/payments`;

const KEPT = "Kept indefinitely: no job in the old code deletes these rows.";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const NullOr = Schema.NullOr;
const Strings = Schema.Array(S);

const ActorKind = Schema.Literals(["account", "organization"]);
const ApprovalState = Schema.Literals(["pending", "approved", "rejected", "consumed", "expired"]);
const ReferenceKind = Schema.Literals(["payment", "movement"]);

// ═══ (1) tables ═════════════════════════════════════════════════════════════════════════════

// ── access ──────────────────────────────────────────────────────────────────────────────────

export const table_feature_gates = defineTable({
  id: "feature-gates",
  title: "Feature gates written on a devnet",
  about:
    "Access's gate table: one row per gate key and Organization or person, written only on a local devnet " +
    "(`requireLocalDevnet`). `requireFeature` reads it while the deployment's gates come from the table " +
    "(`featureSetting().source === \"table\"`); with the PostHog sync on it reads `feature-flags` instead.",
  was: [`${SRC}/access/tables.ts:134`, `${SRC}/access/features/reads.ts:32`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    key: S,
    orgId: opt(S),
    authUserId: opt(S),
    on: B,
    source: Schema.Literals(["devnet"]),
    updatedAt: N,
    updatedBy: S,
  }),
  key: ["key", "orgId", "authUserId"],
  indexes: [
    { name: "by_key_org", fields: ["key", "orgId"], for: "The gate row for one key and Organization (`gateRowsInTx`, `findOrganizationGateInTx`)." },
    { name: "by_key_person", fields: ["key", "authUserId"], for: "The gate row for one key and person (`gateRowsInTx`, `findPersonGateInTx`)." },
  ],
  retention: KEPT,
});

export const table_feature_flags = defineTable({
  id: "feature-flags",
  title: "Synced PostHog feature flag definitions",
  about:
    "Access's synced copy of each catalogue flag's PostHog definition. `requireFeature` reads the key's row when " +
    "the gate source is PostHog. `conditions` is a list of `featureCondition` objects, booked as Unknown.",
  was: [`${SRC}/access/tables.ts:146`, `${SRC}/access/features/reads.ts:69`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    key: S,
    active: B,
    target: Schema.Literals(["person", "organization"]),
    conditions: Schema.Array(U),
    unsupported: opt(S),
    definitionHash: S,
    syncedAt: N,
  }),
  key: ["key"],
  indexes: [{ name: "by_key", fields: ["key"], for: "One flag's synced definition (`syncedFlagInTx`)." }],
  retention: KEPT,
});

export const table_feature_syncs = defineTable({
  id: "feature-syncs",
  title: "PostHog feature sync runs",
  about:
    "Access's log of PostHog flag sync runs, one row per run. `requireFeature` reads the last `synced` run's time, " +
    "so a stale copy closes a money gate. No business key: rows are found by outcome and time.",
  was: [`${SRC}/access/tables.ts:157`, `${SRC}/access/features/reads.ts:85`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    at: N,
    outcome: Schema.Literals(["synced", "failed"]),
    definitionHash: opt(S),
    flags: N,
    ignored: Strings,
    unsupported: Strings,
    reason: opt(S),
  }),
  key: ["_id"],
  indexes: [
    { name: "by_outcome_at", fields: ["outcome", "at"], for: "The latest run with outcome `synced` (`lastGoodSyncAtInTx`, ordered desc)." },
  ],
  retention: KEPT,
});

// ── accounts ────────────────────────────────────────────────────────────────────────────────

export const table_accounts = defineTable({
  id: "accounts",
  title: "Accounts (one logical money Account per person and chain)",
  about:
    "Accounts' logical money Account: one per authenticated user and chain, `accountId` an `account_` brand, " +
    "`smartAccountAddress` the custody Safe. Payments reads it directly, not through a door: " +
    "`lookupActorRecipient` reads an actor Account by id (views/recipients.ts) and `prepareRequestIntentInTx` " +
    "reads the caller's Account by user and chain (commands/writes/requests.ts). Every Accounts read procedure " +
    "below reads it too.",
  was: [`${SRC}/accounts/tables.ts:15`, `${PAY}/views/recipients.ts:75`, `${PAY}/commands/writes/requests.ts:31`],
  concept: concept_accounts,
  tenancy: "person",
  fields: Schema.Struct({
    accountId: S,
    authUserId: S,
    smartAccountAddress: S,
    chainId: N,
    createdAt: N,
  }),
  key: ["accountId"],
  indexes: [
    { name: "by_account_id", fields: ["accountId"], for: "One Account by id: a Payment's actor or recipient, a recipient's Safe (`lookupActorRecipient`, `resolveAccountRecipientSafeInTx`)." },
    { name: "by_smart_account_address", fields: ["smartAccountAddress"], for: "The Accounts at one Safe, for recipient resolution and Movement attribution (`readAccountsAtSafeInTx`)." },
    { name: "by_auth_user_chain", fields: ["authUserId", "chainId"], for: "The caller's Account on Base Sepolia (`requirePaymentAccountInTx`, `accountIdForAuthUserOrNull`, `prepareRequestIntentInTx`)." },
  ],
  retention: KEPT,
});

export const table_smart_accounts = defineTable({
  id: "smart-accounts",
  title: "Smart accounts (a person's Safe and its claimed signer)",
  about:
    "Accounts' Safe records keyed by the BetterAuth user: the counterfactual or deployed Safe and, once claimed, " +
    "its signer. `requireAccountSignerInTx` reads it to check the signer a payment names; Permissions' " +
    "authority checks read it through `requireExactAccountIdentityInTx`.",
  was: [`${SRC}/accounts/tables.ts:35`, `${SRC}/accounts/reads/identity.ts:112`, `${SRC}/accounts/reads/identity.ts:58`],
  concept: concept_accounts,
  tenancy: "person",
  fields: Schema.Struct({
    authUserId: S,
    signerAddress: opt(S),
    smartAccountAddress: S,
    chainId: N,
    deployedAt: NullOr(N),
    deploymentInFlightAt: opt(N),
    deployTxHash: opt(S),
    deployedAtBlock: opt(N),
    userOpHash: opt(S),
    claimLockId: opt(S),
    claimUserOpHash: opt(S),
    claimSignerAddress: opt(S),
    claimUserOpJson: opt(S),
    claimedAt: opt(N),
    claimTxHash: opt(S),
    createdAt: N,
  }),
  key: ["authUserId", "chainId"],
  indexes: [
    { name: "by_auth_user", fields: ["authUserId"], for: "A person's Safes on any chain (`readNativeReadyAccountInTx`)." },
    { name: "by_smart_account_address", fields: ["smartAccountAddress"], for: "The Safe record at one address." },
    { name: "by_auth_user_chain", fields: ["authUserId", "chainId"], for: "A person's Safe on Base Sepolia (`requireAccountSignerInTx`, `requireExactAccountIdentityInTx`)." },
  ],
  retention: KEPT,
});

export const table_approvals = defineTable({
  id: "approvals",
  title: "Approvals (a prepared money action waiting for its signer)",
  about:
    "Accounts' approval page rows: one prepared action, its summary as the backend built it, and the signer's " +
    "signature once approved. Payments reads the approval of one execution through `readExecutionApprovalInTx`. " +
    "Fields: main columns; `actor` and the nested `summary` object are booked as Unknown.",
  was: [`${SRC}/accounts/tables.ts:92`, `${SRC}/accounts/approvals/reads.ts:105`],
  concept: concept_accounts,
  tenancy: "person",
  fields: Schema.Struct({
    approvalId: S,
    authUserId: S,
    kind: Schema.Literals([
      "payment",
      "payroll_run",
      "payment_cancel",
      "payment_redirect",
      "permission_change",
      "invitation",
      "bank_payout",
      "safe_proposal",
      "payroll_agreement",
      "director_change",
      "agent",
      "share_transfer",
      "vote",
    ]),
    state: ApprovalState,
    actor: opt(U),
    summary: U,
    chainId: N,
    executionId: S,
    commandId: opt(S),
    digest: S,
    unsignedUserOpJson: S,
    paymentIds: Strings,
    signerAddress: S,
    signature: opt(S),
    expiresAt: N,
    createdAt: N,
    reviewedAt: opt(N),
    decidedAt: opt(N),
    consumedAt: opt(N),
  }),
  key: ["approvalId"],
  indexes: [
    { name: "by_approval_id", fields: ["approvalId"], for: "One approval by id, for the approval page." },
    { name: "by_execution_id", fields: ["executionId"], for: "The approval of one money execution (`readExecutionApprovalInTx`)." },
    { name: "by_command_auth_user", fields: ["commandId", "authUserId"], for: "A proposal step's open approval for one signer (CAP-943)." },
  ],
  retention: KEPT,
});

// ── activity ────────────────────────────────────────────────────────────────────────────────

export const table_activity_annotations = defineTable({
  id: "activity-annotations",
  title: "Activity annotations over Payment and Movement rows",
  about:
    "Activity's actor-scoped note over one activity row, a Payment or a Movement. Rows belong to an Account or " +
    "an Organization (`actorKind`). The free-text columns are retired (CAP-939). Payments' Movement detail reads " +
    "it through `readAnnotationInTx`.",
  was: [`${SRC}/activity/tables.ts:8`, `${SRC}/activity/reads.ts:14`],
  concept: concept_activity,
  tenancy: "organization",
  fields: Schema.Struct({
    referenceKind: ReferenceKind,
    referenceId: S,
    actorKind: ActorKind,
    actorId: S,
    counterpartyLabel: opt(S),
    accountingCategory: opt(S),
    memo: opt(S),
    lastEditorKind: ActorKind,
    lastEditorId: S,
    updatedAt: N,
  }),
  key: ["actorKind", "actorId", "referenceKind", "referenceId"],
  indexes: [
    { name: "by_actor_reference", fields: ["actorKind", "actorId", "referenceKind", "referenceId"], for: "One actor's annotation of one row (`annotationRow`)." },
  ],
  retention: KEPT,
});

// ── banking ─────────────────────────────────────────────────────────────────────────────────

const PAYOUT_STATES = [
  "Creating",
  "Quoted",
  "Funding",
  "InTransit",
  "Delivered",
  "Returning",
  "Refunded",
  "Cancelling",
  "Cancelled",
  "ClosedUnfunded",
  "Refused",
  "NeedsAttention",
] as const;

export const table_payouts = defineTable({
  id: "payouts",
  title: "Bank payouts (one Bridge payout and the quote it began as)",
  about:
    "Banking's one record of a bank payout (CAP-741). `payoutId` is the `railOperationId` a Payment names. The " +
    "payout door (`applyPayoutEventInTx`) writes every move; the refund link sets only `refundMovementId`. " +
    "Payments reads its quote, deadline and delivery and tells it, through the door, that a Payment was bound, " +
    "its send claimed, its funding verified or its send failed. Rows belong to an Account or an Organization " +
    "payer. Fields: main columns only. `deal`, `timer`, `news`, `sourceToken` and `endReason` are booked as Unknown " +
    "and `currency` and `paymentNotice` as String; `request`, `intent`, `newsHeld`, `balanceCheckFailedAt`, " +
    "`deliveredAmount`, `cancelReason`, `attention`, `refusedBy`, `bridgeRefusal`, `resolvedBy` and " +
    "`observationContext` are left out. A third writer outside the door, the conversion, inserts payouts made " +
    "from stored facts.",
  was: [`${SRC}/banking/tables/payouts.ts:131`, `${SRC}/banking/tables/payouts.ts:126`, `${SRC}/banking/tables/payouts.ts:107`, `${SRC}/banking/payouts/reads.ts:23`],
  concept: concept_banking,
  tenancy: "organization",
  fields: Schema.Struct({
    payoutId: S,
    quoteId: S,
    state: Schema.Literals(PAYOUT_STATES),
    stateSince: N,
    version: N,
    environment: Schema.Literals(["sandbox", "production"]),
    requestKey: S,
    requestDigest: S,
    authUserId: S,
    actorKind: ActorKind,
    actorId: S,
    ownerPartyId: S,
    partyAccountId: S,
    railSubjectRef: S,
    railAccountRef: S,
    sourceSafe: S,
    chainId: N,
    currency: S,
    sourceToken: opt(U),
    journeyId: S,
    quoteDeadlineAt: N,
    draftQuoteJson: opt(S),
    publicQuoteJson: opt(S),
    deal: opt(U),
    timer: opt(U),
    timerJob: opt(S),
    transferId: opt(S),
    news: opt(U),
    paymentId: opt(S),
    settlementId: opt(S),
    commandId: opt(S),
    acceptedAt: opt(N),
    fundingVerifiedAt: opt(N),
    sendFailedAt: opt(N),
    paymentNotice: opt(S),
    refundTxHash: opt(S),
    refundMovementId: opt(S),
    endReason: opt(U),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["payoutId"],
  indexes: [
    { name: "by_payout", fields: ["payoutId"], for: "The payout a Payment's `railOperationId` names (`payoutById`)." },
    { name: "by_quote", fields: ["quoteId"], for: "The payout a quote opened (`readPayoutQuoteForPaymentInTx`)." },
    { name: "by_request", fields: ["actorKind", "actorId", "requestKey"], for: "A repeat of the payer's request key finds its payout." },
    { name: "by_transfer", fields: ["transferId"], for: "The payout of one Bridge transfer, for webhook news." },
    { name: "by_settlement", fields: ["settlementId"], for: "A settlement binds one payout (`bindPayoutPaymentInTx`)." },
    { name: "by_deposit", fields: ["chainId", "deal.depositAddress"], for: "A refund from Bridge's deposit address (`classifyPayoutRefundInTx`)." },
    { name: "by_state_timer", fields: ["state", "timer.at"], for: "The watchdog's waiting payouts whose timer is overdue or missing (CAP-740)." },
  ],
  retention: KEPT,
});

export const table_payout_transitions = defineTable({
  id: "payout-transitions",
  title: "Payout log (one line per move or refusal)",
  about:
    "Banking's append-only payout log: one line per move or refusal the door records, never edited (ADR-0019). " +
    "Every door call payments makes adds a line. `event`, `refused`, `reason`, `held` and `source` are closed " +
    "vocabularies in the old code, summarized as String. No business key: `version` is the payout's version after " +
    "a move, or the version that refused the event, so several refusals at one version share (`payoutId`, " +
    "`version`).",
  was: [`${SRC}/banking/tables/payouts.ts:196`, `${SRC}/banking/tables/payouts.ts:199`, `${SRC}/banking/payouts/writes/lines.ts:66`],
  concept: concept_banking,
  tenancy: "organization",
  fields: Schema.Struct({
    payoutId: S,
    version: N,
    from: S,
    event: S,
    to: opt(Schema.Literals(PAYOUT_STATES)),
    refused: opt(S),
    reason: opt(U),
    held: opt(S),
    source: S,
    transferId: opt(S),
    at: N,
  }),
  key: ["_id"],
  indexes: [{ name: "by_payout", fields: ["payoutId", "version"], for: "One payout's log in version order." }],
  retention: KEPT,
});

// ── books ───────────────────────────────────────────────────────────────────────────────────

export const table_book_charts = defineTable({
  id: "book-charts",
  title: "Book charts (one chart of accounts per Organization)",
  about:
    "Books' one chart per Organization. An Organization with no chart keeps no money facts: " +
    "`recordSettledPaymentInTx` returns at `chartRow` for it.",
  was: [`${SRC}/books/tables.ts:20`, `${SRC}/books/reads.ts:16`],
  concept: concept_books,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    template: Schema.Literals(["us-services"]),
    basis: Schema.Literals(["cash"]),
    createdBy: S,
    createdAt: N,
    openedAt: opt(N),
    backfilledAt: opt(N),
  }),
  key: ["orgId"],
  indexes: [{ name: "by_org", fields: ["orgId"], for: "The Organization's chart (`chartRow`)." }],
  retention: KEPT,
});

export const table_book_accounts = defineTable({
  id: "book-accounts",
  title: "Book accounts (one account of an Organization's chart)",
  about:
    "Books' chart accounts. Settling a Payment can insert one: `ensureSafeAccountInTx` makes the Safe account " +
    "for an asset the first time the Safe holds it. A classification can create one inline (`createAccount`).",
  was: [`${SRC}/books/tables.ts:35`, `${SRC}/books/reads.ts:33`, `${SRC}/books/accounts/writes/chart.ts:177`],
  concept: concept_books,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    accountId: S,
    code: S,
    name: S,
    type: Schema.Literals(["asset", "liability", "equity", "income", "cost_of_services", "expense"]),
    parentAccountId: opt(S),
    quickbooksDetailType: S,
    status: Schema.Literals(["active", "archived"]),
    protection: opt(Schema.Literals(["safe", "uncategorized", "posting", "opening"])),
    safeAddress: opt(S),
    safeAsset: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["accountId"],
  indexes: [
    { name: "by_account", fields: ["accountId"], for: "One account by id (`accountById`)." },
    { name: "by_org_code", fields: ["orgId", "code"], for: "An Organization's chart, or the account with one code (`accountRows`, `accountByKey`)." },
  ],
  retention: KEPT,
});

export const table_book_assignments = defineTable({
  id: "book-assignments",
  title: "Book assignments (the account one actor gives one row)",
  about:
    "Books' assignment of one activity row to an account, per actor: an Organization account id or a personal " +
    "chart code. Rows belong to an Account or an Organization. Last write wins.",
  was: [`${SRC}/books/tables.ts:56`, `${SRC}/books/reads.ts:88`, `${SRC}/books/writes.ts:155`],
  concept: concept_books,
  tenancy: "organization",
  fields: Schema.Struct({
    actorKind: Schema.Literals(["account", "organization"]),
    actorId: S,
    referenceKind: ReferenceKind,
    referenceId: S,
    accountId: opt(S),
    personalCode: opt(S),
    suggestion: opt(S),
    assignedBy: S,
    assignedAt: N,
  }),
  key: ["actorKind", "actorId", "referenceKind", "referenceId"],
  indexes: [
    { name: "by_actor_reference", fields: ["actorKind", "actorId", "referenceKind", "referenceId"], for: "The account one actor gave one row (`assignmentRow`)." },
    { name: "by_account", fields: ["accountId", "assignedAt"], for: "The rows assigned to one account." },
  ],
  retention: KEPT,
});

export const table_book_facts = defineTable({
  id: "book-facts",
  title: "Book facts (append-only business facts of the books)",
  about:
    "Books' append-only facts (ADR-0042): chart changes and money facts. A settled Payment becomes one fact per " +
    "Organization side in the same transaction as the Payment's write (`recordSettledPaymentInTx`); a " +
    "reorganization writes a `reversed` fact (`reverseFactInTx`). Never edited, never deleted.",
  was: [`${SRC}/books/tables.ts:72`, `${SRC}/books/facts/writes/money.ts:66`, `${SRC}/books/facts/writes/standing.ts:58`],
  concept: concept_books,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    factId: S,
    kind: Schema.Literals([
      "account_created",
      "account_renamed",
      "account_archived",
      "account_assigned",
      "recategorized",
      "rows_reclassified",
      "payment_settled",
      "payment_received",
      "deposit_received",
      "payment_sent_outside",
      "payout_returned",
      "opening_balance",
      "reversed",
    ]),
    accountId: opt(S),
    fromAccountId: opt(S),
    referenceKind: opt(ReferenceKind),
    referenceId: opt(S),
    rows: opt(Schema.Array(Schema.Struct({ kind: ReferenceKind, id: S }))),
    code: opt(S),
    name: opt(S),
    occurredAt: opt(N),
    blockTime: opt(N),
    amountValue: opt(S),
    asset: opt(S),
    usdValue: opt(S),
    usdRate: opt(S),
    usdSource: opt(S),
    partyId: opt(S),
    sourceKind: opt(Schema.Literals(["payment", "deposit", "claim", "movement"])),
    sourceId: opt(S),
    txHash: opt(S),
    reversesFactId: opt(S),
    actorAuthUserId: opt(S),
    actorIsAgent: opt(B),
    recordedAt: N,
  }),
  key: ["factId"],
  indexes: [
    { name: "by_org_recorded", fields: ["orgId", "recordedAt"], for: "An Organization's facts in recorded order (`factAssetsInTx`)." },
    { name: "by_org_occurred", fields: ["orgId", "occurredAt"], for: "An Organization's facts by when they happened." },
    { name: "by_org_kind_occurred", fields: ["orgId", "kind", "occurredAt"], for: "An Organization's facts of one kind by date." },
    { name: "by_org_source", fields: ["orgId", "sourceId"], for: "The facts one Payment, Deposit or Movement wrote." },
    { name: "by_fact", fields: ["factId"], for: "The generations and reversals under one money fact id (`standingOf`, a prefix range)." },
  ],
  retention: "Append-only; never edited or deleted (ADR-0042).",
});

export const table_book_prices = defineTable({
  id: "book-prices",
  title: "Book prices (the devnet's USD rate stand-in)",
  about:
    "Books' USD price per pair from a day on, set by a devnet script. A money fact copies the rate once " +
    "(`priceAt`); with no row a USD stablecoin is pinned at 1.0000.",
  was: [`${SRC}/books/tables.ts:140`, `${SRC}/books/facts/reads/facts.ts:14`],
  concept: concept_books,
  tenancy: "global",
  fields: Schema.Struct({ pair: S, from: N, rate: S, source: S }),
  key: ["pair", "from"],
  indexes: [{ name: "by_pair_from", fields: ["pair", "from"], for: "The rate of one pair at a time (`priceAt`)." }],
  retention: KEPT,
});

export const table_book_assets = defineTable({
  id: "book-assets",
  title: "Book assets (tokens an Organization added to its books)",
  about:
    "Books' tokens an Organization added (CAP-979): held, scanned and booked, never paid in. A removed token " +
    "stays so the money it booked still reads. Payments' Movement admission and Payment views read it through " +
    "`bookAssetInTx`, `bookAssetByIdInTx` and `recordsAddedTokenInTx`.",
  was: [`${SRC}/books/tables.ts:149`, `${SRC}/books/assets/reads.ts:33`],
  concept: concept_books,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    chainId: N,
    tokenAddress: S,
    assetId: S,
    symbol: S,
    decimals: N,
    startBlock: N,
    addedBy: S,
    addedAt: N,
    removedAt: opt(N),
  }),
  key: ["orgId", "chainId", "tokenAddress"],
  indexes: [
    { name: "by_org", fields: ["orgId"], for: "The tokens one Organization records (`addedAssetRows`)." },
    { name: "by_chain_token", fields: ["chainId", "tokenAddress"], for: "The added asset at one token address (`bookAssetInTx`, `ownAssetRow`)." },
    { name: "by_asset", fields: ["assetId"], for: "The added asset one asset id names (`bookAssetByIdInTx`)." },
  ],
  retention: "Removal stamps `removedAt`; the row stays.",
});

// ── documents ───────────────────────────────────────────────────────────────────────────────

export const table_payment_documents = defineTable({
  id: "payment-documents",
  title: "Payment documents (the immutable content store)",
  about:
    "Documents' immutable content store: one typed document and its exact original bytes per hash pair. A " +
    "Payment birth stores its instruction and Receipts here (`preparePaymentDocumentsInTx`) and admits a saved " +
    "pair (`admitPaymentDocumentPairInTx`); a Transfer's Memo is stored here too. `originalBytes` is Convex " +
    "`v.bytes()` (an ArrayBuffer), booked as Unknown.",
  was: [`${SRC}/documents/tables.ts:12`, `${SRC}/documents/reads/contents.ts:159`, `${SRC}/documents/writes/contents.ts:53`],
  concept: concept_documents,
  tenancy: "global",
  fields: Schema.Struct({
    documentHash: S,
    contentHash: S,
    format: Schema.Literals(["envelope-v3", "envelope-v4", "envelope-v5", "artifact"]),
    originalBytes: U,
    kind: Schema.Literals(["memo", "invoice", "payslip", "receipt"]),
    issuedAt: opt(N),
    lineItems: opt(Schema.Array(Schema.Struct({ description: S, quantity: N, unitMinor: S }))),
    adjustments: opt(Schema.Array(Schema.Struct({ label: S, amount: S }))),
    mediaType: opt(S),
    signature: opt(Schema.Struct({ signer: S, value: S })),
    createdAt: N,
  }),
  key: ["documentHash", "contentHash"],
  indexes: [
    { name: "by_document_hash", fields: ["documentHash"], for: "Every stored serialization of one document hash." },
    { name: "by_document_content_hash", fields: ["documentHash", "contentHash"], for: "The exact stored pair a reference names (`storedPair`, `admitPaymentDocumentPairInTx`)." },
  ],
  retention: "Immutable; never edited or deleted.",
});

export const table_financial_document_links = defineTable({
  id: "financial-document-links",
  title: "Financial document links (a document's subject, per actor)",
  about:
    "Documents' links naming the subject (a Payment or a Movement) a document belongs to, for one actor. " +
    "Idempotent by a hashed link id. Payments reads it directly in `readDocumentCarrierPaymentsInTx` " +
    "(reads/participants.ts) and writes it through `linkPaymentDocumentInTx` and the Memo writers.",
  was: [`${SRC}/documents/tables.ts:47`, `${SRC}/documents/writes/links.ts:20`, `${PAY}/reads/participants.ts:125`],
  concept: concept_documents,
  tenancy: "organization",
  fields: Schema.Struct({
    linkId: S,
    actorKind: ActorKind,
    actorId: S,
    subjectKind: ReferenceKind,
    subjectId: S,
    role: Schema.Literals(["instruction", "movement", "supporting"]),
    documentHash: S,
    contentHash: S,
    filename: opt(S),
    createdAt: N,
  }),
  key: ["linkId"],
  indexes: [
    { name: "by_link_id", fields: ["linkId"], for: "The existing link with one hashed identity (`insertLinkInTx`)." },
    { name: "by_actor_subject", fields: ["actorKind", "actorId", "subjectKind", "subjectId"], for: "One actor's documents of one Movement (`loadMovementDocuments`)." },
    { name: "by_subject", fields: ["subjectKind", "subjectId"], for: "A Payment's documents (`loadPaymentDocumentsWithPrincipal`)." },
    { name: "by_document_content_hash", fields: ["documentHash", "contentHash"], for: "The subjects one document is linked to (`readDocumentCarrierPaymentsInTx`)." },
  ],
  retention: KEPT,
});

export const table_financial_document_movements = defineTable({
  id: "financial-document-movements",
  title: "Memo occurrences carried by Movements",
  about:
    "Documents' Memo occurrence of one chain Transfer: its logical event, fingerprint, position and state. " +
    "Orphaned, never deleted, when the canonical chain no longer holds it. Payments writes it through the Memo " +
    "writers and reads it through `currentPaymentDocuments` and `readMovementMemoForOccurrenceInTx`.",
  was: [`${SRC}/documents/tables.ts:63`, `${SRC}/documents/writes/memos.ts:49`, `${SRC}/documents/reads/payments.ts:108`],
  concept: concept_documents,
  tenancy: "global",
  fields: Schema.Struct({
    logicalEventId: S,
    financialFingerprint: S,
    chainId: N,
    txHash: S,
    transactionLogOrdinal: N,
    assetId: S,
    tokenAddress: S,
    source: S,
    destination: S,
    rawAmount: S,
    decimals: N,
    state: Schema.Literals(["included", "orphaned", "unresolved"]),
    blockHash: S,
    blockNumber: N,
    logIndex: N,
    blockTimestamp: N,
    documentHash: S,
    contentHash: S,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["logicalEventId"],
  indexes: [
    { name: "by_logical_event_id", fields: ["logicalEventId"], for: "The occurrence of one logical event (`planMovementMemoInTx`, `markMovementMemoOrphanedInTx`)." },
    { name: "by_chain_token_block", fields: ["chainId", "tokenAddress", "blockNumber"], for: "The occurrences in one block or scan window (`readMovementMemoForOccurrenceInTx`, `orphanAbsentMovementMemosInTx`)." },
    { name: "by_document_content_hash", fields: ["documentHash", "contentHash"], for: "The observation state of a movement-role reference (`currentPaymentDocuments`)." },
  ],
  retention: "Orphaned, never deleted.",
});

export const table_financial_document_movement_conflicts = defineTable({
  id: "financial-document-movement-conflicts",
  title: "Memo fingerprint conflicts",
  about:
    "Documents' record of a Memo occurrence that met a different financial fingerprint for the same logical " +
    "event. The writer keeps the last ten per logical event and deletes older ones (`recordMovementConflictInTx`).",
  was: [`${SRC}/documents/tables.ts:88`, `${SRC}/documents/writes/memos.ts:27`],
  concept: concept_documents,
  tenancy: "global",
  fields: Schema.Struct({ logicalEventId: S, expectedFingerprint: S, submittedFingerprint: S, observedAt: N }),
  key: ["logicalEventId", "observedAt"],
  indexes: [
    { name: "by_logical_event_observed", fields: ["logicalEventId", "observedAt"], for: "One logical event's conflicts, oldest first, to trim to ten." },
  ],
  retention: "The last ten conflicts per logical event; older rows are deleted on each new conflict.",
});

// ── organizations ───────────────────────────────────────────────────────────────────────────

export const table_orgs = defineTable({
  id: "orgs",
  title: "Organizations",
  about:
    "Organizations' stored Organization: name, Safe, owners and its Party link. Payments reads it directly, not " +
    "through a door: `lookupActorRecipient` names an Organization actor (views/recipients.ts) and " +
    "`resolveRecipientSafe` reads an Organization recipient's Safe (commands/reads/recipients.ts). The " +
    "Organizations read procedures below read it too.",
  was: [
    `${SRC}/organizations/tables/organizations.ts:17`,
    `${SRC}/organizations/reads/organizations.ts:17`,
    `${PAY}/views/recipients.ts:88`,
    `${PAY}/commands/reads/recipients.ts:24`,
  ],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    creationSource: opt(Schema.Literals(["human", "e2e", "agent"])),
    orgId: S,
    name: S,
    safeAddress: S,
    chainId: N,
    ownerPersonalSafeAddress: S,
    founderEmail: S,
    country: NullOr(S),
    bio: opt(NullOr(S)),
    size: opt(NullOr(S)),
    logoStorageId: opt(NullOr(S)),
    partyId: opt(S),
    safeSigners: opt(Schema.Struct({ owners: Strings, threshold: N, blockNumber: N })),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "One Organization by id (`findOrganization`, `lookupActorRecipient`, `resolveRecipientSafe`)." },
    { name: "by_party_id", fields: ["partyId"], for: "The Organization a Party stands for." },
    { name: "by_owner", fields: ["ownerPersonalSafeAddress"], for: "The Organizations one personal Safe founded." },
    { name: "by_safe_address", fields: ["safeAddress"], for: "The Organizations at one Safe (`readOrganizationsAtSafeInTx`)." },
  ],
  retention: KEPT,
});

export const table_org_members = defineTable({
  id: "org-members",
  title: "Organization members (Seats)",
  about:
    "Organizations' membership rows: a Seat is current while active, bound to a Party, and the Organization's " +
    "bootstrap is usable. Payments reaches it through `requireOrgParticipant`, and through Books' and " +
    "Organizations' seat reads (`readSeatStandingInTx`, `holdsSeatPermissionInTx`). No business key: there is no " +
    "member id, `authUserId` is optional and nullable, and one person can hold several rows in one Organization " +
    "over time (revoked, expired, invited again); readers take the first `active` row (`findActiveMember`).",
  was: [`${SRC}/organizations/tables/members.ts:10`, `${SRC}/organizations/reads/participation.ts:31`],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    email: opt(S),
    name: opt(NullOr(S)),
    authUserId: opt(NullOr(S)),
    personalSafeAddress: opt(NullOr(S)),
    role: S,
    roleKey: opt(NullOr(S)),
    status: Schema.Literals(["pending", "pending_safe", "pending_grant", "active", "revoked", "expired"]),
    grantTxHash: opt(NullOr(S)),
    revokeTxHash: opt(NullOr(S)),
    invitedAt: opt(N),
    acceptedAt: opt(NullOr(N)),
    grantedAt: opt(NullOr(N)),
    revokedAt: opt(NullOr(N)),
    expiresAt: opt(N),
    partyId: opt(S),
    agent: opt(B),
    reconciledAt: opt(N),
    createdAt: opt(N),
    updatedAt: N,
  }),
  key: ["_id"],
  indexes: [
    { name: "by_org", fields: ["orgId"], for: "An Organization's members." },
    { name: "by_email", fields: ["email"], for: "The memberships of one email." },
    { name: "by_org_email", fields: ["orgId", "email"], for: "One email's membership in one Organization." },
    { name: "by_auth_user_status", fields: ["authUserId", "status"], for: "The caller's active membership rows (`findActiveMember`, filtered by Organization)." },
    { name: "by_status", fields: ["status"], for: "Memberships in one status." },
  ],
  retention: KEPT,
});

export const table_seat_permissions = defineTable({
  id: "seat-permissions",
  title: "Seat permissions (Manage books, Issue invoices, Manage people)",
  about:
    "Organizations' grants of an off-chain Seat permission. `managesBooksInTx` reads the caller's grants, " +
    "through `holdsSeatPermissionInTx`, to decide whether a payment may book its row to a new account.",
  was: [`${SRC}/organizations/tables/members.ts:49`, `${SRC}/organizations/members/reads/permissions.ts:43`],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    authUserId: S,
    email: S,
    permission: Schema.Literals(["manage-books", "issue-invoices", "manage-people"]),
    proposalId: opt(S),
    grantedAt: N,
  }),
  key: ["orgId", "authUserId", "permission"],
  indexes: [
    { name: "by_org_permission", fields: ["orgId", "permission"], for: "Every grant of one permission in an Organization (`seatPermissionRows`)." },
    { name: "by_org_user", fields: ["orgId", "authUserId"], for: "The permissions one person holds (`seatPermissionsOfInTx`)." },
  ],
  retention: KEPT,
});

export const table_org_lifecycles = defineTable({
  id: "org-lifecycles",
  title: "Organization setups (bootstrap lifecycle)",
  about:
    "Organizations' setup record of each Organization: its bootstrap status, deployment and proof. Every Seat and " +
    "Permission authority check reads it through `orgBootstrapAuthorityUsable` (Permissions' guard): authority is " +
    "usable only with exactly one row that is completed and whose proof is verified. Fields: main columns only; " +
    "`proof` and the deployment, preparation, submission and scheduling columns are summarized.",
  was: [`${SRC}/organizations/tables/setups.ts:35`, `${SRC}/permissions/guards/bootstraps.ts:8`],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    orgId: S,
    founderAuthUserId: S,
    status: Schema.Literals(["awaitingAuthorization", "processing", "needsAttention", "ready", "rechecking", "failed"]),
    protocol: opt(Schema.Literals(["v4"])),
    revision: N,
    generation: N,
    creationAttemptNumber: N,
    proof: opt(U),
    completedAt: opt(N),
    dueAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["orgId"],
  indexes: [
    { name: "by_org_id", fields: ["orgId"], for: "An Organization's setup rows (`orgBootstrapAuthorityUsable` collects them and needs exactly one)." },
    { name: "by_founder", fields: ["founderAuthUserId"], for: "A founder's setups." },
    { name: "by_status", fields: ["status"], for: "Setups in one status." },
    { name: "by_submission_hash", fields: ["submission.userOpHash"], for: "The setup one submitted UserOperation belongs to." },
    { name: "by_due_at", fields: ["dueAt"], for: "Setups due for their next check." },
  ],
  retention: KEPT,
});

export const table_org_safe_proposals = defineTable({
  id: "org-safe-proposals",
  title: "Organization Safe proposals",
  about:
    "Organizations' Safe transaction proposals awaiting the Directors' threshold. Payments reaches it when " +
    "`readWornAllowancesInTx` asks whether a pending allowance's create or member command executed " +
    "(`readSubjectProposalInTx`). Fields: main columns only; `calls`, `submissions` and `subject` are summarized.",
  was: [`${SRC}/organizations/tables/proposals.ts:15`, `${SRC}/organizations/proposals/writes.ts:196`],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    proposalId: S,
    orgId: S,
    chainId: N,
    safeAddress: S,
    nonce: opt(N),
    safeTxHash: S,
    kind: Schema.Literals(["transaction", "rejection", "scheduled_payment"]),
    to: S,
    value: S,
    data: S,
    calls: Schema.Array(U),
    proposerAuthUserId: S,
    status: Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"]),
    threshold: N,
    approvedBy: Strings,
    executionUserOpHash: opt(S),
    subject: opt(U),
    createdAt: N,
    settledAt: opt(N),
  }),
  key: ["proposalId"],
  indexes: [
    { name: "by_proposal", fields: ["proposalId"], for: "One proposal by id." },
    { name: "by_org_nonce", fields: ["orgId", "nonce"], for: "An Organization's proposals in Safe nonce order." },
    { name: "by_subject_command", fields: ["subject.commandId"], for: "The proposal that carries one subject command (`readSubjectProposalInTx`)." },
  ],
  retention: KEPT,
});

export const table_org_invitations = defineTable({
  id: "org-invitations",
  title: "Organization invitation offers",
  about:
    "Organizations' invitation offers: each generation's consent, phase and cleanup. Payments reaches it when it " +
    "claims an invitation configuration execution: `authorizeInvitationConfigurationExecutionInTx` reads the " +
    "authorizing offer (`readAuthorizingInvitationOfferInTx`). Fields: main columns only; `bindings` is booked as " +
    "Unknown, and `replacementLineage`, `acceptedByAuthUserId`, `acceptedOfferDigest` and `deliveryAttemptedAt` " +
    "are left out.",
  was: [`${SRC}/organizations/tables/invitations.ts:25`, `${SRC}/organizations/invitations/reads/offers.ts:96`],
  concept: concept_organizations,
  tenancy: "organization",
  fields: Schema.Struct({
    invitationId: S,
    generationHash: S,
    configCommandId: S,
    requestHash: S,
    requestJson: S,
    orgId: S,
    chainId: N,
    organizationSafe: S,
    rolesModule: S,
    inviterAccountId: S,
    inviterAuthUserId: S,
    granteePartyId: S,
    granteeSafe: S,
    bindings: Schema.Array(U),
    phase: Schema.Literals(["authorizing", "pending", "pending_grant", "active", "revoking", "declined", "cancelled", "expired", "revoked"]),
    endingReason: NullOr(Schema.Literals(["declined", "cancelled", "expired", "revoked"])),
    authorizedAt: NullOr(N),
    acceptedAt: NullOr(N),
    expiresAt: NullOr(N),
    delivery: Schema.Literals(["not_confirmed", "sent", "failed", "none"]),
    cleanup: Schema.Literals(["not_requested", "disable_pending", "compensate_pending", "retired"]),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["invitationId"],
  indexes: [
    { name: "by_invitation_id", fields: ["invitationId"], for: "One offer by invitation id (`storedOffer`)." },
    { name: "by_config_command_id", fields: ["configCommandId"], for: "The offer one configure command authorizes." },
    { name: "by_org_created", fields: ["orgId", "createdAt", "invitationId"], for: "An Organization's invitations, newest first." },
    { name: "by_grantee_created", fields: ["granteePartyId", "createdAt", "invitationId"], for: "A grantee's invitations." },
    { name: "by_org_phase_created", fields: ["orgId", "phase", "createdAt", "invitationId"], for: "An Organization's invitations in one phase." },
    { name: "by_grantee_phase_created", fields: ["granteePartyId", "phase", "createdAt", "invitationId"], for: "A grantee's invitations in one phase." },
    { name: "by_phase_expires_at", fields: ["phase", "expiresAt"], for: "Invitations of one phase by expiry, for the expiry sweep." },
  ],
  retention: KEPT,
});

// ── parties ─────────────────────────────────────────────────────────────────────────────────

export const table_parties = defineTable({
  id: "parties",
  title: "Parties (one row per counterparty)",
  about:
    "Parties' identity rows: a person, an Organization or an unresolved address, provisional until claimed. " +
    "Payments reads it to name a counterparty (`partyById`, `partyBySafeAddress`), to resolve a recipient " +
    "locator, and writes it when a ledger participant or a recipient has no Party yet (`ensurePartyByAddress`, " +
    "`ensurePartyByEmail`).",
  was: [`${SRC}/parties/tables.ts:131`, `${SRC}/parties/reads/parties.ts:12`, `${SRC}/parties/writes/parties.ts:40`],
  concept: concept_parties,
  tenancy: "global",
  fields: Schema.Struct({
    partyId: S,
    kind: Schema.Literals(["person", "org", "unresolved"]),
    status: Schema.Literals(["provisional", "claimed"]),
    displayName: opt(NullOr(S)),
    handle: opt(NullOr(S)),
    email: opt(NullOr(S)),
    safeAddress: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["partyId"],
  indexes: [
    { name: "by_party_id", fields: ["partyId"], for: "One Party by id (`storedPartyById`)." },
    { name: "by_safe_address", fields: ["safeAddress"], for: "The Party at one Safe (`storedPartyBySafeAddress`)." },
    { name: "by_email", fields: ["email"], for: "The Party of one normalized email (`storedPartyByEmail`)." },
    { name: "by_handle", fields: ["handle"], for: "The Party with one handle (`storedPartyByHandle`)." },
  ],
  retention: KEPT,
});

export const table_party_edges = defineTable({
  id: "party-edges",
  title: "Party edges (contacts and engagements between Parties)",
  about:
    "Parties' relationships (ADR-0022 R2): a `contact` edge from A to B means B is in A's book; `employed` " +
    "edges carry engagements. A Payment birth, a collection or a Deposit records the contact edges in both " +
    "books (`recordContactEdges`).",
  was: [`${SRC}/parties/tables.ts:153`, `${SRC}/parties/writes/edges.ts:69`],
  concept: concept_parties,
  tenancy: "global",
  fields: Schema.Struct({
    edgeId: S,
    fromPartyId: S,
    toPartyId: S,
    kind: Schema.Literals(["contact", "employed"]),
    via: opt(Schema.Array(Schema.Literals(["paid", "paidBy", "invoiced", "invoicedBy", "member", "manual"]))),
    label: opt(NullOr(S)),
    hidden: opt(B),
    firstSeenAt: opt(N),
    lastActivityAt: opt(N),
    engagementType: opt(Schema.Literals(["fixed", "hourly", "milestone"])),
    title: opt(NullOr(S)),
    endedAt: opt(NullOr(N)),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["edgeId"],
  indexes: [
    { name: "by_edge_id", fields: ["edgeId"], for: "One edge by id." },
    { name: "by_from_kind", fields: ["fromPartyId", "kind"], for: "A Party's book of one edge kind." },
    { name: "by_to_kind", fields: ["toPartyId", "kind"], for: "The books a Party appears in." },
    { name: "by_from_to_kind", fields: ["fromPartyId", "toPartyId", "kind"], for: "The one contact edge from A to B (`storedContactEdge`)." },
  ],
  retention: KEPT,
});

export const table_counterparty_destinations = defineTable({
  id: "counterparty-destinations",
  title: "Counterparty destinations (where an actor pays a counterparty)",
  about:
    "Parties' saved destinations: where an actor pays a counterparty, or gets paid itself. Rows belong to an " +
    "Account or an Organization (`actorKind` `account` or `org`). Payments reads it directly in " +
    "`lookupPaymentRecipient` (views/recipients.ts) and through `resolveOwnedPaymentWalletSafeInTx`, and inserts " +
    "a wallet destination through `ensurePaymentWalletDestinationInTx`. Removal stamps `removedAt`; the row stays.",
  was: [
    `${SRC}/parties/tables.ts:215`,
    `${SRC}/parties/destinations/reads.ts:34`,
    `${SRC}/parties/destinations/writes/payments.ts:48`,
    `${PAY}/views/recipients.ts:109`,
  ],
  concept: concept_parties,
  tenancy: "organization",
  fields: Schema.Struct({
    destinationId: S,
    actorKind: Schema.Literals(["account", "org"]),
    actorId: S,
    partyId: S,
    sourceRefJson: S,
    kind: Schema.Literals(["bank", "mobile-money", "wallet"]),
    label: opt(S),
    payloadJson: S,
    ownerScope: opt(Schema.Literals(["self", "counterparty"])),
    createdAt: N,
    updatedAt: N,
    removedAt: opt(N),
    removedReason: opt(Schema.Literals(["unused_network"])),
  }),
  key: ["destinationId"],
  indexes: [
    { name: "by_destination_id", fields: ["destinationId"], for: "One destination by id (`byDestinationId`, `lookupPaymentRecipient`)." },
    { name: "by_actor_party", fields: ["actorKind", "actorId", "partyId"], for: "An actor's destinations for one Party (`ensurePaymentWalletDestinationInTx`)." },
    { name: "by_actor", fields: ["actorKind", "actorId"], for: "An actor's destinations (`readDestinations`)." },
  ],
  retention: "Removal stamps `removedAt`; the row stays so the ledger keeps attributing payments made to it.",
});

export const table_party_accounts = defineTable({
  id: "party-accounts",
  title: "Party bank accounts",
  about:
    "Parties' saved bank accounts, declared by one Party for an owner Party, with Bridge's references once active. " +
    "Payments reaches it when it reads a payout quote: `readPayoutQuoteForPaymentInTx` checks the quoted account " +
    "is still the same through `readPayoutAccountInTx`. Fields: main columns; `secretPayloadEnc` is the " +
    "encrypted bank details.",
  was: [`${SRC}/parties/tables.ts:9`, `${SRC}/parties/accounts/reads.ts:58`],
  concept: concept_parties,
  tenancy: "global",
  fields: Schema.Struct({
    partyAccountId: S,
    ownerPartyId: S,
    declaredBy: S,
    currency: Schema.Literals(["usd", "eur", "gbp"]),
    holderName: S,
    bankName: opt(S),
    last4: S,
    state: Schema.Literals(["saved", "active", "inactive"]),
    secretPayloadEnc: S,
    requestKey: S,
    requestFingerprint: S,
    creationKey: opt(S),
    railSubjectRef: opt(S),
    railAccountRef: opt(S),
    snapshotJson: opt(S),
    stateAt: opt(S),
    stateSeq: opt(N),
    removedAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["partyAccountId"],
  indexes: [
    { name: "by_account", fields: ["partyAccountId"], for: "One bank account by id (`accountById`)." },
    { name: "by_declarer", fields: ["declaredBy"], for: "The bank accounts one Party declared." },
    { name: "by_request", fields: ["declaredBy", "requestKey"], for: "A repeat of a declare request." },
    { name: "by_provider", fields: ["railAccountRef"], for: "The account Bridge's reference names." },
  ],
  retention: KEPT,
});

// ── payroll ─────────────────────────────────────────────────────────────────────────────────

export const table_payroll_runs = defineTable({
  id: "payroll-runs",
  title: "Payroll runs",
  about:
    "Payroll's runs on the shipped command lifecycle: `draft`, `authorized` when the signed UserOperation is " +
    "submitted, `settled` when the last of the run's Payments settles. Payments drives all three moves inside its " +
    "own transactions (`advanceRunsToAuthorized`, `settleRunForSettledPayment`, `returnRunToAuthorized`).",
  was: [`${SRC}/payroll/tables.ts:167`, `${SRC}/payroll/runs/writes/progression.ts:24`],
  concept: concept_payroll,
  tenancy: "organization",
  fields: Schema.Struct({
    runId: S,
    orgPartyId: S,
    assetId: S,
    periodStart: N,
    periodEnd: N,
    status: Schema.Literals(["draft", "authorized", "settled"]),
    batchRef: opt(S),
    settledAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["runId"],
  indexes: [
    { name: "by_run_id", fields: ["runId"], for: "One run by id (`runByIdInTx`)." },
    { name: "by_org_party_created", fields: ["orgPartyId", "createdAt"], for: "An employer's runs, newest first." },
    { name: "by_org_party_settled", fields: ["orgPartyId", "settledAt"], for: "An employer's runs settled in a period (\"Paid This Month\")." },
  ],
  retention: KEPT,
});

export const table_payroll_departments = defineTable({
  id: "payroll-departments",
  title: "Payroll departments",
  about:
    "Payroll's departments: a yearly or per-period budget per token and the holders of its role; on v4, one " +
    "budget in Budgets. A department payment reads it through `readDepartmentSpendInTx` (CAP-1165).",
  was: [`${SRC}/payroll/tables.ts:227`, `${SRC}/payroll/departments/reads.ts:30`],
  concept: concept_payroll,
  tenancy: "organization",
  fields: Schema.Struct({
    departmentId: S,
    orgId: S,
    name: S,
    slug: S,
    status: Schema.Literals(["proposed", "active", "abandoned"]),
    budgets: Schema.Array(
      Schema.Struct({ token: S, budget: S, period: opt(Schema.Literals(["year", "quarter", "month"])) }),
    ),
    holders: Schema.Array(Schema.Struct({ email: S, safe: S, label: S })),
    hat: opt(S),
    budgetId: opt(S),
    closed: opt(B),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["departmentId"],
  indexes: [
    { name: "by_department", fields: ["departmentId"], for: "One department by id." },
    { name: "by_org_slug", fields: ["orgId", "slug"], for: "An Organization's departments (`readDepartmentsInTx`)." },
  ],
  retention: KEPT,
});

// ── permissions ─────────────────────────────────────────────────────────────────────────────

const PermissionLifecycle = Schema.Literals(["pending", "active", "suspended", "revoked", "superseded"]);
const PermissionCommandState = Schema.Literals(["pending", "verified", "mismatch", "provider_failure", "applied", "abandoned"]);
const PermissionOperation = Schema.Literals(["create", "change", "assign", "revoke", "replace"]);

export const table_permissions = defineTable({
  id: "permissions",
  title: "Permissions (Budgets and Manage people)",
  about:
    "Permissions' rows: a Budget (spending authority over one token, optionally capped) or Manage people. An " +
    "Organization payment checks its Budget here (`requireOrganizationSpendAuthorityInTx`, " +
    "`readBudgetAllowanceInTx`); a Director step checks Manage people (`requireCommandAuthority`).",
  was: [`${SRC}/permissions/tables/permissions.ts:34`, `${SRC}/permissions/guards/spending.ts:238`, `${SRC}/permissions/guards/managers.ts:57`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    permissionId: S,
    orgId: S,
    type: Schema.Literals(["budget", "managePeople"]),
    state: PermissionLifecycle,
    revision: N,
    label: opt(S),
    policyJson: opt(S),
    resolvedPolicyJson: opt(S),
    organizationSafe: S,
    rolesModule: S,
    roleKey: S,
    tokenAddress: opt(S),
    assetId: opt(S),
    decimals: opt(N),
    limitRaw: opt(S),
    allowanceKey: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["permissionId", "revision"],
  indexes: [
    { name: "by_permission_id", fields: ["permissionId"], for: "The rows of one Permission, filtered to the one active (`requireOrganizationSpendAuthorityRows`, `readSpendableBudgetInTx`)." },
    { name: "by_org_state", fields: ["orgId", "state"], for: "An Organization's active Permissions, for Manage people (`requireCommandAuthority`)." },
    { name: "by_module_role", fields: ["rolesModule", "roleKey"], for: "The Permission one Roles module role key names." },
  ],
  retention: KEPT,
});

export const table_permission_assignments = defineTable({
  id: "permission-assignments",
  title: "Permission assignments (who holds a Permission)",
  about:
    "Permissions' assignment of a Permission to an Account, Organization or Party, with its member Safe. Every " +
    "authority check reads the caller's active assignment (`activeAssignment`).",
  was: [`${SRC}/permissions/tables/permissions.ts:57`, `${SRC}/permissions/reads/assignments.ts:31`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    permissionAssignmentId: S,
    permissionId: S,
    actorKind: Schema.Literals(["account", "organization", "party"]),
    actorId: S,
    memberSafe: S,
    partyId: opt(S),
    accountId: opt(NullOr(S)),
    state: PermissionLifecycle,
    sourceInvitationId: opt(S),
    sourceGenerationHash: opt(S),
    sourceCommandId: opt(S),
    verifiedReceiptId: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["permissionAssignmentId"],
  indexes: [
    { name: "by_assignment_id", fields: ["permissionAssignmentId"], for: "One assignment by id." },
    { name: "by_permission_actor", fields: ["permissionId", "actorKind", "actorId"], for: "One actor's assignment to one Permission (`activeAssignment`)." },
    { name: "by_member_safe", fields: ["memberSafe"], for: "The assignments bound to one Account's Safe (`loadAccountAssignmentGroups`)." },
    { name: "by_source_invitation", fields: ["sourceInvitationId"], for: "The assignments one invitation granted." },
  ],
  retention: KEPT,
});

export const table_permission_commands = defineTable({
  id: "permission-commands",
  title: "Permission commands (Permission and invitation configure commands)",
  about:
    "Permissions' commands: an ordinary Permission command (no `kind` on old rows) or an invitation configure " +
    "command. Payments claims and records the execution of each through Permissions' guards " +
    "(`authorizePermissionExecutionInTx`, `authorizeInvitationConfigurationExecutionInTx`) and reads its proof " +
    "(`readPermissionExecutionProofInTx`). The table is a union of two row shapes, booked as one struct: a column " +
    "only one shape has is optional (`operation`, `permissionId` and `userOpSenderSafe` are the Permission " +
    "shape's; `invitationId`, `purpose`, `generationHash`, `parentCommandId`, `chainId`, `execution` and the EOA " +
    "columns the invitation shape's). `execution` and `attempts` are booked as Unknown; the prepared calls, request, " +
    "verification and observation columns are left out.",
  was: [`${SRC}/permissions/tables/permissions.ts:87`, `${SRC}/permissions/reads/commands.ts:208`, `${SRC}/permissions/configurations/guards.ts:73`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    kind: opt(Schema.Literals(["permission", "invitation"])),
    commandId: S,
    orgId: S,
    operation: opt(PermissionOperation),
    permissionId: opt(S),
    permissionAssignmentId: opt(NullOr(S)),
    invitationId: opt(S),
    purpose: opt(Schema.Literals(["configure", "grant", "disable", "compensate"])),
    generationHash: opt(S),
    parentCommandId: opt(S),
    chainId: opt(N),
    userOpSenderSafe: opt(S),
    organizationSafe: S,
    rolesModule: S,
    roleKey: opt(S),
    execution: opt(U),
    eoaChainId: opt(N),
    eoaSender: opt(S),
    eoaNonce: opt(S),
    attempts: opt(U),
    state: PermissionCommandState,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["commandId"],
  indexes: [
    { name: "by_command_id", fields: ["commandId"], for: "One command by id (`loadPermissionExecutionCommandInTx`, `loadAuthorizingCommand`, `readPermissionExecutionProofInTx`)." },
    { name: "by_org_created", fields: ["orgId", "createdAt"], for: "An Organization's commands, newest first." },
    { name: "by_org_operation_permission", fields: ["orgId", "operation", "permissionId"], for: "One Permission's own commands, and the Organization's replacements (CAP-894)." },
    { name: "by_eoa_sender", fields: ["eoaChainId", "eoaSender"], for: "The commands one EOA sender sent." },
    { name: "by_eoa_nonce", fields: ["eoaChainId", "eoaSender", "eoaNonce"], for: "The command at one EOA nonce." },
  ],
  retention: KEPT,
});

export const table_permission_receipts = defineTable({
  id: "permission-receipts",
  title: "Permission receipts (chain proof of a Permission command)",
  about:
    "Permissions' verified chain receipts of applied commands. Authority needs a receipt that proves both the " +
    "Permission's revision and the assignment (`requireCommandAuthority`); an execution's proof is read here " +
    "(`readPermissionExecutionProofInTx`). Fields: main columns; `subject` is summarized as Unknown.",
  was: [`${SRC}/permissions/tables/permissions.ts:239`, `${SRC}/permissions/guards/managers.ts:57`, `${SRC}/permissions/reads/approvals.ts:104`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    commandId: S,
    orgId: S,
    permissionId: opt(S),
    permissionAssignmentId: NullOr(S),
    subject: opt(U),
    operation: opt(PermissionOperation),
    revision: N,
    chainId: N,
    userOpHash: S,
    transactionHash: S,
    blockNumber: N,
    blockHash: S,
    emitter: S,
    transactionIndex: N,
    logIndex: N,
    topic0: S,
    dataHash: S,
    factsHash: S,
    createdAt: N,
    orphanedAt: opt(N),
  }),
  key: ["chainId", "transactionHash", "logIndex"],
  indexes: [
    { name: "by_command_id", fields: ["commandId"], for: "One command's receipts (`readPermissionExecutionProofInTx`)." },
    { name: "by_org", fields: ["orgId"], for: "An Organization's receipts, filtered to verified ones (`requireCommandAuthority`)." },
    { name: "by_chain_transaction_log", fields: ["chainId", "transactionHash", "logIndex"], for: "The receipt of one chain log." },
  ],
  retention: "Orphaned receipts are stamped `orphanedAt`; none are deleted.",
});

export const table_permission_allowances = defineTable({
  id: "permission-allowances",
  title: "Permission allowances (v4 budget allowances and their hat)",
  about:
    "Permissions' v4 allowances under an Organization's budget, each with the hat its holders wear. A department or " +
    "budget payment reads the allowances whose hat the sender's Safe wears (`readWornAllowancesInTx`).",
  was: [`${SRC}/permissions/tables/allowances.ts:9`, `${SRC}/permissions/allowances/reads/worn.ts:51`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    allowanceId: S,
    orgId: S,
    requestKey: S,
    proposerAuthUserId: S,
    name: S,
    token: S,
    amount: S,
    period: Schema.Literals(["month", "quarter", "year"]),
    parentBudgetId: S,
    budgetId: opt(S),
    hat: S,
    holder: opt(Schema.Struct({ email: S, safe: S, label: S })),
    status: Schema.Literals(["pending", "active", "abandoned"]),
    proposalId: S,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["allowanceId"],
  indexes: [
    { name: "by_org_request", fields: ["orgId", "requestKey"], for: "A repeat of a create request." },
    { name: "by_org_status", fields: ["orgId", "status"], for: "An Organization's active and pending allowances (`onChainInTx`)." },
    { name: "by_allowance", fields: ["allowanceId"], for: "One allowance by id." },
  ],
  retention: KEPT,
});

export const table_permission_allowance_commands = defineTable({
  id: "permission-allowance-commands",
  title: "Permission allowance commands (change, assign, revoke)",
  about:
    "Permissions' commands on an allowance. `readWornAllowancesInTx` replays the applied ones, and the pending ones " +
    "whose proposal executed, to decide whether a Safe wears the allowance's hat now.",
  was: [`${SRC}/permissions/tables/allowances.ts:34`, `${SRC}/permissions/allowances/reads/worn.ts:22`],
  concept: concept_permissions,
  tenancy: "organization",
  fields: Schema.Struct({
    commandId: S,
    orgId: S,
    allowanceId: S,
    requestKey: S,
    proposerAuthUserId: S,
    operation: Schema.Literals(["change", "assign", "revoke"]),
    amount: opt(S),
    member: opt(Schema.Struct({ email: S, safe: S, label: S })),
    hatSupply: opt(Schema.Struct({ supply: N, maxSupply: N })),
    status: Schema.Literals(["pending", "applied", "abandoned"]),
    proposalId: S,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["commandId"],
  indexes: [
    { name: "by_org_request", fields: ["orgId", "requestKey"], for: "A repeat of a command request." },
    { name: "by_allowance_status", fields: ["allowanceId", "status"], for: "One allowance's applied or pending commands (`wearsInTx`)." },
    { name: "by_command", fields: ["commandId"], for: "One command by id." },
  ],
  retention: KEPT,
});

// ── profiles ────────────────────────────────────────────────────────────────────────────────

export const table_identities = defineTable({
  id: "identities",
  title: "Identities (a person's profile)",
  about:
    "Profiles' one profile per authenticated user: email, display name, onboarding and the link to the person's " +
    "Party. Payments reads it directly to name an Account actor by its display name (`lookupActorRecipient`, " +
    "views/recipients.ts). Requests' birth and document-access reads read it too.",
  was: [`${SRC}/profiles/tables.ts:5`, `${PAY}/views/recipients.ts:80`, `${SRC}/requests/reads/births.ts:53`],
  concept: concept_profiles,
  tenancy: "person",
  fields: Schema.Struct({
    authUserId: S,
    email: S,
    displayName: NullOr(S),
    country: NullOr(S),
    kycTier: Schema.Literals([0, 1, 2, 3]),
    onboarded: opt(B),
    withdrawalAddress: opt(NullOr(S)),
    imageStorageId: opt(NullOr(S)),
    partyId: opt(S),
    memberKind: opt(Schema.Literals(["human", "ai"])),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["authUserId"],
  indexes: [
    { name: "by_auth_user", fields: ["authUserId"], for: "One person's profile (`lookupActorRecipient`, `actorPartyId`, `issuedInvoiceReadAccess`)." },
  ],
  retention: KEPT,
});

// ── requests ────────────────────────────────────────────────────────────────────────────────

export const table_payment_requests = defineTable({
  id: "payment-requests",
  title: "Payment requests (requests and Invoices to be paid)",
  about:
    "Requests' payment requests and issued Invoices: the issuer, the amount, the frozen Memo or Invoice, the " +
    "payer and the settlement id. Payments reads it directly in `writes/births.ts` (an issued Invoice's shared " +
    "obligation, a frozen Memo's source) and through Requests' birth checks; Requests' writers patch it when a " +
    "Payment is born for it. Rows are owned by a person (`ownerAuthUserId`) and issued by an Account or an " +
    "Organization (`issuerActorKind` `account` or `org`). Every column is listed; JSON payloads are Strings and " +
    "`observationContext` is Unknown.",
  was: [`${SRC}/requests/tables.ts:13`, `${PAY}/writes/births.ts:45`, `${PAY}/writes/births.ts:79`],
  concept: concept_requests,
  tenancy: "organization",
  fields: Schema.Struct({
    paymentRequestId: S,
    ownerAuthUserId: S,
    status: Schema.Literals(["draft", "sent", "viewed", "pending_settlement", "paid", "declined", "expired", "cancelled"]),
    issuerActorKind: opt(Schema.Literals(["account", "org"])),
    issuerActorId: opt(S),
    issuerPartyId: S,
    amountKind: opt(Schema.Literals(["asset", "money"])),
    currency: S,
    assetId: opt(S),
    tokenAddress: opt(S),
    amountValue: S,
    decimals: N,
    rawAmount: opt(S),
    moneyMinorUnits: opt(S),
    receivingAccountId: opt(S),
    reference: S,
    payerLabel: opt(S),
    payerPartyId: opt(S),
    requestInstructionJson: opt(S),
    requestDocumentHash: opt(S),
    requestContentHash: opt(S),
    invoiceDocumentHash: opt(S),
    invoiceContentHash: opt(S),
    invoiceFormat: opt(Schema.Literals(["envelope-v3", "envelope-v4", "envelope-v5"])),
    invoiceDocumentInputJson: opt(S),
    invoiceSettlementId: opt(S),
    invoiceReceiptJson: opt(S),
    invoiceReceiptHistoryJson: opt(S),
    invoiceConsumptionJson: opt(S),
    invoiceReceiptVerification: opt(Schema.Literals(["unpaid", "verified", "orphaned", "unavailable"])),
    invoiceReceiptFinalJson: opt(S),
    invoicePayerActorKind: opt(ActorKind),
    invoicePayerActorId: opt(S),
    invoiceIssuerSafe: opt(S),
    invoiceOriginActorKind: opt(ActorKind),
    invoiceOriginActorId: opt(S),
    invoiceEscrowOwnerSafe: opt(S),
    invoiceEscrowAddress: opt(S),
    invoiceEscrowProtocol: opt(Schema.Literals(["v4"])),
    invoiceEscrowState: opt(Schema.Literals(["waiting", "closed"])),
    invoiceEscrowReceivedRaw: opt(S),
    invoiceEscrowPayoutTx: opt(S),
    invoiceEscrowCheckedAt: opt(N),
    memo: opt(S),
    linkToken: S,
    entitlementGranted: B,
    settledPaymentId: opt(S),
    settledDepositRef: opt(S),
    journeyId: opt(S),
    observationContext: opt(U),
    approvedAt: opt(N),
    approvedByAuthUserId: opt(S),
    declinedAt: opt(N),
    declinedByAuthUserId: opt(S),
    cancelledAt: opt(N),
    expiresAt: opt(N),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["paymentRequestId"],
  indexes: [
    { name: "by_payment_request_id", fields: ["paymentRequestId"], for: "One request by id (`sharesIssuedInvoiceObligation`, `frozenRequestMemoSource`, `invoiceBirthIdentity`)." },
    { name: "by_owner", fields: ["ownerAuthUserId"], for: "A person's requests." },
    { name: "by_owner_created", fields: ["ownerAuthUserId", "createdAt"], for: "A person's requests, newest first." },
    { name: "by_issuer_actor_created", fields: ["issuerActorKind", "issuerActorId", "createdAt"], for: "An issuer actor's requests, newest first." },
    { name: "by_issuer_party_created", fields: ["issuerPartyId", "createdAt"], for: "An issuer Party's requests, newest first." },
    { name: "by_issuer_reference", fields: ["issuerPartyId", "reference"], for: "An issuer's request with one reference." },
    { name: "by_payer_party_created", fields: ["payerPartyId", "createdAt"], for: "The requests addressed to one payer Party." },
    { name: "by_payer_party_status", fields: ["payerPartyId", "status", "createdAt"], for: "A payer's requests in one status." },
    { name: "by_request_document", fields: ["requestDocumentHash", "requestContentHash"], for: "The request that froze one Memo (`instructionReference`)." },
    { name: "by_invoice_document", fields: ["invoiceDocumentHash", "invoiceContentHash"], for: "The requests that issued one Invoice document (`issuedInvoiceReadAccess`)." },
    { name: "by_invoice_escrow_state", fields: ["invoiceEscrowState", "invoiceEscrowCheckedAt"], for: "Escrow Invoices waiting for their next check." },
    { name: "by_link_token", fields: ["linkToken"], for: "The request a checkout link names (`loadRequestByLink`, `loadInvoiceByLink`)." },
  ],
  retention: KEPT,
});

export const table_invoice_checkout_payments = defineTable({
  id: "invoice-checkout-payments",
  title: "Invoice checkout Payments (a request's Payment attempts)",
  about:
    "Requests' link between a payment request and each Payment born to pay it. Payments inserts it directly, not " +
    "through a door, when an Invoice or request birth creates its Payment (`commands/writes/items.ts`).",
  was: [`${SRC}/requests/tables.ts:109`, `${PAY}/commands/writes/items.ts:210`],
  concept: concept_requests,
  tenancy: "global",
  fields: Schema.Struct({ paymentRequestId: S, paymentId: S }),
  key: ["paymentId"],
  indexes: [
    { name: "by_payment", fields: ["paymentId"], for: "The request one Payment pays (`recordRegisteredRequestReceiptInTx`)." },
    { name: "by_request", fields: ["paymentRequestId"], for: "Every Payment attempt of one request (`requestPaymentIds`)." },
  ],
  retention: KEPT,
});

export const table_offer_checkouts = defineTable({
  id: "offer-checkouts",
  title: "Offer checkouts (a frozen purchase of a fixed Offer)",
  about:
    "Requests' frozen purchase of a fixed-price Offer: the buyer's wallet, the snapshot, the Memo document and, " +
    "once paid, the registered Payment and its receipt. A registered payer's Payment is born for it " +
    "(`prepareRegisteredPurchaseInTx`) and its verified receipt is projected onto it (`recordRegisteredReceiptInTx`).",
  was: [`${SRC}/requests/tables.ts:112`, `${SRC}/requests/reads/births.ts:116`],
  concept: concept_requests,
  tenancy: "global",
  fields: Schema.Struct({
    checkoutId: S,
    offerId: S,
    requestKey: S,
    requestJson: S,
    sourceWallet: S,
    snapshotJson: S,
    documentJson: S,
    receiptJson: opt(S),
    receiptHistoryJson: opt(S),
    registeredPaymentId: opt(S),
    createdAt: N,
  }),
  key: ["checkoutId"],
  indexes: [
    { name: "by_checkout", fields: ["checkoutId"], for: "One checkout by id (`offerCheckoutBirthIdentity`, `loadPurchaseRow`)." },
    { name: "by_registered_payment", fields: ["registeredPaymentId"], for: "The checkout a verified Payment funded (`recordRegisteredReceiptInTx`)." },
    { name: "by_offer_key", fields: ["offerId", "requestKey"], for: "A repeat of a purchase request." },
    { name: "by_offer_created", fields: ["offerId", "createdAt"], for: "One Offer's recent purchases (cooldown)." },
    { name: "by_wallet_created", fields: ["sourceWallet", "createdAt"], for: "One wallet's recent purchases (cooldown)." },
  ],
  retention: KEPT,
});

export const table_fixed_offers = defineTable({
  id: "fixed-offers",
  title: "Fixed-price Offers",
  about:
    "Requests' fixed-price Offers an Account or Organization sells. A registered purchase's Payment reads the " +
    "Offer's owner to name its recipient (`prepareRegisteredPurchaseInTx`). Rows belong to an Account or an " +
    "Organization (`actorKind` `account` or `org`).",
  was: [`${SRC}/requests/tables.ts:130`, `${SRC}/requests/writes/purchases.ts:205`],
  concept: concept_requests,
  tenancy: "organization",
  fields: Schema.Struct({
    offerId: S,
    actorKind: Schema.Literals(["account", "org"]),
    actorId: S,
    requestKey: S,
    creationJson: S,
    revision: N,
    active: B,
    createdAt: N,
    updatedAt: N,
  }),
  key: ["offerId"],
  indexes: [
    { name: "by_offer", fields: ["offerId"], for: "One Offer by id (`loadOfferRow`)." },
    { name: "by_actor", fields: ["actorKind", "actorId"], for: "An actor's Offers." },
    { name: "by_actor_key", fields: ["actorKind", "actorId", "requestKey"], for: "A repeat of an Offer create request." },
  ],
  retention: KEPT,
});

// ═══ (2) procedures ═════════════════════════════════════════════════════════════════════════
// Leaf procedures first: a procedure is defined before any procedure that invokes it.

const none = { drives: [], invokes: [], emits: [] } as const;

// ── organizations ───────────────────────────────────────────────────────────────────────────

export const procedure_organizations_read_organization_name_in_tx = defineProcedure({
  id: "organizations.read-organization-name-in-tx",
  title: "Read an Organization's name",
  about:
    "The Organization's name, or null, without granting scope (`findOrganization` by `by_org_id`). Payments' notice " +
    "facts name the Organization with it; Books (`classifyRow`), Access (the feature refusal) and Accounts (the approval page) reach it too.",
  was: [`${SRC}/organizations/reads/organizations.ts:30`, `${SRC}/organizations/reads/organizations.ts:17`, `${PAY}/notices/reads.ts:52`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_orgs],
  writes: [],
  ...none,
});

export const procedure_organizations_read_organization_safe_in_tx = defineProcedure({
  id: "organizations.read-organization-safe-in-tx",
  title: "Read an Organization's Safe",
  about:
    "The Organization's chain and lowercased Safe address, or null. Payments' owner void and budget guards read it; " +
    "Books' `ensureSafeAccountInTx` reads it when a settled Payment needs a new Safe account.",
  was: [
    `${SRC}/organizations/reads/organizations.ts:58`,
    `${PAY}/lifecycles/operations/prepare-owners-void.ts:34`,
    `${PAY}/guards/budgets.ts:10`,
    `${SRC}/books/accounts/writes/chart.ts:171`,
  ],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: NullOr(Schema.Struct({ chainId: N, address: S })),
  errors: [],
  reads: [table_orgs],
  writes: [],
  ...none,
});

export const procedure_organizations_read_organizations_at_safe_in_tx = defineProcedure({
  id: "organizations.read-organizations-at-safe-in-tx",
  title: "Read the Organizations at one Safe",
  about:
    "Every Base Sepolia Organization whose Safe is this address (`by_safe_address`, filtered by chain). Payments uses " +
    "it to resolve an Organization recipient and to attribute a Movement's side.",
  was: [`${SRC}/organizations/reads/organizations.ts:104`, `${PAY}/movements/reads/identities.ts:98`, `${PAY}/commands/reads/recipients.ts:2`],
  concept: concept_organizations,
  input: Schema.Struct({ safeAddress: S }),
  output: Schema.Array(Schema.Struct({ orgId: S, safeAddress: S })),
  errors: [],
  reads: [table_orgs],
  writes: [],
  ...none,
});

export const procedure_organizations_read_owner_safes_in_tx = defineProcedure({
  id: "organizations.read-owner-safes-in-tx",
  title: "Read an Organization's owner Safes",
  about:
    "The Organization Safe's owners, lowercased: `safeSigners.owners` when synced, else the founder's personal Safe. " +
    "An unknown Organization has none. Payments' owner-approval guard reads it.",
  was: [`${SRC}/organizations/reads/organizations.ts:50`, `${PAY}/guards/owner-approvals.ts:31`],
  concept: concept_organizations,
  input: Schema.Struct({ orgId: S }),
  output: Strings,
  errors: [],
  reads: [table_orgs],
  writes: [],
  ...none,
});

export const procedure_organizations_require_org_participant = defineProcedure({
  id: "organizations.require-org-participant",
  title: "Require a current Seat of the Organization",
  about:
    "The off-chain gate: the Organization exists, the caller has an active membership bound to a Party, and the " +
    "Organization's bootstrap is usable (`orgBootstrapAuthorityUsable`, Permissions' guard over `org-lifecycles`). " +
    "A missing Organization and a non-member are refused alike with `ROLE_PERMISSION_DENIED`. Returns the " +
    "Organization and the Seat's role key. Payments' Organization reads call it.",
  was: [
    `${SRC}/organizations/reads/participation.ts:85`,
    `${SRC}/organizations/reads/participation.ts:64`,
    `${SRC}/permissions/guards/bootstraps.ts:8`,
    `${PAY}/records/guards.ts:33`,
  ],
  concept: concept_organizations,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: Schema.Struct({ orgId: S, roleKey: NullOr(S) }),
  errors: [error_ROLE_PERMISSION_DENIED],
  reads: [table_orgs, table_org_members, table_org_lifecycles],
  writes: [],
  ...none,
});

// ── accounts ────────────────────────────────────────────────────────────────────────────────

export const procedure_accounts_account_id_for_auth_user_or_null = defineProcedure({
  id: "accounts.account-id-for-auth-user-or-null",
  title: "Read the caller's Account id, or null",
  about:
    "The `accountId` of the person's Base Sepolia Account (`by_auth_user_chain`, first), or null when none exists. " +
    "Payments' read guards and Documents' Payment references use it.",
  was: [`${SRC}/accounts/reads/identity.ts:136`, `${PAY}/records/guards.ts:21`, `${PAY}/reads/payments.ts:9`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: NullOr(S),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_account_signer_in_tx = defineProcedure({
  id: "accounts.require-account-signer-in-tx",
  title: "Require the caller's claimed Safe signer",
  about:
    "Reads the person's one Base Sepolia smart account (`by_auth_user_chain`, unique) and refuses `INVALID_INPUT` " +
    "(`signerAddress`) unless its claimed signer is the address the payment names. Returns the Safe. Payments' " +
    "Organization, request and lifecycle commands call it (also as `requireAuthenticatedSigner`).",
  was: [`${SRC}/accounts/reads/identity.ts:107`, `${PAY}/commands/writes/organizations.ts:227`, `${PAY}/lifecycles/guards.ts:22`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S, signerAddress: S }),
  output: Schema.Struct({ smartAccountAddress: S }),
  errors: [error_INVALID_INPUT],
  reads: [table_smart_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_require_payment_account_in_tx = defineProcedure({
  id: "accounts.require-payment-account-in-tx",
  title: "Require the caller's payment Account",
  about:
    "The person's Base Sepolia Account as an `AccountIdentity` (`by_auth_user_chain`, first); none is " +
    "`INVALID_INPUT` (`actor`: authenticated Account is not ready). Payments' funding read, recipient resolution, " +
    "command birth and authority guard call it (also as `authenticatedAccount`).",
  was: [`${SRC}/accounts/reads/identity.ts:34`, `${PAY}/commands/reads/funding.ts:43`, `${PAY}/guards/authority.ts:178`],
  concept: concept_accounts,
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Struct({ accountId: S, authUserId: S, smartAccountAddress: S, chainId: N }),
  errors: [error_INVALID_INPUT],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_accounts_at_safe_in_tx = defineProcedure({
  id: "accounts.read-accounts-at-safe-in-tx",
  title: "Read the Accounts at one Safe",
  about:
    "The Base Sepolia Accounts whose Safe is this address, oldest first (`by_smart_account_address`, filtered by " +
    "chain). Recipient resolution takes the first; Payments' Movement attribution refuses more than one.",
  was: [`${SRC}/accounts/reads/ledger.ts:42`, `${PAY}/movements/reads/identities.ts:97`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: Schema.Array(Schema.Struct({ accountId: S, smartAccountAddress: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_find_account_recipient_in_tx = defineProcedure({
  id: "accounts.find-account-recipient-in-tx",
  title: "Find the Account recipient at one Safe",
  about: "The first Account at this Safe as an `account` recipient, or null. Payments' recipient resolution calls it.",
  was: [`${SRC}/accounts/reads/ledger.ts:60`, `${PAY}/commands/reads/recipients.ts:50`],
  concept: concept_accounts,
  input: Schema.Struct({ safeAddress: S }),
  output: NullOr(Schema.Struct({ kind: Schema.Literals(["account"]), accountId: S })),
  errors: [],
  reads: [table_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_accounts_at_safe_in_tx],
  emits: [],
});

export const procedure_accounts_resolve_account_recipient_safe_in_tx = defineProcedure({
  id: "accounts.resolve-account-recipient-safe-in-tx",
  title: "Resolve an Account recipient's Safe",
  about:
    "The lowercased Safe of the Account a payment pays (`by_account_id`, first); none is `INVALID_INPUT` " +
    "(`recipient`: Account recipient not found).",
  was: [`${SRC}/accounts/reads/ledger.ts:68`, `${PAY}/commands/reads/recipients.ts:21`],
  concept: concept_accounts,
  input: Schema.Struct({ accountId: S }),
  output: S,
  errors: [error_INVALID_INPUT],
  reads: [table_accounts],
  writes: [],
  ...none,
});

export const procedure_accounts_read_execution_approval_in_tx = defineProcedure({
  id: "accounts.read-execution-approval-in-tx",
  title: "Read the approval of one execution",
  about:
    "The approval row of one money execution (`by_execution_id`, unique), as its id, its page URL (null when the " +
    "checkout origin is not configured) and its judged state at backend time; null when there is none. Payments' " +
    "execution context and reservation read it.",
  was: [`${SRC}/accounts/approvals/reads.ts:105`, `${PAY}/executions/writes/reservations.ts:100`, `${PAY}/commands/reads/contexts.ts:5`],
  concept: concept_accounts,
  input: Schema.Struct({ executionId: S }),
  output: NullOr(Schema.Struct({ approvalId: S, url: NullOr(S), state: ApprovalState })),
  errors: [],
  reads: [table_approvals],
  writes: [],
  ...none,
});

// ── parties ─────────────────────────────────────────────────────────────────────────────────

const PartyValue = U;
const ContactVia = Schema.Literals(["paid", "paidBy", "invoiced", "invoicedBy", "member", "manual"]);

export const procedure_parties_party_by_id = defineProcedure({
  id: "parties.party-by-id",
  title: "Read a Party by id",
  about:
    "One Party by id (`by_party_id`, first) as a frozen business value, or null. Payments' recipient labels read it; " +
    "Access's gate refusal and Parties' ledger writer reach it too. The Party value is booked as Unknown.",
  was: [`${SRC}/parties/reads/parties.ts:52`, `${SRC}/parties/reads/parties.ts:12`, `${PAY}/views/recipients.ts:52`],
  concept: concept_parties,
  input: Schema.Struct({ partyId: S }),
  output: NullOr(PartyValue),
  errors: [],
  reads: [table_parties],
  writes: [],
  ...none,
});

export const procedure_parties_party_by_safe_address = defineProcedure({
  id: "parties.party-by-safe-address",
  title: "Read the Party at one Safe",
  about:
    "The Party at an already-lowercased Safe (`by_safe_address`, first) as a wallet Party value, or null. Payments " +
    "names an Account actor's Party and a notice's counterparty with it.",
  was: [`${SRC}/parties/reads/parties.ts:56`, `${SRC}/parties/reads/parties.ts:28`, `${PAY}/views/recipients.ts:83`, `${PAY}/notices/reads.ts:12`],
  concept: concept_parties,
  input: Schema.Struct({ safeAddress: S }),
  output: NullOr(PartyValue),
  errors: [],
  reads: [table_parties],
  writes: [],
  ...none,
});

export const procedure_parties_resolve_recipient_in_tx = defineProcedure({
  id: "parties.resolve-recipient-in-tx",
  title: "Resolve a recipient locator",
  about:
    "What a locator names: a handle or Party id must resolve to a Party, else `INVALID_INPUT`; an email resolves to " +
    "its claimed Party or a new mailbox at its counterfactual Safe; an address resolves to its Party or a bare " +
    "address that needs acknowledgement (`invalidAddress` when not 0x). A known Party with no Safe is a bank-only " +
    "contact, `INVALID_INPUT`. A Party that is not claimed, or is `unresolved`, resolves as a bare address that " +
    "needs acknowledgement. Payments' lifecycle commands call it; Requests' document freeze reaches it too.",
  was: [`${SRC}/parties/reads/recipients.ts:73`, `${SRC}/parties/reads/recipients.ts:33`, `${PAY}/lifecycles/writes/commands.ts:123`],
  concept: concept_parties,
  input: Schema.Struct({ locator: U }),
  output: U,
  errors: [error_INVALID_INPUT],
  reads: [table_parties],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_id, procedure_parties_party_by_safe_address],
  emits: [],
});

export const procedure_parties_resolve_payment_recipient_in_tx = defineProcedure({
  id: "parties.resolve-payment-recipient-in-tx",
  title: "Resolve a payment's recipient",
  about:
    "`resolveRecipientInTx`, then refuses a bare external address unless the caller acknowledged it " +
    "(`INVALID_INPUT` on `to`). Payments' personal and Organization sends call it.",
  was: [`${SRC}/parties/reads/recipients.ts:127`, `${PAY}/commands/writes/organizations.ts:172`, `${PAY}/commands/writes/personal.ts:7`],
  concept: concept_parties,
  input: Schema.Struct({ locator: U, externalAddressAcknowledged: opt(Schema.Literals([true])) }),
  output: U,
  errors: [error_INVALID_INPUT],
  reads: [table_parties],
  writes: [],
  drives: [],
  invokes: [procedure_parties_resolve_recipient_in_tx],
  emits: [],
});

export const procedure_parties_resolve_owned_payment_wallet_safe_in_tx = defineProcedure({
  id: "parties.resolve-owned-payment-wallet-safe-in-tx",
  title: "Resolve a saved wallet destination's Safe",
  about:
    "The Safe a payment pays for a destination recipient: an active wallet destination on the payment network, " +
    "owned by one of the caller's actor ids. Anything else is `INVALID_INPUT` (not found, not on the payment " +
    "network, or an invalid stored address).",
  was: [`${SRC}/parties/destinations/reads.ts:100`, `${PAY}/commands/reads/recipients.ts:31`],
  concept: concept_parties,
  input: Schema.Struct({
    destinationId: S,
    owner: Schema.Struct({ actorKind: Schema.Literals(["account", "org"]), actorIds: Strings }),
  }),
  output: S,
  errors: [error_INVALID_INPUT],
  reads: [table_counterparty_destinations],
  writes: [],
  ...none,
});

export const procedure_parties_ensure_party_by_address = defineProcedure({
  id: "parties.ensure-party-by-address",
  title: "Ensure the Party at one Safe",
  about:
    "The Party at this Safe, or a new provisional `unresolved` one inserted there. A row that vanishes inside the " +
    "transaction is `UNKNOWN`. Payments' Deposit writer calls it directly.",
  was: [`${SRC}/parties/writes/parties.ts:105`, `${SRC}/parties/writes/parties.ts:40`, `${PAY}/writes/deposits.ts:74`],
  concept: concept_parties,
  input: Schema.Struct({ safeAddress: S, now: opt(N) }),
  output: PartyValue,
  errors: [error_UNKNOWN],
  reads: [table_parties],
  writes: [table_parties],
  ...none,
});

export const procedure_parties_ensure_ledger_party = defineProcedure({
  id: "parties.ensure-ledger-party",
  title: "Ensure the Party behind a ledger participant",
  about:
    "The Party of one Payment, collection or Deposit participant (S4, #1531): an Organization through its own Party " +
    "link (none is `UNKNOWN` `organizationPartyMissing`); a destination through its saved Party; otherwise the " +
    "Party at the Safe the money moved between, inserted when missing (a destination whose Party is gone falls " +
    "back to the address). It never refuses a caller: every failure is a defect, `UNKNOWN`. Payments' callers " +
    "pass no `now`, so the insert takes the `backendNow` shim (ADR-0041 D5).",
  was: [`${SRC}/parties/writes/ledger.ts:60`, `${SRC}/parties/writes/ledger.ts:25`, `${PAY}/writes/births.ts:7`, `${PAY}/writes/collections.ts:52`],
  concept: concept_parties,
  input: Schema.Struct({
    ref: Schema.Struct({ kind: Schema.Literals(["account", "organization", "destination"]), id: S }),
    safeAddress: S,
    now: opt(N),
  }),
  output: PartyValue,
  errors: [error_UNKNOWN],
  reads: [table_orgs, table_parties, table_counterparty_destinations],
  writes: [table_parties],
  drives: [],
  invokes: [procedure_parties_party_by_id, procedure_parties_ensure_party_by_address],
  emits: [],
});

export const procedure_parties_ensure_payment_wallet_destination_in_tx = defineProcedure({
  id: "parties.ensure-payment-wallet-destination-in-tx",
  title: "Ensure the wallet destination a payment records",
  about:
    "For a resolved recipient, in the payment's own transaction: ensures its Party (by Party id, by email, which " +
    "may insert or patch a provisional Party, or by address), then returns the actor's existing counterparty " +
    "wallet destination on the payment network that pays the address, or inserts a new one. A person's wallets " +
    "may be saved under either of their actor ids.",
  was: [`${SRC}/parties/destinations/writes/payments.ts:26`, `${SRC}/parties/writes/ledger.ts:25`, `${PAY}/commands/reads/recipients.ts:56`],
  concept: concept_parties,
  input: Schema.Struct({ authUserId: S, accountId: S, orgId: opt(S), resolved: U, now: opt(N) }),
  output: Schema.Struct({ kind: Schema.Literals(["destination"]), destinationId: S }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_parties, table_counterparty_destinations],
  writes: [table_parties, table_counterparty_destinations],
  drives: [],
  invokes: [procedure_parties_party_by_id, procedure_parties_ensure_party_by_address],
  emits: [],
});

export const procedure_parties_record_contact_edges = defineProcedure({
  id: "parties.record-contact-edges",
  title: "Record a contact edge in both books",
  about:
    "Upserts the `contact` edge from one Party to the other with its provenance (`via`), and the reverse edge when " +
    "`reverseVia` is given; widens first-seen and last-activity times. A self pair writes nothing. A row that " +
    "vanishes inside the transaction is `UNKNOWN`. Payments' birth, collection and Deposit writers call it.",
  was: [`${SRC}/parties/writes/edges.ts:125`, `${SRC}/parties/writes/edges.ts:69`, `${PAY}/writes/collections.ts:84`, `${PAY}/writes/births.ts:8`],
  concept: concept_parties,
  input: Schema.Struct({ fromPartyId: S, toPartyId: S, via: ContactVia, reverseVia: opt(ContactVia), at: N, now: opt(N) }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [table_party_edges],
  writes: [table_party_edges],
  ...none,
});

// ── access ──────────────────────────────────────────────────────────────────────────────────

export const procedure_access_authenticated_user = defineProcedure({
  id: "access.authenticated-user",
  title: "The signed-in BetterAuth user",
  about:
    "The signed-in user from the BetterAuth component's session, in the caller's transaction; no session is " +
    "`NOT_AUTHENTICATED`. Payments reaches it through Platform's `signedIn` step, which every signed-in Payments " +
    "query and mutation starts with. It reads the auth component's own user and session tables, which are not " +
    "tables of the app schema, so no table is linked.",
  was: [`${SRC}/access/sessions/guards.ts:30`, `${SRC}/platform/session.ts:17`, `${PAY}/records/operations/list.ts:14`],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.Struct({ authUserId: S, user: U }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_access_require_authenticated_user = defineProcedure({
  id: "access.require-authenticated-user",
  title: "Require the signed-in BetterAuth user (any context)",
  about:
    "The signed-in user from the BetterAuth component (`requireAuthOrThrow` over `sessionUsers`); none is " +
    "`NOT_AUTHENTICATED`. It takes a query, mutation or action context. Payments' actions reach it through " +
    "Platform's `signedInAction` (submit, submit-command, abandon, prepare-request, the lifecycle actions); from an " +
    "action it is not inside a transaction of the invoker, it reads the auth component directly. Documents' " +
    "`loadPaymentDocuments` calls it inside its query. It reads no table of the app schema.",
  was: [
    `${SRC}/access/sessions/guards.ts:47`,
    `${SRC}/access/sessions/guards.ts:38`,
    `${SRC}/platform/session.ts:24`,
    `${PAY}/executions/operations/submit.ts:20`,
  ],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.Struct({ user: U, authUserId: S }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_access_can_read_scope_in_tx = defineProcedure({
  id: "access.can-read-scope-in-tx",
  title: "Whether a principal may read an actor's scope",
  about:
    "An Account scope is readable only by its own Account; an Organization scope by a current Seat, asked through " +
    "`requireOrgParticipant`, whose `ROLE_PERMISSION_DENIED` is absorbed as `false`. Any other error propagates. " +
    "Payments' reads and Movement reads call it (also as `canReadActor`).",
  was: [`${SRC}/access/sessions/guards.ts:65`, `${PAY}/reads/payments.ts:61`, `${PAY}/movements/reads/movements.ts:46`],
  concept: concept_access,
  input: Schema.Struct({
    principal: Schema.Struct({ authUserId: S, accountId: S }),
    actorKind: ActorKind,
    actorId: S,
  }),
  output: B,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant],
  emits: [],
});

export const procedure_access_require_financial_read_principal_in_tx = defineProcedure({
  id: "access.require-financial-read-principal-in-tx",
  title: "Require a signed-in reader with an Account",
  about:
    "Authenticates the caller (`requireAuthenticatedUser`, BetterAuth; none is `NOT_AUTHENTICATED`), reports the " +
    "proof to the optional callback, then requires the person's payment Account (`INVALID_INPUT` when not ready). " +
    "Returns the read principal. Payments' retry preview loads its principal with it (as `loadActivityPrincipal`).",
  was: [`${SRC}/access/sessions/guards.ts:88`, `${PAY}/lifecycles/reads/retries.ts:147`],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.Struct({ authUserId: S, accountId: S }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_require_authenticated_user, procedure_accounts_require_payment_account_in_tx],
  emits: [],
});

export const procedure_access_require_financial_read_scope_in_tx = defineProcedure({
  id: "access.require-financial-read-scope-in-tx",
  title: "Require a readable financial scope",
  about:
    "The scope a read names (the principal's own Account when none is given), refused `INVALID_INPUT` (`actor`: " +
    "actor not found) when the principal may not read it. It grants no spending authority. Payments' Movement " +
    "reads call it (as `requireActivityActor`).",
  was: [`${SRC}/access/sessions/guards.ts:100`, `${PAY}/movements/reads/movements.ts:33`],
  concept: concept_access,
  input: Schema.Struct({ principal: Schema.Struct({ authUserId: S, accountId: S }), actor: opt(U) }),
  output: Schema.Struct({ kind: ActorKind, id: S }),
  errors: [error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_can_read_scope_in_tx],
  emits: [],
});

export const procedure_access_require_feature = defineProcedure({
  id: "access.require-feature",
  title: "Require a feature gate to be on",
  about:
    "The feature guard (scenario oracle 06), in the caller's transaction: decides one gate for the subject from the " +
    "devnet gate rows, or from the synced PostHog flag and the last good sync, records the decision on the wide " +
    "event, and refuses `FEATURE_NOT_AVAILABLE` when it is off. A refusal names the Organization: its name and " +
    "its Party's handle (`organizationLabelInTx`). Payments' intent prepares check `scheduled-payments` with it, " +
    "and the Books row a send classifies checks `books`.",
  was: [
    `${SRC}/access/features/guards.ts:121`,
    `${SRC}/access/features/reads.ts:143`,
    `${SRC}/access/features/reads.ts:124`,
    `${PAY}/lifecycles/operations/prepare-intent.ts:51`,
    `${PAY}/commands/writes/books.ts:9`,
  ],
  concept: concept_access,
  input: Schema.Struct({ key: S, subject: Schema.Struct({ authUserId: opt(S), orgId: opt(S) }) }),
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE],
  reads: [table_feature_gates, table_feature_flags, table_feature_syncs, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx, procedure_parties_party_by_id],
  emits: [],
});

export const procedure_access_require_feature_from_action = defineProcedure({
  id: "access.require-feature-from-action",
  title: "Require a feature gate to be on, from an action",
  about:
    "`requireFeature` for an action, which has no database of its own: it runs Access's internal query " +
    "`access.features.check` (`featureCheckInTx`, in that query's own read transaction, not the invoker's), records " +
    "the decision on the wide event, and refuses `FEATURE_NOT_AVAILABLE` when the gate is off. Booked as a " +
    "procedure because it is the door function payments calls; it is not an in-transaction function. Payments' " +
    "due-schedule send checks `scheduled-payments` with it.",
  was: [`${SRC}/access/features/guards.ts:152`, `${SRC}/access/features/guards.ts:137`, `${PAY}/schedules/operations/send-due.ts:6`, `${PAY}/schedules/external.ts:6`],
  concept: concept_access,
  input: Schema.Struct({ key: S, subject: Schema.Struct({ authUserId: opt(S), orgId: opt(S) }) }),
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE],
  reads: [table_feature_gates, table_feature_flags, table_feature_syncs, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx, procedure_parties_party_by_id],
  emits: [],
});

// ── books ───────────────────────────────────────────────────────────────────────────────────

const BookAsset = Schema.Struct({ assetId: S, symbol: S, chainId: N, tokenAddress: S, decimals: N, deploymentStartBlock: N });

export const procedure_books_book_asset_in_tx = defineProcedure({
  id: "books.book-asset-in-tx",
  title: "Read the book asset at a token address",
  about:
    "The asset at a token on a chain: one of Capxul's scanned money assets, else one an Organization added, removed " +
    "or not (`by_chain_token`, first), so money booked before still reads; null when unknown. Payments' Deposit " +
    "writer and Movement admission and reads call it.",
  was: [`${SRC}/books/assets/reads.ts:33`, `${PAY}/writes/deposits.ts:64`, `${PAY}/movements/writes/admission.ts:7`],
  concept: concept_books,
  input: Schema.Struct({ chainId: N, tokenAddress: S }),
  output: NullOr(BookAsset),
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

export const procedure_books_book_asset_by_id_in_tx = defineProcedure({
  id: "books.book-asset-by-id-in-tx",
  title: "Read the book asset an asset id names",
  about:
    "The asset an asset id names: Capxul's configured one, else an added one (`by_asset`, first); null for an " +
    "unknown or malformed id. Payments' Payment and activity views name a Payment's asset with it.",
  was: [`${SRC}/books/assets/reads.ts:50`, `${PAY}/views/payments.ts:149`, `${PAY}/views/activity.ts:2`],
  concept: concept_books,
  input: Schema.Struct({ assetId: S }),
  output: NullOr(BookAsset),
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

export const procedure_books_records_added_token_in_tx = defineProcedure({
  id: "books.records-added-token-in-tx",
  title: "Whether an Organization records an added token at a block",
  about:
    "True when the Organization's own row for the token exists, is not removed, and the block is not before the " +
    "row's `startBlock`. Payments' Movement admission asks it before admitting an added token's Transfer.",
  was: [`${SRC}/books/assets/reads.ts:99`, `${PAY}/movements/writes/admission.ts:37`],
  concept: concept_books,
  input: Schema.Struct({ orgId: S, asset: Schema.Struct({ chainId: N, tokenAddress: S }), blockNumber: N }),
  output: B,
  errors: [],
  reads: [table_book_assets],
  writes: [],
  ...none,
});

export const procedure_books_read_row_account_in_tx = defineProcedure({
  id: "books.read-row-account-in-tx",
  title: "Read the account one actor gave one row",
  about:
    "The account an actor's assignment points a Payment or Movement row to (a personal chart code, or an " +
    "Organization account), with its suggestion and time; null when there is none. Payments' book classification " +
    "and Activity's annotation read call it.",
  was: [`${SRC}/books/reads.ts:113`, `${PAY}/commands/writes/books.ts:54`, `${SRC}/activity/reads.ts:34`],
  concept: concept_books,
  input: Schema.Struct({ actor: Schema.Struct({ kind: ActorKind, id: S }), reference: Schema.Struct({ kind: ReferenceKind, id: S }) }),
  output: NullOr(Schema.Struct({ account: Schema.Struct({ accountId: S, code: S, name: S }), suggestion: NullOr(S), assignedAt: N })),
  errors: [],
  reads: [table_book_assignments, table_book_accounts],
  writes: [],
  ...none,
});

export const procedure_books_manages_books_in_tx = defineProcedure({
  id: "books.manages-books-in-tx",
  title: "Whether the person manages an Organization's books",
  about:
    "True when the person is a current Seat holding Manage books, asked through Organizations' " +
    "`holdsSeatPermissionInTx` (which reads the Seat's standing, then its seat permissions). Payments' book " +
    "classification passes it to `classifyRow`, which refuses a new inline account without it.",
  was: [`${SRC}/books/guards.ts:48`, `${SRC}/organizations/members/reads/permissions.ts:57`, `${PAY}/commands/writes/books.ts:45`],
  concept: concept_books,
  input: Schema.Struct({ orgId: S, authUserId: S }),
  output: B,
  errors: [],
  reads: [table_org_members, table_orgs, table_org_lifecycles, table_seat_permissions],
  writes: [],
  ...none,
});

export const procedure_books_classify_row = defineProcedure({
  id: "books.classify-row",
  title: "Classify a row into a book account",
  about:
    "The account an annotation (or a payment that books its row as it is sent) gives its row, in the caller's " +
    "transaction (an Effect over `Transaction`). An Organization row takes an active account of its chart, or a " +
    "new one made inline by a Seat with Manage books (`account_created` fact); a person's row takes a personal " +
    "chart code. The assignment is written last-write-wins, with an `account_assigned` or `recategorized` fact for " +
    "an Organization; a fact a Seat that is an AI causes carries `actorIsAgent`. Refusals: `INVALID_INPUT` (two " +
    "accounts, unknown account, suggestion beside a decided account, a new account on the fixed personal chart, " +
    "code rules), `WRONG_STATE` (no chart, archived account), `ROLE_PERMISSION_DENIED` (Manage books required).",
  was: [`${SRC}/books/writes.ts:223`, `${SRC}/books/writes.ts:47`, `${SRC}/books/writes.ts:91`, `${SRC}/books/writes.ts:155`, `${PAY}/commands/writes/books.ts:56`],
  concept: concept_books,
  input: Schema.Struct({
    actor: Schema.Struct({ kind: ActorKind, id: S }),
    reference: Schema.Struct({ kind: ReferenceKind, id: S }),
    choice: U,
    classifier: Schema.Struct({ authUserId: S, managesBooks: B }),
    method: opt(S),
  }),
  output: NullOr(Schema.Struct({ account: Schema.Struct({ accountId: S, code: S, name: S }), suggestion: NullOr(S) })),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED],
  reads: [table_book_charts, table_book_accounts, table_book_assignments, table_org_members, table_orgs, table_org_lifecycles],
  writes: [table_book_accounts, table_book_assignments, table_book_facts],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx],
  emits: [],
});

const MONEY_FACT_READS = [
  table_book_charts,
  table_book_facts,
  table_book_assets,
  table_book_prices,
  table_book_assignments,
  table_book_accounts,
];

export const procedure_books_record_settled_payment_in_tx = defineProcedure({
  id: "books.record-settled-payment-in-tx",
  title: "Record a settled Payment's money facts",
  about:
    "A2: for each Organization side of a settled Payment or an arrived Deposit, one money fact in the same " +
    "transaction as the Payment's write. A commitment (agreement or stream) records nothing here; its claims do. " +
    "A side with no chart records nothing; a side whose fact id already stands writes nothing (a replay or the " +
    "second seam). The fact takes the assigned or 'not decided' account, the block time (or `fallbackAt`, or " +
    "Capxul's time) and a USD value at a rate taken once; the Safe account for a new asset is made first " +
    "(`ensureSafeAccountInTx`, with its `account_created` fact). The input is the whole stored Payment row " +
    "(`Doc<\"payments\">`), booked as Unknown: Books reads payments' row shape (`moneySides`, `isCommitment`).",
  was: [
    `${SRC}/books/facts/writes/money.ts:98`,
    `${SRC}/books/facts/writes/money.ts:49`,
    `${SRC}/books/accounts/writes/chart.ts:163`,
    `${PAY}/writes/settlements.ts:12`,
    `${PAY}/verifications/writes/sends.ts:228`,
    `${PAY}/writes/deposits.ts:2`,
    `${PAY}/writes/rails.ts:4`,
  ],
  concept: concept_books,
  input: Schema.Struct({ payment: U, chainTime: NullOr(N), fallbackAt: opt(N) }),
  output: Schema.Void,
  errors: [],
  reads: MONEY_FACT_READS,
  writes: [table_book_facts, table_book_accounts],
  drives: [],
  invokes: [procedure_books_book_asset_by_id_in_tx, procedure_organizations_read_organization_safe_in_tx],
  emits: [],
});

export const procedure_books_record_commitment_claim_in_tx = defineProcedure({
  id: "books.record-commitment-claim-in-tx",
  title: "Record one commitment claim's money facts",
  about:
    "One claim of an agreement or stream: its raw amount in the asset's units, as a `claim` money fact per " +
    "Organization side, dated by the claim's block, under a claim fact id so a replay writes nothing. An asset with " +
    "no configured decimals records nothing. Same account, price and Safe-account rules as a settled Payment.",
  was: [`${SRC}/books/facts/writes/money.ts:130`, `${PAY}/reads/settled.ts:60`, `${PAY}/verifications/writes/claims.ts:81`, `${PAY}/verifications/writes/commitments.ts:7`],
  concept: concept_books,
  input: Schema.Struct({ payment: U, claim: Schema.Struct({ logicalEventId: S, rawAmount: S, txHash: S, chainTime: N }) }),
  output: Schema.Void,
  errors: [],
  reads: MONEY_FACT_READS,
  writes: [table_book_facts, table_book_accounts],
  drives: [],
  invokes: [procedure_books_book_asset_by_id_in_tx, procedure_organizations_read_organization_safe_in_tx],
  emits: [],
});

export const procedure_books_reverse_settled_payment_in_tx = defineProcedure({
  id: "books.reverse-settled-payment-in-tx",
  title: "Reverse a settled Payment's money facts",
  about:
    "A reorganization took back the occurrence that settled a Payment, or the Movement a Deposit came from: each " +
    "side's standing fact gets a `reversed` fact (CAP-970); settling again writes the next generation. A " +
    "commitment reverses nothing here.",
  was: [`${SRC}/books/facts/writes/money.ts:163`, `${SRC}/books/facts/writes/standing.ts:39`, `${PAY}/verifications/writes/history.ts:190`, `${PAY}/writes/rollbacks.ts:5`],
  concept: concept_books,
  input: Schema.Struct({ payment: U }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_reverse_commitment_claim_in_tx = defineProcedure({
  id: "books.reverse-commitment-claim-in-tx",
  title: "Reverse one commitment claim's money facts",
  about: "A reorganization took back one claim of a commitment: each side's standing claim fact gets a `reversed` fact.",
  was: [`${SRC}/books/facts/writes/money.ts:180`, `${PAY}/verifications/writes/history.ts:189`],
  concept: concept_books,
  input: Schema.Struct({ payment: U, logicalEventId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_reverse_outside_money_in_tx = defineProcedure({
  id: "books.reverse-outside-money-in-tx",
  title: "Reverse a Movement's outside-money facts",
  about:
    "A reorganization, or a Capxul Payment that claimed the Transfer, took a Movement back: its " +
    "`payment_sent_outside` and `payout_returned` facts are reversed for each Organization side (CAP-969).",
  was: [`${SRC}/books/facts/writes/movements.ts:16`, `${PAY}/movements/writes/overlays.ts:51`],
  concept: concept_books,
  input: Schema.Struct({ orgIds: Strings, movementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_book_facts],
  writes: [table_book_facts],
  ...none,
});

export const procedure_books_schedule_outside_money_in_tx = defineProcedure({
  id: "books.schedule-outside-money-in-tx",
  title: "Schedule a Movement's outside money to be booked",
  about:
    "Schedules Books' internal mutation `books.facts.outside` for the Movement after 30 seconds, or 5 minutes on " +
    "staging and production, so a Capxul Payment's verification can claim the Transfer first and a quick pay is " +
    "never booked as money sent outside and then reversed. Writes no table itself.",
  was: [`${SRC}/books/facts/writes/movements.ts:39`, `${PAY}/movements/writes/projections.ts:64`],
  concept: concept_books,
  input: Schema.Struct({ movementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  ...none,
});

// ── activity ────────────────────────────────────────────────────────────────────────────────

export const procedure_activity_read_annotation_in_tx = defineProcedure({
  id: "activity.read-annotation-in-tx",
  title: "Read one actor's annotation of one row",
  about:
    "The actor's annotation of a Payment or Movement row with the row's book account, or an account-only view when " +
    "only Books holds an assignment; null when neither exists. Payments' Movement detail reads it (as " +
    "`loadActivityAnnotation`).",
  was: [`${SRC}/activity/reads.ts:27`, `${PAY}/movements/reads/movements.ts:85`],
  concept: concept_activity,
  input: Schema.Struct({ scope: Schema.Struct({ kind: ActorKind, id: S }), reference: Schema.Struct({ kind: ReferenceKind, id: S }) }),
  output: NullOr(U),
  errors: [],
  reads: [table_activity_annotations],
  writes: [],
  drives: [],
  invokes: [procedure_books_read_row_account_in_tx],
  emits: [],
});

// ── requests (reads Documents needs) ────────────────────────────────────────────────────────

export const procedure_requests_issued_invoice_read_access = defineProcedure({
  id: "requests.issued-invoice-read-access",
  title: "Who may read an issued Invoice or Memo",
  about:
    "Issued request content belongs to its issuer and its immutable named debtor: `participant` when the principal " +
    "reads the issuer, or is the payer actor (asked through `canReadScopeInTx`), or for an escrow Invoice claimed " +
    "the payer's email Party; `restricted` otherwise; `not_issued` when no request issued the document. A frozen " +
    "Memo is checked first the same way. Payments' retry preview and Documents' reference reads ask it.",
  was: [`${SRC}/requests/reads/documents.ts:67`, `${PAY}/lifecycles/reads/retries.ts:151`, `${SRC}/documents/reads/payments.ts:36`],
  concept: concept_requests,
  input: Schema.Struct({ principal: Schema.Struct({ authUserId: S, accountId: S }), documentHash: S, contentHash: S }),
  output: Schema.Literals(["participant", "restricted", "not_issued"]),
  errors: [],
  reads: [table_payment_requests, table_identities, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_access_can_read_scope_in_tx],
  emits: [],
});

// ── documents ───────────────────────────────────────────────────────────────────────────────

const DocumentRef = U;

export const procedure_documents_admit_payment_document_pair_in_tx = defineProcedure({
  id: "documents.admit-payment-document-pair-in-tx",
  title: "Admit a saved document pair before a Payment birth",
  about:
    "The exact saved content and envelope pair a birth names, and its prepared context: a missing pair or bytes " +
    "that do not hash to the content hash is `INVALID_INPUT` (document not found); a context that does not match " +
    "is `INVALID_INPUT`; a stored format or document hash that no longer matches is `UNKNOWN` (integrity).",
  was: [`${SRC}/documents/reads/contents.ts:153`, `${PAY}/writes/births.ts:133`],
  concept: concept_documents,
  input: Schema.Struct({ documentHash: S, contentHash: S, context: U }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_documents],
  writes: [],
  ...none,
});

export const procedure_documents_read_movement_memo_for_occurrence_in_tx = defineProcedure({
  id: "documents.read-movement-memo-for-occurrence-in-tx",
  title: "Read a Movement occurrence's Memo documents",
  about:
    "Finds the Memo occurrence at exactly this Transfer (same block, tx, log, parties and amount) and loads the " +
    "viewer's Movement documents for its logical event: the Memo and each instruction the reader may see. " +
    "`pending` when there is no occurrence, link or Safe match; `unavailable` when unresolved. Stored content that " +
    "no longer verifies is `UNKNOWN`. The viewer's Safe is read through Access's `readScopeSafeAddressInTx`.",
  was: [`${SRC}/documents/reads/movements.ts:29`, `${SRC}/documents/reads/movements.ts:101`, `${PAY}/movements/reads/movements.ts:112`],
  concept: concept_documents,
  input: Schema.Struct({ viewer: Schema.Struct({ kind: ActorKind, id: S }), occurrence: U, principal: Schema.Struct({ authUserId: S, accountId: S }) }),
  output: U,
  errors: [error_UNKNOWN],
  reads: [table_financial_document_movements, table_financial_document_links, table_payment_documents, table_payment_requests, table_accounts, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_requests_issued_invoice_read_access],
  emits: [],
});

export const procedure_documents_current_payment_documents = defineProcedure({
  id: "documents.current-payment-documents",
  title: "Select a Payment's current document references",
  about:
    "De-duplicates a Payment's references and keeps only included Memo observations (a movement-role reference " +
    "reads its occurrence's state); returns them with the Payment's document state: `unavailable` when any is " +
    "unresolved, `pending` while any is not included or none is an instruction or Memo, else `ready`.",
  was: [`${SRC}/documents/reads/payments.ts:108`, `${PAY}/views/payments.ts:255`],
  concept: concept_documents,
  input: Schema.Struct({ references: Schema.Array(DocumentRef) }),
  output: Schema.Struct({ documents: Schema.Array(DocumentRef), documentState: Schema.Literals(["unavailable", "pending", "ready"]) }),
  errors: [],
  reads: [table_financial_document_movements],
  writes: [],
  ...none,
});

export const procedure_documents_load_payment_documents = defineProcedure({
  id: "documents.load-payment-documents",
  title: "Load a Payment's document references for the signed-in reader",
  about:
    "The Payment's links in role, issue and hash order, each as a reference; an issued Invoice or Memo private to " +
    "its participants is left out. The principal is the signed-in user (BetterAuth, `requireAuthenticatedUser`; " +
    "none is `NOT_AUTHENTICATED`) and their Account id, read only when a private document needs it. A link whose " +
    "content is missing is `UNKNOWN`.",
  was: [`${SRC}/documents/reads/payments.ts:81`, `${SRC}/documents/reads/payments.ts:56`, `${PAY}/lifecycles/reads/previews.ts:64`, `${PAY}/reads/payroll.ts:7`],
  concept: concept_documents,
  input: Schema.Struct({ paymentId: S }),
  output: Schema.Array(DocumentRef),
  errors: [error_NOT_AUTHENTICATED, error_UNKNOWN],
  reads: [table_financial_document_links, table_payment_documents],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_require_authenticated_user,
    procedure_accounts_account_id_for_auth_user_or_null,
    procedure_requests_issued_invoice_read_access,
  ],
  emits: [],
});

export const procedure_documents_load_payment_documents_for_principal = defineProcedure({
  id: "documents.load-payment-documents-for-principal",
  title: "Load a Payment's document references for an admitted principal",
  about: "As `loadPaymentDocuments`, for an execution owner the caller already admitted: no session read.",
  was: [`${SRC}/documents/reads/payments.ts:91`, `${PAY}/reads/payments.ts:253`],
  concept: concept_documents,
  input: Schema.Struct({ paymentId: S, principal: Schema.Struct({ authUserId: S, accountId: S }) }),
  output: Schema.Array(DocumentRef),
  errors: [error_UNKNOWN],
  reads: [table_financial_document_links, table_payment_documents],
  writes: [],
  drives: [],
  invokes: [procedure_requests_issued_invoice_read_access],
  emits: [],
});

export const procedure_documents_verify_payment_document_reference = defineProcedure({
  id: "documents.verify-payment-document-reference",
  title: "Verify a Payment's document reference",
  about: "The reference must still name stored content that passes integrity; anything else is `UNKNOWN` (integrity).",
  was: [`${SRC}/documents/reads/payments.ts:98`, `${PAY}/lifecycles/reads/previews.ts:77`],
  concept: concept_documents,
  input: Schema.Struct({ document: DocumentRef }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [table_payment_documents],
  writes: [],
  ...none,
});

export const procedure_documents_prepare_payment_documents_in_tx = defineProcedure({
  id: "documents.prepare-payment-documents-in-tx",
  title: "Store a birth item's instruction and Receipts",
  about:
    "Builds the item's instruction envelope for its prepared context, checks an Invoice's line items and a " +
    "Payslip's adjustments against it, and stores it and each supporting Receipt in accepted order " +
    "(`persistContentInTx`: insert, or check an existing pair byte for byte). Returns the instruction reference, " +
    "the bundle and the supporting references. A mismatch with the request is `INVALID_INPUT`; a stored pair that " +
    "differs is `UNKNOWN` (integrity).",
  was: [`${SRC}/documents/writes/contents.ts:231`, `${SRC}/documents/writes/contents.ts:53`, `${PAY}/commands/writes/documents.ts:61`],
  concept: concept_documents,
  input: Schema.Struct({ item: U, itemIndex: N, issuedAt: N, context: U }),
  output: Schema.Struct({ instruction: Schema.Struct({ documentHash: S, contentHash: S }), bundle: U, supporting: Schema.Array(DocumentRef) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_documents],
  writes: [table_payment_documents],
  ...none,
});

export const procedure_documents_link_payment_document_in_tx = defineProcedure({
  id: "documents.link-payment-document-in-tx",
  title: "Link a Payment's instruction or supporting document",
  about: "Inserts the link of one Payment document for one of its actors, unless a link with the same hashed identity exists.",
  was: [`${SRC}/documents/writes/links.ts:73`, `${SRC}/documents/writes/links.ts:20`, `${PAY}/commands/writes/documents.ts:90`],
  concept: concept_documents,
  input: Schema.Struct({
    documentHash: S,
    contentHash: S,
    actorKind: ActorKind,
    actorId: S,
    paymentId: S,
    role: Schema.Literals(["instruction", "supporting"]),
    filename: opt(S),
    createdAt: N,
  }),
  output: Schema.Void,
  errors: [],
  reads: [table_financial_document_links],
  writes: [table_financial_document_links],
  ...none,
});

const MEMO_TABLES = [
  table_financial_document_movements,
  table_payment_documents,
  table_financial_document_movement_conflicts,
  table_financial_document_links,
];

export const procedure_documents_persist_movement_memo_in_tx = defineProcedure({
  id: "documents.persist-movement-memo-in-tx",
  title: "Store a verified Transfer's Memo",
  about:
    "Plans and applies a Transfer's Memo now: a zero Transfer is ignored; a fingerprint that differs from the stored " +
    "occurrence marks it `unresolved` and records the conflict (keeping ten); otherwise stores the Memo content, " +
    "inserts or re-includes the occurrence at its new position, and links it for each actor and, when a Payment " +
    "carries it, on the Payment. A stored hash or bytes that differ is `UNKNOWN` (integrity).",
  was: [`${SRC}/documents/writes/memos.ts:219`, `${SRC}/documents/writes/memos.ts:99`, `${PAY}/movements/writes/windows.ts:66`],
  concept: concept_documents,
  input: Schema.Struct({ memo: U }),
  output: U,
  errors: [error_UNKNOWN],
  reads: MEMO_TABLES,
  writes: MEMO_TABLES,
  ...none,
});

export const procedure_documents_prepare_movement_memo_in_tx = defineProcedure({
  id: "documents.prepare-movement-memo-in-tx",
  title: "Plan a Transfer's Memo inside a scan batch",
  about:
    "As `persistMovementMemoInTx`, but returns the plan (`ready` or `conflict`) with `apply` and `reject`. `reject` " +
    "marks an existing occurrence `unresolved`, then removes the Movement projection it captured, through " +
    "payments' own door `captureMemoConflictRemovalInTx` (payments/movements/writes/corrections.ts), which this " +
    "record does not link (procedures.ts imports this file).",
  was: [`${SRC}/documents/writes/memos.ts:189`, `${SRC}/documents/writes/memos.ts:13`, `${PAY}/verifications/writes/evidence.ts:91`],
  concept: concept_documents,
  input: Schema.Struct({ memo: U }),
  output: Schema.Struct({ outcome: Schema.Literals(["ready", "conflict"]), apply: U, reject: U }),
  errors: [error_UNKNOWN],
  reads: MEMO_TABLES,
  writes: MEMO_TABLES,
  ...none,
});

export const procedure_documents_mark_movement_memo_orphaned_in_tx = defineProcedure({
  id: "documents.mark-movement-memo-orphaned-in-tx",
  title: "Orphan a Memo occurrence the chain no longer holds",
  about: "Marks the logical event's occurrence `orphaned` unless it already is; never deletes it.",
  was: [`${SRC}/documents/writes/occurrences.ts:8`, `${PAY}/verifications/writes/history.ts:191`],
  concept: concept_documents,
  input: Schema.Struct({ logicalEventId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_financial_document_movements],
  writes: [table_financial_document_movements],
  ...none,
});

export const procedure_documents_orphan_absent_movement_memos_in_tx = defineProcedure({
  id: "documents.orphan-absent-movement-memos-in-tx",
  title: "Orphan the Memos absent from a canonical scan window",
  about: "Every included occurrence of one token in the block window whose logical event the window no longer holds is orphaned.",
  was: [`${SRC}/documents/writes/occurrences.ts:21`, `${PAY}/movements/writes/windows.ts:184`],
  concept: concept_documents,
  input: Schema.Struct({ chainId: N, tokenAddress: S, fromBlock: N, toBlock: N, presentLogicalEventIds: Strings }),
  output: Schema.Void,
  errors: [],
  reads: [table_financial_document_movements],
  writes: [table_financial_document_movements],
  drives: [],
  invokes: [procedure_documents_mark_movement_memo_orphaned_in_tx],
  emits: [],
});

// ── requests ────────────────────────────────────────────────────────────────────────────────

const Birth = U;

export const procedure_requests_checkout_birth_terms_in_tx = defineProcedure({
  id: "requests.checkout-birth-terms-in-tx",
  title: "Read a checkout's birth request key and amount",
  about:
    "The request key and amount a registered payer's checkout Payment is born with: the frozen Offer purchase's, or " +
    "the Invoice or request link's (a money request is refused as not an asset request); null when the checkout " +
    "does not resolve. Payments' funding read uses it before the allowance and balance check.",
  was: [`${SRC}/requests/reads/births.ts:175`, `${PAY}/commands/reads/funding.ts:47`],
  concept: concept_requests,
  input: Schema.Struct({ checkout: U }),
  output: NullOr(Schema.Struct({ requestKey: S, amounts: Schema.Array(Schema.Struct({ asset: S, value: S })) })),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts, table_payment_requests],
  writes: [],
  ...none,
});

export const procedure_requests_offer_checkout_birth_identity = defineProcedure({
  id: "requests.offer-checkout-birth-identity",
  title: "Check a birth against its frozen Offer purchase",
  about:
    "For an `offer_checkout` birth: the checkout must exist (`INVALID_INPUT`), and the command must carry exactly its " +
    "stored facts (one quick-pay send, sender and recipient Safes, amount and the Memo bytes and hashes), else " +
    "`INVALID_INPUT`. Returns the origin, settlement id, v3 identity and issue time; undefined for another lineage. " +
    "Stored bytes that do not decode are `UNKNOWN`.",
  was: [`${SRC}/requests/reads/births.ts:116`, `${PAY}/commands/writes/items.ts:152`],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth, senderSafe: S, recipientSafe: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts],
  writes: [],
  ...none,
});

export const procedure_requests_request_memo_birth_identity = defineProcedure({
  id: "requests.request-memo-birth-identity",
  title: "Check a birth against an issued request's Memo",
  about:
    "For a `payment_request` or `invoice_checkout` birth of a request with a frozen Memo: the command must carry " +
    "exactly its terms (one quick-pay item, the request key, document, issuer recipient, amount and link token), " +
    "and a request named to a payer Party must be paid by that Party, else `INVALID_INPUT`. Returns the origin, " +
    "settlement id (the budget-derived id when recorded), v3 identity, issue time, Memo source and issuer Safe; " +
    "undefined otherwise. A frozen Memo that does not decode is `UNKNOWN`.",
  was: [`${SRC}/requests/reads/births.ts:60`, `${SRC}/requests/reads/births.ts:39`, `${PAY}/commands/writes/items.ts:141`],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth }),
  output: U,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payment_requests, table_accounts, table_orgs, table_identities],
  writes: [],
  ...none,
});

export const procedure_requests_invoice_birth_identity = defineProcedure({
  id: "requests.invoice-birth-identity",
  title: "Check a birth against its issued Invoice and fix its settlement id",
  about:
    "Only request-owned Invoice bytes select the named debtor's origin and the settlement identity. For a request " +
    "birth with an issued Invoice, the command must carry exactly its terms (one `invoice` item, document, issuer " +
    "Safe, amount, payer actor, link), else `INVALID_INPUT`; a `payment_request` birth while an earlier attempt " +
    "is still open (`invoiceAttemptInTx`) is `WRONG_STATE`. Fixes the settlement id on the request " +
    "(`invoiceSettlementId`). A birth outside a request must not reuse an issued Invoice " +
    "(`requireUnissuedInvoiceInTx`). An earlier Payment of the Invoice with another settlement is `INVALID_INPUT`. " +
    "The open-attempt check reads each earlier attempt's Payment, command and money executions directly " +
    "(`payments`, `paymentCommands`, `moneyExecutions`) and asks payments' own door `voidedByLandedVoidInTx` " +
    "(not linked: procedures.ts imports this file).",
  was: [
    `${SRC}/requests/writes/invoices.ts:176`,
    `${SRC}/requests/reads/attempts.ts:21`,
    `${SRC}/requests/reads/attempts.ts:62`,
    `${SRC}/requests/reads/attempts.ts:107`,
    `${SRC}/requests/reads/invoices.ts:32`,
    `${PAY}/commands/writes/items.ts:153`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ command: Birth, recipientSafe: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payment_requests, table_invoice_checkout_payments, table_payments, table_payment_commands, table_money_executions],
  writes: [table_payment_requests],
  ...none,
});

export const procedure_requests_record_budget_settlement_in_tx = defineProcedure({
  id: "requests.record-budget-settlement-in-tx",
  title: "Record a v4 budget birth's settlement id on its request",
  about:
    "A request paid from a v4 budget (CAP-1252) pays under the id Budgets derives: the request records it at birth " +
    "so its checkout and status match that Payment. Nothing without a budget or an obligation, for another " +
    "lineage, or when the same id is already recorded; a different recorded id is overwritten.",
  was: [`${SRC}/requests/writes/invoices.ts:230`, `${PAY}/commands/writes/items.ts:166`],
  concept: concept_requests,
  input: Schema.Struct({ birth: Schema.Struct({ lineage: U, budget: U, obligation: U }), settlementId: S }),
  output: Schema.Void,
  errors: [],
  reads: [table_payment_requests],
  writes: [table_payment_requests],
  ...none,
});

export const procedure_requests_prepare_confirmed_request_in_tx = defineProcedure({
  id: "requests.prepare-confirmed-request-in-tx",
  title: "Prepare the Payment a payer confirmed for a request",
  about:
    "Compares the payer's reviewed terms (issuer Safe, amount, instruction, no Budget for a person) with the issued " +
    "request (`INVALID_INPUT` on a mismatch), then prepares its Payment through payments' own door " +
    "`preparePaymentCommandInTx`, or replays an earlier approval (`replayRequestPaymentApprovalInTx`); neither is " +
    "linked here (procedures.ts imports this file). Patches the request to `pending_settlement` with the settled " +
    "Payment id, re-reads the stored birth command (`paymentCommands`, directly) and checks it is the request's " +
    "(`INVALID_INPUT`), and on a first approval schedules `invoice_request_transitioned` (`approval_prepared`). " +
    "An Organization payer must be a current Seat. Refuses `NOT_IMPLEMENTED` while the payment writer is disabled " +
    "(payments' `requirePaymentWriterEnabled`). It reads the request's current Payment directly (`currentRequest`), " +
    "and an Invoice's earlier attempts, their commands and money executions directly (`invoiceAttemptInTx`); the " +
    "payer's Account through Accounts' `requirePaymentAccountInTx`, and its Safe through Access's " +
    "`readScopeSafeAddressInTx`.",
  was: [
    `${SRC}/requests/writes/approvals.ts:157`,
    `${SRC}/requests/writes/approvals.ts:57`,
    `${SRC}/requests/writes/approvals.ts:141`,
    `${SRC}/requests/writes/approvals.ts:210`,
    `${SRC}/requests/reads/instructions.ts:21`,
    `${PAY}/commands/writes/requests.ts:28`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, confirmation: U }),
  output: Schema.Struct({ prepared: U, sourceCommand: U }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_NOT_IMPLEMENTED, error_UNKNOWN],
  reads: [
    table_payment_requests,
    table_accounts,
    table_orgs,
    table_invoice_checkout_payments,
    table_payments,
    table_payment_commands,
    table_money_executions,
  ],
  writes: [table_payment_requests],
  drives: [],
  invokes: [procedure_organizations_require_org_participant, procedure_accounts_require_payment_account_in_tx],
  emits: [event_invoice_request_transitioned],
});

export const procedure_requests_prepare_registered_request_in_tx = defineProcedure({
  id: "requests.prepare-registered-request-in-tx",
  title: "Prepare a registered payer's Payment for a request link",
  about:
    "Loads the request by its link (`INVALID_INPUT` when gone or not an asset request), resolves the payer's Safe, " +
    "freezes an unaddressed request's Memo for that wallet (`prepareRequestDocumentInTx`: resolves the payer, " +
    "stores the Memo through Documents' `persistPaymentDocument`, patches the request), refuses a link that is not " +
    "open and a personal payer naming a Budget, then either replays the payer's private approval (reads the Payment " +
    "and its command directly) or prepares a new `invoice_checkout` birth through payments' own door " +
    "`preparePaymentCommandInTx` (not linked: procedures.ts imports this file). Returns the public Invoice summary " +
    "and the prepared command.",
  was: [`${SRC}/requests/writes/checkouts.ts:142`, `${SRC}/requests/writes/checkouts.ts:51`, `${SRC}/requests/writes/checkouts.ts:101`, `${PAY}/commands/writes/requests.ts:70`],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: U }),
  output: Schema.Struct({ invoice: U, prepared: U }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [
    table_payment_requests,
    table_invoice_checkout_payments,
    table_payments,
    table_payment_commands,
    table_accounts,
    table_orgs,
    table_parties,
    table_payment_documents,
  ],
  writes: [table_payment_requests, table_payment_documents],
  drives: [],
  invokes: [
    procedure_parties_resolve_recipient_in_tx,
    procedure_parties_party_by_safe_address,
    procedure_accounts_require_payment_account_in_tx,
  ],
  emits: [],
});

export const procedure_requests_prepare_registered_invoice_in_tx = defineProcedure({
  id: "requests.prepare-registered-invoice-in-tx",
  title: "Prepare a registered payer's Payment for an Invoice link",
  about: "The same Payment as a request link, only for a link that names an issued Invoice (`INVALID_INPUT` otherwise).",
  was: [`${SRC}/requests/writes/checkouts.ts:187`, `${PAY}/commands/writes/requests.ts:59`],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: U }),
  output: Schema.Struct({ invoice: U, prepared: U }),
  errors: [error_INVALID_INPUT],
  reads: [table_payment_requests],
  writes: [],
  drives: [],
  invokes: [procedure_requests_prepare_registered_request_in_tx],
  emits: [],
});

export const procedure_requests_prepare_registered_purchase_in_tx = defineProcedure({
  id: "requests.prepare-registered-purchase-in-tx",
  title: "Prepare a registered payer's Payment for a frozen purchase",
  about:
    "A personal payer naming a Budget, a missing checkout or Offer, and a checkout already registered to another " +
    "Payment are `INVALID_INPUT`. Prepares one quick-pay `offer_checkout` birth to the Offer's owner with the " +
    "frozen Memo bytes through payments' own door `preparePaymentCommandInTx` (not linked: procedures.ts imports " +
    "this file), then records the Payment on the checkout (`registeredPaymentId`). A stored snapshot that does not " +
    "decode is `UNKNOWN`.",
  was: [`${SRC}/requests/writes/purchases.ts:222`, `${SRC}/requests/writes/purchases.ts:205`, `${PAY}/commands/writes/requests.ts:48`],
  concept: concept_requests,
  input: Schema.Struct({ authUserId: S, input: U }),
  output: Schema.Struct({ checkout: U, prepared: U }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_offer_checkouts, table_fixed_offers, table_accounts],
  writes: [table_offer_checkouts],
  ...none,
});

export const procedure_requests_schedule_request_paid_notice_in_tx = defineProcedure({
  id: "requests.schedule-request-paid-notice-in-tx",
  title: "Schedule a request's paid notice",
  about:
    "As a Payment settles: when it pays a request (`requestFingerprint`), schedules Requests' internal action " +
    "`requests.receivables.notify` with `paid`; the notice reads the request's state, so only a paid Invoice is " +
    "announced. Writes no table itself.",
  was: [`${SRC}/requests/writes/notices.ts:48`, `${SRC}/requests/writes/notices.ts:29`, `${PAY}/verifications/writes/claims.ts:89`, `${PAY}/writes/settlements.ts:14`],
  concept: concept_requests,
  input: Schema.Struct({ payment: Schema.Struct({ requestFingerprint: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  ...none,
});

export const procedure_requests_record_registered_receipt_in_tx = defineProcedure({
  id: "requests.record-registered-receipt-in-tx",
  title: "Project a verified Payment's receipt onto its link or purchase",
  about:
    "A verified registered Payment projects its first receipt onto the request link it paid " +
    "(`recordRegisteredRequestReceiptInTx`) and, for a `send`, onto the Offer checkout it funded, unless a different " +
    "receipt is already there. Each recorded receipt projects its Movement's Memo: it names the Movement's actors " +
    "through payments' own `actorInventory` and `desiredAttributions` (not linked: procedures.ts imports this " +
    "file), plans and applies the Memo through Documents' `prepareMovementMemoInTx`, links the instruction through " +
    "Documents' `linkMovementDocumentInTx`, and on a proved reorg correction patches the old occurrence " +
    "`orphaned` in `financialDocumentMovements` directly (`orphanOldMovement`). A purchase receipt's funding check " +
    "reads the registered Payment's command directly. A changed or unproved receipt is `INVALID_INPUT`; a broken " +
    "stored row `UNKNOWN`.",
  was: [
    `${SRC}/requests/writes/purchase-receipts.ts:126`,
    `${SRC}/requests/writes/receipts.ts:231`,
    `${SRC}/requests/writes/purchase-receipts.ts:78`,
    `${SRC}/requests/writes/purchase-receipts.ts:49`,
    `${SRC}/requests/writes/receipts.ts:117`,
    `${SRC}/requests/writes/receipts.ts:152`,
    `${PAY}/verifications/writes/evidence.ts:115`,
  ],
  concept: concept_requests,
  input: Schema.Struct({ paymentId: S, evidence: U }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [
    table_invoice_checkout_payments,
    table_payments,
    table_payment_commands,
    table_payment_requests,
    table_offer_checkouts,
    table_financial_document_movements,
  ],
  writes: [table_payment_requests, table_offer_checkouts, table_financial_document_movements, table_financial_document_links],
  drives: [],
  invokes: [procedure_documents_prepare_movement_memo_in_tx],
  emits: [],
});

// ── banking ─────────────────────────────────────────────────────────────────────────────────

const PayoutBinding = Schema.Struct({
  quoteId: S,
  railOperationId: S,
  paymentId: S,
  commandId: S,
  partyAccountId: S,
  actorKind: ActorKind,
  actorId: S,
  funding: Schema.Struct({ asset: S, value: S }),
  recipient: Schema.UndefinedOr(S),
});

const PAYOUT_DOOR =
  "Through the payout door (`applyPayoutEventInTx`): the money rules decide the move; a move patches the payout, " +
  "schedules its Bridge dispatcher and live timer, and adds its log line, its `payout_transitioned` event and the " +
  "payer's notice; a refusal adds one line. An event for no payout adds an `unknown_payout` line. After a move it " +
  "links Bridge's refund Movement (reads `movements` directly). Because the source is `payments`, the door does " +
  "not call the Payment's writer back. A money-rule break or a vanished row is `UNKNOWN`.";

export const procedure_banking_read_payout_delivery_in_tx = defineProcedure({
  id: "banking.read-payout-delivery-in-tx",
  title: "Read a payout's delivery leg",
  about:
    "What the Payment's writer and view read from the payout a Payment names (CAP-741): the leg's state and stage, " +
    "its failure reason, a needs-attention reason, the delivered bank amount and the refund Movement; null when the " +
    "payout is not stored (a stored-row defect each caller handles).",
  was: [`${SRC}/banking/payouts/reads.ts:128`, `${SRC}/banking/payouts/reads.ts:104`, `${PAY}/views/payments.ts:238`, `${PAY}/writes/rails.ts:2`],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S }),
  output: NullOr(U),
  errors: [],
  reads: [table_payouts],
  writes: [],
  ...none,
});

export const procedure_banking_read_payout_deadline_in_tx = defineProcedure({
  id: "banking.read-payout-deadline-in-tx",
  title: "Read an unsent payout's deadline",
  about:
    "At each authorization boundary an unsent payout needs a live quote and provider transfer. A missing payout is " +
    "`UNKNOWN` (stored row broken); a payout bound to another quote, Payment, command, account or payer is " +
    "`INVALID_INPUT`; an expired quote or transfer, or a failed or refunded delivery, is `WRONG_STATE`. Returns the " +
    "quote's deadline in backend time. Payments' payout guard reads it.",
  was: [`${SRC}/banking/payouts/reads.ts:148`, `${PAY}/guards/payouts.ts:50`],
  concept: concept_banking,
  input: Schema.Struct({ binding: PayoutBinding, now: N }),
  output: N,
  errors: [error_UNKNOWN, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_payouts],
  writes: [],
  ...none,
});

export const procedure_banking_read_payout_quote_for_payment_in_tx = defineProcedure({
  id: "banking.read-payout-quote-for-payment-in-tx",
  title: "Read the payout quote a Payment pays",
  about:
    "The stored quote checked against the Payment: same payer, bank account and funding asset and exact funding " +
    "amount, and a transfer that has not failed (`INVALID_INPUT` otherwise); an expired quote or a bank account " +
    "that changed is `WRONG_STATE` (stale quote). Reads the bank account through Parties' `readPayoutAccountInTx` " +
    "(`INVALID_INPUT` when unavailable), whose `bankAccountView` reads the owner Party (`partyById`) and the " +
    "contact edge between declarer and owner. A stored quote that does not decode is `UNKNOWN`. Returns the " +
    "binding terms, recipient label, funding address and deadline.",
  was: [
    `${SRC}/banking/payouts/reads/quotes.ts:19`,
    `${SRC}/parties/accounts/reads.ts:58`,
    `${SRC}/parties/accounts/views.ts:10`,
    `${SRC}/banking/payouts/reads.ts:72`,
    `${PAY}/commands/writes/organizations.ts:151`,
    `${PAY}/commands/writes/personal.ts:8`,
  ],
  concept: concept_banking,
  input: Schema.Struct({ actor: U, quoteId: S, partyAccountId: S, amount: Schema.Struct({ asset: S, value: S }), now: N }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payouts, table_party_accounts, table_parties, table_party_edges],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_id],
  emits: [],
});

const PAYOUT_DOOR_READS = [table_payouts, table_movements];
const PAYOUT_DOOR_WRITES = [table_payouts, table_payout_transitions];

export const procedure_banking_bind_payout_payment_in_tx = defineProcedure({
  id: "banking.bind-payout-payment-in-tx",
  title: "Bind a payout to the Payment born for it",
  about:
    "The payout keeps the Payment and its links (`payment_bound`). A payout bound to another Payment, command or " +
    "settlement, or a settlement that already has a payout, is `INVALID_INPUT`; a bind the door refuses after the " +
    "quote's deadline is `WRONG_STATE` (stale quote), any other refusal `WRONG_STATE` (`payoutSendRefused`), so the " +
    "Payment's save fails. " +
    PAYOUT_DOOR,
  was: [`${SRC}/banking/payouts/writes/payments.ts:25`, `${SRC}/banking/payouts/writes/door.ts:223`, `${PAY}/commands/writes/payouts.ts:76`],
  concept: concept_banking,
  input: Schema.Struct({ quoteId: S, railOperationId: S, settlementId: S, paymentId: S, commandId: S, now: N }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: PAYOUT_DOOR_READS,
  writes: PAYOUT_DOOR_WRITES,
  drives: [],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_accept_payout_quote_in_tx = defineProcedure({
  id: "banking.accept-payout-quote-in-tx",
  title: "Accept a payout quote as the signed send is claimed",
  about:
    "Checks the deadline, then tells the payout what the Payment sends and where (`send_claimed`, money rule M1). A " +
    "send that is not the deal's is `UNKNOWN` (`payoutSendMismatch`); a payout that can take no send is " +
    "`WRONG_STATE`; either fails the claim, so nothing is sent. A claim taken again finds the payout already " +
    "holding this Payment's send and passes. " +
    PAYOUT_DOOR,
  was: [`${SRC}/banking/payouts/writes/payments.ts:78`, `${SRC}/banking/payouts/writes/door.ts:223`, `${PAY}/executions/writes/claims.ts:182`],
  concept: concept_banking,
  input: Schema.Struct({ binding: PayoutBinding, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN, error_INVALID_INPUT, error_WRONG_STATE],
  reads: PAYOUT_DOOR_READS,
  writes: PAYOUT_DOOR_WRITES,
  drives: [],
  invokes: [procedure_banking_read_payout_deadline_in_tx],
  emits: [event_payout_transitioned],
});

export const procedure_banking_payout_funding_verified_in_tx = defineProcedure({
  id: "banking.payout-funding-verified-in-tx",
  title: "Tell a payout its Payment's funding was verified",
  about: "Payments verified the bound Payment's funding on chain (`funding_verified`): the payout can apply Bridge's news. " + PAYOUT_DOOR,
  was: [`${SRC}/banking/payouts/writes/payments.ts:113`, `${SRC}/banking/payouts/writes/door.ts:223`, `${PAY}/verifications/writes/sends.ts:214`],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S, paymentId: S, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: PAYOUT_DOOR_READS,
  writes: PAYOUT_DOOR_WRITES,
  drives: [],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_payout_send_failed_in_tx = defineProcedure({
  id: "banking.payout-send-failed-in-tx",
  title: "Tell a payout its Payment's send did not land",
  about: "The bound Payment's send failed and did not land (`send_not_landed`): the payout cancels its transfer at Bridge. " + PAYOUT_DOOR,
  was: [`${SRC}/banking/payouts/writes/payments.ts:132`, `${SRC}/banking/payouts/writes/door.ts:223`, `${PAY}/writes/outcomes.ts:108`],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: PAYOUT_DOOR_READS,
  writes: PAYOUT_DOOR_WRITES,
  drives: [],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_classify_payout_refund_in_tx = defineProcedure({
  id: "banking.classify-payout-refund-in-tx",
  title: "Classify a Movement as a payout refund",
  about:
    "A return from a known Bridge deposit address is a refund even before its provider reference arrives: true when " +
    "a bound payout's route matches the Movement. When Bridge named this exact refund transaction, the payout keeps " +
    "the Movement (`refundMovementId`). A vanished row is `UNKNOWN`. Payments' Movement window writer calls it.",
  was: [`${SRC}/banking/payouts/writes/refunds.ts:43`, `${PAY}/movements/writes/windows.ts:61`],
  concept: concept_banking,
  input: Schema.Struct({ movement: U, now: N }),
  output: B,
  errors: [error_UNKNOWN],
  reads: [table_payouts],
  writes: [table_payouts],
  ...none,
});

// ── payroll ─────────────────────────────────────────────────────────────────────────────────

export const procedure_payroll_read_department_spend_in_tx = defineProcedure({
  id: "payroll.read-department-spend-in-tx",
  title: "Read what a department payment spends",
  about:
    "An active v4 department's top budget in Budgets, for a holder, in the department's token (CAP-1165); or why " +
    "not: `not_found`, `not_holder`, `not_active`, `budget_unknown` or `asset_mismatch`. A refusal is a value, not " +
    "an error. Payments' budget guard rides it on its v4 budget route.",
  was: [`${SRC}/payroll/departments/reads/spend.ts:28`, `${SRC}/payroll/departments/reads.ts:30`, `${PAY}/guards/budgets.ts:44`],
  concept: concept_payroll,
  input: Schema.Struct({ orgId: S, departmentId: S, holderSafe: S, tokenAddress: S }),
  output: Schema.Union([
    Schema.Struct({ ok: Schema.Literals([true]), budgetId: S, name: S }),
    Schema.Struct({ ok: Schema.Literals([false]), refusal: Schema.Literals(["not_found", "not_holder", "not_active", "budget_unknown", "asset_mismatch"]) }),
  ]),
  errors: [],
  reads: [table_payroll_departments],
  writes: [],
  ...none,
});

export const procedure_payroll_advance_runs_to_authorized = defineProcedure({
  id: "payroll.advance-runs-to-authorized",
  title: "Advance submitted payroll runs to authorized",
  about:
    "The submit flip, from the one submission choke point: every named run still `draft` becomes `authorized`, and " +
    "each schedules `payroll_run_transitioned` (`scheduleRunTransitionInTx`, which reads the run's batch facts " +
    "through payments' own door `readOrganizationPaymentBatchFactsInTx`, not linked, and reports nothing for a run " +
    "with no `batchRef` or no batch facts). A replay finds the run authorized and writes nothing.",
  was: [`${SRC}/payroll/runs/writes/progression.ts:24`, `${SRC}/payroll/runs/events.ts:54`, `${PAY}/verifications/writes/submissions.ts:131`],
  concept: concept_payroll,
  input: Schema.Struct({ payrollRunIds: Schema.Array(Schema.UndefinedOr(S)) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  drives: [],
  invokes: [],
  emits: [event_payroll_run_transitioned],
});

export const procedure_payroll_settle_run_for_settled_payment = defineProcedure({
  id: "payroll.settle-run-for-settled-payment",
  title: "Settle a payroll run when its last Payment settles",
  about:
    "The settle flip, once per settled Payment: a run not yet settled whose own command (`batchRef`) has every " +
    "Payment settled, asked through payments' own door `isPayrollBatchSettledInTx` (not linked), becomes `settled` " +
    "with `settledAt`, schedules `payroll_run_transitioned` and the run's notice (internal action " +
    "`payroll.runs.notify`). A replay finds the run settled and writes nothing.",
  was: [`${SRC}/payroll/runs/writes/progression.ts:51`, `${SRC}/payroll/runs/writes/notices.ts:18`, `${PAY}/writes/settlements.ts:13`, `${PAY}/verifications/writes/claims.ts:88`],
  concept: concept_payroll,
  input: Schema.Struct({ payment: Schema.Struct({ payrollRunId: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  drives: [],
  invokes: [],
  emits: [event_payroll_run_transitioned],
});

export const procedure_payroll_return_run_to_authorized = defineProcedure({
  id: "payroll.return-run-to-authorized",
  title: "Return a settled payroll run to authorized",
  about:
    "The un-settle flip (P04): a settled run whose Payment lost its indexed fact goes back to `authorized` and " +
    "`settledAt` is cleared. No transition event: the Payment correction reports itself.",
  was: [`${SRC}/payroll/runs/writes/progression.ts:72`, `${PAY}/verifications/writes/history.ts:228`],
  concept: concept_payroll,
  input: Schema.Struct({ payment: Schema.Struct({ payrollRunId: opt(S) }) }),
  output: Schema.Void,
  errors: [],
  reads: [table_payroll_runs],
  writes: [table_payroll_runs],
  ...none,
});

// ── permissions ─────────────────────────────────────────────────────────────────────────────

const ExecutionOutcome = Schema.Literals(["pending", "applied", "mismatch"]);

const COMMAND_AUTHORITY_READS = [
  table_accounts,
  table_smart_accounts,
  table_orgs,
  table_org_lifecycles,
  table_permissions,
  table_permission_assignments,
  table_permission_receipts,
];

const COMMAND_AUTHORITY =
  "`requireCommandAuthority`: the caller's exact Account and Safe (`requireExactAccountIdentityInTx`), the " +
  "Base Sepolia Organization, a usable bootstrap, and an active Manage people Permission the caller is assigned " +
  "whose revision and assignment a verified receipt proves.";

export const procedure_permissions_read_budget_allowance_in_tx = defineProcedure({
  id: "permissions.read-budget-allowance-in-tx",
  title: "Read the allowance a capped Budget spends from",
  about:
    "For the prepare action to read on chain before it builds (#2297): the one active spendable Budget's Roles " +
    "module, allowance key, asset and decimals; null for an unlimited Budget (ADR-0024 R5) or when the Organization " +
    "has no such Budget. Payments' funding and schedule reads call it.",
  was: [`${SRC}/permissions/guards/spending.ts:230`, `${SRC}/permissions/guards/spending.ts:238`, `${PAY}/commands/reads/funding.ts:11`, `${PAY}/schedules/reads.ts:72`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, permissionId: S }),
  output: NullOr(Schema.Struct({ rolesModule: S, allowanceKey: S, assetId: S, decimals: N })),
  errors: [],
  reads: [table_permissions],
  writes: [],
  ...none,
});

export const procedure_permissions_require_organization_spend_authority_in_tx = defineProcedure({
  id: "permissions.require-organization-spend-authority-in-tx",
  title: "Require Budget authority for an Organization payment",
  about:
    "The bootstrap must be usable and the caller's Account assigned to the one active spendable Budget " +
    "(`ROLE_PERMISSION_DENIED`, membership); its token must be the payment's and a stored cap not exceeded " +
    "(`ROLE_PERMISSION_DENIED`, condition or cap). A stored cap that is not an integer is `UNKNOWN`. Returns the " +
    "Permission's Safe, Roles module and role key and the assignment. Payments' authority guard calls it (as " +
    "`requirePermissionSpendAuthority`).",
  was: [`${SRC}/permissions/guards/spending.ts:142`, `${SRC}/permissions/guards/spending.ts:169`, `${PAY}/guards/authority.ts:33`],
  concept: concept_permissions,
  input: Schema.Struct({ account: U, orgId: S, permissionId: S, tokenAddress: S, requiredRawAmount: Schema.BigInt }),
  output: Schema.Struct({
    permission: Schema.Struct({ permissionId: S, organizationSafe: S, rolesModule: S, roleKey: S }),
    assignment: Schema.Struct({ permissionAssignmentId: S }),
  }),
  errors: [error_ROLE_PERMISSION_DENIED, error_UNKNOWN],
  reads: [table_org_lifecycles, table_permissions, table_permission_assignments],
  writes: [],
  ...none,
});

export const procedure_permissions_read_worn_allowances_in_tx = defineProcedure({
  id: "permissions.read-worn-allowances-in-tx",
  title: "Read the allowances whose hat a Safe wears",
  about:
    "The Organization's on-chain allowances (active, or pending whose create proposal executed) whose hat the Safe " +
    "wears now: its holder at create, then each applied command and each pending one whose proposal executed, in " +
    "order. Proposals are read through Organizations' `readSubjectProposalInTx`. Payments' budget guard reads it.",
  was: [`${SRC}/permissions/allowances/reads/worn.ts:70`, `${SRC}/organizations/proposals/writes.ts:196`, `${PAY}/guards/budgets.ts:54`],
  concept: concept_permissions,
  input: Schema.Struct({ orgId: S, safe: S }),
  output: Schema.Array(U),
  errors: [],
  reads: [table_permission_allowances, table_permission_allowance_commands, table_org_safe_proposals],
  writes: [],
  ...none,
});

export const procedure_permissions_find_command_authority = defineProcedure({
  id: "permissions.find-command-authority",
  title: "Find the caller's Manage people authority, or null",
  about:
    COMMAND_AUTHORITY +
    " A refusal (`SMART_ACCOUNT_MISSING`, `ACCOUNT_NOT_FOUND`, `INVALID_INPUT`, `ROLE_PERMISSION_DENIED`) is absorbed " +
    "as null; a broken identity invariant (`UNKNOWN`) propagates. Payments' Director guard uses it to decide whether " +
    "a cancel or redirect runs through the Director role.",
  was: [`${SRC}/permissions/guards/managers.ts:165`, `${SRC}/permissions/guards/managers.ts:57`, `${SRC}/accounts/reads/identity.ts:48`, `${PAY}/guards/owners.ts:36`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, orgId: S }),
  output: NullOr(U),
  errors: [error_UNKNOWN],
  reads: COMMAND_AUTHORITY_READS,
  writes: [],
  ...none,
});

export const procedure_permissions_authorize_permission_execution_in_tx = defineProcedure({
  id: "permissions.authorize-permission-execution-in-tx",
  title: "Authorize claiming a Permission command's execution",
  about:
    "The Permission command must exist and be sent from the caller's own Safe (`INVALID_INPUT`), the caller must hold " +
    "current authority (" +
    COMMAND_AUTHORITY +
    ") whose Safe is still the command's sender (`INVALID_INPUT`), and the command must be `pending` or " +
    "`provider_failure` (`WRONG_STATE`); an `applied` command passes. Payments' execution claim calls it.",
  was: [`${SRC}/permissions/commands/guards.ts:7`, `${SRC}/permissions/reads/commands.ts:208`, `${PAY}/executions/writes/claims.ts:105`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, commandId: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_UNKNOWN],
  reads: [table_permission_commands, ...COMMAND_AUTHORITY_READS],
  writes: [],
  ...none,
});

export const procedure_permissions_authorize_invitation_configuration_execution_in_tx = defineProcedure({
  id: "permissions.authorize-invitation-configuration-execution-in-tx",
  title: "Authorize claiming an invitation configure command's execution",
  about:
    "The one rule for an authorizing configure command (N2): the invitation configure command must exist " +
    "(`INVALID_INPUT`), its offer must be the caller's authorizing one (`INVALID_INPUT`, or `WRONG_STATE` when no " +
    "longer authorizing), the caller must hold current authority (" +
    COMMAND_AUTHORITY +
    "), and the command must be `pending` or `provider_failure` (`WRONG_STATE`). Payments' execution claim calls it.",
  was: [`${SRC}/permissions/configurations/guards.ts:25`, `${SRC}/permissions/configurations/guards.ts:73`, `${SRC}/organizations/invitations/reads/offers.ts:96`, `${PAY}/executions/writes/claims.ts:104`],
  concept: concept_permissions,
  input: Schema.Struct({ authUserId: S, commandId: S }),
  output: U,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_ACCOUNT_NOT_FOUND, error_UNKNOWN],
  reads: [table_permission_commands, table_org_invitations, ...COMMAND_AUTHORITY_READS],
  writes: [],
  ...none,
});

export const procedure_permissions_read_permission_execution_proof_in_tx = defineProcedure({
  id: "permissions.read-permission-execution-proof-in-tx",
  title: "Read a Permission or invitation execution's proof",
  about:
    "The command an execution names and its receipts: the execution's outcome (`pending`, `applied` or " +
    "`mismatch`) and, when decided, the receipt that proves it. A command that is missing, originated by another " +
    "person, of the wrong kind or purpose, or sent from another Safe than stored is `UNKNOWN` (stored row broken; " +
    "the refusal names payments' `moneyExecutions` table). An invitation configure command reads its saved " +
    "`configurationVerificationJson` instead of receipts. Payments' acceptance writer reads it.",
  was: [`${SRC}/permissions/reads/approvals.ts:104`, `${SRC}/permissions/reads/approvals.ts:117`, `${PAY}/executions/writes/acceptances.ts:226`],
  concept: concept_permissions,
  input: Schema.Struct({ execution: U }),
  output: Schema.Struct({
    outcome: ExecutionOutcome,
    receipt: opt(Schema.Struct({ userOpHash: S, transactionHash: S, succeeded: B })),
  }),
  errors: [error_UNKNOWN],
  reads: [table_permission_commands, table_permission_receipts],
  writes: [],
  ...none,
});

export const procedure_permissions_read_permission_execution_outcome_in_tx = defineProcedure({
  id: "permissions.read-permission-execution-outcome-in-tx",
  title: "Read a Permission or invitation execution's outcome",
  about: "The `outcome` of `readPermissionExecutionProofInTx`. Payments' execution reads call it.",
  was: [`${SRC}/permissions/reads/approvals.ts:195`, `${PAY}/executions/reads/executions.ts:185`],
  concept: concept_permissions,
  input: Schema.Struct({ execution: U }),
  output: ExecutionOutcome,
  errors: [error_UNKNOWN],
  reads: [table_permission_commands, table_permission_receipts],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_read_permission_execution_proof_in_tx],
  emits: [],
});
