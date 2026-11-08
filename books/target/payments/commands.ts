// Area commands: the births. A `payment send` (personal, from a budget, into a claim escrow, dated or now)
// and an `org department pay` are one rpc, `payments.commands.prepare`, which reads funding and authority
// from the chain, then births the command, its Payments, their document and the approval from the payer's
// own Safe in one transaction. A Board payment (`--as-directors`) is `payments.commands.propose`, which births
// the same records with a Board proposal instead of an approval. Each Payment's durable process
// (./processes.ts) starts from the birth (`open`) and owns the Payment from then on.
//
// Every prepared Payment knows its v4 payment id before anyone signs: `Payments.paymentId(item)` for a direct
// send, Budgets' derivation from the job nonce for a budget spend or schedule, `EscrowFactory.predictPaymentId`
// for a claim escrow, the general escrow at its counterfactual address (payments.general-escrow). That id is what
// settles it (./processes.ts) and what makes a retry unable to pay twice.

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
import * as booksData from "../books/data.ts";
import * as budgetsData from "../budgets/data.ts";
import { table_chain_budgets, table_hat_wearers } from "../indexing/data.ts";
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
  /** `--account`: the code of the Organization's chart it is booked to, like 6100; kept on each Payment as its `against`. */
  account: Null(S),
  /** `--suggest`: a name for a new account, beside 4999 or 6999, for someone with Manage books to decide. */
  suggest: Null(S),
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
    "paying Safe's balance, or for `--org` the budget's `leftOf` and `authorised` for the caller's Safe (the one " +
    "allowance or department they hold, `--from` among several, a `dep_` department's top budget). A shortfall, a " +
    "missing authority, a closed budget or an unbound department refuses here, and nothing is written (K3). Then, in one transaction: the request key's command (a repeat answers the first command as it " +
    "stands; another request under the key is refused, K1), the payee's Party and Safe (`parties.resolve-recipient`), " +
    "the note's document or the bytes of `--document` (`documents.store`: its hash goes on chain), one Payment per item " +
    "born through `open` with its payment id, and the approval from the caller's Safe carrying the calls " +
    "(`approvals.open`): `approve` and `Payments.send` (kind 0, `sendBatch` for several items of `--input`), or " +
    "`Budgets.spend` or, dated, `Budgets.schedule` from a budget. A mailbox with no live Safe is a claim escrow (route " +
    "`claim_escrow`, its mailbox kept), now or dated: a general escrow owned by the email's derived Safe, its address " +
    "in `escrow_address`, its funding's payment id in `funding_payment_id`. A personal one's sender is the payer's " +
    "Safe (`Payments.send` to the address, and `EscrowFactory.deploy`); a budget's is the company Safe, with Budgets " +
    "and the budget as authority (`Budgets.spend` or, dated, `schedule` to the address), so whoever wears the budget's " +
    "hat or one above it then, or the Board, may take it back. A non-ASCII mailbox is INVALID_RECIPIENT " +
    "(payments.claim-escrow-routes). " +
    "`--account` (a code of the payer's chart: the Organization's open ledger accounts, or the fixed personal chart) " +
    "and `--suggest` (only beside 4999 or 6999) become each Payment's `against`; a bad one is INVALID_INPUT naming it " +
    "(payments.money-sides). A dated personal payment is signed now, sent on its day. It answers the CLI's preview.",
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
    booksData.table_book_accounts,
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
    contract_escrow_factory.f.predictAddress,
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
    "company Safe's balance, or for a dated payment the open top budgets in the asset that no member holds (whose hat " +
    "no Safe but the company Safe wears: the install's own, under the Board's top hat from the Organization's deployment " +
    "row, or one the Board keeps without a holder; indexing's chain budgets and hat wearers) and their `leftOf`; no " +
    "room in any is PAYROLL_BUDGET_EXCEEDED, and nothing is written. Then, in one " +
    "transaction: the command, the payee's Party and Safe, the note's document, one Payment per item born through `open`, " +
    "and one Board proposal at the Safe's next nonce (`board.propose`) carrying either `approve` and one exact " +
    "`Payments.send` (kind 0) whose executor is the company Safe, or, dated, one `Budgets.schedule` on the one of those " +
    "with the most left, so no department's holders can cancel it (payments.department-authority). An immediate Board payment cannot be a budget spend: the Gate refuses re-entry from " +
    "inside a Safe transaction. The calls are checked against what was asked (amount, recipient, contract) before the " +
    "proposal opens; nothing moves until enough Directors approve. An immediate payment to a mailbox with no live Safe is " +
    "a general escrow whose sender is the company Safe and which names no authority (route `claim_escrow`, its mailbox " +
    "kept, its other terms as `prepare` gives them): the batch pays its address through `Payments.send` and sends " +
    "`EscrowFactory.deploy`, and only a Board proposal takes it back. A dated one is `Budgets.schedule` on that top " +
    "budget to the escrow's address, its authority Budgets with that budget's id, so again only the Board; a non-ASCII " +
    "mailbox is INVALID_RECIPIENT (payments.claim-escrow-routes). It takes no `--account` or `--suggest`. A Board payment takes no " +
    "request key from the caller: its key is the proposal's own subject.",
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
    orgsData.table_org_deployments,
    budgetsData.table_budgets,
    table_chain_budgets,
    table_hat_wearers,
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
    contract_escrow_factory.f.predictPaymentId,
    contract_escrow_factory.f.predictAddress,
    contract_companies_house_claimer.f.safeAddressFor,
    contract_erc20.f.approve,
    contract_payments.f.send,
    contract_payments.f.sendBatch,
    contract_budgets.f.schedule,
    contract_escrow_factory.f.deploy,
  ],
  spans: [],
  budget: budget("chain-read"),
  was: [
    `${OLD}/commands/operations/prepare-organization.ts`,
    "packages/backend/src/organizations/proposals/writes/settlements.ts:73",
    "apps/docs/factory/operations/payment.send.yaml",
  ],
});
