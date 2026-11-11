// The examples of payments' operations: one story, Northwind (Marcus, from the Finance budget) paying Brightside Cleaning.
// Not a record and not a module in index.ts: operations.ts imports the lists. Ids 600 to 699 are payments'.

import {
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_SUPERSEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { ADDRESS, CHAIN_ID, ID, hash, ok, refused, uuid } from "../shared/examples.ts";

const PAY = `payment_${ID.paymentToBrightside}`;
const APPROVAL = `approval_${ID.approval}`;
const NEXT_WAIT = `capxul payment wait ${APPROVAL}`;
const DOC = { documentId: uuid(601), documentHash: hash("a1"), content: hash("b2") };

/** The invoice document every Brightside payment carries. */
const document = {
  documentId: DOC.documentId,
  documentHash: DOC.documentHash,
  render: `capxul document render --document-hash ${DOC.documentHash} --content-hash ${DOC.content}`,
};

/** A Payment as `payment get` prints it: Marcus's payment of Brightside's January invoice, settled by default. */
export const brightsidePayment = (over: Record<string, unknown> = {}) => ({
  id: PAY,
  status: "settled",
  route: "budget",
  amount: { asset: "USDC", value: "1250.00" },
  direction: "out",
  counterparty: "Brightside Cleaning",
  paymentId: hash("31"),
  payAt: null,
  receipt: { chainId: CHAIN_ID, txHash: hash("c1") },
  execution: { approvalId: APPROVAL, proposalId: null, outcome: null, needsRetry: false },
  documents: [document],
  timing: { createdAt: "2026-02-10T09:31:00Z", sentAt: "2026-02-10T09:32:10Z", settledAt: "2026-02-10T09:32:24Z" },
  ...over,
});

/** The hand-over `--json` prints at once: the approval to sign and the command that follows it. */
const handover = (extra: Record<string, unknown> = {}) => ({
  status: "awaiting_approval",
  approvalId: APPROVAL,
  approvalUrl: `https://app.capxul.test/approve/${APPROVAL}`,
  paymentIds: [PAY],
  expiresAt: "2026-02-10T10:30:00Z",
  next: `${NEXT_WAIT} --json`,
  ...extra,
});

/** The approval and its payments, followed to the end. */
const ended = (payments: unknown[]) => ({ approval: { id: APPROVAL, state: "executed", refusal: null }, payments });

const SEND = `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance`;

export const examples_payment_send = [
  ok("Marcus pays Brightside's invoice from the Finance budget; the approval link comes back at once", `${SEND} --json`, handover()),
  ok(
    "The same send repeated with its request key reports where the first approval ended",
    `${SEND} --request-key brightside-2026-01 --json`,
    ended([brightsidePayment()]),
  ),
  ok(
    "A dated payment: sent on a day instead of now",
    `${SEND} --on 2026-03-02 --json`,
    handover({ paymentIds: [`payment_${uuid(602)}`] }),
  ),
  refused("The Finance budget holds less than the amount", `${SEND} --json`, error_INSUFFICIENT_BALANCE, { available: "800.00", needed: "1250.00", asset: "USDC" }),
  refused("A recipient that is not an email, a handle or an address", "capxul payment send brightside 1250.00 --json", error_INVALID_RECIPIENT, { recipient: "brightside" }),
  refused("Priya holds no hat on the Finance budget", `${SEND} --json`, error_ROLE_PERMISSION_DENIED),
  refused("More than the Finance budget has left this month", "capxul payment send accounts@brightside.test 9000.00 --org northwind --from finance --json", error_PAYROLL_BUDGET_EXCEEDED),
];

export const examples_payment_retry = [
  ok("Retry a payment whose approval expired", `capxul payment retry ${PAY} --json`, handover({ expiresAt: "2026-02-10T11:30:00Z" })),
  refused("The payment already paid, so its id is consumed", `capxul payment retry ${PAY} --json`, error_WRONG_STATE),
  refused("The paying Safe holds less than the amount", `capxul payment retry ${PAY} --json`, error_INSUFFICIENT_BALANCE, { available: "800.00", needed: "1250.00", asset: "USDC" }),
];

export const examples_payment_cancel = [
  ok("Cancel a scheduled payment before its date: the void's approval comes back", `capxul payment cancel payment_${uuid(602)} --json`, handover({ paymentIds: [`payment_${uuid(602)}`] })),
  ok(
    "Followed to the end the payment reads cancelled",
    `capxul payment cancel payment_${uuid(602)} --timeout-seconds 120 --json`,
    ended([
      brightsidePayment({
        id: `payment_${uuid(602)}`,
        status: "cancelled",
        payAt: "2026-03-02T00:00:00Z",
        receipt: null,
        execution: { approvalId: APPROVAL, proposalId: null, outcome: "voided", needsRetry: false },
        timing: { createdAt: "2026-02-10T09:31:00Z", sentAt: null, settledAt: null },
      }),
    ]),
  ),
  refused("A payment that already settled cannot be cancelled", `capxul payment cancel ${PAY} --json`, error_WRONG_STATE),
  refused("Priya wears no hat on that payment's budget", `capxul payment cancel payment_${uuid(602)} --json`, error_ROLE_PERMISSION_DENIED),
];

export const examples_payment_reschedule = [
  ok("Move a scheduled payment to a later day", `capxul payment reschedule payment_${uuid(602)} --on 2026-03-09 --json`, handover({ paymentIds: [`payment_${uuid(602)}`] })),
  refused("A date the payment cannot be sent on", `capxul payment reschedule payment_${uuid(602)} --on 2026-01-05 --json`, error_INVALID_INPUT),
  refused("The payment already paid", `capxul payment reschedule ${PAY} --on 2026-03-09 --json`, error_WRONG_STATE),
];

export const examples_payment_get = [
  ok("Read the settled payment to Brightside", `capxul payment get ${PAY} --json`, brightsidePayment()),
  refused("An id that does not start with payment_", "capxul payment get 31 --json", error_CLI_USAGE),
  refused("A payment the caller cannot read", `capxul payment get payment_${uuid(699)} --json`, error_INVALID_INPUT),
];

export const examples_payment_list = [
  ok("The Organization's payments, the first page", "capxul payment list --org northwind --limit 2 --json", {
    items: [
      brightsidePayment(),
      brightsidePayment({
        id: `payment_${uuid(602)}`,
        status: "scheduled",
        payAt: "2026-03-02T00:00:00Z",
        receipt: null,
        timing: { createdAt: "2026-02-10T09:35:00Z", sentAt: null, settledAt: null },
      }),
    ],
    nextCursor: "cur_0000000000000002",
  }),
  ok("Only the scheduled ones", "capxul payment list --org northwind --scheduled --json", {
    items: [brightsidePayment({ id: `payment_${uuid(602)}`, status: "scheduled", payAt: "2026-03-02T00:00:00Z", receipt: null, timing: { createdAt: "2026-02-10T09:35:00Z", sentAt: null, settledAt: null } })],
    nextCursor: null,
  }),
  refused("A cursor this list did not give", "capxul payment list --after nonsense --json", error_INVALID_INPUT),
  refused("An Organization the caller is not a member of", "capxul payment list --org elsewhere --json", error_ROLE_PERMISSION_DENIED),
];

export const examples_payment_wait = [
  ok("Follow a payment until it settles", `capxul payment wait ${PAY} --json`, brightsidePayment()),
  ok("Follow an approval ID to its outcome", `${NEXT_WAIT} --json`, ended([brightsidePayment()])),
  refused("A payment the caller cannot read", `capxul payment wait payment_${uuid(699)} --json`, error_INVALID_INPUT),
  refused("The wait ran out before the payment ended", `capxul payment wait payment_${uuid(602)} --timeout-seconds 30 --json`, error_CLI_DEADLINE),
];

export const examples_org_department_pay = [
  ok("Marcus pays from the Finance department's budget", "capxul org department pay finance --to accounts@brightside.test --amount 1250.00 --org northwind --json", {
    approvalId: APPROVAL,
    paymentIds: [PAY],
  }),
  refused("Priya does not hold the Finance department", "capxul org department pay finance --to accounts@brightside.test --amount 1250.00 --org northwind --json", error_ROLE_PERMISSION_DENIED),
  refused("More than the department's budget has left this period", "capxul org department pay finance --to accounts@brightside.test --amount 9000.00 --org northwind --json", error_PAYROLL_BUDGET_EXCEEDED),
];

const SEATS = "capxul org seats buy 5 --from finance --org northwind";
export const examples_org_seats_buy = [
  ok("Buy five seats from the Finance budget at 10 USDC each", `${SEATS} --json`, {
    ...handover({ paymentIds: [`payment_${uuid(603)}`] }),
    purchase: { seats: 5, unitPrice: { amount: "10.00", asset: "USDC" }, total: { amount: "50.00", asset: "USDC" } },
  }),
  ok(
    "Followed to the end the purchase settles",
    `${SEATS} --timeout-seconds 600 --json`,
    ended([brightsidePayment({ id: `payment_${uuid(603)}`, amount: { asset: "USDC", value: "50.00" }, counterparty: "Capxul", documents: [] })]),
  ),
  refused("Not signed in", `${SEATS} --json`, error_NOT_AUTHENTICATED),
  refused("The seats cost more than the budget has left", "capxul org seats buy 500 --from finance --org northwind --json", error_PAYROLL_BUDGET_EXCEEDED),
  refused("Seat pricing is not set on this deployment", `${SEATS} --json`, error_FEATURE_NOT_AVAILABLE),
  refused("The company Safe holds less than the seats cost", `${SEATS} --json`, error_INSUFFICIENT_BALANCE),
  refused("The approval expired before it landed", `${SEATS} --timeout-seconds 600 --json`, error_SUPERSEDED),
];

const WAITING = {
  escrow: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  asset: "USDC",
  amount: "300.00",
  sender: ADDRESS.northwind,
  from_label: "Northwind Trading",
};
export const examples_payment_claim = [
  ok("Priya has nothing waiting", "capxul payment claim --json", { status: "nothing_waiting", safe: ADDRESS.priya, escrows: [], approval_id: null, approval_url: null, expires_at: null }),
  ok("Money waits: one approval collects it", "capxul payment claim --json", {
    status: "awaiting_approval",
    safe: ADDRESS.priya,
    escrows: [WAITING],
    approval_id: `approval_${uuid(604)}`,
    approval_url: `https://app.capxul.test/approve/approval_${uuid(604)}`,
    expires_at: Date.parse("2026-02-10T10:30:00Z"),
  }),
  ok("Collected into Priya's Safe", "capxul payment claim --json", { status: "collected", safe: ADDRESS.priya, escrows: [WAITING], approval_id: `approval_${uuid(604)}`, approval_url: null, expires_at: null }),
  refused("Priya's Safe is not set up yet", "capxul payment claim --json", error_SMART_ACCOUNT_MISSING),
  refused("Priya declined the collection on the approval page", "capxul payment claim --json", error_CANCELLED),
  refused("Not signed in", "capxul payment claim --json", error_NOT_AUTHENTICATED),
];
