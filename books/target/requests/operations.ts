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
import {
  flow_client_account_inbox_decline,
  flow_client_account_inbox_get,
  flow_client_account_inbox_pay,
  flow_client_account_requests_cancel,
  flow_client_account_requests_get,
  flow_client_account_requests_issue,
  flow_client_account_services_create,
  flow_client_account_services_deactivate,
  flow_client_account_services_revise,
  flow_client_banking_deposits_match,
  flow_client_org_timesheets_bill,
} from "./flows.ts";
import { rpc_requests_inbox_list } from "./inbox.ts";
import { rpc_requests_issuing_bill_time, rpc_requests_issuing_list } from "./issuing.ts";
import { rpc_requests_services_get, rpc_requests_services_list } from "./services.ts";
import { RequestPage, RequestView, ServicePage, ServiceView } from "./shapes.ts";

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
  budget: PREVIEW_WRITE,
});

// ── services ────────────────────────────────────────────────────────────────────────────────

export const operation_service_create = defineOperation({
  ...frozenText("service.create"),
  priority: "normal",
  implementedBy: flow_client_account_services_create,
  acceptance: [
    keep("service.create", 1, "cli: the same key and terms print the same `offerId`; the key with other terms exits INVALID_INPUT. world: one service per key."),
    keep("service.create", 2, "trace: one service_transitioned `create` per new key; a refused key sends none."),
    keep("service.create", 3, "read: `service get` shows the unit amount exactly as given; a quantity range whose totals overflow the token exits INVALID_INPUT."),
    rewrite(
      "service.create",
      4,
      "A scripted write without confirmation is refused before anything is read or written, and a terminal cancel writes nothing.",
      "cli: without `--confirm` in a script it exits CLI_USAGE. trace: no rpc is called. world: unchanged after a terminal cancel.",
    ),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`, or the JSON is missing a field or has an extra one." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The request key was used with other terms, or the quantity is outside its limits." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "With `--org`, your Safe does not wear the Organization's Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: budget("write"),
});

export const operation_service_revise = defineOperation({
  ...frozenText("service.revise"),
  priority: "normal",
  implementedBy: flow_client_account_services_revise,
  acceptance: [
    keep("service.revise", 1, "read: `service get` shows the new revision; a purchase of an earlier revision still names its own terms. world: every earlier revision row is unchanged."),
    keep("service.revise", 2, "trace: one service_transitioned `revise` per revision, with the revisions in order."),
    keep("service.revise", 3, "trace: another person's revise sends no service_transitioned. world: unchanged."),
    rewrite(
      "service.revise",
      4,
      "A revise carries exactly the expected revision given, and a revision conflict is refused once, never retried.",
      "trace: one `requests.services.revise` call with the given `expected_revision`; after a conflict, no second call. cli: INVALID_INPUT.",
    ),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The service changed since `--expected-revision`, or it is deactivated." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "You are not the owner, or with `--org` your Safe does not wear the Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: PREVIEW_WRITE,
});

export const operation_service_deactivate = defineOperation({
  ...frozenText("service.deactivate"),
  priority: "normal",
  implementedBy: flow_client_account_services_deactivate,
  acceptance: [
    keep("service.deactivate", 1, "read: its checkout link reads null and `service revise` exits INVALID_INPUT. cli: a buyer at its link is refused WRONG_STATE."),
    keep("service.deactivate", 2, "cli: `revision` is the one it had; `active` is false."),
    keep("service.deactivate", 3, "trace: another person's deactivate sends no service_transitioned. world: unchanged."),
  ],
  returns: ServiceView,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "person-with-services", when: "From a script without `--confirm`, or the revision is malformed." },
    { error: error_INVALID_INPUT, given: "person-with-services", when: "The service was revised since `--expected-revision`." },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-services", when: "You are not the owner, or with `--org` your Safe does not wear the Invoicing hat." },
    NOT_SIGNED_IN,
  ],
  budget: PREVIEW_WRITE,
});

export const operation_service_get = defineOperation({
  ...frozenText("service.get"),
  priority: "normal",
  implementedBy: rpc_requests_services_get,
  acceptance: [
    keep("service.get", 1, "read: the owner reads its service; another person's `service get` of the id exits INVALID_INPUT."),
    keep("service.get", 2, "cli: human and `--json` output name the devnet checkout path `/buy/<offerId>`. world: unchanged."),
  ],
  returns: ServiceView,
  refusals: [{ ...NOT_A_MEMBER, given: "org-with-services" }, NOT_SIGNED_IN],
  budget: budget("read"),
});

export const operation_service_list = defineOperation({
  ...frozenText("service.list"),
  priority: "normal",
  implementedBy: rpc_requests_services_list,
  acceptance: [
    keep("service.list", 1, "read: the owner's services in creation order, each at its current revision and active flag."),
    keep("service.list", 2, "read: another person's list, and the person's own list under `--org`, show none of them."),
    keep("service.list", 3, "world: the diff around a list is empty. trace: no service_transitioned."),
  ],
  returns: ServicePage,
  refusals: [{ ...NOT_A_MEMBER, given: "org-with-services" }, NOT_SIGNED_IN],
  budget: budget("read"),
});

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
  budget: PREVIEW_WRITE,
});

// ── org timesheet bill: an operation beyond the 215 (rules.new-operations; requests.bill-time) ─────────

/** The world `org timesheet bill` starts from: projects' org-with-projects (projects.worlds). */
const W_PROJECTS = "org-with-projects";

export const operation_org_timesheet_bill = defineOperation({
  id: "org.timesheet.bill",
  title: "Bill timesheets' unbilled hours as one Invoice",
  about:
    "Issues one Invoice from the Organization for the billable hours its submitted timesheets log and no invoice has " +
    "billed yet, to the projects' customer or the payer `--to` names, with one line per activity and billing rate (the " +
    "hours at the rate), in the token of the timesheets' currency. The same write marks those hours billed, so no " +
    "second invoice, Capxul's or a connected head's, can ask for them; cancelling or declining the Invoice clears the " +
    "marks, and paying it keeps them. It is then a request like any other: `request get`, `request cancel`, and the " +
    "payer's inbox or invoice escrow.",
  area: "payments",
  command: "org timesheet bill",
  priority: "normal",
  implementedBy: flow_client_org_timesheets_bill,
  who: "A member of the Organization whose Safe wears its Invoicing hat.",
  changes:
    "One request (an Invoice) with its document and the logs it bills; each billed log names the request, and each " +
    "timesheet's billed totals and status follow (partly billed, or billed).",
  acceptance: [
    {
      claim:
        "One Invoice asks for the timesheets' unbilled billable hours, one line per activity at its billing rate, and marks those hours billed.",
      observes:
        "cli: from org-with-projects, Dana's `org timesheet bill <Sam's submitted Website timesheet> --org acme --json` prints " +
        "an issued Invoice to Olga (Website's customer) with one Execution line of 2 hours at 90, 180.00 in all, in the " +
        "token of Acme's currency; read: " +
        "`org timesheet get <it>` prints status billed with totalBilledHours 2, and `request get <the request> --org acme` " +
        "names the same amount; trace: one request_transitioned (issue).",
    },
    {
      claim: "Hours are billed once: billing the same timesheet again finds nothing left to bill.",
      observes:
        "cli: from org-with-projects, `org timesheet bill <Dana's timesheet for Sam, already billed> --org acme` exits " +
        "WRONG_STATE naming nothing left to bill; world: no request is added.",
    },
    {
      claim: "Cancelling the Invoice clears the marks, so the hours can be billed again.",
      observes:
        "cli: from org-with-projects, after the claim-1 Invoice, `request cancel <it> --org acme --confirm` then " +
        "`org timesheet get <the timesheet>` prints status submitted and totalBilledHours 0, and a second `org timesheet " +
        "bill` of it issues a new Invoice for the same 2 hours.",
    },
    {
      claim: "Asking twice under one request key issues one Invoice.",
      observes:
        "cli: from org-with-projects, `org timesheet bill <ts> --request-key k1 --org acme --json` run twice prints the same " +
        "request id; world: one request.",
    },
  ],
  returns: rpc_requests_issuing_bill_time.output,
  errors: [error_CLI_USAGE],
  refusals: [
    NOT_SIGNED_IN,
    { error: error_CLI_USAGE, given: W_PROJECTS, when: "No timesheet is named, or an id is not a timesheet's (`ts_…`): nothing is sent." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_PROJECTS,
      when: "Your Safe does not wear the Organization's Invoicing hat (Sam), or `--org` names an Organization you hold no Seat in: nothing is written.",
    },
    {
      error: error_INVALID_INPUT,
      given: W_PROJECTS,
      when:
        "A timesheet is not the Organization's, a log belongs to another customer than the payer, the projects name no " +
        "customer Party and `--to` is not given, or the timesheets' currency has no admitted token: nothing is written.",
    },
    {
      error: error_WRONG_STATE,
      given: W_PROJECTS,
      when: "A timesheet is a draft or cancelled, or nothing billable is left unbilled on it: nothing is written.",
    },
  ],
  budget: budget("write"),
});
