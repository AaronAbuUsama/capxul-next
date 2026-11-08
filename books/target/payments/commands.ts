// Area commands: the births. A `payment send` (personal, from a budget, into a claim escrow, dated or now)
// and an `org department pay` are one rpc, `payments.commands.prepare`, which reads funding and authority
// from the chain, then births the command, its Payments, their document and the approval from the payer's
// own Safe in one transaction. A Board payment (`--as-directors`) is `payments.commands.propose`, which births
// the same records with a Board proposal instead of an approval. Each Payment's durable process
// (./processes.ts) starts from the birth (`open`) and owns the Payment from then on.
//
// Every prepared Payment knows its v4 payment id before anyone signs: `Payments.paymentId(item)` for a direct
// send, Budgets' derivation from the job nonce for a budget spend or schedule, `EscrowFactory.predictPaymentId`
// for a claim escrow. That id is what settles it (./processes.ts) and what makes a retry unable to pay twice.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_companies_house_claimer,
  contract_erc20,
  contract_escrow_factory,
  contract_payments,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as approvals from "../approvals/procedures.ts";
import * as budgetsData from "../budgets/data.ts";
import * as orgsData from "../organizations/data.ts";
import * as parties from "../parties/procedures.ts";
import * as partiesData from "../parties/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { ReceiptContent, procedure_documents_store } from "../documents/procedures.ts";
import { Route, machine_payment, table_payment_commands, table_payments } from "./data.ts";

const OLD = "packages/backend/src/payments";
const S = Schema.String;
const Null = Schema.NullOr;

// ── shapes the flows and operations share ───────────────────────────────────────────────────

/** The v4 payment kinds a person can name (`--kind`); agreement collections and sweeps are born from chain facts. */
export const PaymentKind = Schema.Literals(["bill", "one-off", "reimbursement", "transfer"]);

/** What `payment send` and `org department pay` ask for. */
export const SendInput = Schema.Struct({
  to: S,
  amount: S,
  asset: Null(S),
  org: Null(S),
  from: Null(S),
  department: Null(S),
  kind: Null(PaymentKind),
  pay_at: Null(S),
  note: Null(S),
  /** `--document <file>`: the receipt's bytes as the SDK read them (at most 128 KB), stored byte for byte by documents. */
  document: Null(ReceiptContent),
  request_key: S,
});

/** What the payer sees before signing: the route, the budget it spends from and every payment id. */
export const Preview = Schema.Struct({
  route: Route,
  from_label: S,
  payee_label: S,
  amount: S,
  asset: S,
  pay_at: Null(S),
  budget: Null(Schema.Struct({ key: S, left: S })),
  chain_payment_ids: Schema.Array(S),
});

/** The hand-over every money command prints with `--json`: the approval or proposal to sign, and its Payments. */
export const Handover = Schema.Struct({
  command_id: S,
  payment_ids: Schema.Array(S),
  status: Schema.Literal("awaiting_approval"),
  approval_id: Null(S),
  proposal_id: Null(S),
  approval_url: Null(S),
  expires_at: Null(Schema.Number),
  replayed: Schema.Boolean,
  preview: Preview,
});

const READ_FAILURES = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;

// ── rpcs ────────────────────────────────────────────────────────────────────────────────────

export const rpc_payments_commands_prepare = defineRpc({
  id: "payments.commands.prepare",
  title: "Prepare a payment from the payer's own Safe",
  about:
    "Births a payment that the payer's own Safe signs. Before its transaction it reads what the chain must allow: the " +
    "paying Safe's balance (personal, claim escrow), or for `--org` the budget's `leftOf` and `authorised` for the caller's " +
    "Safe (the one spending allowance or department they hold, `--from` among several, a `dep_` department's top " +
    "budget). A shortfall, a missing authority, a closed budget or a department whose budget id is not bound yet refuses " +
    "here, and nothing is written (K3). Then, in one transaction: the request key's command (a repeat with the same " +
    "request answers the first command as it stands; another request under the key is refused, K1), the payee resolved " +
    "to its Party and Safe (`parties.resolve-recipient`; a mailbox with no live Safe is paid into a claim escrow), the " +
    "document of the note, or the bytes of `--document` (`documents.store`: its hash goes on chain), one Payment per item born through " +
    "`open` with its payment id, and the approval from the caller's Safe that carries the calls (`approvals.open`): " +
    "`approve` and `Payments.send` (kind 0) for a personal payment (`sendBatch` for several items of `--input`, all or none), " +
    "`Budgets.spend` or, dated, `Budgets.schedule` from a " +
    "budget, `EscrowFactory.deploy` funded in the same operation for a claim escrow. A personal dated payment is the same " +
    "operation signed now and sent on its day (`sendAfter`, with what the Safe needs that day). It answers the hand-over " +
    "with the preview the CLI shows before signing; signing and following are the flow's.",
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in person or agent, for themselves. With `--org`, a member whose own Safe wears the budget's hat or one " +
    "above it (read from Budgets before the birth, and proved again by the chain when the approval is sponsored).",
  input: SendInput,
  output: Handover,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_INVALID_RECIPIENT,
    error_INSUFFICIENT_BALANCE,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_ROLE_PERMISSION_DENIED,
    error_WRONG_STATE,
    ...READ_FAILURES,
  ],
  reads: [
    table_payment_commands,
    table_payments,
    partiesData.table_parties,
    orgsData.table_organizations,
    orgsData.table_org_members,
    budgetsData.table_budgets,
  ],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open],
  invokes: [parties.procedure_parties_resolve_recipient, procedure_documents_store, approvals.procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getCode],
  chain: [
    contract_erc20.f.balanceOf,
    contract_budgets.f.leftOf,
    contract_budgets.f.authorised,
    contract_payments.f.paymentId,
    contract_escrow_factory.f.predictPaymentId,
    contract_companies_house_claimer.f.safeAddressFor,
    contract_erc20.f.approve,
    contract_payments.f.send,
    contract_payments.f.sendBatch,
    contract_budgets.f.spend,
    contract_budgets.f.schedule,
    contract_escrow_factory.f.deploy,
  ],
  spans: [],
  budget: budget("chain-read"),
  was: [
    `${OLD}/commands/operations/prepare.ts:20`,
    `${OLD}/commands/operations/prepare-organization.ts`,
    `${OLD}/commands/external/funding.ts:104`,
    `${OLD}/executions/external/builds.ts:76`,
    "docs/as-is/archive/payments/commands.ts",
  ],
});

export const rpc_payments_commands_propose = defineRpc({
  id: "payments.commands.propose",
  title: "Propose a Board payment from the company Safe",
  about:
    "Births a payment the company Safe makes as a Board batch (`--as-directors`). Before its transaction it reads the " +
    "company Safe's balance, or for a dated payment its open top budgets in the asset and their `leftOf`. Then, in one " +
    "transaction: the command, the payee's Party and Safe, the note's document, one Payment per item born through `open`, " +
    "and one Board proposal at the Safe's next nonce (`board.propose`) carrying either `approve` and one exact " +
    "`Payments.send` (kind 0) whose executor is the company Safe, or, dated, one `Budgets.schedule` on the open top budget " +
    "in the asset with the most left. An immediate Board payment cannot be a budget spend: the Gate refuses re-entry from " +
    "inside a Safe transaction. The calls are checked against what was asked (amount, recipient, contract) before the " +
    "proposal opens; nothing moves until enough Directors approve. A Board payment takes no request key from the caller: " +
    "its key is the proposal's own subject.",
  concept: concept_payments,
  kind: "action",
  who: "A Director of the Organization (wears the Director hat): the proposer, whose own approval of the proposal counts first.",
  input: SendInput,
  output: Handover,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_INVALID_RECIPIENT,
    error_INSUFFICIENT_BALANCE,
    error_ROLE_PERMISSION_DENIED,
    error_WRONG_STATE,
    ...READ_FAILURES,
  ],
  reads: [
    table_payment_commands,
    table_payments,
    partiesData.table_parties,
    orgsData.table_organizations,
    orgsData.table_org_members,
    budgetsData.table_budgets,
  ],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open],
  invokes: [parties.procedure_parties_resolve_recipient, procedure_documents_store, procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getCode],
  chain: [
    contract_erc20.f.balanceOf,
    contract_budgets.f.leftOf,
    contract_payments.f.paymentId,
    contract_erc20.f.approve,
    contract_payments.f.send,
    contract_payments.f.sendBatch,
    contract_budgets.f.schedule,
  ],
  spans: [],
  budget: budget("chain-read"),
  was: [
    `${OLD}/commands/operations/prepare-organization.ts`,
    "packages/backend/src/organizations/proposals/writes/settlements.ts:73",
    "apps/docs/factory/operations/payment.send.yaml",
  ],
});
