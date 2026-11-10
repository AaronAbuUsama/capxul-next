// The target operation records of the 14 frozen operations requests owns (OPERATION_OWNERS):
// requests, the inbox, services and `bank match`. Each is built from the frozen text, never
// retyped (frozenText); its acceptance lines are the frozen claims, each with what a black-box run
// observes. A line that named an old mechanism is rewritten as an outcome, with the old line and its
// test in `was` (P1), and decision requests.acceptance-rewrites lists them. Refusals name the
// devnet worlds of decision requests.worlds.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, hash, ID, ok, refused, uuid } from "../shared/examples.ts";
import {
  flow_client_account_inbox_decline,
  flow_client_account_inbox_get,
  flow_client_account_inbox_pay,
  flow_client_account_requests_cancel,
  flow_client_account_requests_get,
  flow_client_account_requests_issue,
  flow_client_banking_deposits_match,
} from "./flows.ts";
import { rpc_requests_inbox_list } from "./inbox.ts";
import { rpc_requests_issuing_list } from "./issuing.ts";
import { RequestPage, RequestView, ServicePage, ServiceView } from "./shapes.ts";

// ── examples: the requests story (ids 900-949) ───────────────────────────────────────────────
// Brightside's invoice 901 sits in Northwind's inbox; 903 is Northwind's request to Brightside, paid by a bank deposit;
// 904 is Priya asking Marcus for the team lunch.

const at = (iso: string) => Date.parse(iso);
const usdc = (value: string) => ({ asset: "USDC", value, raw: value.replace(".", "") + "0000", decimals: 6 });
const noPayment = { escrow: null, checkout: null, paymentId: null, payment: null, depositId: null };
const brightsideInvoice = {
  id: uuid(901), kind: "invoice", status: "open",
  issuer: { kind: "organization", label: "Brightside Cleaning", safe: ADDRESS.brightside },
  payer: { kind: "capxul", label: "Northwind Trading", safe: ADDRESS.northwind },
  amount: usdc("1200.00"), reference: "INV-0042", note: "Office cleaning, January", documents: [{ hash: hash("a1"), render: `capxul document render --document-hash ${hash("a1")} --content-hash ${hash("b2")}` }],
  expiresAt: null, dueAt: at("2026-02-28T00:00:00Z"), ...noPayment, createdAt: at("2026-02-03T10:00:00Z"), updatedAt: at("2026-02-03T10:00:00Z"),
};
const refundRequest = {
  id: uuid(903), kind: "request", status: "paid",
  issuer: { kind: "organization", label: "Northwind Trading", safe: ADDRESS.northwind },
  payer: { kind: "outside", label: "Brightside Cleaning", safe: null },
  amount: { asset: "EURC", value: "1200.00", raw: "1200000000", decimals: 6 }, reference: "REFUND-2026-001", note: null, documents: [],
  expiresAt: null, dueAt: null, escrow: null, checkout: null, paymentId: null, payment: null, depositId: uuid(860),
  createdAt: at("2026-02-02T09:00:00Z"), updatedAt: at("2026-02-04T08:05:00Z"),
};
const lunchRequest = {
  id: uuid(904), kind: "request", status: "open",
  issuer: { kind: "person", label: "Priya Raman", safe: ADDRESS.priya },
  payer: { kind: "capxul", label: "Marcus Lindqvist", safe: ADDRESS.marcus },
  amount: usdc("40.00"), reference: "Team lunch", note: null, documents: [],
  expiresAt: at("2026-03-10T09:30:00Z"), dueAt: null, ...noPayment, createdAt: at("2026-02-10T09:30:00Z"), updatedAt: at("2026-02-10T09:30:00Z"),
};

const S = Schema.String;

/** The frozen claim `n` (from 1), word for word, with what a black-box run observes. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const line = frozen[id].acceptance[n - 1] as { claim: string; was: readonly string[] };
  return { claim: line.claim, observes, was: [...line.was] };
};

/** Claim `n` rewritten as an observable outcome; the old line and its test move to `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const line = frozen[id].acceptance[n - 1] as { claim: string; was: readonly string[] };
  return { claim, observes, was: [line.claim, ...line.was] };
};

/** A terminal's preview read then the write, as the flows that ask first take it. */
const PREVIEW_WRITE = {
  ...budget("write"),
  p95Ms: 2_500,
  excludes: ["sdk.step.confirm"],
  why: "a terminal's preview read then the write: two round trips; the person's answer to the prompt is excluded",
} as const;

const NOT_SIGNED_IN = { error: error_NOT_AUTHENTICATED, given: "signed-out", when: "You are not signed in." } as const;
const NOT_A_MEMBER = {
  error: error_ROLE_PERMISSION_DENIED,
  given: "org-with-requests",
  when: "`--org` names an Organization you do not take part in.",
} as const;
const NO_INVOICING_HAT = {
  error: error_ROLE_PERMISSION_DENIED,
  given: "org-with-requests",
  when: "With `--org`, your Safe does not wear the Organization's Invoicing hat.",
} as const;
const INDEXER_BEHIND = {
  error: error_WRONG_STATE,
  given: "requests-indexer-behind",
  when: "Ponder is reindexing or behind the chain, so a request's status cannot be stated (`verification_unavailable`).",
} as const;

// ── requests: the issuer's side ─────────────────────────────────────────────────────────────

export const operation_request_issue = defineOperation({
  ...frozenText("request.issue"),
  priority: "normal",
  implementedBy: flow_client_account_requests_issue,
  acceptance: [
    keep(
      "request.issue",
      1,
      "cli: the issued item names its escrow address. chain: the devnet EscrowFactory's `predictAddress(terms, salt)` " +
        "answers that address, and once it is funded and paid out, EscrowDeployed there names the email's " +
        "`safeAddressFor` Safe as ownerSafe and the issuer's Safe as payeeSafe.",
    ),
    keep(
      "request.issue",
      2,
      "cli: a basic request to an outside email names an escrow; one issued with no payer names none and only a checkout " +
        "link. chain: the funded escrow's EscrowCreated carries kind 1.",
    ),
    keep("request.issue", 3, "cli: INVALID_INPUT, exit 2. world: no request is added."),
    keep(
      "request.issue",
      4,
      "cli: with the devnet's fault switch dropping the reply after the write, the command prints the one request it " +
        "issued; a terminal decline exits CANCELLED. world: one request for the key, and none after a decline.",
    ),
  ],
  returns: Schema.Struct({ scope: Schema.Literals(["person", "organization"]), direction: Schema.Literal("issued"), item: RequestView }),
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-requests",
      when: "From a script without `--confirm`, or with both `<email> <amount>` and `--input`.",
    },
    { error: error_INVALID_INPUT, given: "person-with-requests", when: "The request is not valid, such as an Invoice to a bare wallet address." },
    NO_INVOICING_HAT,
    {
      error: error_TOKEN_NOT_SUPPORTED,
      given: "person-with-requests",
      when: "The asset is not one Payments can move exactly (a fee or rebasing token).",
    },
    NOT_SIGNED_IN,
  ],
  examples: [
    ok(
      "Priya asks Marcus for 40 USDC for the team lunch",
      "capxul request issue marcus.lindqvist@northwind.test 40 --reference \"Team lunch\" --confirm --json",
      { scope: "person", direction: "issued", item: lunchRequest },
    ),
    refused("An Invoice to a bare wallet address", `capxul request issue ${ADDRESS.brightside} 40 --reference "Team lunch" --org northwind --confirm --json`, error_INVALID_INPUT),
    refused("From a script without --confirm", `capxul request issue marcus.lindqvist@northwind.test 40 --reference "Team lunch" --json`, error_CLI_USAGE),
    refused("Priya's Safe does not wear Northwind's Invoicing hat", `capxul request issue accounts@brightside.test 1200 --asset EURC --reference "REFUND-2026-001" --org northwind --confirm --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("write"),
});

export const operation_request_get = defineOperation({
  ...frozenText("request.get"),
  priority: "normal",
  implementedBy: flow_client_account_requests_get,
  acceptance: [
    rewrite(
      "request.get",
      1,
      "The issuer gets its request with the status the chain shows for its payment or escrow; a request the caller did not issue reads null.",
      "read: as the issuer, `request get` shows the escrow Invoice paid once its payout settled on the devnet; as another " +
        "person, the same id is CLI_USAGE. trace: the read makes no chain call.",
    ),
    keep("request.get", 2, "read: with `--org` the member reads the Organization's request; the person's own request id under `--org` is CLI_USAGE."),
    keep("request.get", 3, "world: the diff around a read is empty. trace: no request_transitioned is sent."),
    keep("request.get", 4, "cli: with `--wait paid` it prints the request paid after the devnet pays it, or at its deadline the last status, exit 0."),
    keep("request.get", 5, "cli: a paid request's output names `payment get <id>` and `payment wait <id>` with the same `--org`."),
  ],
  returns: RequestView,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-requests",
      when: "The request is not found or not yours, or `--wait paid` is used on a received request.",
    },
    INDEXER_BEHIND,
    NOT_A_MEMBER,
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("The refund request Northwind issued, paid by a bank deposit", `capxul request get ${uuid(903)} --org northwind --json`, refundRequest),
    refused("A request that is not found or not yours", `capxul request get ${uuid(949)} --json`, error_CLI_USAGE),
    refused("Someone outside Northwind", `capxul request get ${uuid(903)} --org northwind --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("read"),
});

export const operation_request_list = defineOperation({
  ...frozenText("request.list"),
  priority: "normal",
  implementedBy: rpc_requests_issuing_list,
  acceptance: [
    rewrite(
      "request.list",
      1,
      "It lists only the requests the caller's scope issued, and nothing for a person who issued nothing.",
      "read: the issuer's list holds exactly its requests; a person who issued nothing gets an empty page.",
    ),
    rewrite(
      "request.list",
      2,
      "A list changes nothing, and a paid request's status does not change once its payment's block is final.",
      "world: the diff around a list is empty. read: a request paid at a final block reads paid in every later list, " +
        "across a devnet reorg above that block.",
    ),
    rewrite(
      "request.list",
      3,
      "When the chain's state cannot be read, the whole list is refused `WRONG_STATE`, never a partial or empty list.",
      "cli: in the world with Ponder held behind the chain, `request list` exits WRONG_STATE `verification_unavailable` and prints no items.",
    ),
    keep("request.list", 4, "trace: no request_transitioned is sent by a list."),
  ],
  returns: RequestPage,
  refusals: [
    { ...INDEXER_BEHIND, when: "Ponder is reindexing or behind the chain, so a listed request's status cannot be stated (`verification_unavailable`). The whole list is refused." },
    NOT_A_MEMBER,
    { error: error_INVALID_INPUT, given: "person-with-requests", when: "`--after` is a cursor this list did not give." },
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("The requests Northwind issued", "capxul request list --org northwind --json", { items: [refundRequest], nextCursor: null }),
    ok("Priya's own requests, one at a time", "capxul request list --limit 1 --json", { items: [lunchRequest], nextCursor: "cursor-2026-02-10-904" }),
    refused("A cursor this list did not give", "capxul request list --after nonsense --json", error_INVALID_INPUT),
  ],
  budget: budget("read"),
});

export const operation_request_cancel = defineOperation({
  ...frozenText("request.cancel"),
  priority: "normal",
  implementedBy: flow_client_account_requests_cancel,
  acceptance: [
    rewrite(
      "request.cancel",
      1,
      "Each cancel reports its own transition, from the status the request had to cancelled, and a refused cancel reports none.",
      "trace: one request_transitioned with transition `cancel`, `from` open or expired and `to` cancelled; a refused " +
        "cancel sends none. world: only that request's status changed.",
    ),
    keep("request.cancel", 2, "cli: at a terminal it prints the issued request's amount, payer and reference and asks; answering no exits CANCELLED and the world is unchanged."),
  ],
  returns: RequestView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-requests", when: "From a script without `--confirm`, or the request is not found or not yours." },
    { error: error_WRONG_STATE, given: "person-with-requests", when: "The request is already being paid, paid, declined or cancelled." },
    NO_INVOICING_HAT,
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("Priya cancels the team lunch request", `capxul request cancel ${uuid(904)} --confirm --json`, { ...lunchRequest, status: "cancelled", updatedAt: at("2026-02-10T09:40:00Z") }),
    refused("A request already paid", `capxul request cancel ${uuid(903)} --org northwind --confirm --json`, error_WRONG_STATE),
    refused("From a script without --confirm", `capxul request cancel ${uuid(904)} --json`, error_CLI_USAGE),
  ],
  budget: PREVIEW_WRITE,
});

// ── the inbox: the payer's side ─────────────────────────────────────────────────────────────

export const operation_inbox_list = defineOperation({
  ...frozenText("inbox.list"),
  priority: "normal",
  implementedBy: rpc_requests_inbox_list,
  acceptance: [
    rewrite(
      "inbox.list",
      1,
      "It lists the Invoice addressed to the payer with the status the chain shows for it, and nothing for a person the requests are not addressed to.",
      "read: the payer's inbox holds the Invoice, paid once the devnet settled it; a third person's inbox is empty.",
    ),
    keep(
      "inbox.list",
      2,
      "cli: pages follow newest first through `nextCursor` (the `--after` value it prints); an `--after` it never printed " +
        "exits INVALID_INPUT and no items. trace: that refusal reads no request.",
    ),
    keep("inbox.list", 3, "cli: in the world with Ponder held behind the chain, `inbox list` exits WRONG_STATE and prints no empty list."),
    keep("inbox.list", 4, "world: the diff around a list is empty. trace: no request_transitioned."),
  ],
  returns: RequestPage,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-requests", when: "`--limit` is outside 1 to 100." },
    { error: error_INVALID_INPUT, given: "person-with-requests", when: "`--after` is a cursor that names no page." },
    { ...INDEXER_BEHIND, when: "Ponder is reindexing or behind the chain, so a received request's status cannot be stated (`verification_unavailable`)." },
    NOT_A_MEMBER,
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("Northwind's inbox: Brightside's invoice", "capxul inbox list --org northwind --json", { items: [brightsideInvoice], nextCursor: null }),
    refused("--limit outside 1 to 100", "capxul inbox list --limit 500 --json", error_CLI_USAGE),
    refused("Someone who is not part of Northwind", "capxul inbox list --org northwind --json", error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("read"),
});

export const operation_inbox_get = defineOperation({
  ...frozenText("inbox.get"),
  priority: "normal",
  implementedBy: flow_client_account_inbox_get,
  acceptance: [
    rewrite(
      "inbox.get",
      1,
      "The addressed payer gets the request with the status the chain shows for it; one not addressed to the caller reads null.",
      "read: the addressed payer's `inbox get` shows the request; another person's is CLI_USAGE. trace: the read makes no chain call.",
    ),
    keep("inbox.get", 2, "read: with `--org` a member reads the Organization's received request; the person's own received request id under `--org` is CLI_USAGE."),
    keep(
      "inbox.get",
      3,
      "cli: another actor's id exits CLI_USAGE; with the devnet's fault switch answering a different request, it exits " +
        "PROVIDER_RESPONSE_INVALID and prints nothing of it.",
    ),
    keep("inbox.get", 4, "world: the diff around a read is empty. trace: no request_transitioned."),
  ],
  returns: RequestView,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-requests",
      when: "The request is not in the inbox of whoever you act as, or `--wait paid` is used on it.",
    },
    INDEXER_BEHIND,
    NOT_A_MEMBER,
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("Brightside's invoice, before Northwind pays it", `capxul inbox get ${uuid(901)} --org northwind --json`, brightsideInvoice),
    refused("A request that is in another inbox", `capxul inbox get ${uuid(904)} --org northwind --json`, error_CLI_USAGE),
    refused("Signed out", `capxul inbox get ${uuid(901)} --json`, error_NOT_AUTHENTICATED),
  ],
  budget: budget("read"),
});

export const operation_inbox_pay = defineOperation({
  ...frozenText("inbox.pay"),
  /** The designed (v4) who: an Organization pays from a budget, so whoever wears its hat or one above it now (authority.md, contradiction 5). */
  who: (frozen["inbox.pay"] as { designed: { who: string } | null }).designed?.who ?? frozenText("inbox.pay").who,
  priority: "normal",
  implementedBy: flow_client_account_inbox_pay,
  acceptance: [
    keep(
      "inbox.pay",
      1,
      "chain: the settled PaymentSent pays the issuer's Safe the request's token and raw amount with kind 1 and the " +
        "request's document hash. cli: with the devnet's fault switch answering another amount, it exits " +
        "PROVIDER_RESPONSE_INVALID and nothing is approved.",
    ),
    rewrite(
      "inbox.pay",
      2,
      "A fresh request key cannot start a second payment while one is live, and no input can pay an issued Invoice on terms other than its own.",
      "cli: a second `inbox pay` with a new key while the first approval waits exits WRONG_STATE. world: one live Payment " +
        "for the request, on its own token, amount, payee and document whatever the input carried.",
    ),
    keep("inbox.pay", 3, "cli: another person's `inbox pay` of the id exits CLI_USAGE. world: no Payment is born."),
    keep("inbox.pay", 4, "cli: `--on` or `--at` under an hour ahead exits INVALID_INPUT. world: no Payment and no approval are born."),
    keep("inbox.pay", 5, "cli: paying a declined or paid request exits WRONG_STATE and its message names `capxul inbox get <id>`."),
  ],
  returns: Schema.Struct({
    status: S,
    approvalId: S,
    approvalUrl: S,
    paymentIds: Schema.Array(S),
    expiresAt: Schema.NullOr(Schema.Number),
    next: Schema.Struct({ argv: Schema.Array(S) }),
    request: RequestView,
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "org-with-requests",
      when: "An Organization payment without `--from`, both `--on` and `--at`, or the request is unavailable to this payer.",
    },
    {
      error: error_WRONG_STATE,
      given: "person-with-requests",
      when: "The request is not open, or the budget or one above it is closed. The message names the command that reads it.",
    },
    {
      error: error_INVALID_INPUT,
      given: "person-with-requests",
      when: "The request is paid only into its escrow, or the date is under an hour ahead.",
    },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-requests", when: "Your Safe wears no hat on that budget or above it." },
    { error: error_INSUFFICIENT_BALANCE, given: "person-with-underfunded-safe", when: "The paying Safe holds less than the request." },
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: "org-with-requests", when: "The budget has less left this period than the request." },
    NOT_SIGNED_IN,
  ],
  examples: [
    ok(
      "Marcus pays Brightside's invoice from the Finance budget; the approval waits for him",
      `capxul inbox pay ${uuid(901)} --org northwind --from finance --json`,
      {
        status: "awaiting_approval", approvalId: ID.approval, approvalUrl: "https://app.capxul.test/approvals/" + ID.approval, paymentIds: [ID.paymentToBrightside],
        expiresAt: at("2026-02-10T10:30:00Z"), next: { argv: ["capxul", "payment", "wait", ID.approval, "--json"] }, request: brightsideInvoice,
      },
    ),
    refused("An Organization payment without --from", `capxul inbox pay ${uuid(901)} --org northwind --json`, error_CLI_USAGE),
    refused("The request is already decided", `capxul inbox pay ${uuid(903)} --org northwind --from finance --json`, error_WRONG_STATE),
    refused("The Finance budget has less left than the invoice", `capxul inbox pay ${uuid(901)} --org northwind --from finance --json`, error_PAYROLL_BUDGET_EXCEEDED),
    refused("Priya wears no hat on that budget", `capxul inbox pay ${uuid(901)} --org northwind --from finance --json`, error_ROLE_PERMISSION_DENIED),
  ],
  budget: budget("chain-settle"),
});

export const operation_inbox_decline = defineOperation({
  ...frozenText("inbox.decline"),
  priority: "normal",
  implementedBy: flow_client_account_inbox_decline,
  acceptance: [
    keep("inbox.decline", 1, "read: `request list` shows it declined and `payment list` shows no Payment for it. world: no Payment row."),
    keep("inbox.decline", 2, "cli: a member whose Safe wears no Invoicing hat exits ROLE_PERMISSION_DENIED; one who wears it declines."),
    keep("inbox.decline", 3, "trace: a second decline, or a refused one, sends no request_transitioned. world: unchanged."),
    keep("inbox.decline", 4, "trace: a personal decline's request_transitioned names no Organization. world: nothing of the issuer's Organization changes."),
    keep("inbox.decline", 5, "cli: an id outside the current inbox exits CLI_USAGE. trace: no decline rpc is called."),
  ],
  returns: RequestView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-requests", when: "From a script without `--confirm`, or the request is not in this inbox." },
    { ...NO_INVOICING_HAT, when: "For an Organization, your Safe does not wear its Invoicing hat." },
    { error: error_WRONG_STATE, given: "person-with-requests", when: "The request has already been decided." },
    NOT_SIGNED_IN,
  ],
  examples: [
    ok("Marcus declines Brightside's invoice", `capxul inbox decline ${uuid(901)} --org northwind --confirm --json`, { ...brightsideInvoice, status: "declined", updatedAt: at("2026-02-10T09:45:00Z") }),
    refused("The request is already decided", `capxul inbox decline ${uuid(901)} --org northwind --confirm --json`, error_WRONG_STATE),
    refused("From a script without --confirm", `capxul inbox decline ${uuid(901)} --json`, error_CLI_USAGE),
  ],
  budget: PREVIEW_WRITE,
});

// ── services ────────────────────────────────────────────────────────────────────────────────

// ── bank match ──────────────────────────────────────────────────────────────────────────────

export const operation_bank_match = defineOperation({
  ...frozenText("bank.match"),
  priority: "normal",
  implementedBy: flow_client_banking_deposits_match,
  acceptance: [
    rewrite(
      "bank.match",
      1,
      "A credited deposit matched to a request marks the request paid, creates no Payment and reports the match once.",
      "read: `request get` shows it paid with the deposit; `payment list` shows no Payment for it. trace: one " +
        "request_transitioned `match` and one bank_deposit_match_transitioned.",
    ),
    keep("bank.match", 2, "read: `bank deposits` shows it matched `not_request`. world: no request changes."),
    keep("bank.match", 3, "cli: the deposit is printed unchanged. trace: no second request_transitioned or bank_deposit_match_transitioned. world: unchanged."),
    keep("bank.match", 4, "cli: matching a matched deposit to another request, or to `none`, exits WRONG_STATE. world: unchanged."),
    keep("bank.match", 5, "cli: an unknown request id exits INVALID_INPUT. read: `bank deposits` still shows the deposit unmatched."),
    keep("bank.match", 6, "cli: with `--json` and no request it exits CLI_USAGE listing the candidate request ids, with no prompt."),
  ],
  returns: Schema.Struct({
    bankDepositId: S,
    match: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("request"), requestId: S, reference: S }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
    status: S,
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "person-with-credited-deposit",
      when: "No deposit has that ID, or no request was given in a script or a `--json` run. It lists the requests you can give.",
    },
    { error: error_WRONG_STATE, given: "person-with-credited-deposit", when: "The deposit is already matched to something else, or is not credited yet." },
    { error: error_INVALID_INPUT, given: "person-with-credited-deposit", when: "The request does not exist, or the deposit is another Party's." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: "org-with-credited-deposit",
      when: "For an Organization, a member whose Safe does not wear its Invoicing hat.",
    },
  ],
  examples: [
    ok(
      "Hannah marks the unmatched 500 USD deposit as not a request",
      `capxul bank match ${uuid(861)} none --org northwind --json`,
      { bankDepositId: uuid(861), match: { kind: "not_request" }, status: "credited" },
    ),
    ok(
      "Hannah matches a deposit to the refund request it paid",
      `capxul bank match ${uuid(860)} ${uuid(903)} --org northwind --json`,
      { bankDepositId: uuid(860), match: { kind: "request", requestId: uuid(903), reference: "REFUND-2026-001" }, status: "credited" },
    ),
    refused("The deposit is already matched to something else", `capxul bank match ${uuid(860)} ${uuid(904)} --org northwind --json`, error_WRONG_STATE),
    refused("A script without a request", `capxul bank match ${uuid(861)} --org northwind --json`, error_CLI_USAGE),
    refused("The request does not exist", `capxul bank match ${uuid(861)} ${uuid(949)} --org northwind --json`, error_INVALID_INPUT),
  ],
  budget: PREVIEW_WRITE,
});

// ── org projects timesheet bill: an operation beyond the 215 (rules.new-operations; requests.bill-time) ─────────

/** The world `org projects timesheet bill` starts from: projects' org-with-projects (projects.worlds). */
const W_PROJECTS = "org-with-projects";

