// The operation records of the frozen operations banking owns (OPERATION_OWNERS): verification,
// `invite accept` (it routes business verification here), bank details, saved bank accounts with
// `contact get` (a contact's entry and the accounts saved on it), bank deposits and bank payouts. Each is built from frozenText, never retyped; acceptance claims are
// the frozen ones word for word except the lines that named a mechanism (a scheduler, a queued
// event, the order of Bridge calls, one transaction), rewritten as outcomes in decision
// banking.acceptance-rewrites. Worlds are listed in decision banking.worlds.

import { Schema } from "effect";
import { budget, defineOperation } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_VERIFICATION_REQUIRED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, CHAIN_ID, hash, ID, NORTHWIND, ok, refused, uuid } from "../shared/examples.ts";
import { Currency, Token } from "./data.ts";
import { VerificationView } from "./verification.ts";
import { BankAccountView, rpc_banking_accounts_list, rpc_banking_accounts_remove } from "./accounts.ts";
import { BankDetailsOverview, rpc_banking_details_settle, rpc_banking_details_show } from "./details.ts";
import { BankDepositView, rpc_banking_deposits_list } from "./deposits.ts";
import { PayoutView } from "./payouts.ts";
import {
  ContactWithAccounts,
  flow_client_account_address_book_get,
  flow_client_account_bank_accounts_add,
  flow_client_banking_payouts_pay,
  flow_client_org_invitations_accept,
  flow_client_verification_start,
  flow_client_verification_status,
  guidedRead,
} from "./flows.ts";
import { InvitationView } from "../organizations/invitations.ts";

// ── examples: the cast's banking story (ids 850-899) ─────────────────────────────────────────

const at = (iso: string) => Date.parse(iso);
const EUR_ACCOUNT = uuid(850);
const BRIGHTSIDE_ACCOUNT = uuid(851);
const eurAccount = { partyAccountId: EUR_ACCOUNT, currency: "eur", holderName: "Northwind Trading", bankName: "Harbour Bank", last4: "4321", state: "active", ownerScope: "self", recipient: null };
const brightsideAccount = {
  partyAccountId: BRIGHTSIDE_ACCOUNT, currency: "usd", holderName: "Brightside Cleaning", bankName: "Harbour Bank", last4: "7788", state: "active", ownerScope: "contact",
  recipient: { partyId: ID.brightside, label: "Brightside Cleaning", onCapxul: false },
};
const currencies = (usd: string, eur: string, gbp: string) => ({ usd, eur, gbp });
const approvedVerification = {
  status: "approved", journeyId: uuid(852), subject: "business", nextStep: null, completed: ["business", "people", "documents"],
  currencies: currencies("approved", "approved", "not_started"), people: [],
};

const S = Schema.String;

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const frozenLine = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Acceptance line n (from 1), its claim kept word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = frozenLine(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Acceptance line n rewritten as an outcome: the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = frozenLine(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

/** The refusal's own text, from the frozen record. */
const when = (id: FrozenId, code: string) =>
  (frozen[id].refusals as readonly { code: string; when: string }[]).find((r) => r.code === code)!.when;

const PERSON_WAIT = { excludes: ["wait.person"] } as const;

// ── verification ────────────────────────────────────────────────────────────────────────────

export const operation_verify_start = defineOperation({
  ...frozenText("verify.start"),
  priority: "normal",
  implementedBy: flow_client_verification_start,
  acceptance: [
    kept("verify.start", 1, "cli: a `--json` run with no `--input` exits with the envelope holding Bridge's person link and questions as Bridge gave them, and reads nothing from stdin; trace: no `sdk.step.ask` span."),
    kept("verify.start", 2, "cli: `--input` of a JSON file naming a JPG path is accepted; trace: one media upload rpc span then one `call.bridge.submitVerification`; world: media holds the identity document."),
    kept("verify.start", 3, "trace: the people in `--input` reach `call.bridge.submitVerification` with no prompt step; world: one `verification-people` row each, `invited`."),
    kept("verify.start", 4, "cli (in a terminal): Bridge's terms link is opened, only the questions the verification's live step lists are asked, the secret answer is not echoed; trace: one `call.bridge.submitVerification`."),
    kept("verify.start", 5, "trace: after Bridge accepted the ID answers and asks a tax question, the next submission carries only the tax answer."),
    kept("verify.start", 6, "cli: with Bridge's stand-in refusing with a reason, the human output shows Capxul's own copy and never that reason."),
    kept("verify.start", 7, "world: one verification row, `begin` once, and the Bridge stand-in holds one customer; cli: the next step is printed."),
    kept("verify.start", 8, "world: after a second start, still one verification row and one customer at the Bridge stand-in; cli: the step moves on."),
    kept("verify.start", 9, "cli: `--org` with `--invitation` exits INVALID_INPUT and a call with no session NOT_AUTHENTICATED; trace: neither has a `call.bridge.*` span."),
  ],
  returns: VerificationView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-ready", when: when("verify.start", "CLI_USAGE") },
    { error: error_INVALID_INPUT, given: "person-ready", when: when("verify.start", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "You cannot verify the Organization you act as: Hal, a member of Globex who is not a Director." },
    { error: error_PROVIDER_ERROR, given: "bridge-unreachable", when: when("verify.start", "PROVIDER_ERROR") },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("verify.start", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Hannah answers Bridge's questions for Northwind from a file and is sent to Bridge's page for the last step",
      "capxul verify start --org northwind --input answers.json --json",
      {
        status: "needs_person", journeyId: uuid(852), subject: "business",
        nextStep: { kind: "person", url: "https://bridge.test/verify/jrn_852", purpose: "terms" },
        completed: ["business"], currencies: currencies("pending", "pending", "not_started"),
        people: [{ invitationId: uuid(853), name: "Tomas Varga", status: "invited" }],
      },
    ),
    ok(
      "Starting with no answers returns the first questions",
      "capxul verify start --json",
      {
        status: "needs_answers", journeyId: uuid(854), subject: "person",
        nextStep: { kind: "answers", questions: [
          { id: "date_of_birth", label: "Date of birth", input: "date", choices: null, correction: null },
          { id: "id_document", label: "A photo of your ID", input: "file", choices: null, correction: null },
        ] },
        completed: [], currencies: currencies("not_started", "not_started", "not_started"), people: [],
      },
    ),
    refused("Bridge refuses an answer: a date of birth under 18", "capxul verify start --input answers.json --json", error_INVALID_INPUT),
    refused("Priya is a member, not a Director, of Northwind", "capxul verify start --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: { ...budget("vendor"), p95Ms: 10_000, why: "uploads the person's documents, up to 24 MB each, before the one submission", ...PERSON_WAIT },
});

export const operation_verify_status = defineOperation({
  ...frozenText("verify.status"),
  priority: "normal",
  implementedBy: flow_client_verification_status,
  acceptance: [
    kept("verify.status", 1, "cli: for a verification Bridge's stand-in has asked to correct, it prints the correction, the steps completed, the liveness step and the approved currencies."),
    kept("verify.status", 2, "cli: `--json --wait` on a terms step prints no browser launch and waits; trace: one `banking.verification.status` a minute."),
    kept("verify.status", 3, "trace: a `--wait --timeout-seconds 600` on a review holds at most 10 `call.bridge.getVerification` spans."),
    kept("verify.status", 4, "cli: at the bound it exits CLI_DEADLINE and prints `capxul verify status --wait` to keep following."),
    kept("verify.status", 5, "cli: `not_started`; trace: no `call.bridge.*` span."),
    kept("verify.status", 6, "cli: a change made at the Bridge stand-in after the start shows; world: the stand-in still holds one customer."),
    kept("verify.status", 7, "cli: exit with NOT_AUTHENTICATED; trace: no `call.bridge.*` span."),
  ],
  returns: VerificationView,
  refusals: [
    { error: error_CLI_DEADLINE, given: "person-ready", when: "After `verify start`, `--wait --timeout-seconds 1` while Bridge's page waits for the person. Progress is kept." },
    { error: error_PROVIDER_ERROR, given: "bridge-unreachable", when: when("verify.status", "PROVIDER_ERROR") },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("verify.status", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok("Northwind's verification is approved for USD and EUR", "capxul verify status --org northwind --json", approvedVerification),
    refused("Waiting one second while Bridge's page waits for the person", "capxul verify status --wait --timeout-seconds 1 --json", error_CLI_DEADLINE),
    refused("Signed out", "capxul verify status --json", error_NOT_AUTHENTICATED),
  ],
  budget: { ...budget("vendor"), ...PERSON_WAIT },
});

export const operation_invite_accept = defineOperation({
  ...frozenText("invite.accept"),
  priority: "normal",
  implementedBy: flow_client_org_invitations_accept,
  acceptance: [
    rewritten(
      "invite.accept",
      1,
      "Accepting records the consent together with what it grants: the accepted invitation and its grant (or the Seat, for an offer with no grants) are written together or not at all.",
      "world: after a successful accept the diff holds the accepted invitation and the Seat; after one that fails, neither; read: `invite list` and `org member get` agree.",
    ),
    kept("invite.accept", 2, "cli: the same digest again returns the same result; world: no change; cli: another digest exits WRONG_STATE."),
    kept("invite.accept", 3, "cli: a digest that is not 32 bytes of hex exits INVALID_INPUT; world: the invitation is still pending."),
    kept("invite.accept", 4, "cli: as anyone but the grantee ROLE_PERMISSION_DENIED; after a cancel, or past the expiry (`dev time warp`), WRONG_STATE."),
  ],
  returns: Schema.Union([InvitationView, VerificationView]),
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-pending-invitation", when: when("invite.accept", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: "org-with-expired-invitation", when: when("invite.accept", "WRONG_STATE") },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("invite.accept", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Priya accepts Northwind's allowance offer at the digest she reviewed",
      `capxul invite accept ${uuid(855)} --offer-digest ${hash("e5")} --confirm --json`,
      {
        id: uuid(855), orgId: NORTHWIND.orgId, organizationName: NORTHWIND.name,
        grantee: { partyId: ID.priya, kind: "human", handle: "priya", accountId: uuid(856), accountReady: true },
        phase: "pending", offers: [{ kind: "allowance", budgetId: ID.financeBudget }], offerDigest: hash("e5"),
        recovery: null, recoveryActions: { resendAvailableAt: null }, expiresAt: at("2026-02-24T09:30:00Z"),
        endingReason: null, acceptedAt: at("2026-02-10T09:30:00Z"), memberId: null, delivery: "sent",
      },
    ),
    refused("The offer changed since Priya read its digest", `capxul invite accept ${uuid(855)} --offer-digest ${hash("f6")} --confirm --json`, error_WRONG_STATE),
    refused("An invitation that was not sent to this person", `capxul invite accept ${uuid(857)} --offer-digest ${hash("e5")} --confirm --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: { ...budget("vendor"), ...PERSON_WAIT },
});

// ── saved bank accounts ─────────────────────────────────────────────────────────────────────

const AccountsPage = Schema.Struct({ items: Schema.Array(BankAccountView), nextCursor: Schema.NullOr(S) });

export const operation_bank_accounts = defineOperation({
  ...frozenText("bank.accounts"),
  priority: "normal",
  implementedBy: rpc_banking_accounts_list,
  acceptance: [
    kept("bank.accounts", 1, "read: the page holds the caller's own accounts only, each with `last4` and never the numbers."),
    kept("bank.accounts", 2, "read: after `bank accounts remove`, the account is not on the page."),
    kept("bank.accounts", 3, "read: a signed-in person whose Party has no accounts gets `items: []` and `nextCursor: null`."),
    kept("bank.accounts", 4, "cli: the human output shows holder, bank, last four digits and currency; trace: the rpc's input has no contact filter."),
    rewritten("bank.accounts", 5, "A read changes nothing.", "world: the snapshot before and after `bank accounts` is the same, outbox included."),
    kept("bank.accounts", 6, "read: after a contact's account is removed, the caller's own GBP account, masked, is still on the page."),
    kept("bank.accounts", 7, "cli: `--org globex` as Ivy, who holds no Seat in Globex, exits ROLE_PERMISSION_DENIED."),
  ],
  returns: AccountsPage,
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "You are not in the Organization named with `--org`: Ivy, outside Globex." },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("bank.accounts", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok("Northwind's saved bank accounts", "capxul bank accounts --org northwind --json", { items: [eurAccount, brightsideAccount], nextCursor: null }),
    refused("Someone outside Northwind asks for its accounts", "capxul bank accounts --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("read"),
});

export const operation_bank_accounts_add = defineOperation({
  ...frozenText("bank.accounts.add"),
  priority: "normal",
  implementedBy: flow_client_account_bank_accounts_add,
  acceptance: [
    kept("bank.accounts.add", 1, "world: an unverified person's save writes one bank account `saved`; trace: no `call.bridge.*` span."),
    rewritten(
      "bank.accounts.add",
      2,
      "A committed save sends one account-saved event, and a replay or a refusal sends none.",
      "world: after the first save the outbox holds one `bank_account_transitioned` (save); after the replay with the same key, or a refused save, none more.",
    ),
    kept("bank.accounts.add", 3, "cli: an invalid IBAN is refused naming the field; no output, error or trace attribute carries the value given."),
    kept("bank.accounts.add", 4, "cli (in a terminal): the account prints masked, and the suggested command reads the details from a file."),
    kept("bank.accounts.add", 5, "cli: a script with no `--input` exits CLI_USAGE without prompting; world: no change."),
  ],
  returns: BankAccountView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-ready", when: when("bank.accounts.add", "CLI_USAGE") },
    { error: error_INVALID_INPUT, given: "person-ready", when: when("bank.accounts.add", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "For an Organization, you cannot manage it: Gus, who wears only a budget's hat in Globex." },
  ],
  examples: [
    ok(
      "Hannah saves Northwind's EUR account from a file",
      `capxul bank accounts add --input account.json --request-key ${uuid(858)} --org northwind --json`,
      eurAccount,
    ),
    refused("Both --currency and --input", "capxul bank accounts add --currency EUR --input account.json --json", error_CLI_USAGE),
    refused("Priya manages no bank accounts for Northwind", "capxul bank accounts add --input account.json --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: { ...budget("vendor"), ...PERSON_WAIT },
});

export const operation_contact_bank_add = defineOperation({
  ...frozenText("contact.bank.add"),
  priority: "normal",
  implementedBy: flow_client_account_bank_accounts_add,
  acceptance: [
    kept("contact.bank.add", 1, "world: before any verification, saving on vendor@example.com, a contact added by email alone, writes one bank account `saved`, scope contact, and leaves the contact entry as it was; trace: no `call.bridge.*` span."),
    kept("contact.bank.add", 2, "cli: an account saved on Bea, a claimed person, has `recipient.onCapxul: true`."),
    rewritten(
      "contact.bank.add",
      3,
      "A committed save sends one account-saved event, and a replay or a refusal none.",
      "world: after the first save the outbox holds one `bank_account_transitioned` (save, scope contact); after the replay or a refusal, none more.",
    ),
    kept("contact.bank.add", 4, "cli: an invalid sort code is refused naming the field, never its value; the saved account prints masked."),
  ],
  returns: BankAccountView,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-contacts",
      when: `${when("contact.bank.add", "CLI_USAGE")} Also a private entry with no Party (Ada's Northwind Ltd), before anything is written (banking.private-entries).`,
    },
    { error: error_INVALID_INPUT, given: "person-with-contacts", when: when("contact.bank.add", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "person-with-contacts", when: "You cannot write to that book: `--org acme` as Ada, who holds no Seat in Acme." },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("contact.bank.add", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Hannah saves Brightside's account on its contact entry",
      `capxul contact bank add Brightside --input account.json --request-key ${uuid(859)} --org northwind --json`,
      brightsideAccount,
    ),
    refused("A bank field is invalid", "capxul contact bank add Brightside --input account.json --org northwind --json", error_INVALID_INPUT),
    refused("A contact who is not in the book", "capxul contact bank add Nobody --input account.json --org northwind --json", error_CLI_USAGE),
  ],
  budget: { ...budget("vendor"), ...PERSON_WAIT },
});

// `contact get` is banking's (shared operations.contact-get-in-banking): the contact's entry from contacts' book, then
// the bank accounts saved on it here (decision banking.contact-get). Its refusals start from contacts' world.
export const operation_contact_get = defineOperation({
  ...frozenText("contact.get"),
  priority: "normal",
  implementedBy: flow_client_account_address_book_get,
  acceptance: [
    kept("contact.get", 1, "cli: Ada's `contact get` of Zed, a claimed person in no book of hers, prints null and exits 0; trace: no `banking.accounts.list-for-contact` span."),
    kept("contact.get", 2, "read: Ada's `contact get` of Bea returns Bea's entry, its label and its bankAccounts masked; cli: `--org acme` as Ada, who holds no Seat in Acme, exits ROLE_PERMISSION_DENIED."),
    kept("contact.get", 3, "trace: a get given a PartyId is one `contacts.book.get` and one `banking.accounts.list-for-contact`, with no `contacts.book.list` and no `wait.person`; cli: at a terminal the picker offers Cy, who is hidden."),
  ],
  returns: Schema.NullOr(ContactWithAccounts),
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-contacts",
      when: "Gave an id that is neither a PartyId nor a private entry's `contact_` id: refused before anything is read (banking.private-entries).",
    },
    { error: error_ROLE_PERMISSION_DENIED, given: "person-with-contacts", when: "`--org` names an Organization you are outside: `--org acme` as Ada, who holds no Seat in Acme." },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("contact.get", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Brightside Cleaning's entry, with its masked bank account",
      `capxul contact get ${ID.brightside} --org northwind --json`,
      {
        id: ID.brightside, ref: { kind: "party", partyId: ID.brightside }, label: "Brightside Cleaning", hidden: false, doctype: "organization",
        details: {
          email_ids: [{ email_id: "accounts@brightside.test", is_primary: true }], phone_nos: [], designation: null, company: "Brightside Cleaning",
          website: "https://brightside.test", industry: "Cleaning services", territory: null, no_of_employees: "11-50", annual_revenue: null, currency: "USD", company_description: null,
        },
        bankAccounts: [brightsideAccount],
      },
    ),
    refused("An id that is neither a PartyId nor a private entry", "capxul contact get brightside --org northwind --json", error_CLI_USAGE),
    refused("Asking for another company's book", "capxul contact get --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: guidedRead,
});

export const operation_bank_accounts_remove = defineOperation({
  ...frozenText("bank.accounts.remove"),
  priority: "normal",
  implementedBy: rpc_banking_accounts_remove,
  acceptance: [
    kept(
      "bank.accounts.remove",
      1,
      "cli: removing another owner's account id answers as for an unknown id; world: a second remove changes nothing; after the Bridge stand-in posts an update for the account, read: `bank accounts` still leaves it out.",
    ),
  ],
  returns: Schema.Struct({ partyAccountId: S }),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-gbp-account", when: when("bank.accounts.remove", "CLI_USAGE") },
    { error: error_INVALID_INPUT, given: "person-with-gbp-account", when: "The account is not one of yours: a well-formed id that names none of the caller's accounts." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "For an Organization, you cannot manage it: Gus, who wears only a budget's hat in Globex." },
  ],
  examples: [
    ok("Hannah removes the old EUR account", `capxul bank accounts remove ${EUR_ACCOUNT} --org northwind --json`, { partyAccountId: EUR_ACCOUNT }),
    refused("An id that is well formed but not one of Northwind's accounts", `capxul bank accounts remove ${uuid(899)} --org northwind --json`, error_INVALID_INPUT),
    refused("An id that is not a bank account id", "capxul bank accounts remove eur --json", error_CLI_USAGE),
  ],
  budget: budget("write"),
});

// ── deposits ────────────────────────────────────────────────────────────────────────────────

export const operation_bank_deposits = defineOperation({
  ...frozenText("bank.deposits"),
  priority: "normal",
  implementedBy: rpc_banking_deposits_list,
  acceptance: [
    kept("bank.deposits", 1, "read: the deposits come newest first, each with its status: credited, arriving, below minimum, returned."),
    kept("bank.deposits", 2, "read: `--unmatched` leaves out the matched and the not-a-request deposits."),
    kept("bank.deposits", 3, "read: 21 deposits are two pages, 20 then 1, the second with `nextCursor: null`."),
    kept("bank.deposits", 4, "read: with `--org globex` Gus gets Globex's deposits and none of his own; cli: Ivy, an outsider, exits ROLE_PERMISSION_DENIED."),
    rewritten("bank.deposits", 5, "A read changes nothing.", "world: the snapshot before and after `bank deposits` is the same, outbox included."),
    kept("bank.deposits", 6, "cli: `--json` prints the rpc's page exactly."),
  ],
  returns: Schema.Struct({
    items: Schema.Array(BankDepositView),
    nextCursor: Schema.NullOr(S),
    unmatchedCount: Schema.Number,
    firstUnmatched: Schema.NullOr(S),
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: "person-with-deposits", when: when("bank.deposits", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "You are outside the Organization named with `--org`: Ivy, outside Globex." },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("bank.deposits", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Northwind's deposits, one credited and one still needing a request",
      "capxul bank deposits --org northwind --json",
      {
        items: [
          {
            bankDepositId: uuid(860), currency: "eur", rail: "sepa", amount: "1200.00", status: "credited", receivedAt: at("2026-02-04T08:00:00Z"), sender: "Brightside Cleaning",
            credit: { token: "eurc", amount: "1200.00", txHash: hash("c1"), safe: ADDRESS.northwind }, match: { kind: "request", requestId: uuid(903), reference: "REFUND-2026-001" },
          },
          {
            bankDepositId: uuid(861), currency: "usd", rail: "wire", amount: "500.00", status: "processing", receivedAt: at("2026-02-09T14:20:00Z"), sender: null,
            credit: null, match: null,
          },
        ],
        nextCursor: null, unmatchedCount: 1, firstUnmatched: uuid(861),
      },
    ),
    refused("A cursor this list never gave", "capxul bank deposits --cursor zzz --json", error_INVALID_INPUT),
  ],
  budget: budget("read"),
});

// ── bank details ────────────────────────────────────────────────────────────────────────────

export const operation_bank_details = defineOperation({
  ...frozenText("bank.details"),
  priority: "normal",
  implementedBy: rpc_banking_details_show,
  acceptance: [
    kept("bank.details", 1, "world: for a person approved for USD, EUR and GBP with USD details open, one call opens EUR and GBP and nothing else; cli: the overview after is masked."),
    kept("bank.details", 2, "cli: `--currency eur` prints the full IBAN and BIC for EUR only; without it every number is masked."),
    kept("bank.details", 3, "cli: as Gus in `--org globex`, Globex's existing USD details print masked and no new currency is opened; world: no change."),
    kept("bank.details", 4, "cli: a deactivated currency is marked; the GBP payee name is the one the Bridge stand-in returned."),
    kept("bank.details", 5, "cli: for an Organization not verified yet, the WRONG_STATE refusal names `capxul verify start` with the same `--org`."),
  ],
  returns: BankDetailsOverview,
  refusals: [
    { error: error_WRONG_STATE, given: "person-ready", when: when("bank.details", "WRONG_STATE") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "For an Organization, you cannot manage it, so details it lacks cannot be opened: Gus asks Globex for `--currency eur`." },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("bank.details", "NOT_AUTHENTICATED") },
  ],
  examples: [
    ok(
      "Northwind's EUR details in full",
      "capxul bank details --currency EUR --org northwind --json",
      {
        items: [{
          currency: "eur", state: "active", visibility: "full",
          fields: { bankName: "Harbour Bank", payeeName: "Northwind Trading", rail: "sepa", last4: "4321", routingNumber: null, accountNumber: null, iban: "DE00000000000000004321", bic: "HARBDEXX", sortCode: null },
          destination: { chainId: CHAIN_ID, token: "eurc", address: ADDRESS.northwind }, developerFeePercent: null,
        }],
        unverified: [{ currency: "gbp", next: ["capxul verify start"] }],
      },
    ),
    refused("Not verified for the currency asked", "capxul bank details --currency EUR --json", error_WRONG_STATE),
    refused("Priya cannot manage Northwind's bank details", "capxul bank details --currency EUR --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("vendor"),
});

export const operation_bank_settle = defineOperation({
  ...frozenText("bank.settle"),
  priority: "normal",
  implementedBy: rpc_banking_details_settle,
  acceptance: [
    kept(
      "bank.settle",
      1,
      "trace: `call.bridge.readBankDetails` ends before `call.bridge.setDepositToken` starts; cli: `bank settle eur --to usdc` straight after `bank details --currency eur` opened EUR succeeds; read: `bank details` shows USDC for EUR.",
    ),
    rewritten(
      "bank.settle",
      2,
      "Moving EUR deposits from EURC to USDC is recorded as one change: the EUR bank details then settle in USDC.",
      "read: `bank details` shows USDC for EUR; world: the outbox holds one `bank_details_transitioned` (change_token).",
    ),
    rewritten(
      "bank.settle",
      3,
      "Keeping the token it already has succeeds and changes nothing.",
      "cli: success; world: no change, outbox included; trace: no `call.bridge.setDepositToken` span.",
    ),
    kept(
      "bank.settle",
      4,
      "trace: with the Bridge stand-in answering the read with an unusable body, no `call.bridge.setDepositToken` span; cli: exit PROVIDER_RESPONSE_INVALID; read: `bank details` shows the old token; world: no change.",
    ),
  ],
  returns: Schema.Struct({
    currency: Currency,
    destination: Schema.Struct({ chainId: Schema.Number, token: Token, address: S }),
    state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: "person-verified", when: when("bank.settle", "INVALID_INPUT") },
    { error: error_CLI_USAGE, given: "person-with-bank-details", when: when("bank.settle", "CLI_USAGE") },
    { error: error_NOT_AUTHENTICATED, given: "signed-out", when: when("bank.settle", "NOT_AUTHENTICATED") },
    { error: error_PROVIDER_ERROR, given: "bridge-unreachable", when: when("bank.settle", "PROVIDER_ERROR") },
  ],
  examples: [
    ok(
      "EUR deposits now arrive as USDC",
      "capxul bank settle eur --to usdc --org northwind --json",
      { currency: "eur", destination: { chainId: CHAIN_ID, token: "usdc", address: ADDRESS.northwind }, state: "active" },
    ),
    refused("No --to in a --json run", "capxul bank settle eur --json", error_CLI_USAGE),
    refused("The currency has no bank details open yet", "capxul bank settle gbp --to usdc --json", error_INVALID_INPUT),
  ],
  budget: {
    ...budget("vendor"),
    p95Ms: 5_000,
    why: "two Bridge calls in sequence for a change: the read of the virtual account, then the token change",
  },
});

// ── payouts ─────────────────────────────────────────────────────────────────────────────────

export const operation_bank_pay = defineOperation({
  ...frozenText("bank.pay"),
  /** The designed (v4) who: a payout is the budget's, so whoever wears its hat or one above it now (authority.md, contradiction 5). */
  who: (frozen["bank.pay"] as { designed: { who: string } | null }).designed?.who ?? frozenText("bank.pay").who,
  priority: "normal",
  implementedBy: flow_client_banking_payouts_pay,
  acceptance: [
    kept("bank.pay", 1, "cli: after `dev time warp` past the quote's deadline, or after the account is removed before approval, the output names `capxul bank pay` again; chain: after the deadline, no PaymentSent to the deposit address."),
    kept("bank.pay", 2, "cli: the quote shows the bank amount Bridge locked and the slippage buffer as part of what leaves the Safe."),
    kept("bank.pay", 3, "cli: for a payout the Bridge stand-in returns, `bank pay` (or a later read) names the reason and the refund's transaction and Safe; chain: the refund Transfer into the Safe."),
    kept("bank.pay", 4, "cli: the same `--request-key` again succeeds with the same payout; chain: one PaymentSent; world: one payout and one Payment."),
    kept("bank.pay", 5, "cli: as Gus, above what Globex's `office-costs` has left, exit PAYROLL_BUDGET_EXCEEDED; world: no change."),
  ],
  returns: PayoutView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: "person-with-gbp-account", when: when("bank.pay", "INVALID_INPUT") },
    {
      error: error_CLI_USAGE,
      given: "person-with-contacts",
      when: "The contact is a private entry with no Party (Ada's Northwind Ltd): refused before any quote, naming how to give it one (banking.private-entries).",
    },
    { error: error_WRONG_STATE, given: "person-with-gbp-account", when: when("bank.pay", "WRONG_STATE") },
    { error: error_VERIFICATION_REQUIRED, given: "person-ready", when: "You are not verified: a new payee in `--input`. It names `capxul verify start`." },
    { error: error_INSUFFICIENT_BALANCE, given: "person-with-gbp-account", when: "The Safe cannot fund the payout: more than its 1,000 USDC." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-verified", when: "You wear no hat on that budget or above it: Hal, paying from Globex's `office-costs`." },
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: "org-verified", when: "The budget has less left this period than the funding amount: Gus, above the 2,000 USDC `office-costs` has left." },
  ],
  examples: [
    ok(
      "Marcus pays Brightside 250 by bank from the Finance budget; the quote waits for his approval",
      `capxul bank pay contact 250 --account ${BRIGHTSIDE_ACCOUNT} --org northwind --from finance --json`,
      {
        payoutId: uuid(862), status: "awaiting_approval", stage: "quoted", stageReason: null,
        quote: { receive: { currency: "usd", amount: "250.00" }, send: { token: "usdc", amount: "250.75" }, slippage: "0.30", rate: "1.00", fee: "0.45", expiresAt: at("2026-02-10T09:45:00Z") },
        account: { partyAccountId: BRIGHTSIDE_ACCOUNT, bankName: "Harbour Bank", last4: "7788", currency: "usd" },
        budget: { budgetId: ID.financeBudget, key: "finance", name: "Finance" },
        paymentIds: [ID.paymentToBrightside], approvalId: ID.approval, approvalUrl: "https://app.capxul.test/approvals/" + ID.approval, refund: null, warnings: [],
      },
    ),
    refused("Marcus is not verified yet", "capxul bank pay self 250 --json", error_VERIFICATION_REQUIRED),
    refused("The payout needs more than the Finance budget has left", `capxul bank pay contact 5000 --account ${BRIGHTSIDE_ACCOUNT} --org northwind --from finance --json`, error_PAYROLL_BUDGET_EXCEEDED),
    refused("Priya wears no hat on the budget", `capxul bank pay contact 250 --account ${BRIGHTSIDE_ACCOUNT} --org northwind --from finance --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: {
    ...budget("vendor"),
    p95Ms: 5_000,
    why: "the quote's two Bridge calls in sequence for an account still saved, then the funding reads",
    excludes: ["wait.person", "chain.confirm"],
  },
});
