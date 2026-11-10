// Banking's bank details area: the receiving accounts people pay an owner by, one Bridge virtual
// account per owner and currency, paying into the owner's Safe in USDC or EURC. Both rpcs are whole
// operations: `bank details` opens what is missing and shows the overview; `bank settle` changes
// the token one currency's deposits become.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { integration_bridge } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_VERIFICATION_REQUIRED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { Currency, machine_bank_details, Rail, table_bank_details, table_verifications, Token } from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const B = "packages/backend/src/banking/bank-details";
const S = Schema.String;

const MANAGE =
  "For an Organization, opening details it lacks or changing them needs current authority to manage it: a Director (the " +
  "Director hat) or the Books officer (the Books hat), read from the deployment's hat ids and indexing's hat wearers " +
  "(decision banking.manage-authority).";

/** One currency's bank details as `bank details` shows them. */
export const BankDetailsView = Schema.Struct({
  currency: Currency,
  state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
  visibility: Schema.Literals(["masked", "full"]),
  fields: Schema.Struct({
    bankName: S,
    payeeName: S,
    rail: Schema.NullOr(Rail),
    last4: S,
    routingNumber: Schema.NullOr(S),
    accountNumber: Schema.NullOr(S),
    iban: Schema.NullOr(S),
    bic: Schema.NullOr(S),
    sortCode: Schema.NullOr(S),
  }),
  destination: Schema.Struct({ chainId: Schema.Number, token: Token, address: S }),
  developerFeePercent: Schema.NullOr(S),
});

export const BankDetailsOverview = Schema.Struct({
  items: Schema.Array(BankDetailsView),
  unverified: Schema.Array(Schema.Struct({ currency: Currency, next: Schema.Array(S) })),
});

const bridgeFailures = [error_PROVIDER_ERROR, error_RATE_LIMITED, error_PROVIDER_RESPONSE_INVALID] as const;

export const rpc_banking_details_show = defineRpc({
  id: "banking.details.show",
  title: "Open missing bank details for approved currencies, then show them",
  about:
    "For each currency the owner's verification approves and that has no bank details (or only failed ones), and only " +
    "when the caller may manage the owner, it asks Bridge to open the virtual account into the owner's Party's Safe in " +
    "USDC, under the row's own key, then writes the row (`open`, and `activate` when Bridge activated it at once; `fail` " +
    "or `reopen` for a failed one); the up to three calls run in parallel. Then it answers the overview: every currency's " +
    "details masked, the full numbers only for the one `--currency` named (decrypted here, never logged), each " +
    "currency still to verify with the `verify start` command that keeps the Organization scope, and Capxul's fee when " +
    "it takes one. A member who may not manage an Organization still sees its existing details read-only. Refused: no " +
    "verification, or `--currency` not approved (WRONG_STATE, naming `capxul verify start`); `--currency` that the " +
    "Organization lacks and the caller may not open (ROLE_PERMISSION_DENIED).",
  concept: concept_banking,
  kind: "action",
  who: "A signed-in person who is verified for the currency, for their own details, or a member of the Organization they act as. " + MANAGE,
  input: Schema.Struct({ org_id: Schema.NullOr(S), currency: Schema.NullOr(Currency) }),
  output: BankDetailsOverview,
  errors: [
    error_NOT_AUTHENTICATED,
    error_WRONG_STATE,
    error_ROLE_PERMISSION_DENIED,
    error_VERIFICATION_REQUIRED,
    ...bridgeFailures,
  ],
  reads: [table_bank_details, table_verifications, table_parties, table_org_members, table_org_deployments, table_hat_wearers],
  writes: [table_bank_details],
  drives: [machine_bank_details.t.open, machine_bank_details.t.activate, machine_bank_details.t.fail, machine_bank_details.t.reopen],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.openBankDetails],
  chain: [],
  spans: ["rpc.banking.details.show"],
  budget: budget("vendor"),
  was: [`${B}/operations/open.ts:1`, `${B}/operations/get.ts:1`, `${B}/operations/list.ts:1`, "docs/as-is/archive/banking/flows.ts:43"],
});

export const rpc_banking_details_settle = defineRpc({
  id: "banking.details.settle",
  title: "Choose the token one currency's deposits become",
  about:
    "Changes the token Bridge turns one currency's deposits into, USDC or EURC. Before Bridge: the currency must have " +
    "active bank details and may settle in that token (INVALID_INPUT otherwise, with Bridge not called), and the caller " +
    "must be signed in. Then it reads the virtual account as Bridge holds it now (`readBankDetails`): Bridge's own state " +
    "of a just-opened account decides whether the change is allowed, not a stored state that may lag it, and an unusable " +
    "read is PROVIDER_RESPONSE_INVALID with nothing written to Bridge. The token Bridge already has succeeds and changes " +
    "nothing. Otherwise it asks Bridge to change the token, and only on Bridge's usable answer writes the change " +
    "(`change_token`, one event); an unusable answer is PROVIDER_RESPONSE_INVALID and leaves the stored token as it was. " +
    "Deposits already completed keep the token they settled in.",
  concept: concept_banking,
  kind: "action",
  who: "A signed-in person, for their own bank details. " + MANAGE,
  input: Schema.Struct({ org_id: Schema.NullOr(S), currency: Currency, token: Token }),
  output: Schema.Struct({
    currency: Currency,
    destination: Schema.Struct({ chainId: Schema.Number, token: Token, address: S }),
    state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
    changed: Schema.Boolean,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, ...bridgeFailures],
  reads: [table_bank_details, table_org_members, table_org_deployments, table_hat_wearers],
  writes: [table_bank_details],
  drives: [machine_bank_details.t.change_token],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.readBankDetails, integration_bridge.c.setDepositToken],
  chain: [],
  spans: ["rpc.banking.details.settle"],
  budget: {
    ...budget("vendor"),
    p95Ms: 5_000,
    why: "two Bridge calls in sequence for a change: the read of the virtual account, then the token change",
  },
  was: [`${B}/operations/settle.ts:1`, "docs/as-is/archive/banking/bank-details.ts:345"],
});
