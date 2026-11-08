// The eight frozen operations payments owns (OPERATION_OWNERS): `payment send`, `retry`, `cancel`,
// `reschedule`, `get`, `list`, `wait`, and `org department pay` (a budget spend is a Payment). The text comes
// from the frozen book through frozenText, never retyped; where the frozen record has a designed (v4) block,
// its `who` and its refusal codes are the specification (P10 rung 1, decision payments.designed-surface).
//
// Acceptance lines keep the frozen claim word for word, except: the "On Protocol v4" openings are stripped
// (P9), and eight lines that name a mechanism a black box cannot see are rewritten as outcomes, with the old
// line and its test citation in `was` (P1, decision payments.acceptance-rewrites).
//
// Worlds (named devnet snapshots, decision payments.worlds): signed-out, person-with-funded-safe,
// person-with-empty-safe, person-without-account, person-with-payment-history, org-with-budgets,
// org-with-dated-payments.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_SUPERSEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_org_departments_pay,
  flow_client_org_fde_pay,
  flow_client_org_seats_buy,
  flow_client_payments_cancel,
  flow_client_payments_pay,
  flow_client_payments_reschedule,
  flow_client_payments_retry,
  flow_client_payments_subscribe,
} from "./flows.ts";
import { rpc_payments_ledger_get, rpc_payments_ledger_list } from "./ledger.ts";
import { Outcome, PaymentStatus, Route } from "./data.ts";

const S = Schema.String;
const Null = Schema.NullOr;
const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;

// ── worlds ──────────────────────────────────────────────────────────────────────────────────

/** The worlds payments' refusals are reached from; each is described in decision payments.worlds. */
export const WORLDS = {
  signedOut: "signed-out",
  funded: "person-with-funded-safe",
  empty: "person-with-empty-safe",
  noAccount: "person-without-account",
  history: "person-with-payment-history",
  budgets: "org-with-budgets",
  dated: "org-with-dated-payments",
} as const;
const W = WORLDS;

// ── acceptance helpers ──────────────────────────────────────────────────────────────────────

type FrozenLine = { readonly claim: string; readonly was: readonly string[] };
const line = (id: FrozenId, n: number) => (frozen[id].acceptance as readonly FrozenLine[])[n - 1]!;

/** Line n (from 1), its claim word for word, its test citation in `was`. */
const kept = (id: FrozenId, n: number, observes: string) => {
  const a = line(id, n);
  return { claim: a.claim, observes, was: [...a.was] };
};

/** Line n with its "On Protocol v4" opening stripped (P9); the old line stays in `was`. */
const v4 = (id: FrozenId, n: number, observes: string) => {
  const a = line(id, n);
  const rest = a.claim.replace(/^On (Protocol v4|v4|a v4) /, "");
  if (rest === a.claim) throw new Error(`${id} #${n} has no v4 opening`);
  return { claim: rest.charAt(0).toUpperCase() + rest.slice(1), observes, was: [a.claim, ...a.was] };
};

/** Line n rewritten as an outcome a black box can check (P1); the old claim and its citation move to `was`. */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = line(id, n);
  return { claim, observes, was: [a.claim, ...a.was] };
};

/** The designed (v4) block's `who`, which P10 makes the specification where it exists. */
const designedWho = (id: FrozenId) => (frozen[id] as { designed: { who: string } | null }).designed?.who ?? frozenText(id).who;

// ── what the CLI prints with --json ─────────────────────────────────────────────────────────

const PaymentJson = Schema.Struct({
  id: S,
  status: PaymentStatus,
  route: Route,
  amount: Schema.Struct({ asset: S, value: S }),
  direction: Schema.Literals(["out", "in"]),
  counterparty: S,
  paymentId: S,
  payAt: Null(S),
  receipt: Null(Schema.Struct({ chainId: Schema.Int, txHash: S })),
  execution: Schema.Struct({ approvalId: Null(S), proposalId: Null(S), outcome: Null(Outcome), needsRetry: Schema.Boolean }),
  documents: Schema.Array(Schema.Struct({ documentId: S, documentHash: S, render: S })),
  timing: Schema.Struct({ createdAt: S, sentAt: Null(S), settledAt: Null(S) }),
});

const HandoverJson = Schema.Struct({
  status: Schema.Literal("awaiting_approval"),
  approvalId: S,
  approvalUrl: S,
  paymentIds: Schema.Array(S),
  expiresAt: S,
  next: S,
});

const EndedJson = Schema.Struct({
  approval: Schema.Struct({ id: S, state: S, refusal: Null(Schema.Struct({ code: S, reason: S })) }),
  payments: Schema.Array(PaymentJson),
});

/** send, retry, cancel, reschedule: the hand-over with `--json`, or, followed to the end, the approval and its Payments. */
const MoneyJson = Schema.Union([HandoverJson, EndedJson]);

// ── payment send ────────────────────────────────────────────────────────────────────────────

export const operation_payment_send = defineOperation({
  ...frozenText("payment.send"),
  who: designedWho("payment.send"),
  priority: "critical",
  implementedBy: flow_client_payments_pay,
  acceptance: [
    kept("payment.send", 1, "chain: one UserOperation and one PaymentSent carry the payment id; read: `payment list` shows exactly one Payment for it, settled"),
    kept("payment.send", 2, "cli: the second signing answers the same UserOperation hash; chain: one UserOperationEvent, one PaymentSent"),
    kept("payment.send", 3, "cli: each is refused with its code; chain: no UserOperation from the Safe; read: the Payment still reads prepared"),
    kept("payment.send", 4, "cli: with one allowance it is used unasked; with several the CLI asks which and `--from` names one"),
    kept("payment.send", 5, "cli: the refusal names `capxul payment wait` with the approval id"),
    kept("payment.send", 6, "cli: INVALID_RECIPIENT names the typed address or recipient; world: nothing written"),
    v4("payment.send", 7, "chain: the operation's calldata is one `Budgets.spend` on the allowance's own budget id; cli and world: another budget, a pending allowance or a failed read is refused with nothing sent"),
    v4("payment.send", 8, "chain: the proposal's calldata is one `Budgets.schedule` of the asked amount to the asked address on the v4 Budgets; cli: another is refused before any approval"),
    rewritten(
      "payment.send",
      9,
      "Once its Board proposal executes, each item reads `scheduled` with the scheduled id of its own `Budgets.schedule`, never one on another budget, and it still does when a chain read fails once on the way.",
      "read: `payment get` shows each item scheduled with its id; chain: PaymentScheduled logs with the items' job nonces; world: the node's fault switch fails one read",
    ),
  ],
  returns: MoneyJson,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: W.funded,
      when: "`--as-directors` without `--org`, an asset you do not hold, or both `<to> <amount>` and `--input`, or both `--on` and `--at`.",
    },
    {
      error: error_INVALID_RECIPIENT,
      given: W.funded,
      when:
        "The address is mistyped, or the recipient is nothing at all. The refusal names it. Also a mailbox with no " +
        "account yet whose Safe could never be claimed (not ASCII), so no claim escrow can wait for it " +
        "(payments.claim-escrow-routes).",
    },
    {
      error: error_INVALID_INPUT,
      given: W.funded,
      when:
        "The signature does not recover the account's signer, or the execution is unknown; or `--on` or `--at` is not in " +
        "the future, `--account` names no code of the payer's chart (an Organization's open ledger accounts, a person's " +
        "fixed personal chart), or `--suggest` comes without `--account` 4999 or 6999.",
    },
    { error: error_INSUFFICIENT_BALANCE, given: W.empty, when: "Your Safe, or the company Safe, holds less than the amount." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.budgets,
      when: "With `--org`, you wear no hat on this budget or above it (no spending allowance for the asset); with `--as-directors`, you are not a Director.",
    },
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: W.budgets, when: "More than the budget has left this period, or over the token's Roles payout ceiling." },
    { error: error_WRONG_STATE, given: W.budgets, when: "The budget or one above it is closed." },
    { error: error_SUPERSEDED, given: W.funded, when: "The sponsorship expired or the claim could not be observed, so the payment must be retried." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("chain-submit"),
  was: [page("payment.send"), "docs/as-is/archive/payments/operations.ts"],
});

// ── payment retry ───────────────────────────────────────────────────────────────────────────

export const operation_payment_retry = defineOperation({
  ...frozenText("payment.retry"),
  who: designedWho("payment.retry"),
  priority: "normal",
  implementedBy: flow_client_payments_retry,
  acceptance: [
    rewritten(
      "payment.retry",
      1,
      "A personal payment whose approval lapsed is retried and lands while another payment from the same Safe is still waiting for its signature.",
      "chain: the retry's UserOperation lands with the same payment id while the other approval is unsigned; read: the lapsed payment reads settled",
    ),
    kept("payment.retry", 2, "cli: ROLE_PERMISSION_DENIED for a payment the Organization received; world: nothing written"),
    kept("payment.retry", 3, "cli: a member who lost the budget's hat is refused ROLE_PERMISSION_DENIED as the first send was"),
    kept("payment.retry", 4, "cli: the original payment's terms are shown; world: nothing changes before the signature"),
    kept("payment.retry", 5, "cli: `--json` answers the approval link; trace: a malformed id makes no rpc"),
  ],
  returns: MoneyJson,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: W.history, when: "The payment ID is malformed." },
    {
      error: error_WRONG_STATE,
      given: W.history,
      when: "The payment's execution was not dropped, replaced, expired or superseded; or it already paid, so its id is consumed.",
    },
    { error: error_ROLE_PERMISSION_DENIED, given: W.dated, when: "You cannot act for that payment, or no longer hold its budget authority." },
    { error: error_INSUFFICIENT_BALANCE, given: W.empty, when: "The paying Safe holds less than the amount." },
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: W.dated, when: "The budget has less left now than the payment needs." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("chain-submit"),
  was: [page("payment.retry")],
});

// ── payment cancel ──────────────────────────────────────────────────────────────────────────

export const operation_payment_cancel = defineOperation({
  ...frozenText("payment.cancel"),
  // The designed who gave a claim escrow to its owner or the Board; under aaron.departments a budget's is its department's
  // (decision payments.department-authority).
  who:
    "The payer. For a budget's dated payment or claim escrow, whoever wears the budget's hat or one above it now, or the " +
    "Board. For a payment the Board made, the Board.",
  priority: "normal",
  implementedBy: flow_client_payments_cancel,
  acceptance: [
    kept("payment.cancel", 1, "cli: WRONG_STATE for the settled and the cancelled payment; world: no approval or proposal opened"),
    rewritten(
      "payment.cancel",
      2,
      "The Board cancels only a dated payment it scheduled for its own Organization, and once its proposal executes the payment reads `cancelled`, its reservation is freed and it changes state once.",
      "chain: one ScheduleCancelled per item and the budget's left rises by the amount; read: `payment get` reads cancelled; trace: one payment_transitioned to cancelled per item",
    ),
    kept("payment.cancel", 3, "read: the payment still reads scheduled after the void's approval expires or is declined"),
    kept("payment.cancel", 4, "cli: ROLE_PERMISSION_DENIED for a member who is not a Director cancelling the Board-scheduled payment (a department's is its hat wearers', payments.department-authority); chain: each Director's approval is their own approveHash"),
    kept("payment.cancel", 5, "cli: `--json` answers the void's approval link and `capxul payment wait`"),
    kept("payment.cancel", 6, "read: the Organization's payment reads cancelled; trace: a malformed id makes no rpc"),
  ],
  returns: MoneyJson,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: W.history, when: "The payment ID is malformed." },
    {
      error: error_WRONG_STATE,
      given: W.history,
      when: "The payment is no longer held, is already cancelled or paid, the payee already collected the escrow, the approval expired, or after the void it does not read `cancelled`.",
    },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.dated,
      when:
        "You wear no hat on the payment's budget or above it now (for a budget's claim escrow too, whoever sent it), you are not the sender of a personal claim escrow, or for a payment the Board made you are not a Director.",
    },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("chain-submit"),
  was: [page("payment.cancel")],
});

// ── payment reschedule ──────────────────────────────────────────────────────────────────────

export const operation_payment_reschedule = defineOperation({
  ...frozenText("payment.reschedule"),
  who: designedWho("payment.reschedule"),
  priority: "normal",
  implementedBy: flow_client_payments_reschedule,
  acceptance: [
    kept("payment.reschedule", 1, "cli: WRONG_STATE naming the status the payment reads"),
    kept("payment.reschedule", 2, "cli: one approval for the budget's move; world: a refused reschedule leaves every payment as it was"),
    kept("payment.reschedule", 3, "chain: the operation's calldata is `Budgets.cancel` then `Budgets.schedule`; read: the old payment reads cancelled, the new one scheduled on its day"),
    rewritten(
      "payment.reschedule",
      4,
      "Only a reschedule or a cancel of that dated payment may cancel it in Budgets: an operation that cancels any other scheduled id is closed unsent.",
      "chain: no operation carries `Budgets.cancel` of another scheduled id; cli: such a route is refused before anyone signs",
    ),
  ],
  returns: MoneyJson,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: W.history, when: "`--on` is a date the payment cannot be sent on. The payment stays as it was." },
    {
      error: error_WRONG_STATE,
      given: W.history,
      when: "An approval expired, the void did not cancel the payment, the payment already paid, or the budget was closed since.",
    },
    { error: error_ROLE_PERMISSION_DENIED, given: W.dated, when: "You cannot act for that payment: you wear no hat on its budget or above it." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("chain-submit"),
  was: [page("payment.reschedule")],
});

// ── payment get ─────────────────────────────────────────────────────────────────────────────

export const operation_payment_get = defineOperation({
  ...frozenText("payment.get"),
  priority: "normal",
  implementedBy: rpc_payments_ledger_get,
  acceptance: [
    kept("payment.get", 1, "cli: CLI_USAGE; trace: no rpc span and no session read"),
    kept("payment.get", 2, "cli: INVALID_INPUT, never a null payment"),
    rewritten(
      "payment.get",
      3,
      "A read, a null read and a refusal change nothing: the world is the same before and after, and no product event is sent.",
      "world: no difference before and after; trace: no payment_transitioned",
    ),
    kept("payment.get", 4, "cli: each document line names `capxul document render`; world: no file saved"),
  ],
  returns: PaymentJson,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: W.history, when: "The ID does not start with `payment_`." },
    { error: error_INVALID_INPUT, given: W.noAccount, when: "You are signed in but have no Account, or the payment is not one you can read." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("read"),
  was: [page("payment.get")],
});

// ── payment list ────────────────────────────────────────────────────────────────────────────

export const operation_payment_list = defineOperation({
  ...frozenText("payment.list"),
  priority: "normal",
  implementedBy: rpc_payments_ledger_list,
  acceptance: [
    kept("payment.list", 1, "read: the list holds the payments the person sent and those they received"),
    rewritten(
      "payment.list",
      2,
      "A read changes nothing: the world is the same before and after, and no product event is sent.",
      "world: no difference before and after; trace: no payment_transitioned",
    ),
    kept("payment.list", 3, "cli: only scheduled payments, ordered by their day"),
    kept("payment.list", 4, "cli: one page and the `--after` command; an unknown cursor is refused"),
  ],
  returns: Schema.Struct({ items: Schema.Array(PaymentJson), nextCursor: Null(S) }),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: W.noAccount, when: "`--after` is a cursor this list did not give, or you have no Account yet." },
    { error: error_ROLE_PERMISSION_DENIED, given: W.budgets, when: "`--org` names an Organization you are not a member of." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("read"),
  was: [page("payment.list")],
});

// ── payment wait ────────────────────────────────────────────────────────────────────────────

export const operation_payment_wait = defineOperation({
  ...frozenText("payment.wait"),
  priority: "normal",
  implementedBy: flow_client_payments_subscribe,
  acceptance: [
    rewritten(
      "payment.wait",
      1,
      "It waits through pending, stops once the payment reads settled, and leaves no live read open behind it.",
      "cli: each state is printed and it exits on settled; trace: one live rpc span, closed when it stops",
    ),
    kept("payment.wait", 2, "cli: still following after three minutes on a payment held that long"),
    kept("payment.wait", 3, "cli: CLI_DEADLINE with the last state; trace: the timer starts after the session read"),
    kept("payment.wait", 4, "cli: INVALID_INPUT when the first frame finds nothing to read"),
  ],
  returns: Schema.Union([PaymentJson, EndedJson]),
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: [
    { error: error_CLI_USAGE, given: W.history, when: "The payment or approval ID is malformed." },
    { error: error_INVALID_INPUT, given: W.history, when: "The payment is not one you can read." },
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
  ],
  budget: budget("live-read"),
  was: [page("payment.wait")],
});

// ── org department pay ──────────────────────────────────────────────────────────────────────

export const operation_org_department_pay = defineOperation({
  ...frozenText("org.department.pay"),
  who: designedWho("org.department.pay"),
  priority: "normal",
  implementedBy: flow_client_org_departments_pay,
  acceptance: [
    rewritten(
      "org.department.pay",
      1,
      "A holder's payment from a v4 department is one `Budgets.spend` of its top budget from their own Safe, carrying the job nonce its payment id was shown with, and a holder who lost the department's hat before the send is refused unsent.",
      "chain: the calldata is one `Budgets.spend` on the top budget id with that job nonce, and PaymentSent carries the shown id; cli: ROLE_PERMISSION_DENIED once the hat is gone",
    ),
    kept("org.department.pay", 2, "cli: ROLE_PERMISSION_DENIED `not_holder`; world: nothing written"),
    kept("org.department.pay", 3, "cli: WRONG_STATE for the proposed department"),
    kept("org.department.pay", 4, "cli: PAYROLL_BUDGET_EXCEEDED `budget_exhausted`; world: nothing written and no approval opened"),
    kept("org.department.pay", 5, "cli: refused before signing; chain: nothing sent"),
  ],
  returns: Schema.Struct({ approvalId: S, paymentIds: Schema.Array(S) }),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W.budgets, when: "You do not hold the department (`not_holder`): you are not its budget's office holder or above." },
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: W.budgets, when: "More than the budget has left this period (`budget_exhausted`), or over the Roles payout ceiling." },
    { error: error_WRONG_STATE, given: W.budgets, when: "The department is not active on v4, its budget id is not known yet, or it or a budget above it is closed." },
    { error: error_INVALID_INPUT, given: W.budgets, when: "The department is unknown, or the amount is not in its budget's token." },
  ],
  budget: budget("chain-submit"),
  was: [page("org.department.pay")],
});

// ── org seats buy: an operation beyond the 215 (rules.new-operations; aaron.buy-seats) ───────────────
//
// The pack organizations.buy-seats' payments command (docs/design/new-commands.md section 5.5): payments books it
// because its flow births a payment command, and organizations sits below payments (payments.seat-purchase).

/** The worlds `org seats buy` starts from (payments.seat-worlds). */
export const SEAT_WORLDS = {
  /** Dana wears the People hat and the allowance `capxul` (500 USDC a month under `running-costs`); Acme funded. */
  buyer: "org-with-fde-allowance",
  /** org-with-fde-allowance with the deployment's SEAT_PRICE and FDE_HOSTING_PRICE unset. */
  unpriced: "org-with-prices-unset",
  /** org-with-fde-allowance with `running-costs`, the budget above `capxul`, closed. */
  closed: "org-with-closed-running-costs",
  /** org-with-fde-allowance after a Board payment left the company Safe 5 USDC. */
  shortSafe: "org-with-short-company-safe",
  /** @ledger, Dana's agent, holding a Seat in Acme. */
  agent: "org-with-agent-member",
} as const;
const SW = SEAT_WORLDS;

/** The purchase `--json` adds to a money command's hand-over: what is bought, at what price, in all. */
const PurchaseJson = Schema.Struct({
  seats: Schema.Int,
  unitPrice: Schema.Struct({ amount: S, asset: S }),
  total: Schema.Struct({ amount: S, asset: S }),
});

export const operation_org_seats_buy = defineOperation({
  id: "org.seats.buy",
  title: "Buy more seats for the Organization from a budget",
  about:
    "Buys `<n>` more seats for the Organization, paid once at the deployment's SEAT_PRICE (10 USDC a seat on the test " +
    "USDC) from the budget `--from` names to Capxul, as one payment with one approval the buyer signs from their own " +
    "Safe. The seat limit rises by the seats when the payment settles, never before, and a bought seat is kept for " +
    "good. The buyer wears the People hat, the hat that invites and so meets the limit, and Budgets must admit their " +
    "Safe on the budget now: a department's money is acted on by whoever wears its hat, or one above it, at that moment. Since a " +
    "People-hat wearer holds no department or team office, that budget is usually an allowance whose hat they wear " +
    "(organizations.founder-people-hat). `org seats show` gives the limit and the price before buying.",
  area: "payments",
  command: "org seats buy",
  priority: "normal",
  implementedBy: flow_client_org_seats_buy,
  who:
    "A person with a Seat in the Organization whose own Safe wears its People hat and whom Budgets.authorised admits " +
    "on the `--from` budget now: a wearer of that budget's hat or of a budget above it, as the chain reads it at the " +
    "call, so whoever is swapped out of the hat can no longer buy from it. Never an agent, and never the Board: a Board " +
    "payment is the company Safe's own batch, which cannot spend from a budget at once (payments.commands.propose). A " +
    "lapsed purchase's `payment retry` needs the same.",
  changes:
    "One payment command (purpose seats), its one Payment to Capxul's receiving Safe, the purchase's Invoice and one " +
    "approval. Once the Payment settles, the Organization's seat limit rises by the seats and a counted seat purchase " +
    "is recorded; a reorg below finality takes them back until the Payment settles again.",
  acceptance: [
    {
      claim:
        "One approval pays the seats times SEAT_PRICE from the named budget to Capxul, and the seat limit rises by them when the payment settles.",
      observes:
        "cli: from org-with-fde-allowance, Dana's `org seats buy 2 --from capxul --org acme` previews 2 seats at 10 USDC, 20 USDC from " +
        "`capxul` with 500 left, signs one approval and ends with its Payment settled; read: `org seats show --org acme --json` then " +
        "prints seatLimit 12 and seatsBought 2; chain: one UserOperation from Dana's Safe whose one call is `Budgets.spend` on " +
        "`capxul`'s budget id of 20 USDC to CAPXUL_RECEIVING_SAFE, and one PaymentSent with the shown payment id.",
    },
    {
      claim: "Nothing is counted before the payment settles: a purchase left unsigned, or declined, leaves the seat limit as it was.",
      observes:
        "cli: from org-with-fde-allowance, `org seats buy 1 --from capxul --org acme --no-wait --json` prints `awaiting_approval` " +
        "with an approvalId; read: `org seats show` still prints seatLimit 10; after Dana declines that approval on the approval " +
        "page, `payment get <its payment> --org acme` reads cancelled and seatLimit is still 10; chain: no Budgets.spend from `capxul`.",
    },
    {
      claim: "Asking twice under one request key buys once.",
      observes:
        "cli: from org-with-fde-allowance, Dana's `org seats buy 2 --from capxul --org acme --request-key k1 --no-wait --json` run twice prints " +
        "the same approvalId and paymentIds; read: once Dana signs it and it settles, `org seats show` prints seatLimit 12, not 14; " +
        "world: one payment command.",
    },
    {
      claim:
        "Only a person wearing the People hat whom Budgets admits on the budget now may buy: lacking either, or being an agent, buys nothing.",
      observes:
        "cli: from org-with-budgets, Pat's `org seats buy 1 --from office-costs --org acme` (People hat, no hat on or above " +
        "`office-costs`) and Mia's (wears `office-costs`, no People hat) each exit ROLE_PERMISSION_DENIED; from org-with-agent-member, " +
        "@ledger's `org seats buy 1 --from capxul --org acme` exits ROLE_PERMISSION_DENIED before `--from` is looked up; world: " +
        "no payment command and no approval.",
    },
    {
      claim: "A purchase whose approval lapsed is retried under the same payment id and still buys once.",
      observes:
        "cli: from org-with-fde-allowance, after `org seats buy 1 --from capxul --org acme --no-wait` lapses unsigned (`capxul dev " +
        "time warp 2h`), `payment retry <its payment> --org acme` signs a new approval for the same payment id; read: once it " +
        "settles, seatLimit 11 and seatsBought 1; chain: one PaymentSent with that payment id.",
    },
  ],
  returns: Schema.Union([Schema.Struct({ ...HandoverJson.fields, purchase: PurchaseJson }), EndedJson]),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
    {
      error: error_CLI_USAGE,
      given: SW.buyer,
      when: "`<n>` or `--from` is missing, or `<n>` is not a whole number: nothing is sent.",
    },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.budgets,
      when:
        "`--org` names an Organization you hold no Seat in (Olga), your Safe does not wear the People hat (Mia), Budgets does not " +
        "authorise your Safe on the `--from` budget now because you wear neither its hat nor one above it (Pat), or you are an agent, " +
        "which never buys seats: nothing is written.",
    },
    {
      error: error_INVALID_INPUT,
      given: SW.buyer,
      when: "`<n>` is under 1 or over 1,000, or `--from` names no budget of the Organization: nothing is written.",
    },
    {
      error: error_FEATURE_NOT_AVAILABLE,
      given: SW.unpriced,
      when:
        "The deployment sets no SEAT_PRICE or no CAPXUL_RECEIVING_SAFE, or prices seats in a token other than the budget's: nothing " +
        "can be bought, and nothing is written.",
    },
    {
      error: error_WRONG_STATE,
      given: SW.closed,
      when:
        "The budget is not on chain yet (a department or allowance still proposed), or it or a budget above it is closed " +
        "(`running-costs` above `capxul`), as `org department pay` refuses: nothing is prepared.",
    },
    {
      error: error_PAYROLL_BUDGET_EXCEEDED,
      given: SW.buyer,
      when:
        "`org seats buy 51 --from capxul` costs 510 USDC, more than the 500 `capxul` has left this month, or the total is over the " +
        "token's payout ceiling: nothing is prepared or signed.",
    },
    {
      error: error_INSUFFICIENT_BALANCE,
      given: SW.shortSafe,
      when: "The company Safe holds 5 USDC, less than the 10 one seat costs, though `capxul` has room: nothing is prepared or signed.",
    },
    {
      error: error_SUPERSEDED,
      given: SW.buyer,
      when: "The approval expired or was displaced before it landed: nothing was bought, and the refusal names `payment retry` and `payment wait`.",
    },
  ],
  budget: budget("chain-submit"),
  was: ["docs/design/new-commands.md (section 5.5)", "books/target/shared/rulings.ts (aaron.buy-seats, aaron.test-prices)"],
});

// ── org fde pay: an operation beyond the 215 (rules.new-operations; aaron.fde-hosted) ─────────────────
//
// The pack organizations.buy-seats' second payments command (docs/design/new-commands.md section 5.5): the hosted
// FDE's months, paid in advance from a budget (organizations.fde-hosting, payments.fde-hosting-purchase).

/** The worlds `org fde pay` starts from (payments.fde-hosting-purchase). */
export const FDE_PAY_WORLDS = {
  /** Dana wears the People hat and the allowance `capxul`; Acme's FDE runs in its start-up month. */
  payer: SEAT_WORLDS.buyer,
  /** org-with-fde-allowance 32 days on: the start-up month ran out unpaid and the FDE is paused. */
  paused: "org-with-fde-allowance-paused",
  /** org-with-fde-allowance with FDE_HOSTING_PRICE (and SEAT_PRICE) unset. */
  unpriced: SEAT_WORLDS.unpriced,
  /** org-with-fde-allowance with `running-costs`, the budget above `capxul`, closed. */
  closed: SEAT_WORLDS.closed,
  /** org-with-fde-allowance after a Board payment left the company Safe 5 USDC. */
  shortSafe: SEAT_WORLDS.shortSafe,
} as const;
const FW = FDE_PAY_WORLDS;

/** What `--json` adds to the hand-over of a hosting payment: the months, at what price, in all, and the paid-through before. */
const HostingJson = Schema.Struct({
  months: Schema.Int,
  unitPrice: Schema.Struct({ amount: S, asset: S }),
  total: Schema.Struct({ amount: S, asset: S }),
  paidThrough: Null(S),
});

export const operation_org_fde_pay = defineOperation({
  id: "org.fde.pay",
  title: "Pay months of the hosted FDE's hosting from a budget",
  about:
    "Pays `[<months>]` calendar months (1 when not given, at most 12) of the Organization's hosted Forward Deployed " +
    "Engineer, in advance, at the deployment's FDE_HOSTING_PRICE (20 USDC a month on the test USDC), from the budget " +
    "`--from` names to Capxul, as one payment with one approval the payer signs from their own Safe. The FDE's " +
    "paid-through instant moves on by the months when the payment settles, never before: from the later of the old " +
    "paid-through instant and the settlement, so a paused FDE is never charged for the time it was paused, and paying " +
    "wakes it. Budgets must admit the payer's Safe on the budget now: whoever wears its hat, or one above it, at that " +
    "moment. `org fde show` gives the paid-through instant and the price before paying.",
  area: "payments",
  command: "org fde pay",
  priority: "normal",
  implementedBy: flow_client_org_fde_pay,
  who:
    "A person with a Seat in the Organization whom Budgets.authorised admits on the `--from` budget now: a wearer of " +
    "that budget's hat or of a budget above it, as the chain reads it at the call, so whoever is swapped out of the hat " +
    "can no longer pay from it. Never an agent, so the FDE never pays for its own hosting, and never the Board, whose " +
    "payment is its own batch and cannot spend from a budget at once (payments.commands.propose).",
  changes:
    "One payment command (purpose fde_hosting), its one Payment to Capxul's receiving Safe, the payment's Invoice and " +
    "one approval. Once the Payment settles, the hosting payment is counted and the FDE's paid-through instant moves on " +
    "by the months (a paused FDE is woken and resumed); a reorg below finality takes exactly those months back until " +
    "the Payment settles again.",
  acceptance: [
    {
      claim:
        "One approval pays the months times FDE_HOSTING_PRICE from the named budget to Capxul, and the FDE's paid-through instant moves on by them when the payment settles.",
      observes:
        "cli: from org-with-fde-allowance, Dana's `org fde pay 2 --from capxul --org acme` previews 2 months at 20 USDC, 40 USDC " +
        "from `capxul` with 500 left, signs one approval and ends with its Payment settled; read: `org fde show --org acme --json` " +
        "then prints monthsPaid 2 and paidThrough two calendar months after the start-up month's end; chain: one UserOperation " +
        "from Dana's Safe whose one call is `Budgets.spend` on `capxul`'s budget id of 40 USDC to CAPXUL_RECEIVING_SAFE, and one " +
        "PaymentSent with the shown payment id.",
    },
    {
      claim: "Paying for a paused FDE wakes it, and the months run from the payment, so the pause is not charged.",
      observes:
        "cli: from org-with-fde-allowance-paused, Dana's `org fde pay --from capxul --org acme` settles; read: `org fde show " +
        "--org acme --json` prints status `resuming` or `running`, then `running`, with paidThrough one calendar month after " +
        "the settlement's time, not after the lapsed paid-through instant; `org fde ask` then reaches the FDE.",
    },
    {
      claim: "Nothing is counted before the payment settles: a hosting payment left unsigned, or declined, leaves the paid-through instant as it was.",
      observes:
        "cli: from org-with-fde-allowance, `org fde pay 1 --from capxul --org acme --no-wait --json` prints `awaiting_approval` " +
        "with an approvalId and the hosting's paidThrough; read: `org fde show` prints the same paidThrough and monthsPaid 0; " +
        "after Dana declines that approval on the approval page, `payment get <its payment> --org acme` reads cancelled and " +
        "paidThrough is unchanged; chain: no Budgets.spend from `capxul`.",
    },
    {
      claim:
        "Who may pay follows the budget's hat now: someone taken out of it cannot pay from it, and the FDE never pays for itself.",
      observes:
        "cli: from org-with-fde-allowance, after the Board revokes Dana's `capxul` (`org allowance revoke capxul --member " +
        "dana@acme.test --org acme`, approved by Dana as the one Director), Dana's `org fde pay --from capxul --org acme` exits " +
        "ROLE_PERMISSION_DENIED; the FDE's own `org fde pay --from capxul --org acme`, run through the stand-in host " +
        "(`capxul-devnet fde run acme --`), exits ROLE_PERMISSION_DENIED before `--from` is looked up; world: no payment " +
        "command and no approval.",
    },
  ],
  returns: Schema.Union([Schema.Struct({ ...HandoverJson.fields, hosting: HostingJson }), EndedJson]),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
    {
      error: error_CLI_USAGE,
      given: FW.payer,
      when: "`--from` is missing, or `<months>` is not a whole number: nothing is sent.",
    },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.budgets,
      when:
        "`--org` names an Organization you hold no Seat in (Olga naming Acme), Budgets does not authorise your Safe on the " +
        "`--from` budget now, or you are an agent, which never pays for hosting: nothing is written.",
    },
    {
      error: error_INVALID_INPUT,
      given: FW.payer,
      when: "`<months>` is under 1 or over 12, or `--from` names no budget of the Organization: nothing is written.",
    },
    {
      error: error_FEATURE_NOT_AVAILABLE,
      given: FW.unpriced,
      when:
        "The deployment sets no FDE_HOSTING_PRICE or no CAPXUL_RECEIVING_SAFE, or prices hosting in a token other than the " +
        "budget's: hosting is not charged, and nothing is written.",
    },
    {
      error: error_WRONG_STATE,
      given: FW.closed,
      when:
        "The Organization has no hosted FDE, or its hosting is retired (removed, or its key moved off the host), the budget " +
        "is not on chain yet, or it or a budget above it is closed (`running-costs` above `capxul`): nothing is prepared.",
    },
    {
      error: error_PAYROLL_BUDGET_EXCEEDED,
      given: FW.payer,
      when:
        "The months cost more than the budget has left this month, or the total is over the token's payout ceiling: " +
        "nothing is prepared or signed.",
    },
    {
      error: error_INSUFFICIENT_BALANCE,
      given: FW.shortSafe,
      when: "The company Safe holds 5 USDC, less than the 20 one month costs, though `capxul` has room: nothing is prepared or signed.",
    },
    {
      error: error_SUPERSEDED,
      given: FW.payer,
      when: "The approval expired or was displaced before it landed: nothing was paid, and the refusal names `payment retry` and `payment wait`.",
    },
  ],
  budget: budget("chain-submit"),
  was: ["docs/design/new-commands.md (section 5.5)", "books/target/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices)"],
});
