// The as-is book of the old payments concept: the movements, notices and records areas.
//
// Every operation registered at `payments/movements:*`, `payments/notices:*` and
// `payments/records:*` (packages/backend/convex/payments/{movements,notices,records}.ts), as the old
// code does it. `payments/events/` registers no function of its own: its delivery step runs as
// `payments.records.emitTransition`, booked here.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_payments } from "./foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  event_payment_transitioned,
  event_payment_verification_retry,
} from "./vocabulary.ts";
import {
  machine_movement,
  machine_payment_schedule,
  table_money_executions,
  table_movements,
  table_payment_commands,
  table_payment_schedules,
  table_payments,
  table_provider_send_attempts,
} from "./data.ts";
import {
  procedure_access_authenticated_user,
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_books_book_asset_by_id_in_tx,
  procedure_documents_current_payment_documents,
  procedure_documents_load_payment_documents,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_require_org_participant,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  table_accounts,
  table_counterparty_destinations,
  table_identities,
  table_orgs,
} from "./neighbors.ts";
import { integration_mail } from "./external.ts";

const BACKEND = "packages/backend";
const SRC = `${BACKEND}/src/payments`;
const PROTOCOL = "packages/protocol/src/payments";

/** Every public records row: no session, input that does not decode, or a defect. */
const CALL_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

/** What the wire Payment projection (`toWirePayment`) reads, besides the Payment row itself. */
const PROJECTION_READS = [
  table_payments,
  table_payment_schedules,
  table_payment_commands,
  table_money_executions,
  table_provider_send_attempts,
  table_accounts,
  table_identities,
  table_orgs,
  table_counterparty_destinations,
];

/** The neighbours' readers the wire Payment projection calls inside the query. */
const PROJECTION_INVOKES = [
  procedure_documents_load_payment_documents,
  procedure_documents_current_payment_documents,
  procedure_books_book_asset_by_id_in_tx,
  procedure_banking_read_payout_delivery_in_tx,
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
];

const PROJECTION_WAS = [
  `${SRC}/reads/payments.ts:135`,
  `${SRC}/reads/payments.ts:163`,
  `${SRC}/views/payments.ts:198`,
  `${SRC}/views/payments.ts:149`,
  `${SRC}/views/payments.ts:238`,
  `${SRC}/views/payments.ts:255`,
  `${SRC}/views/recipients.ts:74`,
  `${SRC}/views/recipients.ts:79`,
  `${SRC}/views/recipients.ts:87`,
  `${SRC}/views/recipients.ts:108`,
  `${SRC}/views/recipients.ts:52`,
  `${SRC}/views/recipients.ts:83`,
  `${SRC}/executions/views/executions.ts:51`,
  `${SRC}/executions/views/executions.ts:83`,
  `${SRC}/executions/views/executions.ts:99`,
  `${SRC}/reads/participants.ts:8`,
  `${SRC}/schedules/views.ts:40`,
  `${SRC}/schedules/reads.ts:28`,
  `${SRC}/records/views.ts:13`,
];

/** The wire Payment (`Payment` in payment-schema.ts) is too deep to transcribe here. */
const WirePayment = Schema.Unknown;
const Page = Schema.Struct({ items: Schema.Array(WirePayment), nextCursor: Schema.NullOr(Schema.String) });
/** `PaymentIdSchema` (value-schema.ts:13) and the rows' `OrgId` (operations.ts:42) are non-empty strings. */
const PaymentId = Schema.NonEmptyString;
const OrgId = Schema.NonEmptyString;

// ── movements ──────────────────────────────────────────────────────────────────────────────

const InclusionBatch = Schema.Struct({ migrated: Schema.Number, complete: Schema.Boolean });

export const rpc_payments_movements_migrate_inclusion = defineRpc({
  id: "payments.movements.migrate-inclusion",
  title: "Rewrite one batch of finalized Movements to included",
  about:
    "Registered as the internal mutation `payments/movements:migrateInclusion`. Takes up to 100 `movements` rows whose " +
    "`canonicalState` is `finalized` (index `by_canonical_state`, reading 101 to know whether more remain) and patches " +
    "each to `included`, keeping chain facts and timestamps. Answers how many it rewrote and whether none are left. " +
    "Nothing schedules it: an operator runs `scripts/migrate-movement-inclusion.ts`, which calls it through " +
    "`npx convex run` until it answers `complete`, and fails if a batch makes no progress. Failures are defects: " +
    "`attempt([])` admits no code.",
  was: [
    `${BACKEND}/convex/payments/movements.ts:3`,
    `${SRC}/movements/operations/migrate-inclusion.ts:11`,
    `${SRC}/movements/writes/inclusions.ts:7`,
    `${SRC}/movements/writes/inclusions.ts:9`,
    `${SRC}/movements/writes/inclusions.ts:26`,
    `${BACKEND}/src/payments/tables/movements.ts:23`,
    `${BACKEND}/scripts/migrate-movement-inclusion.ts:24`,
    `${BACKEND}/docs/contracts/activity.md:28`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: an operator, through `scripts/migrate-movement-inclusion.ts` (`npx convex run`), repeated until `complete`.",
  input: Schema.Struct({}),
  output: InclusionBatch,
  errors: [error_UNKNOWN],
  reads: [table_movements],
  writes: [table_movements],
  drives: [machine_movement.t.to_included],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_movements_rollback_inclusion = defineRpc({
  id: "payments.movements.rollback-inclusion",
  title: "Roll one batch of included Movements back to finalized",
  about:
    "Registered as the internal mutation `payments/movements:rollbackInclusion`. The inverse of migrate-inclusion, for " +
    "rolling back to a source that does not accept `included`: takes up to 100 `movements` rows whose `canonicalState` " +
    "is `included` and patches each to `finalized`. It does not tell a migrated row from one the Movement writers " +
    "stored as `included`: every `included` row is rolled back. An operator runs it through " +
    "`scripts/migrate-movement-inclusion.ts --rollback` until it answers `complete`.",
  was: [
    `${BACKEND}/convex/payments/movements.ts:4`,
    `${SRC}/movements/operations/rollback-inclusion.ts:11`,
    `${SRC}/movements/writes/inclusions.ts:29`,
    `${BACKEND}/scripts/migrate-movement-inclusion.ts:35`,
    `${BACKEND}/docs/contracts/activity.md:31`,
  ],
  concept: concept_payments,
  kind: "mutation",
  who: "internal: an operator, through `scripts/migrate-movement-inclusion.ts --rollback` (`npx convex run`), repeated until `complete`.",
  input: Schema.Struct({}),
  output: InclusionBatch,
  errors: [error_UNKNOWN],
  reads: [table_movements],
  writes: [table_movements],
  drives: [machine_movement.t.to_finalized],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── notices ────────────────────────────────────────────────────────────────────────────────

const NoticeEvent = Schema.Literals(["scheduled", "sent", "cancelled", "failed", "short"]);

const ScheduleNoticeFacts = Schema.Struct({
  state: Schema.Literals(["waiting", "sent", "failed", "cancelled"]),
  sendsAt: Schema.Number,
  failedReason: Schema.NullOr(Schema.Literals(["window_passed", "not_member", "approvals_lost"])),
  shortfall: Schema.NullOr(Schema.Literals(["budget_exhausted", "balance_too_low", "fees_too_high", "send_refused"])),
  payerName: Schema.String,
  payerEmail: Schema.NullOr(Schema.String),
  payments: Schema.Array(
    Schema.Struct({
      paymentId: Schema.String,
      payeeName: Schema.String,
      payeeEmail: Schema.NullOr(Schema.String),
      amount: Schema.String,
      decimals: Schema.Number,
      assetSymbol: Schema.String,
    }),
  ),
});

export const rpc_payments_notices_notice_facts = defineRpc({
  id: "payments.notices.notice-facts",
  title: "Read what a scheduled command's notices are built from",
  about:
    "Registered as the internal query `payments/notices:noticeFacts`. For one command: its latest `paymentSchedules` " +
    "row (index `by_command`), its `paymentCommands` row and every Payment it names (a missing one is a stored-row " +
    "defect), and the `moneyExecutions` row whose `executionId` is the schedule's. The payer's mailbox is the Party " +
    "at the execution's `userOpSenderSafe`, null when no execution carries that id (a Board's schedule stores its " +
    "command id as `executionId`); the payer's name comes from the command's first Payment only: its Organization's " +
    "name, else the Party at its `paymentSenderSafe`, else `Your payer`. Each payee is the Party at the Payment's " +
    "`recipientSafeAddress`, else its payout label, else `your payee`. Null when the command has no schedule, no " +
    "command row or no Payment. Only the notify workflow calls it, through `ctx.runQuery`.",
  was: [
    `${BACKEND}/convex/payments/notices.ts:6`,
    `${SRC}/notices/operations/notice-facts.ts:12`,
    `${SRC}/notices/reads.ts:21`,
    `${SRC}/notices/reads.ts:32`,
    `${SRC}/notices/reads.ts:36`,
    `${SRC}/notices/reads.ts:38`,
    `${SRC}/notices/reads.ts:42`,
    `${SRC}/notices/reads.ts:46`,
    `${SRC}/notices/reads.ts:52`,
    `${SRC}/notices/reads.ts:84`,
    `${SRC}/notices/reads.ts:49`,
    `${SRC}/notices/reads.ts:58`,
    `${SRC}/notices/rules.ts:29`,
    `${SRC}/schedules/reads.ts:28`,
    `${SRC}/schedules/writes.ts:230`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: the `payments.notices.notify` workflow, through `ctx.runQuery`.",
  input: Schema.Struct({ commandId: Schema.String }),
  output: Schema.NullOr(ScheduleNoticeFacts),
  errors: [error_UNKNOWN],
  reads: [table_payment_schedules, table_payment_commands, table_payments, table_money_executions],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_safe_address, procedure_organizations_read_organization_name_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const workflow_payments_notices_notify = defineWorkflow({
  id: "payments.notices.notify",
  title: "Email the payee and payer about one step of a scheduled payment",
  about:
    "Registered as the internal action `payments/notices:notify` (ADR-0034, ruling 6A); the entry loads Resend. Args: " +
    "`commandId`, `event`, `attempt`, and on a retry `paymentId` and `only`. `scheduleNoticeInTx` schedules it with " +
    "`runAfter(0)` inside the same mutation as the schedule step it announces, with attempt 0: `scheduled` when a " +
    "schedule is stored (a signed one, a Board's, or a budget's), `short` when the day-ahead check finds a shortfall " +
    "(no state change), `sent` and `failed` when the due job moves the schedule, and `cancelled` when Budgets' " +
    "reservation is cancelled (a Board cancel, the due job reading it cancelled on chain, or a reschedule) or a landed " +
    "void ends it. The trigger names only `to_sent`; the other steps schedule it the same way. Per Payment of the " +
    "command it plans the emails (payee: scheduled, sent, cancelled, failed; payer: failed, short) only while the schedule's state is still the one the event put it in, and hands " +
    "them to the mail owner, so the payer gets one `failed` or `short` email per Payment of a batch. A failed send " +
    "never stops or repeats the step. A facts read or a send that throws (Resend not loaded) ends the run as a " +
    "defect, with no retry. Recipients the provider did not take are retried by the action scheduling itself again, for that Payment and those recipients only. Each recipient's " +
    "outcome is written through `operator.notices.record` (operator's own mutation), and on a local devnet each " +
    "message goes to `operator.outboxes.record` instead of Resend. Returns `{ sent, failed }` counts. Child spans: " +
    "`convex.query` (notice facts) and `convex.mutation` (delivery records, the Resend component). Timeout is " +
    "Convex's action limit; the code sets none.",
  was: [
    `${BACKEND}/convex/payments/notices.ts:4`,
    `${BACKEND}/convex/payments/notices.ts:7`,
    `${SRC}/notices/operations/notify.ts:21`,
    `${SRC}/notices/writes.ts:19`,
    `${SRC}/notices/writes.ts:24`,
    `${SRC}/schedules/writes.ts:84`,
    `${SRC}/schedules/writes.ts:148`,
    `${SRC}/schedules/writes.ts:172`,
    `${SRC}/schedules/writes.ts:187`,
    `${SRC}/schedules/writes.ts:252`,
    `${SRC}/schedules/writes/board-cancels.ts:32`,
    `${SRC}/schedules/writes/board-cancels.ts:66`,
    `${SRC}/schedules/writes.ts:178`,
    `${SRC}/schedules/operations/board.ts:155`,
    `${SRC}/verifications/writes/budget-schedules.ts:106`,
    `${SRC}/verifications/writes/voids.ts:97`,
    `${SRC}/notices/operations/notify.ts:44`,
    `${SRC}/notices/rules.ts:49`,
    `${SRC}/notices/rules.ts:57`,
    `${SRC}/notices/external.ts:29`,
    `${SRC}/notices/external.ts:35`,
    `${SRC}/notices/reads.ts:87`,
    `${BACKEND}/src/integrations/mail/notices.ts:17`,
    `${BACKEND}/src/integrations/mail/notices.ts:20`,
    `${BACKEND}/src/integrations/mail/notices.ts:41`,
    `${BACKEND}/src/integrations/mail/notices.ts:132`,
    `${BACKEND}/src/integrations/mail/service.ts:147`,
    `${BACKEND}/src/integrations/mail/service.ts:149`,
  ],
  concept: concept_payments,
  priority: "normal",
  trigger: { transition: machine_payment_schedule.t.to_sent },
  steps: [
    { name: "attribute", about: "Records the run as the system job `scheduled_payment_notices`." },
    {
      name: "facts",
      about: "Runs `payments.notices.notice-facts` for the command; null ends the run with `{ sent: 0, failed: 0 }`.",
    },
    { name: "select", about: "On a retry (`paymentId` set) keeps only that Payment; otherwise every Payment of the command." },
    {
      name: "plan",
      about:
        "`scheduleNotices`: nothing unless the schedule's state is still the event's (scheduled and short: waiting); else the payee's and payer's templates.",
    },
    {
      name: "deliver",
      about:
        "`deliverNotices` per Payment under notice key `payments.notices.notify:<commandId>:<paymentId>:<event>`, to the `only` recipients on a retry; each outcome goes to `operator.notices.record`.",
    },
    {
      name: "retry",
      about:
        "Recipients not taken while fewer than 3 attempts were made: schedules itself again by business delay (1 min, then 4 min) with attempt + 1 and `only` set.",
    },
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency:
    "None stops a resend: the notice key only names the delivery record. A schedule that has moved past the event sends nothing, and a retry sends only to `only`.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});

// ── records ────────────────────────────────────────────────────────────────────────────────

export const rpc_payments_records_emit_transition = defineRpc({
  id: "payments.records.emit-transition",
  title: "Deliver one Payment lifecycle event after its write commits",
  about:
    "Telemetry plumbing: registered as the internal action `payments/records:emitTransition`; its handler is " +
    "`writerEventDelivered` in `payments/events/deliveries.ts`. The payment writer (`scheduleWriterTelemetry` in " +
    "`payments/events/writer.ts`) schedules one run per Payment through `scheduleTelemetryEmit` (`runAfter(0)`) from " +
    "the mutation that changed it, after claiming the Payment's `lifecycleSequence` and, for a terminal step, its " +
    "`terminalOutcome`/`terminalEventId` in that mutation; a scheduling failure is only logged as dropped. The run " +
    "attributes the event to the command's person (`authUserId`) or to the system job `payment_writer`, marks the " +
    "scheduled `organizationId` as the verified Organization without reading anything (the writer took it from the " +
    "command), and posts `payment_transitioned` (`progressed`, `settled` or `failed`) or " +
    "`payment_verification_retry` to PostHog, awaited with a 1 s timeout, continuing the caller's trace; a failed " +
    "post is reported, never thrown. Jobs scheduled before CAP-1251 " +
    "(`payment_settled`, `payment_failed`, `payment_lifecycle_transition`) deliver as `payment_transitioned`. A record " +
    "missing a fact its event needs is reported as dropped (`[CAPXUL_TELEMETRY_DROPPED]`) and delivers nothing. It " +
    "reads and writes no table. A per-command `payment_verification_retry` goes through the same writer, so it is " +
    "delivered once per Payment of the command and bumps each one's `lifecycleSequence`. The PostHog post has no " +
    "integration record in this book. `internalOperation` also " +
    "accepts `parentActor`, `scheduledForMs` and `businessDueMs`.",
  was: [
    `${BACKEND}/convex/payments/records.ts:3`,
    `${SRC}/records/operations/emit-transition.ts:8`,
    `${SRC}/events/deliveries.ts:23`,
    `${SRC}/events/deliveries.ts:110`,
    `${SRC}/events/deliveries.ts:162`,
    `${SRC}/events/deliveries.ts:206`,
    `${SRC}/events/deliveries.ts:216`,
    `${SRC}/events/deliveries.ts:234`,
    `${SRC}/events/writer.ts:24`,
    `${SRC}/events/writer.ts:72`,
    `${SRC}/events/writer.ts:187`,
    `${SRC}/events/writer.ts:224`,
    `${SRC}/events/writer.ts:166`,
    `${SRC}/verifications/events.ts:28`,
    `${BACKEND}/src/platform/telemetry.ts:133`,
    `${BACKEND}/src/platform/observation/telemetry.ts:40`,
    `${BACKEND}/src/platform/observation/telemetry.ts:52`,
    `${BACKEND}/src/platform/observation/telemetry.ts:95`,
    `${BACKEND}/src/platform/observation/telemetry.ts:115`,
  ],
  concept: concept_payments,
  kind: "action",
  who: "internal: scheduled by the payment writer (`scheduleWriterTelemetry`) from the mutation whose write the event reports.",
  input: Schema.Struct({
    recipientProps: Schema.optionalKey(Schema.Unknown),
    recipientKind: Schema.optionalKey(Schema.Literals(["capxul", "wallet", "bank"])),
    rail: Schema.optionalKey(Schema.Literals(["direct", "bridge"])),
    recipientOnCapxul: Schema.optionalKey(Schema.Boolean),
    partyAccountId: Schema.optionalKey(Schema.String),
    quoteId: Schema.optionalKey(Schema.String),
    railOperationId: Schema.optionalKey(Schema.String),
    event: Schema.Literals([
      "payment_transitioned",
      "payment_verification_retry",
      "payment_settled",
      "payment_failed",
      "payment_lifecycle_transition",
    ]),
    transition: Schema.optionalKey(Schema.Literals(["progressed", "settled", "failed"])),
    paymentId: Schema.optionalKey(Schema.String),
    paymentIds: Schema.optionalKey(Schema.Array(Schema.String)),
    purposeKind: Schema.optionalKey(Schema.String),
    settlementId: Schema.optionalKey(Schema.String),
    reasonCode: Schema.optionalKey(Schema.String),
    commandId: Schema.optionalKey(Schema.String),
    paymentLifecycleId: Schema.optionalKey(Schema.String),
    executionId: Schema.optionalKey(Schema.String),
    userOpHash: Schema.optionalKey(Schema.String),
    paymentOutcome: Schema.optionalKey(Schema.String),
    terminalEventId: Schema.optionalKey(Schema.String),
    executionState: Schema.optionalKey(Schema.String),
    sponsorshipValidUntil: Schema.optionalKey(Schema.Number),
    occurredAt: Schema.optionalKey(Schema.Number),
    causalSequence: Schema.optionalKey(Schema.Number),
    authUserId: Schema.optionalKey(Schema.String),
    organizationId: Schema.optionalKey(Schema.String),
    observationContext: Schema.optionalKey(Schema.Unknown),
    attempt: Schema.optionalKey(Schema.Number),
    delayMs: Schema.optionalKey(Schema.Number),
    outcome: Schema.optionalKey(Schema.Literals(["scheduled", "unresolved"])),
    causeProps: Schema.optionalKey(Schema.Unknown),
    chainId: Schema.Number,
    txHash: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_payment_transitioned, event_payment_verification_retry],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_load_purpose_kinds = defineRpc({
  id: "payments.records.load-purpose-kinds",
  title: "Read each prepared Payment's purpose kind",
  about:
    "Registered as the internal query `payments/records:loadPurposeKinds`, for the `payment_failed` event a failed " +
    "send emits (#1685). Reads each Payment by `paymentId`; a missing one is left out, and one with no recorded " +
    "`purposeKind` reports `unknown`. No caller in the old backend, SDK or CLI runs it: the reference to it appears " +
    "only in its registration and the operation catalog.",
  was: [
    `${BACKEND}/convex/payments/records.ts:8`,
    `${SRC}/records/operations/load-purpose-kinds.ts:16`,
    `${SRC}/records/reads.ts:55`,
    `${SRC}/reads/payments.ts:33`,
    "packages/observability/src/operations/payments.ts:96",
  ],
  concept: concept_payments,
  kind: "query",
  who: "internal: no caller found.",
  input: Schema.Struct({ paymentIds: Schema.Array(Schema.String) }),
  output: Schema.Array(Schema.Struct({ paymentId: Schema.String, purposeKind: Schema.String })),
  errors: [error_UNKNOWN],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_list = defineRpc({
  id: "payments.records.list",
  title: "List the Payments the caller's Account sent or received",
  about:
    "Implements protocol row `payments.records.list`. Signed in; the caller's Account on Base Sepolia is required " +
    "(none yet is refused as `INVALID_INPUT`, not an empty page). Collects every Payment whose actor or recipient " +
    "actor is the Account (indexes `by_actor_created`, `by_recipient_actor_created`), de-duplicates, sorts newest " +
    "first and projects each to the wire Payment with its documents. Both index reads are whole (`collect`), and one " +
    "Payment whose projection throws fails the whole list: a missing counterparty as `INVALID_INPUT` on `paymentId` " +
    "(`attempt([])` makes it a defect, but its code still crosses), a broken stored row as `UNKNOWN`. One page " +
    "holding everything: `nextCursor` is always null. A projection the wire Payment does not admit is an `UNKNOWN` invariant failure. The output's " +
    "`Payment` items are left as `Schema.Unknown` (payment-schema.ts).",
  was: [
    `${PROTOCOL}/operations.ts:109`,
    `${BACKEND}/convex/payments/records.ts:7`,
    `${SRC}/records/operations/list.ts:12`,
    `${SRC}/records/guards.ts:17`,
    `${SRC}/records/reads.ts:20`,
    `${SRC}/reads/payments.ts:173`,
    `${SRC}/views/recipients.ts:24`,
    `${BACKEND}/src/platform/execute.ts:120`,
    `${BACKEND}/src/platform/observation/evidence.ts:27`,
    `${BACKEND}/src/platform/page.ts:11`,
    ...PROJECTION_WAS,
  ],
  concept: concept_payments,
  kind: "query",
  who: "A signed-in person with an Account on this chain; sees only Payments that Account sent or received.",
  input: Schema.Struct({}),
  output: Page,
  errors: CALL_ERRORS,
  reads: PROJECTION_READS,
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_accounts_account_id_for_auth_user_or_null, ...PROJECTION_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_get = defineRpc({
  id: "payments.records.get",
  title: "Read one Payment the caller's Account sent or received",
  about:
    "Implements protocol row `payments.records.get`. Signed in; the caller's Account is required. Reads the Payment " +
    "by `paymentId` and answers null unless the Account is its actor or recipient actor; a missing row and one the " +
    "Account is not party to give the same null, and telemetry names `payment_id` only for a row it returns. " +
    "Reads the row again to project it to the wire Payment with its documents; a projection that throws fails the " +
    "read as in `list` (a missing counterparty crosses as `INVALID_INPUT`). The SDK subscribes to it " +
    "(`client.payments.subscribe`) as well as reading it once. The output's `Payment` is `Schema.Unknown` (payment-schema.ts).",
  was: [
    `${PROTOCOL}/operations.ts:116`,
    `${BACKEND}/convex/payments/records.ts:5`,
    `${SRC}/records/operations/get.ts:11`,
    `${SRC}/records/guards.ts:17`,
    `${SRC}/records/reads.ts:31`,
    `${SRC}/records/reads.ts:39`,
    `${SRC}/reads/payments.ts:126`,
    `${SRC}/reads/payments.ts:139`,
    "packages/sdk/src/payments/subscription.ts:43",
    ...PROJECTION_WAS,
  ],
  concept: concept_payments,
  kind: "live",
  who: "A signed-in person with an Account on this chain; null for any Payment that Account did not send or receive.",
  input: Schema.Struct({ paymentId: PaymentId }),
  output: Schema.NullOr(WirePayment),
  errors: CALL_ERRORS,
  reads: PROJECTION_READS,
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_accounts_account_id_for_auth_user_or_null, ...PROJECTION_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_list_for_organization = defineRpc({
  id: "payments.records.list-for-organization",
  title: "List the Payments an Organization sent or received",
  about:
    "Implements protocol row `payments.records.listForOrganization`. Signed in, and a current participant of the " +
    "Organization (`requireOrgParticipant`; a missing Organization or a non-participant is `ROLE_PERMISSION_DENIED`), " +
    "after which telemetry may name the Organization. Collects every Payment whose actor or recipient actor is the " +
    "Organization, newest first, each projected to the wire Payment as the Organization sees it. One page holding " +
    "everything (`nextCursor` null), with the authorized `orgId` echoed. Items are `Schema.Unknown` (payment-schema.ts).",
  was: [
    `${PROTOCOL}/operations.ts:123`,
    `${BACKEND}/convex/payments/records.ts:6`,
    `${SRC}/records/operations/list-for-organization.ts:12`,
    `${SRC}/records/guards.ts:27`,
    `${SRC}/records/reads.ts:20`,
    `${BACKEND}/src/organizations/reads/participation.ts:85`,
    ...PROJECTION_WAS,
  ],
  concept: concept_payments,
  kind: "query",
  who: "A signed-in current participant of the Organization.",
  input: Schema.Struct({ orgId: OrgId }),
  output: Schema.Struct({ orgId: OrgId, items: Schema.Array(WirePayment), nextCursor: Schema.NullOr(Schema.String) }),
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: PROJECTION_READS,
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_organizations_require_org_participant, ...PROJECTION_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_get_for_organization = defineRpc({
  id: "payments.records.get-for-organization",
  title: "Read one of an Organization's Payments",
  about:
    "Implements protocol row `payments.records.getForOrganization`. Signed in and a current participant of the " +
    "Organization. Reads the Payment by `paymentId`; null unless the Organization is its actor or recipient actor, " +
    "and telemetry names `payment_id` only for a returned row. Answers `{ orgId, payment }`, the payment projected to " +
    "the wire Payment as the Organization sees it. The SDK subscribes to it (Organization payment subscriptions) and " +
    "checks the echoed `orgId`. `payment` is `Schema.Unknown` (payment-schema.ts).",
  was: [
    `${PROTOCOL}/operations.ts:130`,
    `${BACKEND}/convex/payments/records.ts:4`,
    `${SRC}/records/operations/get-for-organization.ts:11`,
    `${SRC}/records/guards.ts:27`,
    `${SRC}/records/reads.ts:31`,
    `${SRC}/reads/payments.ts:126`,
    "packages/sdk/src/payments/subscription.ts:73",
    ...PROJECTION_WAS,
  ],
  concept: concept_payments,
  kind: "live",
  who: "A signed-in current participant of the Organization; null for any Payment the Organization did not send or receive.",
  input: Schema.Struct({ orgId: OrgId, paymentId: PaymentId }),
  output: Schema.Struct({ orgId: OrgId, payment: Schema.NullOr(WirePayment) }),
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: PROJECTION_READS,
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_organizations_require_org_participant, ...PROJECTION_INVOKES],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payments_records_payout_stage = defineRpc({
  id: "payments.records.payout-stage",
  title: "Read how far one bank payout got",
  about:
    "Implements protocol row `payments.records.payoutStage` (CAP-741), the stage `capxul bank pay` reports, read " +
    "apart from the Payment because the Payment wire keeps only keys published clients decode strictly. `actor` " +
    "picks the scope: `org` requires a current participant of that Organization, `account` the caller's Account. " +
    "Null unless the viewer is party to the Payment, it carries a `railOperationId`, and Banking has a stored payout " +
    "delivery for it; otherwise `{ paymentId, stage, reason? }` from Banking's delivery. Telemetry names the " +
    "Payment only when a stage is returned.",
  was: [
    `${PROTOCOL}/operations.ts:142`,
    `${PROTOCOL}/payout-schema.ts:79`,
    `${PROTOCOL}/payout-schema.ts:89`,
    `${BACKEND}/convex/payments/records.ts:9`,
    `${SRC}/records/operations/payout-stage.ts:14`,
    `${SRC}/records/guards.ts:17`,
    `${SRC}/records/guards.ts:27`,
    `${SRC}/records/reads.ts:46`,
    `${SRC}/reads/payouts.ts:57`,
    `${SRC}/reads/payouts.ts:63`,
  ],
  concept: concept_payments,
  kind: "query",
  who: "A signed-in person for their own Account's Payment, or a current participant of the Organization named in `actor`.",
  input: Schema.Struct({
    actor: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("account") }),
      Schema.Struct({ kind: Schema.Literal("org"), orgId: Schema.String }),
    ]),
    paymentId: PaymentId,
  }),
  output: Schema.NullOr(
    Schema.Struct({ paymentId: PaymentId, stage: Schema.String, reason: Schema.optionalKey(Schema.String) }),
  ),
  errors: [...CALL_ERRORS, error_ROLE_PERMISSION_DENIED],
  reads: [table_payments],
  writes: [],
  drives: [],
  invokes: [
    procedure_access_authenticated_user,
    procedure_accounts_account_id_for_auth_user_or_null,
    procedure_organizations_require_org_participant,
    procedure_banking_read_payout_delivery_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
