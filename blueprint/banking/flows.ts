// Banking's Core SDK flows (A4): one SDK method per frozen operation that composes rpcs and local
// steps; the CLI calls exactly that method. The operations whose SDK method is one rpc call (`bank
// accounts`, `bank accounts remove`, `bank deposits`, `bank details`, `bank settle`) are
// implemented by the rpc itself (decision banking.flows).

import { Schema } from "effect";
import { budget, defineFlow } from "../../packages/blueprint-engine/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_CLI_DEADLINE, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { Currency, Token } from "./data.ts";
import { rpc_banking_verification_start, rpc_banking_verification_status, VerificationView } from "./verification.ts";
import {
  BankAccountView,
  rpc_banking_accounts_add,
  rpc_banking_accounts_list_for_contact,
  rpc_banking_accounts_requirements,
} from "./accounts.ts";
import { PayoutView, rpc_banking_payouts_get, rpc_banking_payouts_quote } from "./payouts.ts";
import { Book, Details, Entry, rpc_contacts_book_get, rpc_contacts_book_list } from "../contacts/book.ts";
import { rpc_media_files_upload } from "../media/files.ts";
import { InvitationView, rpc_organizations_invitations_accept } from "../organizations/invitations.ts";

const SDK = "packages/sdk/src";
const CLI = "apps/cli/src/commands";
const S = Schema.String;

/** `--input` for `verify start` and an `inv_kyb_` `invite accept`: an answer dictionary, or answers, files and people. */
const VerificationInput = Schema.Struct({
  answers: Schema.Record(S, Schema.Unknown),
  files: Schema.Record(S, S),
  people: Schema.Array(Schema.Record(S, Schema.Unknown)),
});

export const flow_client_verification_start = defineFlow({
  id: "client.verification.start",
  title: "Start or continue a verification, prompting only at a terminal",
  about:
    "`verify start`. It reads the verification's live step first, so it asks only the questions Bridge still has open " +
    "and never resends accepted answers. At a terminal it opens Bridge's terms when they are the next step, asks each " +
    "live question with secrets masked, and submits once; in a script, an agent or a `--json` run it never prompts: it " +
    "takes `--input` (a file or `-`, up to 64 KB of JSON), submits once and returns the next step with any person link " +
    "and questions unchanged. Each document path is read on this machine, checked (JPG or PNG for an ID image, JPG, PNG " +
    "or PDF otherwise, within media's limits) and uploaded to media before the one submission. Human refusal copy never " +
    "shows a provider's reason.",
  component: component_core_sdk,
  sdk: "client.verification.start",
  input: Schema.Struct({
    orgId: Schema.NullOr(S),
    invitationId: Schema.NullOr(S),
    input: Schema.NullOr(VerificationInput),
    interactive: Schema.Boolean,
  }),
  output: VerificationView,
  steps: [
    { name: "read", rpc: rpc_banking_verification_status, about: "The live step and its open questions; before a start, `not_started` without asking Bridge." },
    { name: "ask", local: "prompt", about: "At a terminal only: Bridge's terms when they are next, then each live question, secrets masked." },
    { name: "check", local: "build", about: "Reads each document path on this machine and checks its type and size before anything is sent." },
    { name: "upload", rpc: rpc_media_files_upload, about: "Uploads each document to media as an identity document; its file id goes in the submission." },
    { name: "submit", rpc: rpc_banking_verification_start, about: "Submits once: answers, the file ids and, for a business, the named people." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: {
    ...budget("vendor"),
    p95Ms: 10_000,
    why: "uploads the person's documents, up to 24 MB each, before the one submission to Bridge",
  },
  was: [`${SDK}/parties/verifications.ts:47`, `${CLI}/verify/subcommands/start/execute.ts:1`],
});

export const flow_client_verification_status = defineFlow({
  id: "client.verification.status",
  title: "Read a verification's step, and follow it with `--wait`",
  about:
    "`verify status`. One read of the verification from Bridge; with `--wait`, or at a terminal when the step needs the " +
    "person, it follows the step until it ends or the deadline (default 300 s, 1 to 3600), reading at most once a minute " +
    "because each read asks Bridge, so a 10-minute review asks Bridge at most 10 times. At a terminal a step that needs " +
    "the person opens Bridge's page; in JSON it waits without opening a browser. Past the deadline it fails CLI_DEADLINE " +
    "with the command to keep following; nothing is lost.",
  component: component_core_sdk,
  sdk: "client.verification.status",
  input: Schema.Struct({
    orgId: Schema.NullOr(S),
    wait: Schema.Boolean,
    timeoutSeconds: Schema.Number,
    interactive: Schema.Boolean,
  }),
  output: VerificationView,
  steps: [
    { name: "read", rpc: rpc_banking_verification_status, about: "The verification as Bridge has it now." },
    { name: "open", local: "prompt", about: "At a terminal, a step that needs the person opens Bridge's page." },
    { name: "follow", local: "wait", about: "With `--wait`: read again once a minute until the step ends or the deadline passes." },
  ],
  errors: [error_CLI_DEADLINE],
  calls: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${SDK}/parties/verifications.ts:51`, `${CLI}/verify/subcommands/status/execute.ts:1`],
});

export const flow_client_account_bank_accounts_add = defineFlow({
  id: "client.account.bank-accounts.add",
  title: "Save a bank account, your own or a contact's",
  about:
    "The one SDK method of `bank accounts add` (your own account) and `contact bank add` (an account on a contact already " +
    "in your book). For a contact it first finds the entry in the book by label, PartyId, email or handle; one that is not " +
    "there, or a private entry with no Party to save it on (`ref` null), stops the command with CLI_USAGE before anything " +
    "is saved (banking.private-entries). It reads the currency's fields, asks for each at a terminal with " +
    "bank numbers typed hidden (a script passes `{ details, requestKey? }` with `--input` and is never prompted), keeps " +
    "the request key it prints (`--input` and `--request-key` must agree), and saves once. The answer is masked: the " +
    "numbers never appear, not even in the suggested command for next time, which reads them from a file.",
  component: component_core_sdk,
  sdk: "client.account.bankAccounts.add",
  input: Schema.Struct({
    orgId: Schema.NullOr(S),
    contact: Schema.NullOr(S),
    currency: Schema.NullOr(Currency),
    input: Schema.NullOr(Schema.Struct({ details: Schema.Record(S, S), requestKey: Schema.NullOr(S) })),
    requestKey: Schema.NullOr(S),
    interactive: Schema.Boolean,
  }),
  output: BankAccountView,
  steps: [
    { name: "contact", rpc: rpc_contacts_book_list, about: "`contact bank add` only: the book's entries, to find the named contact's PartyId; a private entry has none." },
    { name: "fields", rpc: rpc_banking_accounts_requirements, about: "The currency's fields and their choices." },
    { name: "ask", local: "prompt", about: "At a terminal only: each field, bank numbers typed hidden." },
    { name: "key", local: "build", about: "The request key: the one given, or a new one the CLI prints for a retry." },
    { name: "save", rpc: rpc_banking_accounts_add, about: "Saves once; a repeat with the same key and details returns the same account." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${SDK}/parties/accounts.ts:52`, `${CLI}/bank/subcommands/accounts/internal/input.ts:1`, `${CLI}/contact/subcommands/bank/subcommands/add/execute.ts:24`],
});

/** A contact as `contact get` returns it: the entry from contacts' book, with the accounts saved on it here. */
export const ContactWithAccounts = Schema.Struct({
  id: Entry.fields.id,
  ref: Entry.fields.ref,
  label: Entry.fields.label,
  hidden: Entry.fields.hidden,
  doctype: Entry.fields.doctype,
  details: Details,
  /** Empty for a private entry (`ref` null): accounts are saved on a contact's Party. */
  bankAccounts: Schema.Array(BankAccountView),
});

/** At a terminal with no PartyId, the picker's page comes before the two reads: three calls in sequence. */
export const guidedRead = {
  ...budget("read"),
  p50Ms: 800,
  p95Ms: 1_600,
  excludes: ["wait.person"],
  why: "the entry's read and its accounts' read run in sequence, after the picker's page at a terminal (contacts.budgets)",
};

export const flow_client_account_address_book_get = defineFlow({
  id: "client.account.address-book.get",
  title: "Show one contact with the bank accounts saved on it",
  about:
    "`contact get`, banking's flow because only banking can add the contact's bank accounts (shared " +
    "operations.contact-get-in-banking). Given a contact id (a PartyId, or a private entry's `contact_` id) it never " +
    "lists or prompts: one read of the entry and its details from contacts' book (`{ book, contactId }`), hidden or not; " +
    "null (it is not in this book) ends it with null and reads no accounts. Then, for an entry with a Party, the accounts " +
    "saved on that contact here, masked, and whether the contact is on Capxul; a private entry (`ref` null) shows none " +
    "and reads none (banking.private-entries). At a terminal with no id the person first picks from the book, hidden " +
    "contacts included; quitting the picker is CANCELLED. The CLI refuses a malformed id, or a script without one, with " +
    "CLI_USAGE before calling it, and prints the `bank pay` command for a contact with a Party.",
  component: component_core_sdk,
  sdk: "client.account.addressBook.get",
  input: Schema.Struct({
    book: Book,
    /** The entry's id: its PartyId, or a private entry's `contact_` id. Absent only at a terminal, where the person picks. */
    contactId: Schema.optionalKey(S),
  }),
  output: Schema.NullOr(ContactWithAccounts),
  steps: [
    { name: "choices", rpc: rpc_contacts_book_list, about: "Only with no id at a terminal: the book page by page for the picker, hidden entries included." },
    { name: "pick", local: "prompt", about: "Only with no id at a terminal: the person picks one entry; quitting is CANCELLED." },
    { name: "entry", rpc: rpc_contacts_book_get, about: "The entry and its details for `{ book, contactId }`, hidden or not; null ends the flow with null." },
    { name: "accounts", rpc: rpc_banking_accounts_list_for_contact, about: "An entry with a Party only: the accounts saved on it, masked, with whether it is on Capxul; a private entry has none." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: guidedRead,
  was: [`${CLI}/contact/subcommands/get/execute.ts:20`, `${CLI}/contact/subcommands/get/execute.ts:50`, `${SDK}/parties/contacts.ts:146`],
});

export const flow_client_banking_payouts_pay = defineFlow({
  id: "client.banking.payouts.pay",
  title: "Pay a bank account and follow the payout",
  about:
    "`bank pay`. For a contact it finds their PartyId in the book; a private entry, which has no Party (`ref` null), is " +
    "refused with CLI_USAGE before any quote, naming how to give it one (banking.private-entries). For a new payee in " +
    "`--input` it first saves their bank " +
    "account, so the numbers never enter a command line. It quotes once (the request key makes a retry reach the same " +
    "payout), and at a terminal shows the locked bank amount, what leaves the Safe with its slippage buffer, and the " +
    "deadline. With `--json` it returns once the approval waits, stage `quoted`, with the approval's id and link. " +
    "Otherwise the payer signs: an agent paying from an Organization's budget (a Seat wearing its hat; the verification " +
    "is the Organization's) signs the sponsored approval's digest with its own key at once and gives it to approvals; a " +
    "person approves on the approval page the CLI opens (their wait is never system time). Then it follows the payout " +
    "until it is in transit or delivered, or fails with its reason and refund; at the approval deadline with the payout " +
    "in transit it ends normally and names `capxul payment wait`. An expired quote (its approval expired: WRONG_STATE) or " +
    "a changed account names `bank pay` again; a declined approval ends CANCELLED. Nothing is sent in any of them.",
  component: component_core_sdk,
  sdk: "client.banking.payouts.pay",
  input: Schema.Struct({
    orgId: Schema.NullOr(S),
    from: Schema.NullOr(S),
    to: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("self") }),
      Schema.Struct({ kind: Schema.Literal("contact"), contact: S }),
      Schema.Struct({ kind: Schema.Literal("new"), holderName: S, currency: Currency, details: Schema.Record(S, S) }),
    ]),
    account: Schema.NullOr(S),
    amount: S,
    fixedToken: Schema.NullOr(Token),
    asset: Schema.NullOr(Token),
    requestKey: Schema.NullOr(S),
    interactive: Schema.Boolean,
  }),
  output: PayoutView,
  steps: [
    { name: "contact", rpc: rpc_contacts_book_list, about: "`bank pay <contact>` only: the book's entries, to find the contact's PartyId; a private entry is refused." },
    { name: "payee", rpc: rpc_banking_accounts_add, about: "A new payee in `--input` only: saves their account with its holder's name first." },
    { name: "quote", rpc: rpc_banking_payouts_quote, about: "The quote, the payout and its Payment, once per request key; `from` names the budget by key." },
    { name: "show", local: "prompt", about: "At a terminal: the locked bank amount, the funding with its slippage buffer, the budget's name, and the deadline." },
    { name: "sponsored", rpc: rpc_approvals_signing_get, about: "The payout's approval, live, until approvals has sponsored it (`pending`, with its digest) or it ends." },
    { name: "sign", local: "sign", about: "An agent payer signs the digest with its own key at once; a person signs on the approval page instead." },
    { name: "give-signature", rpc: rpc_approvals_signing_sign, about: "An agent's signature to approvals, which sends the operation once." },
    { name: "approve", local: "wait", about: "A person approves on the approval page the CLI opens; `--json` returns before this step." },
    { name: "follow", rpc: rpc_banking_payouts_get, about: "Read until in transit, delivered or failed, or the approval deadline passes." },
  ],
  errors: [error_WRONG_STATE, error_CANCELLED],
  calls: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${SDK}/accounts/command-approvals.ts:137`, `${CLI}/bank/subcommands/pay/execute.ts:1`, `${CLI}/bank/internal/payout-errors.ts:16`],
});

export const flow_client_org_invitations_accept = defineFlow({
  id: "client.org.invitations.accept",
  title: "Accept an invitation, or start a business verification for an inv_kyb_ id",
  about:
    "`invite accept`, which this concept owns because it routes (decision operations.invite-accept-in-banking). An id " +
    "starting `inv_kyb_` is a business verification's invitation: the person's own details from `--input` go to " +
    "banking's verification start as that invitation, and the answer is the verification's next step. Every other id is " +
    "an Organization invitation: organizations' accept records the consent at the digest the person reviewed (a script " +
    "passes `--offer-digest` and `--confirm`; at a terminal the digest shown is used) and seats them. `--input` with " +
    "any other id is refused by the CLI.",
  component: component_core_sdk,
  sdk: "client.org(orgId).invitations.accept",
  input: Schema.Struct({
    orgId: Schema.NullOr(S),
    invitationId: S,
    offerDigest: Schema.NullOr(S),
    input: Schema.NullOr(VerificationInput),
    interactive: Schema.Boolean,
  }),
  output: Schema.Union([InvitationView, VerificationView]),
  steps: [
    { name: "route", local: "build", about: "An `inv_kyb_` id goes to the verification; every other id to the Organization's invitation." },
    { name: "verify", rpc: rpc_banking_verification_start, about: "`inv_kyb_` only: the invited person's own details, as that invitation." },
    { name: "digest", local: "prompt", about: "At a terminal, for an Organization invitation: shows the offer and asks; a yes uses its digest, a no ends CANCELLED." },
    { name: "accept", rpc: rpc_organizations_invitations_accept, about: "Every other id: consent at the digest, and the Seat." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: budget("vendor"),
  was: [`${SDK}/organizations/invitations.ts:1`, `${CLI}/org-invite/subcommands/accept/execute.ts:1`],
});
