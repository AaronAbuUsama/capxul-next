// The old book's payment operations, as it is: every payment.*.yaml page under
// apps/docs/factory/operations/ in /home/user/factory (branch integration/factory), one
// operation record each. The text (title, about, who, changes, notes, mistakes, acceptance,
// refusals' `when`) is the book's, verbatim; acceptance lines are numbered by position.
//
// implementedBy is what the CLI command (apps/cli/src/commands/payment/subcommands/<name>/)
// reaches: the SDK flow (./flows.ts) when the SDK method it calls composes several calls, else the
// one public rpc it reaches (./movements.ts owns packages/backend/src/payments/records/).
//
// returns is a Struct of the page's `returns` fields. A field's type is the protocol row's where
// the row gives it (payments.records.get and .list return the wire Payment); otherwise
// Schema.Unknown: the approval hand-over fields (status, approvalId, approvalUrl, paymentIds,
// expiresAt, next, approval) come from the CLI's handOver
// (apps/cli/src/commands/payment/internal/approval.ts:49, :204), not from a payments row. Where a
// page lists the fields of two `--json` shapes the CLI prints one at a time (send, retry, cancel,
// reschedule, wait), returns is the Union of one Struct per shape, so that either output decodes.
//
// A refusal's `given` names the devnet world (packages/scenarios) from which one scenario step's
// command reaches it; `?` where none does. No budget: nothing measured these commands.

import { Schema } from "effect";
import { defineOperation } from "../../../packages/book/src/index.ts";
import {
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_SUPERSEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { flow_client_approvals_prepare, flow_client_payments_subscribe } from "./flows.ts";
import { rpc_payments_records_get, rpc_payments_records_list } from "./movements.ts";

// ── the wire Payment, as payments.records.get and .list return it ───────────────────────────
// Transcribed from packages/protocol/src/payments/payment-schema.ts:158 with its vocabularies
// (status.ts:23, :62, :92, :97), AssetAmountSchema (money/schema.ts:46), MoneySchema
// (money/schema.ts:54), DocumentRefV3Schema (documents/read-schema.ts:13) and PaymentTiming
// (payment-schema.ts:96). Branded strings and numbers are plain here; the Struct's two
// cross-field checks (document kind maps to paymentType; a bank payout carries its quote,
// output and two rail legs, payment-schema.ts:204) are not transcribed.

const AssetAmount = Schema.Struct({
  asset: Schema.String,
  value: Schema.String,
  currency: Schema.optional(Schema.Never),
  decimals: Schema.optional(Schema.Never),
});

const Money = Schema.Struct({
  currency: Schema.String,
  value: Schema.String,
  decimals: Schema.Number,
  asset: Schema.optional(Schema.Never),
});

const DocumentRef = Schema.Struct({
  documentHash: Schema.String,
  contentHash: Schema.String,
  kind: Schema.Literals(["memo", "invoice", "payslip", "receipt"]),
  format: Schema.Literals(["envelope-v3", "envelope-v4", "envelope-v5", "artifact"]),
  role: Schema.Literals(["instruction", "movement", "supporting"]),
  issuedAt: Schema.NullOr(Schema.Number),
});

const Payment = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    "pending",
    "settling",
    "in_transit",
    "unresolved",
    "scheduled",
    "streaming",
    "pending_claim",
    "settled",
    "cancelled",
    "failed",
  ]),
  amount: AssetAmount,
  paymentType: Schema.Literals(["unspecified", "invoice", "payroll", "reimbursement"]),
  direction: Schema.Literals(["in", "out", "self"]),
  counterpartyLabel: Schema.String,
  receipt: Schema.NullOr(Schema.Struct({ chainId: Schema.Number, transactionHash: Schema.String })),
  recipient: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String, label: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("external_address"), label: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("party_account"), partyAccountId: Schema.String, label: Schema.String }),
  ]),
  documents: Schema.Array(DocumentRef),
  documentState: Schema.optionalKey(Schema.Literals(["ready", "pending", "unavailable"])),
  timing: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("instant") }),
    Schema.Struct({ kind: Schema.Literal("scheduled"), at: Schema.Number }),
    Schema.Struct({
      kind: Schema.Literal("stream"),
      startsAt: Schema.Number,
      endsAt: Schema.Number,
      cliffAt: Schema.optionalKey(Schema.Number),
    }),
  ]),
  schedule: Schema.optionalKey(
    Schema.Struct({
      sendsAt: Schema.Number,
      windowEndsAt: Schema.Number,
      shortfall: Schema.optionalKey(Schema.Literals(["budget_exhausted", "balance_too_low", "fees_too_high", "send_refused"])),
      failedReason: Schema.optionalKey(Schema.Literals(["window_passed", "not_member", "approvals_lost"])),
    }),
  ),
  released: AssetAmount,
  availableToClaim: AssetAmount,
  execution: Schema.optionalKey(
    Schema.Struct({
      status: Schema.Literals([
        "pending",
        "included",
        "dropped",
        "replaced",
        "expired",
        "unresolved",
        "superseded",
        "failed",
        "settled",
      ]),
      retryRequired: Schema.Boolean,
      notSent: Schema.optionalKey(Schema.Literal(true)),
    }),
  ),
  requestedOutput: Schema.optionalKey(Money),
  deliveredOutput: Schema.optionalKey(Money),
  outputExact: Schema.optionalKey(Schema.Boolean),
  recipientOnCapxul: Schema.optionalKey(Schema.Boolean),
  recipientWarning: Schema.optionalKey(Schema.Boolean),
  legs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(["funding", "delivery"]),
        state: Schema.Literals(["pending", "done", "failed", "refunded"]),
      }),
    ),
  ),
  links: Schema.optionalKey(
    Schema.Struct({
      quoteId: Schema.String,
      railOperationId: Schema.String,
      refundMovementId: Schema.optionalKey(Schema.String),
    }),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

// ── what an approval hand-over prints with --json ───────────────────────────────────────────
// payment send, retry, cancel and reschedule print one of two shapes, never both. An agent that
// gets the link at once is handed the open approval (awaitingApproval, internal/approval.ts:49,
// returned at :312). Followed to its end (a person, an AI's own key, or a replayed request key),
// it prints the ApprovalOutcome (paidResult, approval.ts:204; packages/sdk/src/accounts/
// approval-records.ts:23). The four pages list both shapes' fields as one list, with the same
// text. `payments` is read with payments.records.get or .get-for-organization
// (packages/sdk/src/accounts/organization-approvals.ts:131; for a cancel, again by voids.ts:47),
// so each is the wire Payment. The other fields come from the CLI and the Approval: Schema.Unknown.

const ApprovalHandOver = Schema.Union([
  Schema.Struct({
    status: Schema.Unknown, // With `--json`, `awaiting_approval` while the approval waits for you.
    approvalId: Schema.Unknown, // The approval's ID, which `capxul payment wait` follows.
    approvalUrl: Schema.Unknown, // The approval page where you sign.
    paymentIds: Schema.Unknown, // The payments the approval covers.
    expiresAt: Schema.Unknown, // When the approval lapses.
    next: Schema.Unknown, // The `capxul payment wait` command that follows it.
  }),
  Schema.Struct({
    approval: Schema.Unknown, // When followed to the end, the approval as it ended.
    payments: Schema.Array(Payment), // When followed to the end, each payment it moved, as it stands.
  }),
]);

// ── payment send ─────────────────────────────────────────────────────────────────────────

// The book names `sdk: client.payments.pay`, but the CLI reads `client.accounts.read` (send/execute.ts:80),
// then calls `client.approvals.prepare` (send/execute.ts:94), which loads the Safe, prepares the Payment
// (payments.commands.prepare) and opens an approval, then follows it with `client.approvals.wait`
// (approval.ts:175). With `--org` it runs org/subcommands/payment/subcommands/send/execute.ts: it reads the
// treasury, your allowances and what is left, refuses an overspend itself (ROLE_PERMISSION_DENIED,
// budget_exhausted, :78), then calls `client.approvals.prepare` with an organizationId. With
// `--org --as-directors` it runs send/as-directors.ts (`proposals.pay`), a different flow; without `--org`
// it is refused by `personalAsDirectors` (as-directors.ts:29).
// A note longer than a Line (300 characters) is split at sentence ends into consecutive notes; the text is the book's.
export const operation_payment_send = defineOperation({
  id: "payment.send",
  title: "Send a payment",
  about: "Pays someone by email, `@handle` or 0x address. The CLI prepares the payment and opens the approval page, which is the only confirmation. With `--org`, it pays from a spending allowance you hold in that Organization. With `--org --as-directors`, it pays from the Organization account itself as a Director proposal.",
  was: [
    "apps/docs/factory/operations/payment.send.yaml:1",
    "apps/cli/src/commands/payment/subcommands/send/command.ts:12",
    "apps/cli/src/commands/payment/subcommands/send/execute.ts:74",
    "apps/cli/src/commands/payment/subcommands/send/execute.ts:94",
    "apps/cli/src/commands/payment/internal/approval.ts:278",
    "apps/cli/src/commands/payment/internal/approval.ts:49",
    "apps/cli/src/commands/payment/internal/approval.ts:204",
    "apps/cli/src/commands/org/subcommands/payment/subcommands/send/execute.ts:78",
    "apps/cli/src/commands/org/subcommands/payment/subcommands/send/as-directors.ts:29",
    "apps/cli/src/commands/org/subcommands/payment/subcommands/send/as-directors.ts:26",
    "apps/cli/src/auth/input.ts:20",
    "apps/cli/src/commands/payment/subcommands/send/execute.ts:31",
    "apps/cli/src/commands/payment/subcommands/send/execute.ts:33",
    "apps/cli/src/commands/payment/subcommands/send/execute.ts:35",
    "apps/cli/src/commands/payment/internal/send-target.ts:27",
    "apps/cli/src/commands/payment/internal/send-target.ts:65",
    "apps/cli/src/commands/payment/internal/send-target.ts:79",
    "apps/cli/src/commands/payment/internal/send-target.ts:103",
    "packages/protocol/src/errors/factories.ts:193",
    "apps/cli/src/runtime/money-refusal.ts:118",
    "packages/sdk/src/accounts/approvals.ts:106",
    "packages/scenarios/src/acme/s2-the-team-and-its-permissions.scenario.ts:1568",
    "packages/scenarios/src/acme/s2-the-team-and-its-permissions.scenario.ts:175",
    "packages/scenarios/src/acme/s1-acme-is-founded.scenario.ts:1683",
    "packages/scenarios/src/acme/s10-acme-schedules-payments.scenario.ts:842",
  ],
  area: "payments",
  command: "payment send",
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  who: "A signed-in person. With `--org`, a member holding a spending allowance for the asset. With `--as-directors`, a Director.",
  changes: "You sign the payment on the approval page, and the money moves once it settles. With `--as-directors`, it opens a proposal at the Safe's next nonce and nothing moves until enough Directors approve.",
  notes: [
    "The asset defaults to USDC and must be one the payer holds. `--request-key` makes repeating the same send safe: a repeat reports where the first approval ended.",
    "With `--json` it returns the approval link and a `capxul payment wait` command at once. Otherwise it follows the approval until it lapses, or for `--timeout-seconds` (1 to 3600).",
    "A typed 0x address is taken as your own choice. The approval page shows it again before you sign.",
    "With `--org` and several spending allowances for the asset, name one with `--from`. `--as-directors` takes no `--from`, `--input`, `--request-key`, `--account` or `--suggest`.",
    "On Protocol v4 an immediate `--as-directors` payment is one Board batch from the company Safe: `approve` of the amount to Payments, then one exact `Payments.send` (kind 0) whose executor is the company Safe and whose document hash is the note's.",
    "The client checks that batch pays what you asked before anyone approves it. A personal payment is one `Payments.send` from your Companies House Safe.",
    "On Protocol v4 `--org --from <allowance>` pays now with one `Budgets.spend` from your own Safe, and Budgets pays from the company Safe through its Roles payout role. Budgets derives the payment's job nonce, so the client checks the payment id before you sign.",
    "More than the allowance has left this period is refused before you sign. A dated `--org` payment is not built yet (CAP-1238).",
    "On Protocol v4 a dated `--as-directors` payment (`--on` or `--at`) is one Board proposal at the Safe's next nonce: one `Budgets.schedule` from the company Safe on its open top budget in the asset with the most left. The client checks it pays what you asked before anyone approves it.",
    "When it executes, the budget reserves the amount, and on the day Capxul asks Budgets to pay it (CAP-1238). That day's run asks only for the items still pending, and it does not read the Safe's balance again, because the budget already holds the amount.",
    "No retry window ends a dated budget payment: only the chain does. Paid settles it, and every item cancelled voids it (CAP-1252).",
  ],
  mistakes: [
    { what: "You used `--as-directors` without `--org`", fix: "It is refused with `CLI_USAGE`. A personal payment has no Directors. Name the Organization with `--org`." },
    { what: "You sent an asset your account does not hold", fix: "It is refused with `CLI_USAGE`, and the message lists the assets you hold. Choose one with `--asset`." },
    { what: "You sent to a `@handle` nobody has", fix: "It is refused, and the message names the handle. Send to an email, an existing `@handle` or an 0x address." },
  ],
  acceptance: [
    /* 1 */ "A signed personal payment is sent once and records its one Payment (backend submit.test.ts).",
    /* 2 */ "A replay of the same signature answers with the same hash and sends nothing more (backend submit.test.ts).",
    /* 3 */ "A signature that does not recover the account's signer, an unknown execution and another person's execution are each refused and nothing is sent (backend submit.test.ts).",
    /* 4 */ "An Organization payment uses the one spending allowance you hold for the asset, and with several asks which and takes `--from` (cli approval.test.ts).",
    /* 5 */ "An expired approval is refused and names the wait command (cli approval.test.ts).",
    /* 6 */ "A mistyped address, and a recipient that is nothing, are refused naming it (cli refusals.test.ts).",
    /* 7 */ "On Protocol v4 a payment from a spending allowance is one `Budgets.spend` from the wearer's Safe; before anyone signs, the route must name that allowance's own active budget, and a route to another budget, a pending allowance or an unreadable list is closed unsent (sdk budget-route.test.ts).",
    /* 8 */ "On Protocol v4 a dated Director payment is one exact `Budgets.schedule` of the asked amount to the asked address on a v4 Budgets; another amount, recipient or contract is refused before anyone approves (sdk organizations/tests/org.proposals.test.ts).",
    /* 9 */ "Once its Board proposal executes, each item's Budgets id is found by the job nonce its `Budgets.schedule` carried, and never one on another budget; a chain read that fails is tried again, not given up (backend payments/schedules/tests/board-budgets.test.ts).",
  ],
  returns: ApprovalHandOver,
  // The CLI's own refusals (inputRequired, auth/input.ts:20; usage, as-directors.ts:26): both sources, both send
  // times, no <to> <amount> off a terminal, a recipient that is no email, @handle or whole 0x address, an asset the
  // account does not hold, and `--as-directors` without `--org`.
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "?", when: "`--as-directors` without `--org`, an asset you do not hold, or both `<to> <amount>` and `--input`, or both `--on` and `--at`." },
    // As is, nothing in the old code produces INVALID_RECIPIENT: Errors.invalidRecipient (protocol errors/factories.ts:193)
    // has no caller, no backend row or chain revert decoder raises the code, and the CLI only words it (money-refusal.ts:118).
    // The mistyped address and the empty recipient this refusal describes are refused by the CLI's readRecipient with
    // CLI_USAGE, field `to` (send-target.ts:27, :65), before any session. So refusal-not-produced on it is a finding.
    { error: error_INVALID_RECIPIENT, given: "?", when: "The address is mistyped, or the recipient is nothing at all. The refusal names it." },
    { error: error_INVALID_INPUT, given: "?", when: "The signature does not recover the account's signer, or the execution is unknown." },
    { error: error_INSUFFICIENT_BALANCE, given: "?", when: "The paying Safe holds less than the amount." },
    // s2.19 (s2:1566): Ben, a Seat who is not a Director, runs `payment send --org acme --as-directors` and is refused.
    // It depends on s2.8, Ben's acceptance (s2:444), and s2.20 saves after-s2 straight after it (s2:175, :1599), so
    // after-s2 holds Ben as a Seat. after-s1 cannot reach it: Ben is not invited until s2.4, and Sam, refused at s1.14
    // (s1:1681), is a co-Director from s1.15, so Acme is 2 of 2 at after-s1. s10.19 (s10:840) reaches the code from
    // after-s10 by an overspend (reason budget_exhausted), which this `when` does not describe.
    { error: error_ROLE_PERMISSION_DENIED, given: "after-s2", when: "With `--org`, you hold no spending allowance for the asset; with `--as-directors`, you are not a Director." },
    // As is, SUPERSEDED reaches the CLI after its implementation: the backend's accounts.approvals.observe answers it
    // (backend accounts/approvals/errors.ts:37) to `client.approvals.wait`, which handOver runs (approval.ts:175). No file
    // books that accounts row, and client.approvals.prepare never produces the code, so refusal-not-produced on it is a finding.
    { error: error_SUPERSEDED, given: "?", when: "The sponsorship expired or the claim could not be observed, so the payment must be retried." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment list ─────────────────────────────────────────────────────────────────────────

// `client.payments.list` forwards one rpc, payments.records.list. With `--org` the CLI runs
// org/subcommands/payment/subcommands/list/execute.ts (`client.org(id).payments.list`, payments.records.listForOrganization).
// `--limit`, `--after` and `--scheduled` are applied by the CLI to the page the rpc returns: the row takes no
// cursor (protocol payments/operations.ts:110) and the backend answers the whole list (runtime/paging.ts:1).
// As is, the CLI refuses an `--after` it cannot find, and a `--limit` outside 1 to 100, with `CLI_USAGE`
// (runtime/paging.ts:82, :43; auth/input.ts:20), not the `INVALID_INPUT` the book's refusal names.
export const operation_payment_list = defineOperation({
  id: "payment.list",
  title: "List payments",
  about: "Lists payments you sent and received. With `--org`, it lists the Organization's payments. Use it to find a payment ID for `payment get`, `wait` or `retry`.",
  was: [
    "apps/docs/factory/operations/payment.list.yaml:1",
    "apps/cli/src/commands/payment/subcommands/list/command.ts:8",
    "apps/cli/src/commands/payment/subcommands/list/execute.ts:54",
    "apps/cli/src/runtime/paging.ts:82",
    "packages/sdk/src/payments/methods.ts:68",
    "packages/protocol/src/payments/operations.ts:109",
  ],
  area: "payments",
  command: "payment list",
  priority: "normal",
  implementedBy: rpc_payments_records_list,
  who: "A signed-in person. With `--org`, a member of that Organization.",
  changes: "Nothing: it only reads.",
  notes: [
    "It shows 25 at a time by default. `--limit` takes 1 to 100.",
    "When there are more, it prints the command with `--after` for the next page.",
  ],
  acceptance: [
    /* 1 */ "It lists the union of payments sent and received (backend list.test.ts).",
    /* 2 */ "A read schedules nothing and changes no Payment row (backend list.test.ts).",
    /* 3 */ "`--scheduled` lists only scheduled payments, soonest first (cli payment.test.ts).",
    /* 4 */ "`--limit` shows one page, names the next with `--after`, and an unknown cursor is refused (cli payment.test.ts).",
  ],
  returns: Schema.Struct({
    items: Schema.Array(Payment), // The payments sent and received, each with its ID, status, amount, direction, counterparty and timing.
    nextCursor: Schema.NullOr(Schema.String), // The `--after` value for the next page, or null on the last.
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: "?", when: "`--after` is a cursor this list did not give, or you have no Account yet." },
    { error: error_ROLE_PERMISSION_DENIED, given: "?", when: "`--org` names an Organization you are not a member of." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment get ──────────────────────────────────────────────────────────────────────────

// `client.payments.get` forwards one rpc, payments.records.get. With `--org` the CLI runs
// org/subcommands/payment/subcommands/get/execute.ts (`client.org(id).payments.get`, payments.records.getForOrganization).
// A null read is refused by the CLI (`paymentNotFound`), so the SDK's null becomes `INVALID_INPUT`.
export const operation_payment_get = defineOperation({
  id: "payment.get",
  title: "Show a payment",
  about: "Reads one payment by its ID: its status, how its execution went, its receipt and its documents. With `--org`, it reads one of the Organization's payments.",
  was: [
    "apps/docs/factory/operations/payment.get.yaml:1",
    "apps/cli/src/commands/payment/subcommands/get/command.ts:7",
    "apps/cli/src/commands/payment/subcommands/get/execute.ts:15",
    "apps/cli/src/commands/payment/subcommands/get/execute.ts:13",
    "apps/cli/src/commands/payment/internal/shared.ts:9",
    "apps/cli/src/commands/payment/internal/shared.ts:15",
    "packages/sdk/src/payments/methods.ts:84",
    "packages/protocol/src/payments/operations.ts:116",
    "packages/protocol/src/payments/payment-schema.ts:158",
    "apps/cli/src/commands/payment/internal/shared.ts:69",
    "packages/scenarios/src/acme/personal-payment.ts:346",
    "packages/scenarios/src/acme/s1-acme-is-founded.scenario.ts:1958",
  ],
  area: "payments",
  command: "payment get",
  priority: "normal",
  implementedBy: rpc_payments_records_get,
  who: "A signed-in person who sent or received the payment. With `--org`, a member of that Organization.",
  changes: "Nothing: it only reads.",
  notes: [
    "Each document line names the command that renders it.",
  ],
  mistakes: [
    { what: "You gave an ID that is not a payment ID", fix: "It is refused with `CLI_USAGE`. A payment ID starts with `payment_`. Run `payment list` to find it." },
  ],
  acceptance: [
    /* 1 */ "A malformed ID is refused before any session is restored (cli payment.test.ts).",
    /* 2 */ "A signed-in person with no Account is refused `INVALID_INPUT`, not read as null (backend get.test.ts).",
    /* 3 */ "A read, a null read and a refusal schedule nothing and change no Payment row (backend get.test.ts).",
    /* 4 */ "Each document line names the command that saves it as a PDF, and the read saves none itself (cli approval.test.ts).",
  ],
  returns: Schema.Struct({
    id: Payment.fields.id, // The payment's `payment_` ID.
    status: Payment.fields.status, // Its status.
    amount: Payment.fields.amount, // Its amount and asset.
    direction: Payment.fields.direction, // Whether you sent or received it.
    receipt: Payment.fields.receipt, // Its chain and transaction hash, or null before it lands.
    execution: Payment.fields.execution, // How its execution went, and whether it must be retried.
    documents: Payment.fields.documents, // Its documents, each with the `capxul document render` command that saves it.
    timing: Payment.fields.timing, // When it was created, sent and settled.
  }),
  // The CLI refuses an ID that is not payment_ and letters or digits (readPaymentId), before any session.
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "?", when: "The ID does not start with `payment_`." },
    // s1.37 (personal-payment.ts:344) runs in S1 after s1.20 saves after-s1 (s1:1958): Sam reads Dana's personal Payment and the CLI refuses `INVALID_INPUT`.
    // That Payment is made at s1.33, after the save, so it is not in after-s1; but the row answers null alike for a missing Payment and one Sam
    // cannot read, and the CLI refuses any null (internal/shared.ts:69), so from after-s1 Sam reading any well-formed ID he is not party to reaches it.
    { error: error_INVALID_INPUT, given: "after-s1", when: "You are signed in but have no Account, or the payment is not one you can read." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment wait ─────────────────────────────────────────────────────────────────────────

// For a payment ID the CLI calls `client.payments.subscribe`, which subscribes to payments.records.get and
// re-reads it fresh on each change; the CLI ends the wait on a terminal, needs-action or scheduled Payment.
// For an `approval_` ID it runs wait/approval.ts (`followApproval`), and with `--org` org/.../wait/execute.ts.
export const operation_payment_wait = defineOperation({
  id: "payment.wait",
  title: "Follow a payment",
  about: "Follows a payment until it ends, needs action or must be retried, and prints each state as it changes. It also takes an `approval_…` ID, such as the one `payment send --json` or an agreement write returns, and follows that approval to its outcome.",
  was: [
    "apps/docs/factory/operations/payment.wait.yaml:1",
    "apps/cli/src/commands/payment/subcommands/wait/command.ts:8",
    "apps/cli/src/commands/payment/subcommands/wait/execute.ts:7",
    "apps/cli/src/commands/payment/subcommands/wait/approval.ts:47",
    "apps/cli/src/commands/payment/internal/wait.ts:118",
    "apps/cli/src/commands/payment/internal/wait.ts:125",
    "apps/cli/src/commands/payment/internal/shared.ts:15",
    "apps/cli/src/commands/payment/subcommands/wait/approval.ts:60",
    "apps/cli/src/auth/input.ts:20",
    "apps/cli/src/commands/payment/internal/wait.ts:170",
    "apps/cli/src/commands/payment/subcommands/wait/approval.ts:100",
    "apps/cli/src/commands/payment/subcommands/wait/approval.ts:114",
    "packages/sdk/src/payments/methods.ts:52",
    "packages/sdk/src/payments/subscription.ts:43",
  ],
  area: "payments",
  command: "payment wait",
  priority: "normal",
  implementedBy: flow_client_payments_subscribe,
  who: "A signed-in person who can read the payment. With `--org`, a member of that Organization.",
  changes: "Nothing: it only reads. It never sends anything itself.",
  notes: [
    "With no `--timeout-seconds` it follows the payment until it ends. The timeout takes 1 to 3600.",
    "If you stop it or it times out, it prints what it knows, and the payment may still settle. Run it again to keep following.",
  ],
  mistakes: [
    { what: "The timeout passed before the payment ended", fix: "It stops with `CLI_DEADLINE` and the last state it saw. The payment may still settle. Run `payment wait` again." },
  ],
  acceptance: [
    /* 1 */ "It waits through pending and stops on settled with one unsubscribe (cli payment.test.ts).",
    /* 2 */ "With no timeout it keeps following past the old two-minute default (cli payment.test.ts).",
    /* 3 */ "At `--timeout-seconds` it ends with the last known state, and the timeout starts after the session is restored (cli payment.test.ts).",
    /* 4 */ "A fresh null result is refused (cli payment.test.ts).",
  ],
  // One shape per ID kind: the Payment itself (internal/wait.ts:170), or the ApprovalOutcome (wait/approval.ts:114, :115).
  // As is, an agreement write's approval prints the agreement's own read instead, which neither shape covers (wait/approval.ts:100, :112).
  returns: Schema.Union([
    Schema.Struct({
      id: Payment.fields.id, // For a payment ID, the payment's ID. The Payment itself is the data, not wrapped.
      status: Payment.fields.status, // For a payment ID, the status it ended on.
      receipt: Payment.fields.receipt, // For a payment ID, its chain and transaction hash, or null.
    }),
    Schema.Struct({
      approval: Schema.Unknown, // For an approval ID, the approval as it ended.
      payments: Schema.Array(Payment), // For an approval ID, the payments it moved; empty for an allowance change or an invitation.
    }),
  ]),
  // The CLI refuses a malformed payment ID (readPaymentId) or approval ID (APPROVAL_ID, inputRequired), before any session.
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "?", when: "The payment or approval ID is malformed." },
    { error: error_INVALID_INPUT, given: "?", when: "The payment is not one you can read." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment retry ────────────────────────────────────────────────────────────────────────

// The book names `sdk: client.payments.retry`, but the CLI calls `client.approvals.prepare({ retry })`
// (retry/execute.ts), which prepares the lifecycle step and opens an approval.
export const operation_payment_retry = defineOperation({
  id: "payment.retry",
  title: "Retry a payment",
  about: "Retries one exact payment: the same recipient, amount and asset, prepared again. Use it when a payment's execution was dropped, replaced, expired or superseded. You approve the retry in the browser, as you did the first time.",
  was: [
    "apps/docs/factory/operations/payment.retry.yaml:1",
    "apps/cli/src/commands/payment/subcommands/retry/command.ts:6",
    "apps/cli/src/commands/payment/subcommands/retry/execute.ts:32",
    "apps/cli/src/commands/payment/subcommands/retry/execute.ts:23",
    "apps/cli/src/commands/payment/internal/shared.ts:15",
    "apps/cli/src/commands/payment/internal/approval.ts:278",
    "packages/sdk/src/accounts/approvals.ts:106",
  ],
  area: "payments",
  command: "payment retry",
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  who: "The person who made the payment. With `--org`, someone who can act for that Organization's payment.",
  changes: "You sign the retried payment on the approval page, and the money moves once it settles.",
  notes: [
    "With `--json` it returns the approval link at once. Otherwise it follows the approval until it lapses, or for `--timeout-seconds` (1 to 3600).",
  ],
  mistakes: [
    { what: "The payment is not in a state that needs a retry", fix: "It is refused with `WRONG_STATE`. Only a payment whose execution was dropped, replaced, expired or superseded can be retried. Check it with `payment get`." },
  ],
  acceptance: [
    /* 1 */ "A personal payment whose approval lapsed is retried on its own nonce lane (backend prepare-scoped.test.ts).",
    /* 2 */ "A readable incoming payment is refused as an Organization retry source (backend prepare-scoped.test.ts).",
    /* 3 */ "The original budget authority refusal holds for a retry (backend prepare-scoped.test.ts).",
    /* 4 */ "Every original payment is previewed without writes (backend prepare-scoped.test.ts).",
    /* 5 */ "It hands an agent the approval link, retries an Organization's payment in that Organization, and refuses a malformed ID before any session (cli retry.test.ts).",
  ],
  returns: ApprovalHandOver,
  // The CLI refuses a malformed payment ID (readPaymentId), before any session.
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "?", when: "The payment ID is malformed." },
    { error: error_WRONG_STATE, given: "?", when: "The payment's execution was not dropped, replaced, expired or superseded." },
    { error: error_ROLE_PERMISSION_DENIED, given: "?", when: "You cannot act for that payment, or no longer hold its budget authority." },
    { error: error_INSUFFICIENT_BALANCE, given: "?", when: "The paying Safe holds less than the amount." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment cancel ───────────────────────────────────────────────────────────────────────

// The book's row is payments.lifecycles.prepareScoped. The CLI calls `client.approvals.prepare({ cancel })`
// and follows the approval until the Payment reads `cancelled` (`untilVoided`). With `--org --as-directors`
// it runs org/subcommands/payment/subcommands/cancel/as-directors.ts (`proposals.cancelScheduled`), a different flow
// whose output the page's returns do not describe; without `--org` it is refused by `personalAsDirectors` (CLI_USAGE).
// `untilVoided` reads the Payment every 2 s for up to 180 s after the void is sent (internal/voids.ts:11, :38).
export const operation_payment_cancel = defineOperation({
  id: "payment.cancel",
  title: "Cancel a scheduled payment",
  about: "Cancels a scheduled payment that you signed, before its date. The CLI prepares a void on the payment's own nonce lane and gives you an approval link. You approve the void in your browser, and the CLI follows it until the payment reads `cancelled`.",
  was: [
    "apps/docs/factory/operations/payment.cancel.yaml:1",
    "apps/cli/src/commands/payment/subcommands/cancel/command.ts:8",
    "apps/cli/src/commands/payment/subcommands/cancel/execute.ts:34",
    "apps/cli/src/commands/payment/subcommands/cancel/execute.ts:25",
    "apps/cli/src/commands/payment/internal/shared.ts:15",
    "apps/cli/src/commands/payment/subcommands/cancel/command.ts:31",
    "apps/cli/src/commands/payment/internal/voids.ts:38",
    "apps/cli/src/commands/payment/internal/approval.ts:278",
    "packages/sdk/src/accounts/approvals.ts:106",
  ],
  area: "payments",
  command: "payment cancel",
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  who: "The person who scheduled the payment. With `--org`, someone who can act for that Organization's payment. With `--org --as-directors`, a Director.",
  changes: "You sign the void on the approval page. Once the void lands, the payment can never be sent. With `--as-directors`, it opens a proposal that the Directors approve at the threshold.",
  notes: [
    "With `--json` it returns the approval link and a `capxul payment wait` command at once. Otherwise it follows the approval until it lapses, or for `--timeout-seconds`.",
    "An AI that signs with its own key signs the void at once.",
    "The approval ends when the void is sent. The payment can read `scheduled` for a short time after that. The CLI reads it for up to three minutes.",
    "On Protocol v4 the Directors cancel a payment they dated (`--as-directors`) with one Board proposal at the Safe's next nonce: one `Budgets.cancel` per item from the company Safe. When it executes, the budget's reservation is freed and the payment reads `cancelled` (CAP-1238).",
  ],
  mistakes: [
    { what: "The payment does not read `cancelled` after the void", fix: "It fails with `WRONG_STATE` and names `capxul payment get`. Read the payment to see what it became." },
    { what: "You let the approval expire, or rejected it on the approval page", fix: "Expiry ends with `WRONG_STATE` and a rejection with `CANCELLED`. The payment stays scheduled in both cases." },
  ],
  acceptance: [
    /* 1 */ "A cancel of a payment that is no longer held, or already cancelled, is refused before anything is built (backend prepare-scoped.test.ts).",
    /* 2 */ "On Protocol v4 the Board cancels only a waiting schedule it stored for its own Organization, and once its proposal executes the schedule, its command and its Payment are cancelled, once (backend payments/schedules/tests/board-cancel.test.ts).",
    /* 3 */ "A held payment stays held when its cancel fails before it is signed (backend prepare-scoped.test.ts).",
    /* 4 */ "Only a Director can cancel an Organization-funded commitment, and each Director prepares their own (backend prepare-scoped.test.ts).",
    /* 5 */ "It prepares the void for the approval page and hands an agent the link (cli cancel.test.ts).",
    /* 6 */ "It cancels an Organization's scheduled payment in that Organization, and refuses a malformed ID before any session (cli cancel.test.ts).",
  ],
  returns: ApprovalHandOver,
  // The CLI refuses a malformed payment ID (readPaymentId), before any session, and `--as-directors` without `--org`
  // (personalAsDirectors).
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: "?", when: "The payment ID is malformed." },
    { error: error_WRONG_STATE, given: "?", when: "The payment is no longer held, is already cancelled, the approval expired, or after the void it does not read `cancelled`." },
    { error: error_ROLE_PERMISSION_DENIED, given: "?", when: "You cannot act for that payment, or for an Organization-funded commitment you are not a Director." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});

// ── payment reschedule ───────────────────────────────────────────────────────────────────

// The book's row is payments.lifecycles.prepareScoped. The CLI orchestrates the move itself (reschedule/execute.ts:31):
// it refuses an `--on` it cannot read before any session (`scheduledOn`, :32), reads the Payment (`client.payments.get`
// or the Organization's, internal/voids.ts:30), and for a `scheduled` one first calls
// `client.approvals.prepare({ reschedule })` (:44, :50). Any answer but `WRONG_STATE` is handed over as it is. On
// `WRONG_STATE` it checks the date against the send window (`scheduleWindowRefusal`, INVALID_INPUT on `on`, :56),
// prepares `{ cancel }` (:64), follows the void (`untilVoided`), then prepares `{ reschedule }` again (:76). A Payment
// that does not read `scheduled` goes straight to that last step. One or two approvals, through the same SDK method.
export const operation_payment_reschedule = defineOperation({
  id: "payment.reschedule",
  title: "Move a scheduled payment",
  about: "Moves a scheduled payment that you signed to a new date. A budget's dated payment moves in one approval. Any other is cancelled by its void, then sent again on the new date. You approve each step in your browser.",
  was: [
    "apps/docs/factory/operations/payment.reschedule.yaml:1",
    "apps/cli/src/commands/payment/subcommands/reschedule/command.ts:6",
    "apps/cli/src/commands/payment/subcommands/reschedule/execute.ts:44",
    "apps/cli/src/commands/payment/subcommands/reschedule/execute.ts:48",
    "apps/cli/src/commands/payment/subcommands/reschedule/execute.ts:56",
    "apps/cli/src/commands/payment/subcommands/reschedule/execute.ts:64",
    "apps/cli/src/commands/payment/subcommands/reschedule/execute.ts:76",
    "apps/cli/src/commands/payment/internal/approval.ts:278",
    "packages/sdk/src/accounts/approvals.ts:106",
  ],
  area: "payments",
  command: "payment reschedule",
  priority: "normal",
  implementedBy: flow_client_approvals_prepare,
  who: "The person who scheduled the payment. With `--org`, someone who can act for that Organization's payment.",
  changes: "A budget's dated payment: you sign one approval, and your Safe calls Budgets once to cancel the old payment and schedule the same recipient and amount on the new date, so the budget keeps holding it. Any other: you sign two approvals, the void of the old payment and then the new date. Nothing moves until the new date.",
  notes: [
    "`--on` takes a day, such as `2026-11-03`, which means 00:00 UTC. It also takes an ISO time with its zone.",
    "The CLI checks the new date before it cancels anything.",
    "An AI that signs with its own key signs every approval at once.",
    "You can run it again. A payment that is already cancelled goes straight to its new date.",
    "With `--json` it returns the first approval link at once. Run the same command again after the void lands.",
  ],
  mistakes: [
    { what: "You give a date that a payment cannot be sent on", fix: "It refuses with `INVALID_INPUT` on `on`, and the payment stays as it was." },
    { what: "You let an approval expire, or rejected it on the approval page", fix: "Expiry ends with `WRONG_STATE` and a rejection with `CANCELLED`. Run the command again to pick up where it stopped." },
  ],
  acceptance: [
    /* 1 */ "When the void did not cancel the payment, it says what the payment became (cli cancel.test.ts).",
    /* 2 */ "A budget's dated payment still waiting moves in one approval, and any other refusal cancels nothing (cli cancel.test.ts).",
    /* 3 */ "A budget's reschedule is one operation: `Budgets.cancel` of the old id, then `Budgets.schedule` on the new day; landed, the old payment reads cancelled and the new one waits on its day (backend payments/commands/tests/prepare-budget.test.ts).",
    /* 4 */ "Only a reschedule's operation may cancel a dated payment in Budgets (sdk payments/tests/budget-route.test.ts).",
  ],
  returns: ApprovalHandOver,
  refusals: [
    { error: error_INVALID_INPUT, given: "?", when: "`--on` is a date the payment cannot be sent on. The payment stays as it was." },
    { error: error_WRONG_STATE, given: "?", when: "An approval expired, or the void did not cancel the payment." },
    { error: error_ROLE_PERMISSION_DENIED, given: "?", when: "You cannot act for that payment." },
    { error: error_NOT_AUTHENTICATED, given: "?", when: "You are not signed in." },
  ],
});
