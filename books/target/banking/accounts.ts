// Banking's saved bank accounts area: the external bank accounts an owner pays out to, their own or
// a contact's, with the full numbers encrypted to their row. One table replaces old parties'
// `partyAccounts` and the bank kind of its destinations (decision banking.one-bank-account-store).
// The add flow (./flows.ts) serves both `bank accounts add` and `contact bank add`.

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
} from "../shared/vocabulary.ts";
import { Currency, machine_bank_account, table_bank_accounts, table_bank_payouts, table_verifications } from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { table_contacts } from "../contacts/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const A = "packages/backend/src/parties/accounts";
const S = Schema.String;

const MANAGE =
  "For an Organization, saving or removing its accounts needs current authority to manage it: a Director or the Books " +
  "officer (decision banking.manage-authority).";

/** A saved account as every list and answer shows it: masked, never the numbers. */
export const BankAccountView = Schema.Struct({
  partyAccountId: S,
  currency: Currency,
  holderName: S,
  bankName: Schema.NullOr(S),
  last4: S,
  state: Schema.Literals(["saved", "active", "inactive"]),
  ownerScope: Schema.Literals(["self", "contact", "payee"]),
  recipient: Schema.NullOr(Schema.Struct({ partyId: S, label: S, onCapxul: Schema.Boolean })),
});

export const rpc_banking_accounts_requirements = defineRpc({
  id: "banking.accounts.requirements",
  title: "The fields a currency's bank account needs",
  about:
    "The fields, and their finite choices, that a bank account in one currency needs before Bridge will hold it: USD a " +
    "routing and an account number and the account type; EUR an IBAN and a BIC, the owner type and the holder's names; " +
    "GBP a sort code and an account number, the owner type and the holder's names (Bridge's sandbox requires " +
    "`account_owner_type` for GBP). Each field says whether it is secret (typed hidden). The add rpc validates against the " +
    "same rules, so the form and the backend cannot disagree. It reads and writes nothing.",
  concept: concept_banking,
  kind: "query",
  who: "A signed-in person.",
  input: Schema.Struct({ currency: Currency }),
  output: Schema.Struct({
    currency: Currency,
    fields: Schema.Array(
      Schema.Struct({
        id: S,
        label: S,
        secret: Schema.Boolean,
        choices: Schema.NullOr(Schema.Array(Schema.Struct({ value: S, label: S }))),
      }),
    ),
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.accounts.requirements"],
  budget: budget("read"),
  was: [`${A}/operations/requirements.ts:1`, `${A}/rules/requirements.ts:1`],
});

export const rpc_banking_accounts_add = defineRpc({
  id: "banking.accounts.add",
  title: "Save a bank account to pay out to",
  about:
    "Saves one bank account for the owner: their own (`self`), one on a contact already in their book (by its PartyId), " +
    "or a payee known only by name (from `bank pay --input`). The fields are checked against the currency's requirements; " +
    "an invalid one is INVALID_INPUT naming the field, never its value. The request key makes a repeat with the same " +
    "details return the same account and send nothing, and a different request under the same key INVALID_INPUT. When " +
    "the owner is already verified for the currency, it asks Bridge to hold the account under the account's own id as " +
    "key (fields Bridge rejects are INVALID_INPUT); otherwise no Bridge call is made and the account waits as `saved` " +
    "until its first payout. Then one transaction writes the row with the numbers encrypted to it (`save`, and `register` " +
    "when Bridge holds it). A contact account names whether the contact is on Capxul (its Party is an active person, " +
    "agent or Organization).",
  concept: concept_banking,
  kind: "action",
  who: "A signed-in person, for their own accounts or their own book's contacts. " + MANAGE,
  input: Schema.Struct({
    org_id: Schema.NullOr(S),
    for: Schema.Union([
      Schema.Struct({ scope: Schema.Literal("self") }),
      Schema.Struct({ scope: Schema.Literal("contact"), party_id: S }),
      Schema.Struct({ scope: Schema.Literal("payee"), holder_name: S }),
    ]),
    currency: Currency,
    details: Schema.Record(S, S),
    request_key: S,
  }),
  output: BankAccountView,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_PROVIDER_ERROR,
    error_RATE_LIMITED,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [
    table_bank_accounts,
    table_verifications,
    table_parties,
    table_contacts,
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
  ],
  writes: [table_bank_accounts],
  drives: [machine_bank_account.t.save, machine_bank_account.t.register],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.addBankAccount],
  chain: [],
  spans: ["rpc.banking.accounts.add"],
  budget: budget("vendor"),
  was: [`${A}/operations/add.ts:1`, `${A}/operations/register.ts:1`, `${A}/operations/prepare.ts:1`, `${A}/operations/finalize.ts:1`],
});

export const rpc_banking_accounts_list = defineRpc({
  id: "banking.accounts.list",
  title: "List the owner's own saved bank accounts, masked",
  about:
    "One page of the accounts the owner saved for itself (`scope` self), newest first, removed ones left out, each masked: " +
    "its id, holder, bank, last four digits, currency and state, never the numbers. Contacts' accounts are not listed " +
    "here. An owner whose Party has none gets an empty page. It reads only banking's own table and writes nothing.",
  concept: concept_banking,
  kind: "query",
  who: "A signed-in person, for their own accounts, or any current member of the Organization they name with `--org`.",
  input: Schema.Struct({ org_id: Schema.NullOr(S), cursor: Schema.NullOr(S) }),
  output: Schema.Struct({ items: Schema.Array(BankAccountView), nextCursor: Schema.NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_bank_accounts, table_org_members],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.accounts.list"],
  budget: budget("read"),
  was: [`${A}/operations/list.ts:1`, `${A}/views.ts:1`],
});

export const rpc_banking_accounts_list_for_contact = defineRpc({
  id: "banking.accounts.list-for-contact",
  title: "List the bank accounts saved on one contact, masked",
  about:
    "The accounts the owner saved on one contact's Party (`scope` contact, by `bank-accounts-by-party`), newest first, " +
    "removed ones left out, each masked as `bank accounts` shows its own: never the numbers. A Party with none, or one the " +
    "owner never saved an account on, gets an empty list: whether the Party is in the book at all is contacts' answer, " +
    "which `contact get` reads first (decision banking.contact-get). A PartyId that is not well formed is INVALID_INPUT. " +
    "It reads only banking's own table and the Seats, and writes nothing.",
  concept: concept_banking,
  kind: "query",
  who: "A signed-in person, for their own book's contacts, or any current member of the Organization they name with `--org`.",
  input: Schema.Struct({ org_id: Schema.NullOr(S), party_id: S }),
  output: Schema.Struct({ items: Schema.Array(BankAccountView) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_bank_accounts, table_org_members],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.accounts.list-for-contact"],
  budget: budget("read"),
  was: ["apps/cli/src/commands/contact/subcommands/get/execute.ts:50", `${A}/operations/list.ts:1`],
});

export const rpc_banking_accounts_remove = defineRpc({
  id: "banking.accounts.remove",
  title: "Remove a saved bank account",
  about:
    "Removes one of the owner's saved accounts by its id: the row stays, marked removed, so payouts already made to it " +
    "keep pointing at it, and no later Bridge event can bring it back. An id that is not one of the owner's reads as " +
    "unknown (INVALID_INPUT), whether it exists elsewhere or not. Removing it again returns it unchanged and sends " +
    "nothing. No Bridge call: Bridge keeps the external account, which nothing pays to again. A payout still quoted to the " +
    "account is told (this rpc is a signal of its process), which ends it unfunded.",
  concept: concept_banking,
  kind: "mutation",
  who: "A signed-in person, for their own accounts. " + MANAGE,
  input: Schema.Struct({ org_id: Schema.NullOr(S), bank_account_id: S }),
  output: Schema.Struct({ partyAccountId: S }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_bank_accounts, table_bank_payouts, table_org_members, table_org_deployments, table_hat_wearers],
  writes: [table_bank_accounts],
  drives: [machine_bank_account.t.remove],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.banking.accounts.remove"],
  budget: budget("write"),
  was: [`${A}/operations/remove.ts:14`],
});
