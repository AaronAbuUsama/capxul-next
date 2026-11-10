// Activity's durable work: the change-log appenders that keep `activity-changes` (data.ts).
//
// Each is triggered by one transition of payments' machines, through the outbox (P4: a projection
// that may lag is a workflow in the reacting concept, and activity depends on payments, never the
// reverse). A workflow's trigger names one transition, so each followed transition has its own
// small workflow; they share one shape. Every Payment transition is followed, because each is a
// change of status a follower sees; of a Movement's, only `record`, its birth: a Movement never
// changes, and a reorg's removal shows as the row leaving the feed, not as an event (decision
// activity.followed-transitions). None waits on anything, so none has an instance or signals:
// each run is one transaction, retried until it commits, and a second delivery is a no-op.

import { budget, defineWorkflow, type TransitionRef } from "../../packages/blueprint-engine/src/index.ts";
import { concept_activity } from "../shared/foundation.ts";
import { machine_movement, machine_payment, table_payments } from "../payments/data.ts";
import { table_activity_changes } from "./data.ts";

const OLD = "packages/backend/src/activity/items";
const CLI = "apps/cli/src/commands/activity/subcommands/events/execute.ts";

const APPEND =
  "For each feed, under that feed's lock: the next `seq` and one row naming the row, the transition and the event's " +
  "commit time; `new` if the feed has no row for it yet (`by-owner-row`), else `updated`.";

const IDEMPOTENCY =
  "The outbox event's id: `by-owner-event` is unique per feed, so a redelivered transition appends nothing.";

type PaymentTransition = keyof typeof machine_payment.t;

/** One Payment transition followed into the change log of each feed that holds the Payment. */
const notePayment = (name: PaymentTransition, what: string) => {
  const transition: TransitionRef = machine_payment.t[name];
  return defineWorkflow({
    id: `activity.changes.note-payment-${name.replace(/_/g, "-")}`,
    title: `A Payment ${what}: note it in its feeds`,
    about:
      `Triggered by payments' \`${name}\` through the outbox: a Payment ${what}. It reads the Payment's row for its two ` +
      "sides and appends one change to the feed of each side Capxul holds: the owner's, and the payee's when the payee " +
      "is another Capxul party (a Payment to oneself is noted once). The first change a feed notes for a Payment is " +
      "`new` and every later one `updated`, so a reader sees it born first even when this run overtakes an earlier " +
      "transition's. The change log may lag the Payment by a second or two; the row a reader gets is read as it stands.",
    concept: concept_activity,
    priority: "normal",
    trigger: { transition },
    steps: [
      { name: "sides", about: "The Payment's owner and its payee (`payee_kind`, `payee_id`); a payee outside Capxul has no feed." },
      { name: "append", about: APPEND },
    ],
    reads: [table_payments, table_activity_changes],
    writes: [table_activity_changes],
    drives: [],
    invokes: [],
    emits: [],
    calls: [],
    chain: [],
    idempotency: IDEMPOTENCY,
    timeoutMs: 30_000,
    retries: { max: 8, backoff: "exponential" },
    budget: budget("background"),
    was: [`${OLD}/reads/changes.ts:20`, `${OLD}/rules/changes.ts:43`, "packages/backend/src/payments/reads/activity.ts:1"],
  });
};

// ── Payments ────────────────────────────────────────────────────────────────────────────────

export const workflow_activity_changes_note_payment_open = notePayment("open", "was born");
export const workflow_activity_changes_note_payment_schedule = notePayment("schedule", "was scheduled for its day");
export const workflow_activity_changes_note_payment_come_due = notePayment("come_due", "came due");
export const workflow_activity_changes_note_payment_escrow = notePayment("escrow", "went into a claim escrow");
export const workflow_activity_changes_note_payment_submit = notePayment("submit", "was sent");
export const workflow_activity_changes_note_payment_settle = notePayment("settle", "settled");
export const workflow_activity_changes_note_payment_mismatch = notePayment("mismatch", "met a PaymentSent that disagrees");
export const workflow_activity_changes_note_payment_unsettle = notePayment("unsettle", "was reopened by a reorg");
export const workflow_activity_changes_note_payment_lapse = notePayment("lapse", "lapsed and needs a retry");
export const workflow_activity_changes_note_payment_retry = notePayment("retry", "was retried");
export const workflow_activity_changes_note_payment_cancel = notePayment("cancel", "was cancelled");

// ── Movements ───────────────────────────────────────────────────────────────────────────────

export const workflow_activity_changes_note_movement_record = defineWorkflow({
  id: "activity.changes.note-movement-record",
  title: "Outside money was recorded: note the new Movement in its feed",
  about:
    "Triggered by payments' Movement `record` through the outbox: one side of an indexed Transfer that no Payment " +
    "explains was recorded for one feed. The event names that side's owner and the Transfer, so it appends one `new` " +
    "change to that feed with the Movement's id. A Movement is noted when payments records it, however late its block " +
    "was indexed, so a reader of the change log sees it once, after its cursor; the old CLI's fifteen-minute replay " +
    "window and its list of seen rows existed because the feed was read by block time.",
  concept: concept_activity,
  priority: "normal",
  trigger: { transition: machine_movement.t.record },
  steps: [{ name: "append", about: APPEND }],
  reads: [table_activity_changes],
  writes: [table_activity_changes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: IDEMPOTENCY,
  timeoutMs: 30_000,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
  was: [`${CLI}:23`, `${CLI}:131`, "packages/backend/src/payments/movements/reads/activity.ts:1"],
});
