// Banking's payouts area: paying a bank account through Bridge. The quote creates Bridge's
// transfer and births the payout with its Payment in one transaction; from then on the payout's
// one durable process (./processes.ts) follows it. The rpcs here are the quote, the read the bank
// pay flow follows, and an operator's resolution of a payout that needs a person.

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { contract_budgets, contract_erc20, integration_bridge, integration_chain_rpc } from "../shared/external.ts";
import {
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_VERIFICATION_REQUIRED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  Currency,
  machine_bank_account,
  machine_bank_payout,
  PayoutReason,
  table_bank_accounts,
  table_bank_payouts,
  table_verifications,
  Token,
} from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_org_members } from "../organizations/data.ts";
import { table_payments } from "../payments/data.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { table_budgets } from "../budgets/data.ts";

const PO = "packages/backend/src/banking/payouts";
const S = Schema.String;

/** A payout as `bank pay` follows it. `stage` `funding` is read from the Payment: the payout is quoted and its Payment sent. */
export const PayoutView = Schema.Struct({
  payoutId: S,
  status: Schema.Literals(["awaiting_approval", "in_transit", "delivered", "failed"]),
  stage: Schema.Literals(["quoted", "funding", "in_transit", "delivered", "returning", "refunded", "expired", "needs_attention"]),
  stageReason: Schema.NullOr(PayoutReason),
  quote: Schema.Struct({
    receive: Schema.Struct({ currency: Currency, amount: S }),
    send: Schema.Struct({ token: Token, amount: S }),
    slippage: S,
    rate: S,
    fee: S,
    expiresAt: Schema.Number,
  }),
  account: Schema.Struct({ partyAccountId: S, bankName: Schema.NullOr(S), last4: S, currency: Currency }),
  /** For an Organization, the budget it pays from as `--from` named it, with its name ("from Office costs"). */
  budget: Schema.NullOr(Schema.Struct({ budgetId: S, key: Schema.NullOr(S), name: Schema.NullOr(S) })),
  paymentIds: Schema.Array(S),
  approvalId: Schema.NullOr(S),
  approvalUrl: Schema.NullOr(S),
  refund: Schema.NullOr(Schema.Struct({ txHash: S, amount: S, safe: S })),
  warnings: Schema.Array(Schema.Struct({ code: S, message: S })),
});

export const rpc_banking_payouts_quote = defineRpc({
  id: "banking.payouts.quote",
  title: "Quote a bank payout and birth it with its Payment",
  about:
    "`bank pay`'s one write. A known request key with the same request returns its payout and pays nothing twice; " +
    "another request under it is INVALID_INPUT. Before any call it refuses an amount unit that disagrees with the " +
    "funding asset, or an asset that cannot pay the currency (EURC to GBP): INVALID_INPUT; an account that is not the " +
    "owner's, removed or inactive: WRONG_STATE (the bank account changed); an owner not verified for the currency: " +
    "VERIFICATION_REQUIRED. An account still `saved` is registered at Bridge first, under its own id. Bridge then " +
    "creates the transfer under the payout's id (derived from the owner and request key): an amount on its own fixes " +
    "what reaches the bank, a token fixes what leaves the Safe; the quote locks the bank amount and a slippage buffer " +
    "inside the funding. An Organization's `from` is the budget's Capxul key (`office-costs`) or chain id; an unknown " +
    "key is INVALID_INPUT. It reads the funding live at one block: the Safe's `balanceOf` for a person; for an " +
    "Organization the budget's `budgetOf` (closed: WRONG_STATE), `authorised` for the member's Safe " +
    "(ROLE_PERMISSION_DENIED) and `leftOf`. Then one transaction writes the payout (`quote`, with the approval's id), " +
    "the account's `register`, Bridge's deposit address as an outside Party (`parties.resolve-recipient`) and the " +
    "Payment command (`payments.prepare-command`, purpose `bank_payout`, one item of the quoted amount to the deposit " +
    "address, kind 0, no document, its hash the keccak-256 of the payout id (banking.payout-document-hash), `fee_raw` " +
    "the quote's `fee_amount`, for a contact's account `against` party the contact's Party as Supplier " +
    "(banking.payout-books); `not_after` the quote's `expires_at`, so nothing moves after it; `pay_at` null, `resume` " +
    "false): personal `approve` and `Payments.send`, or the budget's `Budgets.spend`. Funding short is " +
    "INSUFFICIENT_BALANCE, a budget short PAYROLL_BUDGET_EXCEEDED, both before anything is written. It answers the " +
    "quote with the approval to sign.",
  concept: concept_banking,
  kind: "action",
  who:
    "A signed-in person verified for the currency, paying from their own Safe; for an Organization, the wearer of the " +
    "named budget's hat or a hat above it (Budgets checks it on chain; the rpc reads `authorised` first).",
  input: Schema.Struct({
    org_id: Schema.NullOr(S),
    /** `--from`: the budget an Organization pays from, by its Capxul key or its chain id; null for a person. */
    from: Schema.NullOr(S),
    to: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("self") }),
      Schema.Struct({ kind: Schema.Literal("contact"), party_id: S }),
    ]),
    bank_account_id: Schema.NullOr(S),
    amount: S,
    fixed_token: Schema.NullOr(Token),
    funding_token: Schema.NullOr(Token),
    request_key: S,
  }),
  output: PayoutView,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_VERIFICATION_REQUIRED,
    error_INSUFFICIENT_BALANCE,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_ROLE_PERMISSION_DENIED,
    error_INVALID_RECIPIENT,
    error_PROVIDER_ERROR,
    error_RATE_LIMITED,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [table_bank_payouts, table_bank_accounts, table_verifications, table_parties, table_org_members, table_budgets],
  writes: [table_bank_payouts, table_bank_accounts],
  drives: [machine_bank_payout.t.quote, machine_bank_account.t.register],
  invokes: [procedure_parties_resolve_recipient, procedure_payments_prepare_command],
  emits: [],
  calls: [
    integration_bridge.c.addBankAccount,
    integration_bridge.c.quotePayout,
    integration_chain_rpc.c.getBlock,
    integration_chain_rpc.c.readContract,
  ],
  chain: [contract_erc20.f.balanceOf, contract_budgets.f.budgetOf, contract_budgets.f.authorised, contract_budgets.f.leftOf],
  spans: ["rpc.banking.payouts.quote"],
  budget: {
    ...budget("vendor"),
    p95Ms: 5_000,
    why: "two Bridge calls in sequence when the account is still saved (register, then quote), then the funding reads",
  },
  was: [
    `${PO}/operations/quote.ts:1`,
    `${PO}/operations/prepare.ts:1`,
    `${PO}/operations/request.ts:1`,
    `${PO}/operations/finalize.ts:1`,
    "docs/as-is/archive/banking/payouts.ts:541",
  ],
});

export const rpc_banking_payouts_get = defineRpc({
  id: "banking.payouts.get",
  title: "Read one payout and how far it got",
  about:
    "The payout as `bank pay` follows it: its stage and reason, the quote (the locked bank amount, the funding with its " +
    "slippage buffer, the rate and the deadline), the account masked, its Payment and approval, and for a failed payout " +
    "why it failed and the refund's transaction and Safe. `funding` is not a stored state: it is a `quoted` payout whose " +
    "Payment payments shows `submitted`. An id that is not the owner's is INVALID_INPUT. It writes nothing.",
  concept: concept_banking,
  kind: "query",
  who: "The payer: the signed-in person, or a member of the Organization that pays.",
  input: Schema.Struct({ org_id: Schema.NullOr(S), payout_id: S }),
  output: PayoutView,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_bank_payouts, table_bank_accounts, table_payments, table_org_members, table_budgets],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.payouts.get"],
  budget: budget("read"),
  was: [`${PO}/operations/outcome.ts:1`, `${PO}/rules/stage.ts:1`, "docs/as-is/archive/banking/payouts.ts:317"],
});

export const rpc_banking_payouts_resolve = defineRpc({
  id: "banking.payouts.resolve",
  title: "An operator settles a payout that needs a person",
  about:
    "The payout process's signal for `needs_attention`: an operator names the end (delivered, refunded or expired), who " +
    "they are and why, and the process applies it and keeps both on the payout. `delivered` needs the amount Bridge " +
    "reported, or a quote that locked one: no Payment's story ends on an estimate (INVALID_INPUT otherwise). A payout " +
    "that does not need attention is WRONG_STATE. Replaces old `banking.payouts.resolve`, run from the Convex dashboard.",
  concept: concept_banking,
  kind: "mutation",
  who: "operator: a Capxul operator with the deploy key; no person or agent session can call it.",
  input: Schema.Struct({
    owner_id: S,
    payout_id: S,
    to: Schema.Literals(["delivered", "refunded", "expired"]),
    why: S,
  }),
  output: Schema.Struct({ payoutId: S, accepted: Schema.Boolean }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_bank_payouts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.payouts.resolve"],
  budget: budget("write"),
  was: [`${PO}/operations/resolve.ts:1`, "docs/as-is/archive/banking/payouts.ts:411"],
});
