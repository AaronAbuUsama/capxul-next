// The as-is book of the old payments concept: the commands area.
//
// Every operation registered at `payments/commands:*` (packages/backend/convex/payments/commands.ts),
// as the old code does it. Five are public prepare actions that implement a protocol row of
// `commands` (packages/protocol/src/payments/operations.ts:150); the other fourteen are internal
// queries and mutations an action runs through `ctx.runQuery` / `ctx.runMutation` in the same
// call. Nothing here is scheduled, cron-driven or triggered after another call, so every one is an
// rpc and none is a workflow.
//
// How touches are booked:
// - An internal rpc lists what its own transaction does through payments code. A neighbour's
//   function it calls is an invoke of that neighbour's procedure; a neighbour table the payments
//   code queries or inserts into by itself is a read or write of that table (a boundary finding).
// - A public action holds no transaction of its own. It lists what the internal rpcs it runs touch
//   on the paths that action can take (a personal prepare never reaches the Organization, Budget or
//   Directors' routes), so the endpoint shows everything one call does. The payments.executions
//   rpcs it runs (loadActive, loadLaneHolders, load, store, classify, complete) are booked in
//   executions.ts; only their tables, transitions and chain calls are folded in here, not their
//   invokes.
// - Requests' writers call back into payments' own door, `preparePaymentCommandInTx`. neighbors.ts
//   names that call-back only in prose, so the rpcs whose birth rides a Requests writer invoke
//   procedure_payments_prepare_payment_command_in_tx (procedures.ts) as well; that procedure
//   carries the birth's tables and transitions.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_payments } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payment_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_money_execution,
  machine_payment,
  machine_payment_command,
  machine_payment_command_verification,
  table_money_executions,
  table_payment_commands,
  table_payment_document_intents,
  table_payment_schedules,
  table_payments,
  table_provider_send_attempts,
} from "./data.ts";
import {
  procedure_access_require_feature,
  procedure_accounts_find_account_recipient_in_tx,
  procedure_accounts_require_account_signer_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_accounts_resolve_account_recipient_safe_in_tx,
  procedure_banking_bind_payout_payment_in_tx,
  procedure_banking_payout_send_failed_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_banking_read_payout_quote_for_payment_in_tx,
  procedure_books_book_asset_by_id_in_tx,
  procedure_books_classify_row,
  procedure_books_manages_books_in_tx,
  procedure_books_read_row_account_in_tx,
  procedure_documents_admit_payment_document_pair_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_link_payment_document_in_tx,
  procedure_documents_load_payment_documents,
  procedure_documents_prepare_payment_documents_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_parties_ensure_ledger_party,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_record_contact_edges,
  procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
  procedure_parties_resolve_payment_recipient_in_tx,
  procedure_payroll_read_department_spend_in_tx,
  procedure_permissions_find_command_authority,
  procedure_permissions_read_budget_allowance_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_requests_checkout_birth_terms_in_tx,
  procedure_requests_invoice_birth_identity,
  procedure_requests_offer_checkout_birth_identity,
  procedure_requests_prepare_confirmed_request_in_tx,
  procedure_requests_prepare_registered_invoice_in_tx,
  procedure_requests_prepare_registered_purchase_in_tx,
  procedure_requests_prepare_registered_request_in_tx,
  procedure_requests_record_budget_settlement_in_tx,
  procedure_requests_request_memo_birth_identity,
  table_accounts,
  table_counterparty_destinations,
  table_identities,
  table_invoice_checkout_payments,
  table_orgs,
  table_payment_requests,
} from "./neighbors.ts";
import {
  contract_budgets,
  contract_entry_point,
  contract_erc20,
  contract_roles,
  integration_chain_rpc,
} from "../shared/external.ts";
import { procedure_payments_prepare_payment_command_in_tx } from "./procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payments/commands.ts`;
const SRC = `${BACKEND}/src/payments`;
const CMD = `${SRC}/commands`;
const OPS = `${CMD}/operations`;
const EXE = `${SRC}/executions`;
const ROWS = "packages/protocol/src/payments/operations.ts";

/** Keep each link once, in first-seen order. An undefined link is kept, so the build reports it. */
const union = <const L extends ReadonlyArray<ReadonlyArray<{ readonly id: string }>>>(
  ...lists: L
): Array<L[number][number]> => {
  const seen = new Set<string>();
  const out: Array<L[number][number]> = [];
  for (const list of lists)
    for (const item of list) {
      if (item === undefined) {
        out.push(item);
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};

/** Keep each span name once, in first-seen order. */
const spanUnion = (...lists: ReadonlyArray<ReadonlyArray<string>>): string[] => [...new Set(lists.flat())];

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** A code no `attempt` list admits becomes a defect: UNKNOWN on the wire. */
const DEFECT = [error_UNKNOWN];

/** `attempt([...])` around the command guard writers (claim, fail, link). */
const COMMAND_GUARD_ERRORS = [
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_ACCOUNT_NOT_FOUND,
  ...DEFECT,
];

/** `INTENT_FAILURES` (commands/writes/transactions.ts:26). */
const INTENT_ERRORS = [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_NOT_IMPLEMENTED];

/** The six codes every prepare intent mutation's `attempt` admits, plus a defect. */
const PREPARE_INTENT_ERRORS = [
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_ACCOUNT_NOT_FOUND,
  error_WRONG_STATE,
  error_NOT_IMPLEMENTED,
  ...DEFECT,
];

/** `PREPARE` (operations.ts:79): CALL, DEFECTS, DENIED, STATE, CHAIN, ANSWER, FUNDING, DISABLED. */
const PREPARE_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_INSUFFICIENT_BALANCE,
  error_NOT_IMPLEMENTED,
];

/** `PREPARE_SEND` (operations.ts:91): PREPARE plus the `books` gate. */
const PREPARE_SEND_ROW_ERRORS = [...PREPARE_ROW_ERRORS, error_FEATURE_NOT_AVAILABLE];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/**
 * `authorizePaymentCommandSubmissionInTx` (guards/authority.ts:172): the caller's Account, then the
 * branch the stored command's intent names (account, void, owner lifecycle, owners birth, budget,
 * Roles permission). Each branch reads through its neighbour.
 */
const AUTHORIZE = {
  reads: [table_payment_commands, table_payments, table_money_executions, table_payment_schedules],
  invokes: [
    procedure_accounts_require_payment_account_in_tx,
    procedure_permissions_require_organization_spend_authority_in_tx,
    procedure_permissions_find_command_authority,
    procedure_permissions_read_worn_allowances_in_tx,
    procedure_payroll_read_department_spend_in_tx,
    procedure_organizations_read_organization_safe_in_tx,
    procedure_organizations_read_owner_safes_in_tx,
  ],
};
const AUTHORIZE_WAS = [
  `${SRC}/guards/authority.ts:172`,
  `${SRC}/guards/authority.ts:178`,
  `${SRC}/guards/authority.ts:139`,
  `${SRC}/guards/budgets.ts:44`,
  `${SRC}/guards/budgets.ts:54`,
  `${SRC}/guards/budgets.ts:79`,
  `${SRC}/guards/owner-approvals.ts:31`,
  `${SRC}/guards/owner-approvals.ts:32`,
  `${SRC}/guards/owners.ts:36`,
  `${SRC}/guards/voids.ts:41`,
  `${SRC}/guards/voids.ts:46`,
];

/**
 * The same guard on the paths a payment prepare can store: an Account command (`authorizeAccountSubmission`,
 * no neighbour read beyond the caller's Account), a Roles route under a Permission, or a v4 budget route.
 * The void, Directors' and owner-lifecycle branches are never reached from these prepares.
 */
const AUTH_ACCOUNT = { reads: [table_payment_commands], invokes: [procedure_accounts_require_payment_account_in_tx] };

/**
 * `resolveExecutionRoute` (guards/authority.ts:97) for an Organization: a Roles route under a
 * Permission (authority.ts:139) or a v4 budget route (guards/budgets.ts:68: a department's spend or
 * the caller's worn allowance, then the Organization Safe). An Account's direct route reads nothing.
 */
const ORG_ROUTE_INVOKES = [
  procedure_permissions_require_organization_spend_authority_in_tx,
  procedure_permissions_read_worn_allowances_in_tx,
  procedure_payroll_read_department_spend_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
];

/** The Directors' route (guards/owner-approvals.ts:44, :31, :32): the Safe's owners as last read. */
const OWNERS_ROUTE_INVOKES = [
  procedure_organizations_read_owner_safes_in_tx,
  procedure_organizations_read_organization_safe_in_tx,
];

const AUTH_SPEND = {
  reads: [table_payment_commands, table_payments],
  invokes: [procedure_accounts_require_payment_account_in_tx, ...ORG_ROUTE_INVOKES],
};

/**
 * The one writer of a birth command, `preparePaymentCommandInTx` (commands/writes/commands.ts:82),
 * with its items (writes/items.ts:233) and the ledger birth (payments/writes/births.ts:114): replay
 * of a settled or identical birth, the route, the intent reservation, each Payment born with its
 * documents, payout binding and party edges, then the command row. Every birth booked here is of
 * `send` items, born `pending`. The route invokes depend on the caller, so they are added below.
 */
const BIRTH_CORE = {
  reads: [
    table_payment_commands,
    table_payment_document_intents,
    table_payments,
    table_money_executions,
    table_orgs,
  ],
  writes: [table_payment_commands, table_payment_document_intents, table_payments],
  drives: [
    machine_payment_command.t.to_prepared,
    machine_payment_command_verification.t.to_not_started,
    machine_payment.t.to_pending,
  ],
  invokes: [
    procedure_accounts_require_payment_account_in_tx,
    procedure_accounts_resolve_account_recipient_safe_in_tx,
    procedure_parties_resolve_owned_payment_wallet_safe_in_tx,
    procedure_requests_request_memo_birth_identity,
    procedure_requests_offer_checkout_birth_identity,
    procedure_requests_invoice_birth_identity,
    procedure_requests_record_budget_settlement_in_tx,
    procedure_banking_read_payout_quote_for_payment_in_tx,
    procedure_banking_bind_payout_payment_in_tx,
    procedure_documents_prepare_payment_documents_in_tx,
    procedure_documents_link_payment_document_in_tx,
    procedure_documents_admit_payment_document_pair_in_tx,
    procedure_parties_ensure_ledger_party,
    procedure_parties_record_contact_edges,
  ],
};

/** A personal birth: the direct route, and no lineage, so no Requests row is read or written. */
const PERSONAL_BIRTH = BIRTH_CORE;

/**
 * An Organization batch under a Permission. The input's `lineage` (any PaymentCommandLineage) rides
 * the command, so a `payment_request` or `invoice_checkout` lineage reads Requests' `paymentRequests`
 * (births.ts:45, :78) and inserts its `invoiceCheckoutPayments` row (items.ts:210).
 */
const ORG_BIRTH = {
  reads: [...BIRTH_CORE.reads, table_payment_requests],
  writes: [...BIRTH_CORE.writes, table_invoice_checkout_payments],
  drives: BIRTH_CORE.drives,
  invokes: [...BIRTH_CORE.invokes, ...ORG_ROUTE_INVOKES],
};

/** The Directors' dated birth (`approval: owners`): their route, no lineage. */
const OWNERS_BIRTH = { ...BIRTH_CORE, invokes: [...BIRTH_CORE.invokes, ...OWNERS_ROUTE_INVOKES] };
const BIRTH_WAS = [
  `${CMD}/writes/commands.ts:82`,
  `${CMD}/writes/commands.ts:104`,
  `${CMD}/writes/commands.ts:117`,
  `${CMD}/writes/commands.ts:130`,
  `${CMD}/writes/commands.ts:146`,
  `${CMD}/writes/commands.ts:154`,
  `${CMD}/writes/commands.ts:164`,
  `${CMD}/writes/commands.ts:223`,
  `${CMD}/writes/commands.ts:240`,
  `${CMD}/writes/commands.ts:249`,
  `${CMD}/writes/replays.ts:23`,
  `${CMD}/writes/replays.ts:48`,
  `${CMD}/writes/replays.ts:127`,
  `${CMD}/writes/intents.ts:27`,
  `${CMD}/writes/intents.ts:41`,
  `${CMD}/reads/authorities.ts:36`,
  `${CMD}/reads/recipients.ts:12`,
  `${CMD}/reads/recipients.ts:24`,
  `${CMD}/writes/items.ts:141`,
  `${CMD}/writes/items.ts:142`,
  `${CMD}/writes/items.ts:152`,
  `${CMD}/writes/items.ts:166`,
  `${CMD}/writes/items.ts:173`,
  `${CMD}/writes/items.ts:210`,
  `${CMD}/writes/items.ts:215`,
  `${CMD}/writes/items.ts:233`,
  `${CMD}/writes/documents.ts:61`,
  `${CMD}/writes/documents.ts:90`,
  `${CMD}/writes/payouts.ts:51`,
  `${CMD}/writes/payouts.ts:76`,
  `${SRC}/writes/ledger.ts:29`,
  `${SRC}/writes/births.ts:41`,
  `${SRC}/writes/births.ts:45`,
  `${SRC}/writes/births.ts:77`,
  `${SRC}/writes/births.ts:78`,
  `${SRC}/writes/births.ts:114`,
  `${SRC}/writes/births.ts:133`,
  `${SRC}/writes/births.ts:167`,
  `${SRC}/writes/births.ts:169`,
  `${SRC}/writes/births.ts:237`,
  `${SRC}/rules/transitions.ts:48`,
  `${SRC}/guards/authority.ts:97`,
  `${SRC}/guards/authority.ts:117`,
  `${SRC}/guards/budgets.ts:68`,
  `${SRC}/guards/owner-approvals.ts:44`,
  `${CMD}/writes/items.ts:171`,
  `${CMD}/writes/items.ts:206`,
];

/** Resolving one personal or Organization item's recipient, or its bank payout quote. */
const RECIPIENT_INVOKES = [
  procedure_banking_read_payout_quote_for_payment_in_tx,
  procedure_parties_resolve_payment_recipient_in_tx,
  procedure_accounts_find_account_recipient_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_accounts_require_payment_account_in_tx,
  procedure_parties_ensure_payment_wallet_destination_in_tx,
];

/**
 * `bookSentPayments` (commands/writes/books.ts:31): a sent item's account in the payer's books. Only an
 * Organization's books need the `books` gate and read whether the caller manages them (books.ts:42, :45).
 */
const BOOKS_PERSONAL_INVOKES = [procedure_books_read_row_account_in_tx, procedure_books_classify_row];
const BOOKS_ORG_INVOKES = [
  procedure_access_require_feature,
  procedure_books_manages_books_in_tx,
  ...BOOKS_PERSONAL_INVOKES,
];
const BOOKS_WAS = [
  `${CMD}/writes/books.ts:31`,
  `${CMD}/writes/books.ts:42`,
  `${CMD}/writes/books.ts:45`,
  `${CMD}/writes/books.ts:54`,
  `${CMD}/writes/books.ts:56`,
];

/** The wire Payment projection a personal prepare answers with (`readPreparedPaymentViewsInTx`). */
const PROJECTION = {
  reads: [
    table_payments,
    table_payment_schedules,
    table_payment_commands,
    table_money_executions,
    table_provider_send_attempts,
    table_accounts,
    table_identities,
    table_orgs,
    table_counterparty_destinations,
  ],
  invokes: [
    procedure_documents_load_payment_documents,
    procedure_documents_current_payment_documents,
    procedure_books_book_asset_by_id_in_tx,
    procedure_banking_read_payout_delivery_in_tx,
    procedure_parties_party_by_id,
    procedure_parties_party_by_safe_address,
  ],
};

/**
 * What `recordPaymentCommandOutcome(failed)` (writes/outcomes.ts:16) records once the guard passed: the
 * active execution read (nothing written for `failed`), each Payment failed, a bank payout cancelled.
 */
const FAIL_OUTCOME = {
  reads: [table_payment_commands, table_payments, table_money_executions],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.to_failed],
  invokes: [procedure_banking_payout_send_failed_in_tx],
  emits: [event_payment_transitioned],
};

/** `failPrepared` (fail-prepared.ts): what a born command's refusal records, behind the full guard. */
const FAIL = {
  reads: union(AUTHORIZE.reads, FAIL_OUTCOME.reads),
  writes: FAIL_OUTCOME.writes,
  drives: FAIL_OUTCOME.drives,
  invokes: [...AUTHORIZE.invokes, ...FAIL_OUTCOME.invokes],
  emits: FAIL_OUTCOME.emits,
};
const FAIL_WAS = [
  `${CMD}/writes/submissions.ts:22`,
  `${CMD}/writes/submissions.ts:40`,
  `${SRC}/writes/outcomes.ts:16`,
  `${SRC}/writes/outcomes.ts:29`,
  `${SRC}/writes/outcomes.ts:40`,
  `${SRC}/writes/outcomes.ts:98`,
  `${SRC}/writes/outcomes.ts:108`,
  `${SRC}/writes/outcomes.ts:109`,
  `${SRC}/events/writer.ts:72`,
  `${SRC}/events/writer.ts:224`,
  `${EXE}/writes/lifecycles.ts:41`,
];

/**
 * The executions side of a build (`getOrBuildStoredExecution` / `buildOrReuseExecution`,
 * executions/external/builds.ts:47, :190): the live execution reused, a lapsed sponsorship
 * classified, the own lane followed, the sender's balance read, the sponsored UserOperation built
 * and stored. Booked on the payments.executions rpcs; folded in here as tables, transitions and calls.
 * The store inserts the execution `prepared` and may expire a lapsed lane holder; payments.executions.classify,
 * run for a lapsed active execution (expiries.ts:20, :78) or an expired operation that landed on the own lane
 * (lanes.ts:118), records expired, displaced, reverted or succeeded and moves the command and its Payments with it.
 */
const BUILD = {
  reads: [table_money_executions, table_payment_commands, table_payments],
  writes: [table_money_executions, table_payment_commands, table_payments],
  drives: [
    machine_money_execution.t.to_prepared,
    machine_money_execution.t.to_expired,
    machine_money_execution.t.to_displaced,
    machine_money_execution.t.to_reverted,
    machine_money_execution.t.to_succeeded,
    machine_payment.t.to_pending,
    machine_payment.t.to_settling,
    machine_payment.t.to_failed,
    machine_payment_command.t.to_prepared,
    machine_payment_command.t.to_submitted,
  ],
  calls: [
    integration_chain_rpc.c.fetchLatestBlockNumber,
    integration_chain_rpc.c.fetchEntryPointNonce,
    integration_chain_rpc.c.fetchEntryPointUserOperationEvent,
    integration_chain_rpc.c.fetchUserOperationReceipt,
    integration_chain_rpc.c.fetchErc20Balance,
    integration_chain_rpc.c.fetchUserOperationFees,
    integration_chain_rpc.c.sponsorUserOperation,
  ],
  /** eth_call reads: the sender's balance and the lane's nonce. Nothing is sent to chain at prepare. */
  chain: [contract_erc20.f.balanceOf, contract_entry_point.f.getNonce],
  spans: [
    "chain.read eth_blockNumber",
    "chain.read eth_call",
    "chain.read eth_getLogs",
    "chain.read eth_getUserOperationReceipt",
    "chain.read eth_maxPriorityFeePerGas",
    "chain.read eth_getBlockByNumber",
    "chain.read pm_getPaymasterStubData",
    "chain.read eth_estimateUserOperationGas",
    "chain.read pm_getPaymasterData",
  ],
};

/**
 * Child spans every prepare action has besides its chain reads: each `ctx.runQuery` / `ctx.runMutation`
 * through the operation's Action context is a `convex.query` / `convex.mutation` client span
 * (platform/execute.ts:273), and each chain read's upstream try is a `chain.attempt <upstream>` span
 * (integrations/chain-rpc/internal/requests.ts:79).
 */
const ACTION_SPANS = ["convex.query", "convex.mutation", "chain.attempt <upstream>"];
const ACTION_SPANS_WAS = [
  `${BACKEND}/src/platform/execute.ts:227`,
  `${BACKEND}/src/platform/execute.ts:273`,
  `${BACKEND}/src/integrations/chain-rpc/internal/requests.ts:79`,
];

/**
 * A settled replay in `storeBuiltExecution` (executions/external/replays.ts:26): a succeeded execution runs
 * payments.executions.complete, which reads the command's wire Payments and, for a command not yet
 * `submitted`, records the submission (its transitions are in BUILD).
 */
const SETTLED_REPLAY_READS = [
  table_payments,
  table_payment_schedules,
  table_payment_commands,
  table_money_executions,
  table_provider_send_attempts,
  table_accounts,
  table_identities,
  table_orgs,
  table_counterparty_destinations,
];
const BUILD_WAS = [
  `${EXE}/external/builds.ts:47`,
  `${EXE}/external/builds.ts:77`,
  `${EXE}/external/builds.ts:94`,
  `${EXE}/external/builds.ts:102`,
  `${EXE}/external/builds.ts:107`,
  `${EXE}/external/builds.ts:112`,
  `${EXE}/external/builds.ts:114`,
  `${EXE}/external/builds.ts:137`,
  `${EXE}/external/builds.ts:153`,
  `${EXE}/external/builds.ts:190`,
  `${EXE}/external/builds.ts:233`,
  `${EXE}/external/funding.ts:27`,
  `${EXE}/external/funding.ts:36`,
  `${EXE}/external/funding.ts:63`,
  `${EXE}/external/safes.ts:164`,
  `${EXE}/external/safes.ts:169`,
  `${EXE}/external/safes.ts:188`,
  `${EXE}/external/lanes.ts:85`,
  `${EXE}/external/lanes.ts:95`,
  `${EXE}/external/lanes.ts:103`,
  `${EXE}/external/lanes.ts:133`,
  `${EXE}/external/lanes.ts:118`,
  `${EXE}/external/expiries.ts:20`,
  `${EXE}/external/expiries.ts:78`,
  `${EXE}/external/attempts.ts:71`,
  `${EXE}/external/attempts.ts:183`,
  `${EXE}/writes/stores.ts:67`,
  `${EXE}/writes/stores.ts:78`,
  `${EXE}/writes/failures.ts:34`,
  `${EXE}/writes/failures.ts:42`,
  `${BACKEND}/src/integrations/chain-rpc/internal/requests.ts:255`,
  `${BACKEND}/src/integrations/chain-rpc/internal/userOperations.ts:31`,
];

/** `storeBuiltExecution` (executions/external/builds.ts:246): the build, a settled replay, the claim. */
const STORE_WAS = [`${EXE}/external/builds.ts:246`, `${EXE}/external/builds.ts:269`, `${EXE}/external/builds.ts:274`, `${EXE}/external/replays.ts:26`];

/** `birthFunded` (commands/external/funding.ts:191): Budget or allowance, then the sender's balance, before birth. */
const BIRTH_FUNDING = {
  reads: [table_payment_document_intents],
  invokes: [
    procedure_accounts_require_payment_account_in_tx,
    procedure_requests_checkout_birth_terms_in_tx,
    procedure_permissions_read_budget_allowance_in_tx,
    ...ORG_ROUTE_INVOKES,
  ],
  calls: [
    integration_chain_rpc.c.fetchEthCall,
    integration_chain_rpc.c.fetchLatestBlock,
    integration_chain_rpc.c.fetchErc20Balance,
  ],
  chain: [contract_roles.f.allowances, contract_budgets.f.leftOf, contract_erc20.f.balanceOf],
  spans: ["chain.read eth_call", "chain.read eth_getBlockByNumber"],
};
const BIRTH_FUNDING_WAS = [
  `${CMD}/external/funding.ts:65`,
  `${CMD}/external/funding.ts:99`,
  `${CMD}/external/funding.ts:122`,
  `${CMD}/external/funding.ts:191`,
  `${CMD}/external/funding.ts:224`,
  `${CMD}/reads/funding.ts:101`,
  `${CMD}/reads/funding.ts:106`,
];

/** The build gates (commands/external/builds.ts:26, :42): the Roles module admitted, the Budget able to cover it. */
const BUILD_GATES = {
  reads: [table_payment_commands, table_money_executions, table_payments],
  invokes: [procedure_permissions_read_budget_allowance_in_tx],
  calls: [integration_chain_rpc.c.fetchCode, integration_chain_rpc.c.fetchEthCall, integration_chain_rpc.c.fetchLatestBlock],
  chain: [contract_roles.f.allowances, contract_budgets.f.leftOf],
  spans: ["chain.read eth_getCode", "chain.read eth_call", "chain.read eth_getBlockByNumber"],
};
const BUILD_GATES_WAS = [
  `${CMD}/external/builds.ts:26`,
  `${CMD}/external/builds.ts:42`,
  `${CMD}/external/funding.ts:157`,
  `${CMD}/external/funding.ts:162`,
  `${CMD}/external/funding.ts:167`,
  `${CMD}/external/funding.ts:177`,
  `${CMD}/external/funding.ts:181`,
  `${CMD}/external/funding.ts:251`,
  `${CMD}/external/roles-modules.ts:16`,
  `${CMD}/reads/budgets.ts:49`,
  `${CMD}/reads/budgets.ts:62`,
];

/** The link-observation mutation's own touches. */
const LINK = { reads: [...AUTHORIZE.reads], writes: [table_payment_commands], invokes: [...AUTHORIZE.invokes] };
/** The claim-initiated mutation's own touches. */
const CLAIM = LINK;

// ── shared shapes ──────────────────────────────────────────────────────────────────────────

const Address = Schema.String;
/** `PreparedPaymentCommandSchema` (payments/schema): the frozen command with route and items, too deep to transcribe. */
const PreparedPaymentCommand = Schema.Unknown;
/** `RecipientObservationSchema` (access/actor-schema): telemetry facts about one recipient, too deep to transcribe. */
const RecipientObservation = Schema.Unknown;
/** `PersonalUnsignedUserOperationSchema`: the unsigned, sponsored ERC-4337 UserOperation, too deep to transcribe. */
const UserOperation = Schema.Unknown;
const ObservationContext = Schema.Unknown;
const ExecutionOperation = Schema.Literals([
  "send",
  "create_commitment",
  "claim_commitment",
  "cancel_commitment",
  "redirect_commitment",
  "void_schedule",
]);

/** `PreparedPaymentCommandExecutionSchema` (payments/schema/requests.ts:84); nested parts are opaque. */
const PreparedPaymentCommandExecution = Schema.Struct({
  recipientObservations: Schema.Array(RecipientObservation),
  emitPaymentInitiated: Schema.Boolean,
  executionId: Schema.String,
  commandId: Schema.String,
  paymentIds: Schema.Array(Schema.String),
  request: Schema.Unknown,
  chainId: Schema.Number,
  signerAddress: Address,
  userOpSenderSafe: Address,
  digest: Schema.String,
  preparedCommand: Schema.optionalKey(PreparedPaymentCommand),
  userOperation: Schema.optionalKey(UserOperation),
  sourceCommand: Schema.optionalKey(Schema.Unknown),
  sourcePaymentIds: Schema.optionalKey(Schema.Array(Schema.String)),
  sourceRecipientSafes: Schema.optionalKey(Schema.Array(Address)),
  lifecycleSource: Schema.optionalKey(
    Schema.Struct({ paymentId: Schema.String, commitmentId: Schema.String, documentHash: Schema.String }),
  ),
  documentBundles: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  settled: Schema.optionalKey(Schema.Unknown),
});

/** `PreparedOfferCheckoutExecutionSchema` (requests/offer-schema.ts:147), without its first field. */
const RegisteredCheckoutExecutionFields = {
  executionId: Schema.String,
  commandId: Schema.String,
  paymentIds: Schema.Array(Schema.String),
  chainId: Schema.Number,
  signerAddress: Address,
  userOpSenderSafe: Address,
  digest: Schema.String,
  userOperation: UserOperation,
  preparedCommand: Schema.Struct({
    commandId: Schema.String,
    chainId: Schema.Number,
    contractAddress: Address,
    senderSafe: Address,
    executionRoute: Schema.Unknown,
    items: Schema.Array(Schema.Unknown),
  }),
};

/** `PrepareInvoiceCheckoutExecutionInputSchema` (requests/checkout-schema.ts:109). */
const CheckoutLinkInput = Schema.Struct({
  linkToken: Schema.String,
  payer: Schema.Unknown,
  permissionId: Schema.optionalKey(Schema.String),
  signerAddress: Address,
});

/** What an Organization or Directors' prepare intent answers (`PreparedOrganizationPayment`). */
const PreparedOrganizationPayment = Schema.Struct({
  command: PreparedPaymentCommand,
  recipientObservations: Schema.Array(RecipientObservation),
});

// ── public prepare actions (rows of `commands`, operations.ts:150) ──────────────────────────

export const rpc_payments_commands_prepare = defineRpc({
  id: "payments.commands.prepare",
  title: "Prepare one personal Payment and its UserOperation",
  about:
    "Row `payments.commands.prepare`, registered as the public action `payments/commands:prepare`. Signed in " +
    "(`signedInAction`). Unless the Payment is dated, `birthFunded` runs the internal query loadBirthFunding and " +
    "refuses a new request key the caller's Safe cannot cover (INSUFFICIENT_BALANCE via ERC-20 balanceOf) before " +
    "anything is written (#2394). Then the internal mutation prepareIntent plans and saves the command (or replays " +
    "the same request key's one). `builtExecution` runs the Roles and Budget gates (no-ops on a personal direct " +
    "route) and `getOrBuildStoredExecution`: payments.executions.loadActive, linkObservation, then reuse the live " +
    "execution or build a sponsored Safe UserOperation and store it (payments.executions.store); a terminal build " +
    "refusal runs failPrepared. Unless the execution already succeeded it runs claimInitiated, whose answer becomes " +
    "`emitPaymentInitiated`: the SDK, not the server, sends `payment_initiated`. `commandPrepared` annotates the " +
    "wide event with command, payment and execution ids. Answers the personal execution view. Touches are those " +
    "internal rpcs' on an Account's path (direct route, the account branch of the command guard); nothing is sent " +
    "to chain here.",
  was: [
    `${CONVEX}:21`,
    `${OPS}/prepare.ts:14`,
    `${OPS}/prepare.ts:20`,
    `${OPS}/prepare.ts:21`,
    `${OPS}/prepare.ts:25`,
    `${OPS}/prepare.ts:27`,
    `${OPS}/prepare.ts:32`,
    `${OPS}/prepare.ts:36`,
    `${OPS}/prepare.ts:37`,
    `${OPS}/prepare.ts:42`,
    `${ROWS}:152`,
    `${ROWS}:91`,
    `${CMD}/writes/transactions.ts:48`,
    `${CMD}/writes/transactions.ts:101`,
    `${CMD}/events.ts:10`,
    `${CMD}/views.ts:34`,
    `${CMD}/views.ts:74`,
    `${BACKEND}/src/platform/session.ts:24`,
    ...BIRTH_FUNDING_WAS,
    ...BUILD_GATES_WAS,
    ...BUILD_WAS,
    ...ACTION_SPANS_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who: "A signed-in person paying from their own Account Safe with their own signer (`signedInAction`).",
  input: Schema.Struct({
    requestKey: Schema.String,
    signerAddress: Address,
    /** `PaymentExecutionIntentSchema`: recipient ref, amount, quote, type, timing, documents, books; too deep to transcribe. */
    payment: Schema.Unknown,
  }),
  output: Schema.Struct({
    actorAccountId: Schema.String,
    item: Schema.Unknown,
    documentBundle: Schema.Unknown,
    instructionDocument: Schema.Unknown,
    userOperation: UserOperation,
    recipientObservation: RecipientObservation,
    executionId: Schema.String,
    commandId: Schema.String,
    paymentId: Schema.String,
    requestKey: Schema.String,
    payment: Schema.Unknown,
    purposeKind: Schema.String,
    emitPaymentInitiated: Schema.Boolean,
    chainId: Schema.Number,
    signerAddress: Address,
    userOpSenderSafe: Address,
    digest: Schema.String,
    settled: Schema.optionalKey(Schema.Unknown),
  }),
  errors: PREPARE_SEND_ROW_ERRORS,
  reads: union(BIRTH_FUNDING.reads, PERSONAL_BIRTH.reads, PROJECTION.reads, AUTH_ACCOUNT.reads, FAIL_OUTCOME.reads, BUILD.reads),
  writes: union(PERSONAL_BIRTH.writes, LINK.writes, FAIL_OUTCOME.writes, BUILD.writes),
  drives: union(PERSONAL_BIRTH.drives, FAIL_OUTCOME.drives, BUILD.drives),
  invokes: union(
    [procedure_access_require_feature, procedure_accounts_require_account_signer_in_tx],
    RECIPIENT_INVOKES,
    PERSONAL_BIRTH.invokes,
    PROJECTION.invokes,
    BOOKS_PERSONAL_INVOKES,
    AUTH_ACCOUNT.invokes,
    FAIL_OUTCOME.invokes,
  ),
  emits: FAIL_OUTCOME.emits,
  calls: BUILD.calls,
  chain: BUILD.chain,
  spans: spanUnion(BUILD.spans, ACTION_SPANS),
});

export const rpc_payments_commands_prepare_organization = defineRpc({
  id: "payments.commands.prepare-organization",
  title: "Prepare an Organization batch and its UserOperation",
  about:
    "Row `payments.commands.prepareOrganization`, registered as `payments/commands:prepareOrganization`. Signed in. " +
    "Only when no item is dated, `birthFunded` (loadBirthFunding) refuses a new batch its Budget cannot cover: the " +
    "Roles allowance (`allowances`, plus the latest block time for a refilling Budget, #2298) or the v4 " +
    "`Budgets.leftOf`, ROLE_PERMISSION_DENIED `budget_exhausted`; then the Organization Safe's balance. The internal " +
    "mutation prepareOrganizationIntent plans and saves the batch. `organizationVerified` stamps the wide event. " +
    "`storedExecution` runs `rolesModuleAdmits` (eth_getCode; a module not on an admitted Roles mastercopy is " +
    "WRONG_STATE and fails the command), `budgetAllowanceAdmits` (a v4 budget: loadActive, then `Budgets.leftOf` " +
    "again; a Roles route: loadBudgetAllowance, then the allowance again; a shortfall fails the command) and " +
    "`storeBuiltExecution`: linkObservation, build or reuse and store the execution, a settled replay through " +
    "payments.executions.complete, then claimInitiated. `commandPrepared` annotates the wide event. Touches are those " +
    "internal rpcs' on an Organization's paths; nothing is sent to chain here.",
  was: [
    `${CONVEX}:16`,
    `${OPS}/prepare-organization.ts:14`,
    `${OPS}/prepare-organization.ts:20`,
    `${OPS}/prepare-organization.ts:21`,
    `${OPS}/prepare-organization.ts:26`,
    `${OPS}/prepare-organization.ts:27`,
    `${OPS}/prepare-organization.ts:30`,
    `${OPS}/prepare-organization.ts:37`,
    `${ROWS}:159`,
    `${ROWS}:91`,
    `${CMD}/writes/transactions.ts:58`,
    `${CMD}/events.ts:10`,
    ...BIRTH_FUNDING_WAS,
    ...BUILD_GATES_WAS,
    ...BUILD_WAS,
    ...ACTION_SPANS_WAS,
    ...STORE_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who: "A signed-in member who may spend from the named Organization Budget (Permission), signing with their own signer.",
  input: Schema.Struct({
    orgId: Schema.String,
    permissionId: Schema.String,
    requestKey: Schema.String,
    signerAddress: Address,
    /** `OrganizationPaymentExecutionItemSchema` each; too deep to transcribe. */
    items: Schema.Array(Schema.Unknown),
    lineage: Schema.optionalKey(Schema.Unknown),
  }),
  output: PreparedPaymentCommandExecution,
  errors: PREPARE_SEND_ROW_ERRORS,
  reads: union(
    BIRTH_FUNDING.reads,
    ORG_BIRTH.reads,
    AUTH_SPEND.reads,
    FAIL_OUTCOME.reads,
    BUILD_GATES.reads,
    BUILD.reads,
    SETTLED_REPLAY_READS,
  ),
  writes: union(ORG_BIRTH.writes, LINK.writes, FAIL_OUTCOME.writes, BUILD.writes),
  drives: union(ORG_BIRTH.drives, FAIL_OUTCOME.drives, BUILD.drives),
  invokes: union(
    BIRTH_FUNDING.invokes,
    BUILD_GATES.invokes,
    [procedure_access_require_feature, procedure_accounts_require_account_signer_in_tx],
    RECIPIENT_INVOKES,
    ORG_BIRTH.invokes,
    BOOKS_ORG_INVOKES,
    AUTH_SPEND.invokes,
    FAIL_OUTCOME.invokes,
  ),
  emits: FAIL_OUTCOME.emits,
  calls: union(BIRTH_FUNDING.calls, BUILD_GATES.calls, BUILD.calls),
  chain: union(BIRTH_FUNDING.chain, BUILD_GATES.chain, BUILD.chain),
  spans: spanUnion(BIRTH_FUNDING.spans, BUILD_GATES.spans, BUILD.spans, ACTION_SPANS),
});

export const rpc_payments_commands_prepare_request = defineRpc({
  id: "payments.commands.prepare-request",
  title: "Prepare the Payment a payer confirmed for a request",
  about:
    "Row `payments.commands.prepareRequest`, registered as `payments/commands:prepareRequest`. Signed in. " +
    "`payerFunded` runs `birthFunded` for an Account payer without a Permission or an Organization payer with one, " +
    "unless the payment is dated; a dated v4 budget payment still reads its budget now (CAP-1252). The internal " +
    "mutation prepareRequestIntent has Requests birth the confirmed request's command. `organizationVerified` stamps " +
    "an Organization payer. The first prepared item must be a send or create_commitment, else INVALID_INPUT " +
    "(`requestUnconfirmed`). `storedExecution` then gates, builds and stores the execution as for " +
    "prepare-organization, with the source command and Payment kept for a retry, and runs claimInitiated; " +
    "`commandPrepared` annotates the wide event. The birth rides Requests' `prepareConfirmedRequestInTx`, which calls " +
    "back payments' `preparePaymentCommandInTx` (invoked here as that procedure, which carries the birth's writes). " +
    "`plannedRequest` admits only INTENT_FAILURES, so a dated release the `scheduled-payments` gate refuses inside " +
    "prepareRequestIntent reaches the caller as UNKNOWN: the row's FEATURE_NOT_AVAILABLE has no source on this path.",
  was: [
    `${CONVEX}:20`,
    `${OPS}/prepare-request.ts:16`,
    `${OPS}/prepare-request.ts:25`,
    `${OPS}/prepare-request.ts:26`,
    `${OPS}/prepare-request.ts:36`,
    `${OPS}/prepare-request.ts:38`,
    `${OPS}/prepare-request.ts:44`,
    `${OPS}/prepare-request.ts:46`,
    `${OPS}/prepare-request.ts:65`,
    `${ROWS}:166`,
    `${ROWS}:91`,
    `${CMD}/writes/transactions.ts:72`,
    `${CMD}/writes/transactions.ts:36`,
    `${CMD}/errors.ts:56`,
    ...BIRTH_FUNDING_WAS,
    ...BUILD_GATES_WAS,
    ...BUILD_WAS,
    ...ACTION_SPANS_WAS,
    ...STORE_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who: "A signed-in payer of a request it confirmed, signing with its own signer (an Account, or an Organization under a Permission).",
  input: Schema.Struct({
    /** `RequestPaymentConfirmationSchema`: the frozen request terms the payer confirmed; too deep to transcribe. */
    confirmation: Schema.Unknown,
    signerAddress: Address,
  }),
  output: PreparedPaymentCommandExecution,
  errors: PREPARE_SEND_ROW_ERRORS,
  reads: union(
    BIRTH_FUNDING.reads,
    [table_accounts],
    AUTH_SPEND.reads,
    FAIL_OUTCOME.reads,
    BUILD_GATES.reads,
    BUILD.reads,
    SETTLED_REPLAY_READS,
  ),
  writes: union(LINK.writes, FAIL_OUTCOME.writes, BUILD.writes),
  drives: union(FAIL_OUTCOME.drives, BUILD.drives),
  invokes: union(
    BIRTH_FUNDING.invokes,
    BUILD_GATES.invokes,
    [
      procedure_access_require_feature,
      procedure_accounts_require_account_signer_in_tx,
      procedure_requests_prepare_confirmed_request_in_tx,
      procedure_payments_prepare_payment_command_in_tx,
    ],
    AUTH_SPEND.invokes,
    FAIL_OUTCOME.invokes,
  ),
  emits: FAIL_OUTCOME.emits,
  calls: union(BIRTH_FUNDING.calls, BUILD_GATES.calls, BUILD.calls),
  chain: union(BIRTH_FUNDING.chain, BUILD_GATES.chain, BUILD.chain),
  spans: spanUnion(BIRTH_FUNDING.spans, BUILD_GATES.spans, BUILD.spans, ACTION_SPANS),
});

export const rpc_payments_commands_prepare_offer_checkout = defineRpc({
  id: "payments.commands.prepare-offer-checkout",
  title: "Prepare a registered payer's Payment for an Offer checkout",
  about:
    "Row `payments.commands.prepareOfferCheckout`, registered as `payments/commands:prepareOfferCheckout`. Signed " +
    "in. `payerFunded` reads the checkout's frozen terms through loadBirthFunding (Requests' " +
    "`checkoutBirthTermsInTx`) and refuses an unfunded payer before birth (#2403). The internal mutation " +
    "prepareOfferCheckoutIntent has Requests birth the purchase. `builtExecution` runs the Roles and Budget gates and " +
    "`getOrBuildStoredExecution` (loadActive, linkObservation, build or reuse, store). Unlike the other prepares it " +
    "never runs claimInitiated and never annotates the wide event with `commandPrepared`. Answers the Offer " +
    "checkout execution view. The birth rides Requests' `prepareRegisteredPurchaseInTx`, which calls back payments' " +
    "`preparePaymentCommandInTx` (invoked here as that procedure, which carries the birth's writes).",
  was: [
    `${CONVEX}:14`,
    `${OPS}/prepare-offer-checkout.ts:13`,
    `${OPS}/prepare-offer-checkout.ts:18`,
    `${OPS}/prepare-offer-checkout.ts:24`,
    `${OPS}/prepare-offer-checkout.ts:26`,
    `${OPS}/prepare-offer-checkout.ts:27`,
    `${ROWS}:173`,
    `${ROWS}:79`,
    `${CMD}/writes/transactions.ts:77`,
    `${CMD}/views.ts:158`,
    ...BIRTH_FUNDING_WAS,
    ...BUILD_GATES_WAS,
    ...BUILD_WAS,
    ...ACTION_SPANS_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who: "A signed-in, registered payer of an Offer checkout, signing with its own signer.",
  input: Schema.Struct({
    checkoutId: Schema.String,
    payer: Schema.Unknown,
    permissionId: Schema.optionalKey(Schema.String),
    signerAddress: Address,
  }),
  output: Schema.Struct({
    /** `OfferCheckoutSchema`: the Offer checkout snapshot; too deep to transcribe. */
    checkout: Schema.Unknown,
    ...RegisteredCheckoutExecutionFields,
  }),
  errors: PREPARE_ROW_ERRORS,
  reads: union(BIRTH_FUNDING.reads, AUTH_SPEND.reads, FAIL_OUTCOME.reads, BUILD_GATES.reads, BUILD.reads),
  writes: union(LINK.writes, FAIL_OUTCOME.writes, BUILD.writes),
  drives: union(FAIL_OUTCOME.drives, BUILD.drives),
  invokes: union(
    BIRTH_FUNDING.invokes,
    BUILD_GATES.invokes,
    [
      procedure_accounts_require_account_signer_in_tx,
      procedure_requests_prepare_registered_purchase_in_tx,
      procedure_payments_prepare_payment_command_in_tx,
    ],
    AUTH_SPEND.invokes,
    FAIL_OUTCOME.invokes,
  ),
  emits: FAIL_OUTCOME.emits,
  calls: union(BIRTH_FUNDING.calls, BUILD_GATES.calls, BUILD.calls),
  chain: union(BIRTH_FUNDING.chain, BUILD_GATES.chain, BUILD.chain),
  spans: spanUnion(BIRTH_FUNDING.spans, BUILD_GATES.spans, BUILD.spans, ACTION_SPANS),
});

export const rpc_payments_commands_prepare_invoice_checkout = defineRpc({
  id: "payments.commands.prepare-invoice-checkout",
  title: "Prepare a registered payer's Payment for an Invoice checkout link",
  about:
    "Row `payments.commands.prepareInvoiceCheckout`, registered as `payments/commands:prepareInvoiceCheckout`. " +
    "It is `checkoutPrepared(input, \"invoice\")` (commands/external/builds.ts:83), the same engine Requests' " +
    "prepare-request-registered action runs with `request`: signed in, `payerFunded` on the link's frozen terms " +
    "(#2403), the internal mutation prepareInvoiceCheckoutIntent (Requests' `prepareRegisteredInvoiceInTx` births " +
    "the Payment, calling back payments' `preparePaymentCommandInTx`, invoked here as that procedure), then " +
    "`builtExecution` (gates, linkObservation, build or reuse, store). No claimInitiated and no `commandPrepared`. " +
    "Answers the Invoice checkout execution view.",
  was: [
    `${CONVEX}:12`,
    `${OPS}/prepare-invoice-checkout.ts:7`,
    `${CMD}/external/builds.ts:83`,
    `${CMD}/external/builds.ts:89`,
    `${CMD}/external/builds.ts:95`,
    `${CMD}/external/builds.ts:97`,
    `${CMD}/external/builds.ts:98`,
    `${ROWS}:180`,
    `${ROWS}:79`,
    `${CMD}/writes/transactions.ts:86`,
    `${CMD}/views.ts:171`,
    ...BIRTH_FUNDING_WAS,
    ...BUILD_GATES_WAS,
    ...BUILD_WAS,
    ...ACTION_SPANS_WAS,
  ],
  concept: concept_payments,
  kind: "action",
  who: "A signed-in, registered payer of an Invoice checkout link, signing with its own signer.",
  input: CheckoutLinkInput,
  output: Schema.Struct({
    ...RegisteredCheckoutExecutionFields,
    /** `AssetInvoiceCheckoutSummarySchema`; too deep to transcribe. */
    invoice: Schema.Unknown,
  }),
  errors: PREPARE_ROW_ERRORS,
  reads: union(BIRTH_FUNDING.reads, AUTH_SPEND.reads, FAIL_OUTCOME.reads, BUILD_GATES.reads, BUILD.reads),
  writes: union(LINK.writes, FAIL_OUTCOME.writes, BUILD.writes),
  drives: union(FAIL_OUTCOME.drives, BUILD.drives),
  invokes: union(
    BIRTH_FUNDING.invokes,
    BUILD_GATES.invokes,
    [
      procedure_accounts_require_account_signer_in_tx,
      procedure_requests_prepare_registered_invoice_in_tx,
      procedure_payments_prepare_payment_command_in_tx,
    ],
    AUTH_SPEND.invokes,
    FAIL_OUTCOME.invokes,
  ),
  emits: FAIL_OUTCOME.emits,
  calls: union(BIRTH_FUNDING.calls, BUILD_GATES.calls, BUILD.calls),
  chain: union(BIRTH_FUNDING.chain, BUILD_GATES.chain, BUILD.chain),
  spans: spanUnion(BIRTH_FUNDING.spans, BUILD_GATES.spans, BUILD.spans, ACTION_SPANS),
});

// ── internal prepare transactions ──────────────────────────────────────────────────────────

export const rpc_payments_commands_prepare_intent = defineRpc({
  id: "payments.commands.prepare-intent",
  title: "Plan and save one personal Payment command",
  about:
    "The internal mutation `payments/commands:prepareIntent`: the personal prepare action's transaction. Decodes the " +
    "payment strictly (INVALID_INPUT); a dated payment needs the `scheduled-payments` gate (FEATURE_NOT_AVAILABLE). " +
    "`preparePaymentIntentInTx` checks the caller's own signer, then `preparePersonalPaymentInTx`: the Account's " +
    "authority, streams refused, an existing intent for the request key replayed from its resolved command, " +
    "otherwise the recipient resolved (a bank payout from its accepted quote, else Parties' resolution to an Account, " +
    "Organization or a payment-wallet destination it may create) and one `send` birth written by " +
    "`preparePaymentCommandInTx`. The prepared Safe must be the signer's Account Safe (INVALID_INPUT). Answers the " +
    "wire Payment and stores the recipient observation on the command. `bookSentPayments` then classifies the sent " +
    "Payment in the payer's books when the item names an account or a suggestion (no `books` gate for a person). The " +
    "route is the Account's direct one and the command carries no lineage, so no Requests row is read or written.",
  was: [
    `${CONVEX}:10`,
    `${OPS}/prepare-intent.ts:22`,
    `${OPS}/prepare-intent.ts:34`,
    `${OPS}/prepare-intent.ts:40`,
    `${OPS}/prepare-intent.ts:43`,
    `${OPS}/prepare-intent.ts:46`,
    `${CMD}/guards.ts:14`,
    `${CMD}/guards.ts:27`,
    `${CMD}/guards.ts:34`,
    `${CMD}/writes/personal.ts:28`,
    `${CMD}/writes/personal.ts:37`,
    `${CMD}/writes/personal.ts:39`,
    `${CMD}/writes/personal.ts:82`,
    `${CMD}/writes/personal.ts:103`,
    `${CMD}/writes/personal.ts:108`,
    `${CMD}/writes/personal.ts:117`,
    `${CMD}/writes/personal.ts:144`,
    `${CMD}/writes/personal.ts:149`,
    `${CMD}/reads/recipients.ts:43`,
    `${CMD}/writes/observations.ts:13`,
    `${CMD}/writes/observations.ts:30`,
    `${SRC}/reads/payments.ts:192`,
    `${BACKEND}/src/access/features/guards.ts:121`,
    ...BIRTH_WAS,
    ...BOOKS_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare (`plannedPersonal`, commands/writes/transactions.ts:48) for the signed-in " +
    "caller it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    signerAddress: Schema.String,
    requestKey: Schema.String,
    /** `validatorOf(PaymentExecutionIntentSchema)`; too deep to transcribe. */
    payment: Schema.Unknown,
  }),
  output: Schema.Struct({
    actorAccountId: Schema.String,
    command: PreparedPaymentCommand,
    /** The wire Payment (`Payment` in payment-schema.ts); too deep to transcribe. */
    payment: Schema.Unknown,
    recipientObservation: RecipientObservation,
  }),
  errors: union([error_FEATURE_NOT_AVAILABLE], INTENT_ERRORS, DEFECT),
  reads: union(PERSONAL_BIRTH.reads, PROJECTION.reads),
  writes: PERSONAL_BIRTH.writes,
  drives: PERSONAL_BIRTH.drives,
  invokes: union(
    [procedure_access_require_feature, procedure_accounts_require_account_signer_in_tx],
    RECIPIENT_INVOKES,
    PERSONAL_BIRTH.invokes,
    PROJECTION.invokes,
    BOOKS_PERSONAL_INVOKES,
  ),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_organization_intent = defineRpc({
  id: "payments.commands.prepare-organization-intent",
  title: "Plan and save one Organization batch command",
  about:
    "The internal mutation `payments/commands:prepareOrganizationIntent`: the Organization prepare action's " +
    "transaction. Decodes the input strictly (INVALID_INPUT); any dated item needs the `scheduled-payments` gate for " +
    "the Organization. `prepareOrganizationPaymentInTx` refuses an empty batch and streams, replays an existing " +
    "intent for the request key, otherwise resolves each item's recipient (bank payout quote, or Parties' " +
    "resolution) and builds one birth of `send` items under the Permission; then checks the caller's signer and " +
    "writes the birth with `preparePaymentCommandInTx`, whose route must spend from the signer's Account Safe " +
    "(INVALID_INPUT otherwise). Stores the recipient observations on the command, then `bookSentPayments` classifies " +
    "each booked item in the Organization's books (the `books` gate first). A `payment_request` or `invoice_checkout` " +
    "lineage in the input reaches Requests' `paymentRequests` and `invoiceCheckoutPayments` directly.",
  was: [
    `${CONVEX}:15`,
    `${OPS}/prepare-organization-intent.ts:21`,
    `${OPS}/prepare-organization-intent.ts:31`,
    `${OPS}/prepare-organization-intent.ts:37`,
    `${OPS}/prepare-organization-intent.ts:40`,
    `${OPS}/prepare-organization-intent.ts:51`,
    `${CMD}/writes/organizations.ts:37`,
    `${CMD}/writes/organizations.ts:62`,
    `${CMD}/writes/organizations.ts:92`,
    `${CMD}/writes/organizations.ts:121`,
    `${CMD}/writes/organizations.ts:135`,
    `${CMD}/writes/organizations.ts:151`,
    `${CMD}/writes/organizations.ts:172`,
    `${CMD}/writes/organizations.ts:177`,
    `${CMD}/writes/organizations.ts:227`,
    `${CMD}/writes/organizations.ts:228`,
    `${CMD}/writes/observations.ts:30`,
    ...BIRTH_WAS,
    ...BOOKS_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare-organization (`plannedOrganization`, commands/writes/transactions.ts:58) " +
    "for the signed-in caller it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    /** `validatorOf(PrepareOrganizationPaymentExecutionInputSchema)`: orgId, permissionId, requestKey, signerAddress, items, lineage. */
    input: Schema.Unknown,
  }),
  output: PreparedOrganizationPayment,
  errors: union([error_FEATURE_NOT_AVAILABLE], PREPARE_INTENT_ERRORS),
  reads: ORG_BIRTH.reads,
  writes: ORG_BIRTH.writes,
  drives: ORG_BIRTH.drives,
  invokes: union(
    [procedure_access_require_feature, procedure_accounts_require_account_signer_in_tx],
    RECIPIENT_INVOKES,
    ORG_BIRTH.invokes,
    BOOKS_ORG_INVOKES,
  ),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_owners_intent = defineRpc({
  id: "payments.commands.prepare-owners-intent",
  title: "Plan and save the Directors' dated payment",
  about:
    "The internal mutation `payments/commands:prepareOwnersIntent` (ADR-0034 ruling 2A). Decodes the items strictly " +
    "(INVALID_INPUT) and always needs the `scheduled-payments` gate. `prepareOwnersPaymentInTx` refuses no items, " +
    "streams and an undated payment (INVALID_INPUT), resolves each item's recipient as an Organization batch does, " +
    "then writes one birth from the Organization Safe itself with `approval: owners` and, on Protocol v4, the " +
    "company's top budget id (CAP-1238). The route is the Directors' route: the caller must be one of the Safe's " +
    "owners as last read. No signer check and no books. Stores the recipient observations. The proposal of its " +
    "SafeOp hash follows the build, in Organizations' pay-scheduled action.",
  was: [
    `${CONVEX}:17`,
    `${OPS}/prepare-owners-intent.ts:24`,
    `${OPS}/prepare-owners-intent.ts:37`,
    `${OPS}/prepare-owners-intent.ts:40`,
    `${OPS}/prepare-owners-intent.ts:43`,
    `${CMD}/writes/owners.ts:27`,
    `${CMD}/writes/owners.ts:39`,
    `${CMD}/writes/owners.ts:58`,
    `${CMD}/writes/owners.ts:69`,
    `${CMD}/writes/organizations.ts:135`,
    `${CMD}/errors.ts:62`,
    `${CMD}/errors.ts:66`,
    `${CMD}/errors.ts:69`,
    `${CMD}/external/owners.ts:19`,
    `${CMD}/writes/transactions.ts:67`,
    `${BACKEND}/src/organizations/proposals/operations/pay-scheduled.ts:53`,
    `${BACKEND}/src/organizations/proposals/operations/pay-scheduled.ts:91`,
    ...BIRTH_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by Organizations' pay-scheduled action through `plannedOwners` (commands/writes/transactions.ts:67), " +
    "directly and inside `ownersScheduledExecution` (commands/external/owners.ts:19), for a Director it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.String,
    requestKey: Schema.String,
    /** `validatorOf(Schema.Array(OrganizationPaymentExecutionItemSchema))`; too deep to transcribe. */
    items: Schema.Array(Schema.Unknown),
    budgetId: Schema.optionalKey(Schema.String),
  }),
  output: PreparedOrganizationPayment,
  errors: union([error_FEATURE_NOT_AVAILABLE], PREPARE_INTENT_ERRORS),
  reads: OWNERS_BIRTH.reads,
  writes: OWNERS_BIRTH.writes,
  drives: OWNERS_BIRTH.drives,
  invokes: union([procedure_access_require_feature], RECIPIENT_INVOKES, OWNERS_BIRTH.invokes),
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_request_intent = defineRpc({
  id: "payments.commands.prepare-request-intent",
  title: "Birth the Payment a payer confirmed for a request",
  about:
    "The internal mutation `payments/commands:prepareRequestIntent`. Decodes the input strictly (INVALID_INPUT); a " +
    "scheduled release needs the `scheduled-payments` gate (for the Organization when an Organization pays). " +
    "`prepareRequestIntentInTx` checks the caller's signer, has Requests' `prepareConfirmedRequestInTx` birth the " +
    "request's command (it calls payments' `preparePaymentCommandInTx`), requires the prepared Safe to be the " +
    "signer's, then reads the caller's `accounts` row for the command's chain directly (a neighbour table read) and " +
    "asserts the birth matches the confirmation. Answers the prepared command and its source command.",
  was: [
    `${CONVEX}:19`,
    `${OPS}/prepare-request-intent.ts:18`,
    `${OPS}/prepare-request-intent.ts:25`,
    `${OPS}/prepare-request-intent.ts:31`,
    `${OPS}/prepare-request-intent.ts:39`,
    `${CMD}/writes/requests.ts:22`,
    `${CMD}/writes/requests.ts:27`,
    `${CMD}/writes/requests.ts:28`,
    `${CMD}/writes/requests.ts:29`,
    `${CMD}/writes/requests.ts:31`,
    `${CMD}/writes/requests.ts:38`,
    `${BACKEND}/src/requests/writes/approvals.ts:18`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare-request (`plannedRequest`, commands/writes/transactions.ts:72) for the " +
    "signed-in payer it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    /** `validatorOf(PrepareRequestPaymentExecutionInputSchema)`: confirmation and signerAddress. */
    input: Schema.Unknown,
  }),
  output: Schema.Struct({ prepared: PreparedPaymentCommand, sourceCommand: Schema.Unknown }),
  errors: union([error_FEATURE_NOT_AVAILABLE], PREPARE_INTENT_ERRORS),
  reads: [table_accounts],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_require_feature,
    procedure_accounts_require_account_signer_in_tx,
    procedure_requests_prepare_confirmed_request_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_offer_checkout_intent = defineRpc({
  id: "payments.commands.prepare-offer-checkout-intent",
  title: "Birth a registered payer's Offer checkout Payment",
  about:
    "The internal mutation `payments/commands:prepareOfferCheckoutIntent`. Decodes the input strictly (INVALID_INPUT), " +
    "checks the caller's signer, has Requests' `prepareRegisteredPurchaseInTx` birth the purchase (it calls payments' " +
    "`preparePaymentCommandInTx`), and requires the prepared Safe to be the signer's Account Safe (INVALID_INPUT). " +
    "Answers the checkout and the prepared command.",
  was: [
    `${CONVEX}:13`,
    `${OPS}/prepare-offer-checkout-intent.ts:17`,
    `${OPS}/prepare-offer-checkout-intent.ts:24`,
    `${OPS}/prepare-offer-checkout-intent.ts:30`,
    `${CMD}/writes/requests.ts:42`,
    `${CMD}/writes/requests.ts:47`,
    `${CMD}/writes/requests.ts:48`,
    `${CMD}/writes/requests.ts:49`,
    `${BACKEND}/src/requests/writes/purchases.ts:24`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare-offer-checkout (`plannedOfferCheckout`, commands/writes/transactions.ts:77) " +
    "for the signed-in payer it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    /** `validatorOf(PrepareOfferCheckoutExecutionInputSchema)`: checkoutId, payer, permissionId, signerAddress. */
    input: Schema.Unknown,
  }),
  output: Schema.Struct({ checkout: Schema.Unknown, prepared: PreparedPaymentCommand }),
  errors: PREPARE_INTENT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_require_account_signer_in_tx,
    procedure_requests_prepare_registered_purchase_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_invoice_checkout_intent = defineRpc({
  id: "payments.commands.prepare-invoice-checkout-intent",
  title: "Birth a registered payer's Invoice checkout Payment",
  about:
    "The internal mutation `payments/commands:prepareInvoiceCheckoutIntent`. Decodes the input strictly " +
    "(INVALID_INPUT), checks the caller's signer, has Requests' `prepareRegisteredInvoiceInTx` birth the Payment for " +
    "the link (it calls payments' `preparePaymentCommandInTx`), and requires the prepared Safe to be the signer's " +
    "Account Safe (INVALID_INPUT). Answers the Invoice summary and the prepared command.",
  was: [
    `${CONVEX}:11`,
    `${OPS}/prepare-invoice-checkout-intent.ts:17`,
    `${OPS}/prepare-invoice-checkout-intent.ts:27`,
    `${OPS}/prepare-invoice-checkout-intent.ts:33`,
    `${CMD}/writes/requests.ts:53`,
    `${CMD}/writes/requests.ts:58`,
    `${CMD}/writes/requests.ts:59`,
    `${CMD}/writes/requests.ts:60`,
    `${BACKEND}/src/requests/writes/checkouts.ts:20`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare-invoice-checkout (`plannedCheckout` with `invoice`, " +
    "commands/writes/transactions.ts:86) for the signed-in payer it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    /** `validatorOf(PrepareInvoiceCheckoutExecutionInputSchema)`: linkToken, payer, permissionId, signerAddress. */
    input: Schema.Unknown,
  }),
  output: Schema.Struct({ invoice: Schema.Unknown, prepared: PreparedPaymentCommand }),
  errors: PREPARE_INTENT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_require_account_signer_in_tx,
    procedure_requests_prepare_registered_invoice_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_prepare_request_checkout_intent = defineRpc({
  id: "payments.commands.prepare-request-checkout-intent",
  title: "Birth a registered payer's shared request checkout Payment",
  about:
    "The internal mutation `payments/commands:prepareRequestCheckoutIntent`: the shared request checkout over the " +
    "Invoice checkout engine, with the same input schema. Decodes strictly (INVALID_INPUT), checks the caller's " +
    "signer, has Requests' `prepareRegisteredRequestInTx` birth the Payment (it calls payments' " +
    "`preparePaymentCommandInTx`), and requires the prepared Safe to be the signer's Account Safe (INVALID_INPUT). " +
    "No payments action runs it: Requests' prepare-request-registered action reaches it through `checkoutPrepared`.",
  was: [
    `${CONVEX}:18`,
    `${OPS}/prepare-request-checkout-intent.ts:17`,
    `${OPS}/prepare-request-checkout-intent.ts:27`,
    `${OPS}/prepare-request-checkout-intent.ts:33`,
    `${CMD}/writes/requests.ts:64`,
    `${CMD}/writes/requests.ts:69`,
    `${CMD}/writes/requests.ts:70`,
    `${CMD}/writes/requests.ts:71`,
    `${CMD}/writes/transactions.ts:95`,
    `${CMD}/external/builds.ts:83`,
    `${BACKEND}/src/requests/checkouts/operations/prepare-request-registered.ts:16`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by Requests' prepare-request-registered action through `checkoutPrepared(input, \"request\")` and " +
    "`plannedCheckout` (commands/writes/transactions.ts:86), for the signed-in payer it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    /** `validatorOf(PrepareInvoiceCheckoutExecutionInputSchema)`: linkToken, payer, permissionId, signerAddress. */
    input: Schema.Unknown,
  }),
  output: Schema.Struct({ invoice: Schema.Unknown, prepared: PreparedPaymentCommand }),
  errors: PREPARE_INTENT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_require_account_signer_in_tx,
    procedure_requests_prepare_registered_request_in_tx,
    procedure_payments_prepare_payment_command_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal command writes ────────────────────────────────────────────────────────────────

export const rpc_payments_commands_claim_initiated = defineRpc({
  id: "payments.commands.claim-initiated",
  title: "Claim a command's one payment_initiated report",
  about:
    "The internal mutation `payments/commands:claimInitiated`. Loads the command by id (INVALID_INPUT when unknown), " +
    "authorizes the caller against the stored command (`authorizePaymentCommandSubmissionInTx`), and stamps " +
    "`paymentInitiatedClaimedAt` the first time, answering true; a later call answers false and writes nothing. The " +
    "answer becomes the prepare reply's `emitPaymentInitiated`, so the SDK sends `payment_initiated` once per " +
    "command; the server emits no event here.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/claim-initiated.ts:13`,
    `${OPS}/claim-initiated.ts:23`,
    `${EXE}/external/builds.ts:271`,
    `${EXE}/external/builds.ts:274`,
    `${CMD}/writes/initiations.ts:9`,
    `${CMD}/writes/initiations.ts:20`,
    `${CMD}/writes/initiations.ts:21`,
    `${CMD}/errors.ts:11`,
    ...AUTHORIZE_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by payments.commands.prepare (`initiationClaimed`, commands/writes/transactions.ts:101) and by " +
    "`storeBuiltExecution` (executions/external/builds.ts:271) when the request carries `items` (an Organization batch, " +
    "the Directors' payment, a payment request), each unless the execution already succeeded, for the caller it names " +
    "in `authUserId`. The checkout prepares and lifecycle steps never claim it.",
  input: Schema.Struct({ authUserId: Schema.String, commandId: Schema.String }),
  output: Schema.Boolean,
  errors: COMMAND_GUARD_ERRORS,
  reads: CLAIM.reads,
  writes: CLAIM.writes,
  drives: [],
  invokes: CLAIM.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_fail_prepared = defineRpc({
  id: "payments.commands.fail-prepared",
  title: "Fail a prepared command that can never be sent",
  about:
    "The internal mutation `payments/commands:failPrepared`. Loads the command (INVALID_INPUT when unknown) and " +
    "authorizes the caller against it. Only a command still `prepared` fails (a sent one ends through its receipt); " +
    "otherwise it answers false. `recordPaymentCommandOutcome(failed)` does nothing for a command already completed " +
    "or applied; else it reads the active execution, moves each Payment to failed (a failed void leaves its Payment; " +
    "a failed create_commitment fails a held one), cancels a bank payout at Bridge through Banking " +
    "(`payoutSendFailedInTx`, CAP-738), stamps the command `completionOutcome: failed`, and schedules a " +
    "`payment_transitioned` (transition failed, with the reason code and cause properties) through " +
    "payments.records.emitTransition. The caller (`recordPrepareFailure`) never lets a failed write replace the " +
    "refusal it reports; it reports the dropped record instead.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/fail-prepared.ts:14`,
    `${OPS}/fail-prepared.ts:29`,
    `${EXE}/writes/failures.ts:34`,
    `${EXE}/writes/failures.ts:42`,
    `${EXE}/writes/failures.ts:51`,
    ...FAIL_WAS,
    ...AUTHORIZE_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by `recordPrepareFailure` (executions/writes/failures.ts:34) from the funding and Roles gates and the " +
    "build of any payment prepare, for the caller it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    commandId: Schema.String,
    reasonCode: Schema.String,
    /** `causePropertiesValidator`: the typed cause's failure mode and chain cause properties. */
    causeProps: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Boolean,
  errors: COMMAND_GUARD_ERRORS,
  reads: FAIL.reads,
  writes: FAIL.writes,
  drives: FAIL.drives,
  invokes: FAIL.invokes,
  emits: FAIL.emits,
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_link_observation = defineRpc({
  id: "payments.commands.link-observation",
  title: "Record who first prepared a command and the trace it continues",
  about:
    "The internal mutation `payments/commands:linkObservation`. Loads the command (INVALID_INPUT when unknown), " +
    "authorizes the caller, and refuses a command whose verification is `unresolved` or `mismatch` (WRONG_STATE). " +
    "Patches the originating auth user, the sanitized originating observation context (only when no originator was " +
    "recorded yet), the correlation and journey ids, each kept when already set, and `updatedAt`.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/link-observation.ts:14`,
    `${OPS}/link-observation.ts:29`,
    `${CMD}/writes/submissions.ts:48`,
    `${CMD}/writes/submissions.ts:64`,
    `${CMD}/writes/submissions.ts:65`,
    `${CMD}/writes/submissions.ts:72`,
    ...AUTHORIZE_WAS,
  ],
  concept: concept_payments,
  kind: "mutation",
  who:
    "internal: run by `getOrBuildStoredExecution` (executions/external/builds.ts:233) before a payment command's " +
    "execution is built, for the caller it names in `authUserId`.",
  input: Schema.Struct({
    authUserId: Schema.String,
    commandId: Schema.String,
    correlationId: Schema.optionalKey(Schema.String),
    journeyId: Schema.optionalKey(Schema.String),
    originatingObservationContext: Schema.optionalKey(ObservationContext),
  }),
  output: Schema.Undefined,
  errors: union(COMMAND_GUARD_ERRORS, [error_WRONG_STATE]),
  reads: LINK.reads,
  writes: LINK.writes,
  drives: [],
  invokes: LINK.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal command reads ─────────────────────────────────────────────────────────────────

export const rpc_payments_commands_load_birth_funding = defineRpc({
  id: "payments.commands.load-birth-funding",
  title: "What a new command would spend, and from which Safe",
  about:
    "The internal query `payments/commands:loadBirthFunding`. Refuses when money writes are off (NOT_IMPLEMENTED). " +
    "Reads the caller's Account; answers null when a named payer Account is not the caller's, when a checkout's " +
    "frozen terms are absent (Requests' `checkoutBirthTermsInTx`), or when the request key already has a " +
    "`paymentDocumentIntents` row (a known request key keeps the build's checks). Otherwise sums the amounts per " +
    "token, resolves the execution route (direct, Roles under the Permission, or a v4 budget) and answers the chain, " +
    "the sender Safe, the totals, the Organization Budget allowance row (Permissions' `readBudgetAllowanceInTx`) and " +
    "the v4 budget route.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/load-birth-funding.ts:13`,
    `${OPS}/load-birth-funding.ts:40`,
    `${CMD}/reads/funding.ts:41`,
    `${CMD}/reads/funding.ts:43`,
    `${CMD}/reads/funding.ts:47`,
    `${CMD}/reads/funding.ts:52`,
    `${CMD}/reads/funding.ts:72`,
    `${CMD}/reads/funding.ts:91`,
    `${SRC}/guards/authority.ts:97`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: run by `birthFunding` (commands/reads/funding.ts:101) from `birthFunded`: payments.commands.prepare, " +
    "prepare-organization, `payerFunded` (prepare-request, both checkouts and Requests' prepare-request-registered " +
    "through `checkoutPrepared`) and Payroll's authorize action.",
  input: Schema.Struct({
    authUserId: Schema.String,
    spend: Schema.Union([
      Schema.Struct({
        requestKey: Schema.String,
        amounts: Schema.Array(Schema.Struct({ asset: Schema.String, value: Schema.String })),
      }),
      Schema.Struct({
        checkout: Schema.Union([
          Schema.Struct({ kind: Schema.Literal("offer"), checkoutId: Schema.String }),
          Schema.Struct({ kind: Schema.Literals(["invoice", "request"]), linkToken: Schema.String }),
        ]),
      }),
    ]),
    organization: Schema.optionalKey(Schema.Struct({ orgId: Schema.String, permissionId: Schema.String })),
    accountId: Schema.optionalKey(Schema.String),
  }),
  output: Schema.NullOr(
    Schema.Struct({
      chainId: Schema.Number,
      sender: Schema.String,
      required: Schema.Array(Schema.Struct({ token: Schema.String, total: Schema.String })),
      /** Permissions' Budget allowance row (`readBudgetAllowanceInTx`); too deep to transcribe. */
      budget: Schema.NullOr(Schema.Unknown),
      budgetRoute: Schema.NullOr(Schema.Struct({ budgets: Schema.String, budgetId: Schema.String })),
    }),
  ),
  errors: union(INTENT_ERRORS, DEFECT),
  reads: [table_payment_document_intents],
  writes: [],
  drives: [],
  invokes: [
    procedure_accounts_require_payment_account_in_tx,
    procedure_requests_checkout_birth_terms_in_tx,
    procedure_permissions_read_budget_allowance_in_tx,
    ...ORG_ROUTE_INVOKES,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_load_budget_allowance = defineRpc({
  id: "payments.commands.load-budget-allowance",
  title: "The capped Budget a prepared Organization command spends from",
  about:
    "The internal query `payments/commands:loadBudgetAllowance`. Answers null for an unknown command, an Account " +
    "command, a command whose verification has started, a command with an active execution, or Payments that do not " +
    "share one Permission. Otherwise answers Permissions' Budget allowance row for the Organization and that " +
    "Permission (null when nothing caps it on chain). `attempt([])` admits no code: every failure is a defect.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/load-budget-allowance.ts:12`,
    `${OPS}/load-budget-allowance.ts:20`,
    `${CMD}/reads/budgets.ts:22`,
    `${CMD}/reads/budgets.ts:24`,
    `${CMD}/reads/budgets.ts:34`,
    `${CMD}/reads/budgets.ts:44`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: run by `budgetAllowance` (commands/reads/budgets.ts:49) from `budgetAllowanceAdmits`: the build gate of " +
    "the payment prepares, Payroll's run build and Organizations' pay-scheduled action.",
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(Schema.Unknown),
  errors: DEFECT,
  reads: [table_payment_commands, table_money_executions, table_payments],
  writes: [],
  drives: [],
  invokes: [procedure_permissions_read_budget_allowance_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_load_context = defineRpc({
  id: "payments.commands.load-context",
  title: "A command, who sent it, and its live or latest execution",
  about:
    "The internal query `payments/commands:loadContext`. Answers null for an unknown command. Otherwise reads the " +
    "command's payment executions and picks the active one, else the newest, and answers the telemetry join: " +
    "recipient observations, originating user, Organization, Payment ids, command and lifecycle ids, originating " +
    "observation context, execution id and state, operation hash, correlation and journey ids, sponsorship window, " +
    "sender, nonce, EntryPoint scan floor and completion outcome. `attempt([])`: every failure is a defect.",
  was: [
    `${CONVEX}:8`,
    `${OPS}/load-context.ts:12`,
    `${OPS}/load-context.ts:20`,
    `${CMD}/reads/contexts.ts:115`,
    `${CMD}/reads/contexts.ts:117`,
    `${CMD}/reads/contexts.ts:122`,
    `${CMD}/reads/contexts.ts:158`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: run by `commandContext` (commands/reads/contexts.ts:158) from payments.verifications.verify and the " +
    "lifecycles prepare actions (lifecycles/external.ts:28).",
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      recipientObservations: Schema.Array(RecipientObservation),
      authUserId: Schema.optionalKey(Schema.String),
      organizationId: Schema.optionalKey(Schema.String),
      paymentIds: Schema.Array(Schema.String),
      commandId: Schema.String,
      intentId: Schema.String,
      paymentLifecycleId: Schema.optionalKey(Schema.String),
      originatingObservationContext: Schema.optionalKey(ObservationContext),
      executionId: Schema.optionalKey(Schema.String),
      userOpHash: Schema.optionalKey(Schema.String),
      correlationId: Schema.optionalKey(Schema.String),
      journeyId: Schema.optionalKey(Schema.String),
      executionState: Schema.optionalKey(Schema.String),
      sponsorshipValidUntil: Schema.optionalKey(Schema.Number),
      sender: Schema.optionalKey(Schema.String),
      nonce: Schema.optionalKey(Schema.String),
      scanFloor: Schema.optionalKey(Schema.Number),
      completionOutcome: Schema.optionalKey(Schema.Literals(["settled", "failed"])),
    }),
  ),
  errors: DEFECT,
  reads: [table_payment_commands, table_money_executions],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_commands_load_execution_context = defineRpc({
  id: "payments.commands.load-execution-context",
  title: "The command behind one of the caller's executions",
  about:
    "The internal query `payments/commands:loadExecutionContext`. Refuses an unknown execution or one another user " +
    "built (INVALID_INPUT, `Money execution not found`). Answers null when the execution's command is not a payment " +
    "command; otherwise the telemetry join of execution and command: ids, lifecycle id, originating context, Payment " +
    "ids, request key, operation, Organization, operation hash (sent or expected), correlation and journey ids, " +
    "sponsorship window and execution state.",
  was: [
    `${CONVEX}:9`,
    `${OPS}/load-execution-context.ts:12`,
    `${OPS}/load-execution-context.ts:20`,
    `${CMD}/reads/contexts.ts:80`,
    `${CMD}/reads/contexts.ts:85`,
    `${CMD}/reads/contexts.ts:92`,
    `${CMD}/reads/contexts.ts:167`,
  ],
  concept: concept_payments,
  kind: "query",
  who:
    "internal: run by `executionContext` (commands/reads/contexts.ts:167) from payments.executions.submit, " +
    "submit-command and abandon, for the signed-in caller it names in `authUserId`.",
  input: Schema.Struct({ authUserId: Schema.String, executionId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      authUserId: Schema.String,
      executionId: Schema.String,
      commandId: Schema.String,
      paymentLifecycleId: Schema.optionalKey(Schema.String),
      originatingObservationContext: Schema.optionalKey(ObservationContext),
      paymentIds: Schema.Array(Schema.String),
      requestKey: Schema.optionalKey(Schema.String),
      operation: ExecutionOperation,
      organizationId: Schema.optionalKey(Schema.String),
      userOpHash: Schema.optionalKey(Schema.String),
      correlationId: Schema.optionalKey(Schema.String),
      journeyId: Schema.optionalKey(Schema.String),
      sponsorshipValidUntil: Schema.optionalKey(Schema.Number),
      executionState: Schema.String,
    }),
  ),
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_money_executions, table_payment_commands],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
