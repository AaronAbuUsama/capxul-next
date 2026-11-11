// The old book's Banking area, as it is: one operation record for each operation that
// apps/docs/factory/areas/banking.yaml lists (8), read from /home/user/factory (branch
// integration/factory). The text (title, about, who, changes, notes, mistakes, acceptance and each
// refusal's `when`) is the frozen book's, spread from ../../frozen, never retyped.
//
// implementedBy: each CLI command (apps/cli/src/commands/bank/) is traced to the SDK method the page
// names. `bank details`, `deposits`, `match` and `settle` call `client.banking` (or
// `client.org(id).banking` for an Organization actor, bank/internal/scope.ts:13), whose methods each
// forward one banking row (packages/sdk/src/banking/); `bank accounts` and its `add` and `remove` call
// `client.account.bankAccounts` (or the Organization's), which forward one parties row each
// (packages/sdk/src/parties/accounts.ts:52). So each is implemented by the one rpc it reaches, from
// ../banking/bank-details.ts, ../banking/deposits.ts and ../parties/accounts.ts. Where the CLI composes
// several of those methods itself (details reads, opens and reads again; match reads the deposit and
// its candidates first), implementedBy is the rpc of the method the page names and the comment names
// the others. `bank pay` calls `client.approvals.prepare`, which composes several calls: its flow is
// ../payments/flows.ts's.
//
// returns: a Struct of the page's `returns` fields, each typed from the protocol row's output schema
// (packages/protocol/src/banking/schema.ts, parties/accounts-schema.ts). `bank pay`'s fields come from
// the CLI's own payout result and the quote, not a row: Schema.Unknown, as the comment says.
//
// errors: what the CLI command produces itself (CliFailure), before or after its implementation.
// Every bank command selects its actor first, which refuses an `--org` that is empty, given twice or
// names an Organization you are not in by handle with CLI_USAGE (auth/actor.ts:28, :43, :59). The session
// restore's NOT_AUTHENTICATED (auth/first-party.ts:173) is shared by every signed-in command and left
// out, as ../payments/operations.ts leaves it out. A backend refusal the CLI only rewords keeps its code
// (payout-errors.ts:21, :37) and is not listed.
//
// refusals: `given` names a saved devnet world (packages/scenarios) from which a scenario step's command
// reaches the refusal. S19 (s19-dana-is-paid-by-bank.scenario.ts), which reaches the refusals of
// `bank details`, `settle`, `deposits` and `match`, runs on the devnet the run starts on (`parent: null`,
// :143) and restores no saved world, so those stay `?`. No budget: nothing measured these commands.
// priority is `normal`: the old book has none.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_VERIFICATION_REQUIRED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_banking_bank_details_get, rpc_banking_bank_details_settle } from "../banking/bank-details.ts";
import { rpc_banking_deposits_list, rpc_banking_deposits_match } from "../banking/deposits.ts";
import { rpc_parties_accounts_add, rpc_parties_accounts_list, rpc_parties_accounts_remove } from "../parties/accounts.ts";
import { flow_client_approvals_prepare } from "../payments/flows.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

type Worlds = Readonly<Record<string, readonly [error: Ref<"error">, given: string]>>;

/** The page's refusals in its order, `when` verbatim; each code mapped to its error and world. */
const refusalsOf = (id: FrozenId, worlds: Worlds) =>
  frozenRefusals(id).map(({ code, when }) => {
    const mapped = worlds[code];
    if (mapped === undefined) throw new Error(`${id}: refusal ${code} has no error record`);
    return { error: mapped[0], given: mapped[1], when };
  });

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands/bank";
const SDK = "packages/sdk/src";
const ROWS = "packages/protocol/src";
const S19 = "packages/scenarios/src/acme/s19-dana-is-paid-by-bank.scenario.ts";

/** The actor every bank command selects first, and the refusals it makes itself. */
const ACTOR_WAS = [
  "apps/cli/src/auth/actor.ts:87",
  "apps/cli/src/auth/actor.ts:28",
  "apps/cli/src/auth/actor.ts:43",
  "apps/cli/src/auth/actor.ts:59",
  "apps/cli/src/auth/input.ts:20",
];

// ── the row shapes ───────────────────────────────────────────────────────────────────────────

/** AssetAmountSchema (money/schema.ts:46): branded strings are plain here. */
const AssetAmount = Schema.Struct({
  asset: Schema.String,
  value: Schema.String,
  currency: Schema.optional(Schema.Never),
  decimals: Schema.optional(Schema.Never),
});

const BankCurrency = Schema.Literals(["usd", "eur", "gbp"]); // banking/schema.ts:7
const SettlementToken = Schema.Literals(["usdc", "eurc"]); // banking/schema.ts:8

/** BankDetailsSchema (banking/schema.ts:42), with BankDetailsFieldsSchema (:34). */
const BankDetails = Schema.Struct({
  receivingAccountId: Schema.String,
  currency: BankCurrency,
  state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
  visibility: Schema.Literals(["masked", "full"]),
  bankName: Schema.optionalKey(Schema.String),
  accountHolder: Schema.optionalKey(Schema.String),
  bankAddress: Schema.optionalKey(Schema.String),
  paymentRails: Schema.Array(Schema.String),
  fields: Schema.Struct({
    routingNumber: Schema.optionalKey(Schema.String),
    accountNumber: Schema.optionalKey(Schema.String),
    iban: Schema.optionalKey(Schema.String),
    bic: Schema.optionalKey(Schema.String),
    sortCode: Schema.optionalKey(Schema.String),
  }),
  destination: Schema.Struct({ chainId: Schema.Number, token: SettlementToken, address: Schema.String }),
  developerFeePercent: Schema.optionalKey(Schema.String),
  minimumDeposit: Schema.optionalKey(Schema.String),
  notice: Schema.optionalKey(Schema.String),
});

/** BankDepositSchema (banking/schema.ts:73). `receivedAt` is EpochMsSchema: a number. */
const BankDeposit = Schema.Struct({
  bankDepositId: Schema.String,
  receivingAccountId: Schema.String,
  currency: BankCurrency,
  amount: Schema.String,
  receivedAt: Schema.Number,
  sender: Schema.optionalKey(Schema.String),
  reference: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["processing", "arriving", "credited", "returned", "below_minimum"]),
  refundState: Schema.optionalKey(Schema.Literals(["in_flight", "done", "failed"])),
  credit: Schema.optionalKey(
    Schema.Struct({
      amount: AssetAmount,
      symbol: Schema.Literals(["USDC", "EURC"]),
      chainId: Schema.Number,
      transactionHash: Schema.String,
      movementId: Schema.String,
    }),
  ),
  match: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("request"),
        requestId: Schema.String,
        reference: Schema.String,
        how: Schema.Literals(["reference", "manual"]),
      }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
  ),
});

/** BankAccountSchema (parties/accounts-schema.ts:64), with RecipientLocatorSchema (parties/schema.ts:31). */
const BankAccount = Schema.Struct({
  partyAccountId: Schema.String,
  ownerPartyId: Schema.String,
  ownerScope: Schema.Literals(["self", "contact"]),
  currency: BankCurrency,
  holderName: Schema.String,
  bankName: Schema.optionalKey(Schema.String),
  last4: Schema.String,
  state: Schema.Literals(["saved", "active", "inactive"]),
  recipient: Schema.Struct({
    ref: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("handle"), handle: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("email"), email: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("address"), address: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String }),
    ]),
    label: Schema.String,
    onCapxul: Schema.Boolean,
  }),
});

// ── bank details ─────────────────────────────────────────────────────────────────────────────

// The page names `client.banking.details.get`. As is, the CLI reads the overview first (`details.list`,
// details/execute.ts:48). With `--currency` it reads that currency (`details.get`, :56), opens it when the person
// is verified for it and it has none (`details.open`, :60, an action that calls Bridge) and reads it again (:63).
// Without `--currency` it opens every verified currency that has none (:73) and lists them all (:79), and prints the
// overview (`accounts`, `verification`), not one BankDetails. Not verified at all, or not for the currency, it
// refuses WRONG_STATE itself and names `capxul verify start` (:59, :69 → internal/presentation.ts:75).
export const operation_bank_details = defineOperation({
  ...frozenText("bank.details"),
  was: [
    page("bank.details"),
    `${CLI}/subcommands/details/command.ts:14`,
    `${CLI}/subcommands/details/execute.ts:44`,
    `${CLI}/subcommands/details/execute.ts:48`,
    `${CLI}/subcommands/details/execute.ts:56`,
    `${CLI}/subcommands/details/execute.ts:59`,
    `${CLI}/subcommands/details/execute.ts:60`,
    `${CLI}/subcommands/details/execute.ts:73`,
    `${CLI}/subcommands/details/execute.ts:20`,
    `${CLI}/internal/presentation.ts:75`,
    `${CLI}/internal/input.ts:17`,
    `${CLI}/internal/scope.ts:13`,
    `${SDK}/banking/bank-details.ts:115`,
    `${ROWS}/banking/operations.ts:34`,
    `${ROWS}/banking/schema.ts:42`,
    ...ACTOR_WAS,
    `${S19}:143`,
    `${S19}:151`,
  ],
  priority: "normal",
  implementedBy: rpc_banking_bank_details_get,
  acceptance: frozenClaims("bank.details"),
  // BankDetailsSchema's fields (banking/schema.ts:42), as one `--currency` read prints them (fullBankDetailsResult).
  returns: Schema.Struct({
    currency: BankDetails.fields.currency,
    state: BankDetails.fields.state,
    visibility: BankDetails.fields.visibility,
    fields: BankDetails.fields.fields,
    destination: BankDetails.fields.destination,
    developerFeePercent: BankDetails.fields.developerFeePercent,
  }),
  // CLI_USAGE: a currency that is not USD, EUR or GBP (internal/input.ts:17). WRONG_STATE: not verified
  // (presentation.ts:75). ACCOUNT_NOT_FOUND, or ROLE_PERMISSION_DENIED when an open was refused for permission,
  // when no details exist after opening (details/execute.ts:20, :84, :85).
  errors: [error_CLI_USAGE, error_WRONG_STATE, error_ACCOUNT_NOT_FOUND, error_ROLE_PERMISSION_DENIED],
  refusals: refusalsOf("bank.details", {
    // s19.1 (s19:151): Noor, not verified, asks for bank details and the CLI refuses WRONG_STATE. S19 restores no
    // saved world (see the header).
    WRONG_STATE: [error_WRONG_STATE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
  }),
});

// ── bank deposits ────────────────────────────────────────────────────────────────────────────

export const operation_bank_deposits = defineOperation({
  ...frozenText("bank.deposits"),
  was: [
    page("bank.deposits"),
    `${CLI}/subcommands/deposits/command.ts:14`,
    `${CLI}/subcommands/deposits/execute.ts:16`,
    `${CLI}/internal/deposits-presentation.ts:82`,
    `${SDK}/banking/deposits.ts:64`,
    `${ROWS}/banking/operations.ts:62`,
    `${ROWS}/banking/schema.ts:105`,
    ...ACTOR_WAS,
    `${S19}:278`,
  ],
  priority: "normal",
  implementedBy: rpc_banking_deposits_list,
  acceptance: frozenClaims("bank.deposits"),
  // BankDepositsPageSchema = pageOf(BankDepositSchema) (banking/schema.ts:105, primitives/page.ts:11); the CLI
  // prints the page as is (deposits-presentation.ts:82).
  returns: Schema.Struct({ items: Schema.Array(BankDeposit), nextCursor: Schema.NullOr(Schema.String) }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.deposits", {
    // s19.6 (s19:278): Dana pages with a cursor the list never gave and is refused INVALID_INPUT. S19 restores no
    // saved world.
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
  }),
});

// ── bank match ───────────────────────────────────────────────────────────────────────────────

// Given a request (or `none`), the CLI calls `deposits.match` at once (match/execute.ts:54). Without one it reads
// the deposit (`deposits.get`, :33) and its candidates (`deposits.candidates`, :41) and asks which, or refuses with
// CLI_USAGE naming them in a script or a `--json` run (internal/input.ts:63).
export const operation_bank_match = defineOperation({
  ...frozenText("bank.match"),
  was: [
    page("bank.match"),
    `${CLI}/subcommands/match/command.ts:14`,
    `${CLI}/subcommands/match/execute.ts:21`,
    `${CLI}/subcommands/match/execute.ts:33`,
    `${CLI}/subcommands/match/execute.ts:36`,
    `${CLI}/subcommands/match/execute.ts:41`,
    `${CLI}/subcommands/match/execute.ts:54`,
    `${CLI}/internal/input.ts:43`,
    `${CLI}/internal/input.ts:63`,
    `${CLI}/internal/deposits-presentation.ts:133`,
    `${SDK}/banking/deposits.ts:111`,
    `${ROWS}/banking/operations.ts:85`,
    `${ROWS}/banking/schema.ts:73`,
    ...ACTOR_WAS,
    `${S19}:319`,
  ],
  priority: "normal",
  implementedBy: rpc_banking_deposits_match,
  acceptance: frozenClaims("bank.match"),
  // BankDepositSchema's fields (banking/schema.ts:73); the CLI prints the whole deposit (deposits-presentation.ts:133).
  returns: Schema.Struct({
    bankDepositId: BankDeposit.fields.bankDepositId,
    match: BankDeposit.fields.match,
    status: BankDeposit.fields.status,
  }),
  // CLI_USAGE: an empty deposit or request ID (input.ts:43), no deposit with that ID (match/execute.ts:36), no
  // request in a script or a `--json` run (input.ts:63).
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.match", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    // s19.8 (s19:319): Dana matches a deposit she already marked `none` and is refused WRONG_STATE. S19 restores no
    // saved world.
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── bank settle ──────────────────────────────────────────────────────────────────────────────

export const operation_bank_settle = defineOperation({
  ...frozenText("bank.settle"),
  was: [
    page("bank.settle"),
    `${CLI}/subcommands/settle/command.ts:14`,
    `${CLI}/subcommands/settle/execute.ts:10`,
    `${CLI}/subcommands/settle/execute.ts:11`,
    `${CLI}/subcommands/settle/execute.ts:14`,
    `${CLI}/internal/input.ts:17`,
    `${CLI}/internal/input.ts:26`,
    `${CLI}/internal/presentation.ts:137`,
    `${SDK}/banking/bank-details.ts:145`,
    `${ROWS}/banking/operations.ts:44`,
    ...ACTOR_WAS,
    `${S19}:171`,
  ],
  priority: "normal",
  implementedBy: rpc_banking_bank_details_settle,
  acceptance: frozenClaims("bank.settle"),
  // BankDetailsSchema's fields (banking/schema.ts:42); the CLI prints the whole BankDetails (presentation.ts:137).
  returns: Schema.Struct({
    currency: BankDetails.fields.currency,
    destination: BankDetails.fields.destination,
    state: BankDetails.fields.state,
  }),
  // CLI_USAGE: a currency that is not USD, EUR or GBP (input.ts:17), and a missing or unknown `--to` (:26, :36).
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.settle", {
    // s19.2 (s19:171): verified Dana asks EUR to settle in USDC before EUR details are open and is refused
    // INVALID_INPUT. S19 restores no saved world.
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    CLI_USAGE: [error_CLI_USAGE, "?"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
  }),
});

// ── bank pay ─────────────────────────────────────────────────────────────────────────────────

// The page names `client.approvals.prepare` (row payments.commands.prepare). As is, the CLI composes more around it
// (pay/execute.ts:63): it selects or saves the bank account (`bankAccounts`, payout-account.ts:79), reads the
// payer's holdings (`accounts.read` or the Organization's `treasury`, :85), asks for a quote (`payments.quote`,
// :122), with an Organization reads `me` and what the allowance has left (:37, :48), then calls
// `client.approvals.prepare` (:144) and follows the approval and the payout stage itself (payout-approval.ts:28,
// :116). VERIFICATION_REQUIRED and a quote's INSUFFICIENT_BALANCE come from `payments.quote`, which the CLI reaches
// before the flow, and keep their codes when the CLI rewords them (payout-errors.ts:37).
export const operation_bank_pay = defineOperation({
  ...frozenText("bank.pay"),
  was: [
    page("bank.pay"),
    `${CLI}/subcommands/pay/command.ts:13`,
    `${CLI}/subcommands/pay/execute.ts:65`,
    `${CLI}/subcommands/pay/execute.ts:72`,
    `${CLI}/subcommands/pay/execute.ts:85`,
    `${CLI}/subcommands/pay/execute.ts:92`,
    `${CLI}/subcommands/pay/execute.ts:113`,
    `${CLI}/subcommands/pay/execute.ts:122`,
    `${CLI}/subcommands/pay/execute.ts:144`,
    `${CLI}/subcommands/pay/execute.ts:171`,
    `${CLI}/internal/payout-input.ts:31`,
    `${CLI}/internal/payout-account.ts:79`,
    `${CLI}/internal/payout-approval.ts:28`,
    `${CLI}/internal/payout-approval.ts:116`,
    `${CLI}/internal/payout-approval.ts:136`,
    `${CLI}/internal/payout-errors.ts:21`,
    `${CLI}/internal/payout-errors.ts:37`,
    "apps/cli/src/commands/payment/internal/approval.ts:159",
    "packages/sdk/src/accounts/approvals.ts:106",
    `${ROWS}/payments/operations.ts:152`,
    ...ACTOR_WAS,
    "packages/scenarios/src/acme/s8-two-companies-year-end.scenario.ts:1708",
  ],
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  acceptance: frozenClaims("bank.pay"),
  // No row returns these fields: the CLI builds them from the approval, the quote (`payments.quote`) and the payout's
  // stage (payout-approval.ts:183, :199; payout-view.ts). Each is Schema.Unknown.
  returns: Schema.Struct({
    status: Schema.Unknown, // `awaiting_approval` with `approvalId` and `approvalUrl`, or `in_transit`.
    stage: Schema.Unknown, // `quoted`, `funding`, `in_transit`, `delivered` or `needs_attention`, with `stageReason`.
    quote: Schema.Unknown, // What reaches the bank, what leaves the Safe, the rate, slippage and expiry.
    paymentIds: Schema.Unknown, // The Payments it made.
    warnings: Schema.Unknown, // Anything the payer should know, each with its code.
  }),
  // CLI_USAGE: the payout arguments and `--input` (payout-input.ts:41-88), the account (payout-account.ts:34-155),
  // the request key, the amount and an allowance (send-target.ts:79, send-budget.ts:154-207), and a unit and `--asset`
  // that disagree (pay/execute.ts:113). INVALID_INPUT: EURC to a GBP account (:92). The approval follow refuses
  // CANCELLED, WRONG_STATE (expired), CLI_DEADLINE and TRANSACTION_FAILED itself (payment/internal/approval.ts:100,
  // :109, :118, :140; payout-approval.ts:136).
  errors: [
    error_CLI_USAGE,
    error_INVALID_INPUT,
    error_CANCELLED,
    error_WRONG_STATE,
    error_CLI_DEADLINE,
    error_TRANSACTION_FAILED,
  ],
  refusals: refusalsOf("bank.pay", {
    // s8.29 (s8:1708) is refused for a dated payout (`--on`), which this `when` does not describe.
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
    VERIFICATION_REQUIRED: [error_VERIFICATION_REQUIRED, "?"],
    INSUFFICIENT_BALANCE: [error_INSUFFICIENT_BALANCE, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── bank accounts ────────────────────────────────────────────────────────────────────────────

export const operation_bank_accounts = defineOperation({
  ...frozenText("bank.accounts"),
  was: [
    page("bank.accounts"),
    `${CLI}/subcommands/accounts/command.ts:15`,
    `${CLI}/subcommands/accounts/execute.ts:11`,
    `${CLI}/subcommands/accounts/internal/scope.ts:10`,
    `${SDK}/parties/accounts.ts:57`,
    `${ROWS}/parties/accounts-operations.ts:40`,
    `${ROWS}/parties/accounts-schema.ts:64`,
    ...ACTOR_WAS,
    "packages/scenarios/src/acme/s8-two-companies-year-end.scenario.ts:139",
    "packages/scenarios/src/acme/s8-two-companies-year-end.scenario.ts:1788",
  ],
  priority: "normal",
  implementedBy: rpc_parties_accounts_list,
  acceptance: frozenClaims("bank.accounts"),
  // pageOf(BankAccountSchema) (parties/accounts-operations.ts:42); the CLI prints the page as is (execute.ts:13).
  returns: Schema.Struct({ items: Schema.Array(BankAccount), nextCursor: Schema.NullOr(Schema.String) }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.accounts", {
    // s8.33 (s8:1788): Alice, Acme's payee and not a member, lists Acme's bank accounts with `--org <Acme's ID>` and
    // is refused ROLE_PERMISSION_DENIED. S8 restores after-s7 (s8:139), where Alice is still no member.
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "after-s7"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
  }),
});

// ── bank accounts add ────────────────────────────────────────────────────────────────────────

// In a terminal without `--input` the CLI first reads the currency's fields (`bankAccounts.requirements`,
// accounts/internal/input.ts:112) and prompts for them; then it calls `bankAccounts.add` (add/execute.ts:17).
export const operation_bank_accounts_add = defineOperation({
  ...frozenText("bank.accounts.add"),
  was: [
    page("bank.accounts.add"),
    `${CLI}/subcommands/accounts/subcommands/add/command.ts:13`,
    `${CLI}/subcommands/accounts/subcommands/add/execute.ts:12`,
    `${CLI}/subcommands/accounts/subcommands/add/execute.ts:17`,
    `${CLI}/subcommands/accounts/internal/input.ts:31`,
    `${CLI}/subcommands/accounts/internal/input.ts:112`,
    `${CLI}/subcommands/accounts/internal/request.ts:9`,
    `${SDK}/parties/accounts.ts:56`,
    `${ROWS}/parties/accounts-operations.ts:29`,
    `${ROWS}/parties/accounts-schema.ts:64`,
    ...ACTOR_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_parties_accounts_add,
  acceptance: frozenClaims("bank.accounts.add"),
  // BankAccountSchema's fields (parties/accounts-schema.ts:64); the CLI prints the whole account (add/execute.ts:20).
  returns: Schema.Struct({
    partyAccountId: BankAccount.fields.partyAccountId,
    currency: BankAccount.fields.currency,
    last4: BankAccount.fields.last4,
    state: BankAccount.fields.state,
  }),
  // CLI_USAGE: `--currency` with `--input` (input.ts:31), the owner type and fields (:14, :106), and request keys
  // that differ or are empty (request.ts:9, :12).
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.accounts.add", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── bank accounts remove ─────────────────────────────────────────────────────────────────────

// The CLI lists the saved accounts first (`bankAccounts.list`, remove/execute.ts:15) to name the one removed, then
// calls `bankAccounts.remove` (:19).
export const operation_bank_accounts_remove = defineOperation({
  ...frozenText("bank.accounts.remove"),
  was: [
    page("bank.accounts.remove"),
    `${CLI}/subcommands/accounts/subcommands/remove/command.ts:12`,
    `${CLI}/subcommands/accounts/subcommands/remove/execute.ts:12`,
    `${CLI}/subcommands/accounts/subcommands/remove/execute.ts:15`,
    `${CLI}/subcommands/accounts/subcommands/remove/execute.ts:19`,
    `${SDK}/parties/accounts.ts:58`,
    `${ROWS}/parties/accounts-operations.ts:45`,
    ...ACTOR_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_parties_accounts_remove,
  acceptance: frozenClaims("bank.accounts.remove"),
  // The row's output Struct({ partyAccountId }) (parties/accounts-operations.ts:47); the CLI prints it as is.
  returns: Schema.Struct({ partyAccountId: Schema.String }),
  // CLI_USAGE: an empty or control-character ID (remove/execute.ts:12).
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("bank.accounts.remove", {
    CLI_USAGE: [error_CLI_USAGE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});
