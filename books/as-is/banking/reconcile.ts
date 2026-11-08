// The as-is book of the old banking concept: the reconcile area (Bridge catch-up).
//
// Every operation registered at `banking/reconcile:*` (packages/backend/convex/banking/reconcile.ts),
// as the old code does it. `catchUp` is the minute cron job "recover Bridge events"
// (packages/backend/src/platform/jobs.ts:59), so it is a workflow; the five others are the internal
// queries and mutations it runs. Touches of an rpc are its own transaction's; the workflow lists
// what every rpc it runs touches, the deposits area's `reconcile` included.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { event_banking_reconcile_completed } from "../shared/vocabulary.ts";
import { integration_bridge } from "../shared/external.ts";
import { table_rail_deposits, table_rail_events, table_rail_sync_state } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/banking/reconcile.ts`;
const B = `${BACKEND}/src/banking`;
const R = `${B}/reconcile`;

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** `catchUpEnvelope` (banking/model.ts:76): the inbox envelope and when Bridge created the event. */
const CatchUpEvent = Schema.Struct({
  eventId: S,
  sequence: N,
  category: S,
  type: S,
  objectRef: S,
  payloadEnc: S,
  createdAt: S,
});

const none = { drives: [], invokes: [], emits: [], calls: [], chain: [], spans: [] } as const;

export const rpc_banking_reconcile_cursor = defineRpc({
  id: "banking.reconcile.cursor",
  title: "Read the Bridge catch-up cursor",
  about: "Registered as the internal query `banking/reconcile:cursor`: the stored cursor (the last Bridge event id read), or null before the first page.",
  was: [`${CONVEX}:2`, `${R}/operations/cursor.ts:5`, `${R}/reads.ts:5`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the catch-up run (`banking.reconcile.catch-up`).",
  input: Schema.Struct({}),
  output: Schema.NullOr(S),
  errors: [],
  reads: [table_rail_sync_state],
  writes: [],
  ...none,
});

export const rpc_banking_reconcile_lease = defineRpc({
  id: "banking.reconcile.lease",
  title: "Take the catch-up lease",
  about:
    "Registered as the internal mutation `banking/reconcile:lease` (`claimLease`). False when another run holds a live " +
    "lease that is not the one handed to this continuation. Otherwise it writes this run's lease for ten minutes (as long " +
    "as Convex lets an action run), inserting the rail's row if there is none. On a DevNet (`local`) with no cursor and no " +
    "start yet it also records `readsFrom`, the wall time now (CAP-818); only then does it write a wide event of its own.",
  was: [`${CONVEX}:5`, `${R}/operations/lease.ts:6`, `${R}/writes.ts:43`, `${R}/writes.ts:20`, `${R}/rules.ts:12`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the catch-up run, with the lease its parent handed it when it is a continuation.",
  input: Schema.Struct({ leaseId: S, handoff: opt(S) }),
  output: Schema.Boolean,
  errors: [],
  reads: [table_rail_sync_state],
  writes: [table_rail_sync_state],
  ...none,
});

export const rpc_banking_reconcile_release = defineRpc({
  id: "banking.reconcile.release",
  title: "Give the catch-up lease back",
  about:
    "Registered as the internal mutation `banking/reconcile:release` (`releaseLease`): clears the lease only when this run " +
    "still holds it; a lease another run holds is left. Writes no wide event of its own.",
  was: [`${CONVEX}:6`, `${R}/operations/release.ts:6`, `${R}/writes.ts:79`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the catch-up run, unless a continuation took the lease over.",
  input: Schema.Struct({ leaseId: S }),
  output: Schema.Null,
  errors: [],
  reads: [table_rail_sync_state],
  writes: [table_rail_sync_state],
  ...none,
});

export const rpc_banking_reconcile_recover = defineRpc({
  id: "banking.reconcile.recover",
  title: "Reschedule lost or due inbox rows",
  about:
    "Registered as the internal mutation `banking/reconcile:recover` (`recoverPending`), attributed to `bridge_reconcile`. " +
    "One page of 20: first unprocessed, unparked rows never tried and created more than two minutes ago (their process run " +
    "was lost), then, if room is left, rows whose back-off is due. It holds each for one run (`holdForRun`: a new " +
    "`runId` and `nextAttemptAt` ten minutes on) and schedules `banking.webhooks.process` with that `runId`. A refused " +
    "row is processed and a parked row never selected. Returns the count; a tick with none is a no-op.",
  was: [`${CONVEX}:4`, `${R}/operations/recover.ts:7`, `${R}/writes.ts:172`, `${R}/writes.ts:156`, `${B}/rules.ts:42`, `${R}/README.md:5`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the catch-up run, first in every tick.",
  input: Schema.Struct({}),
  output: N,
  errors: [],
  reads: [table_rail_events],
  writes: [table_rail_events],
  ...none,
});

export const rpc_banking_reconcile_advance = defineRpc({
  id: "banking.reconcile.advance",
  title: "Insert one Bridge event page and move the cursor",
  about:
    "Registered as the internal mutation `banking/reconcile:advance` (`advanceCursor`). Inserts each event of the page " +
    "through the inbox guard (`insertEvent`, source `catch_up`, which schedules its process run); on a DevNet an event " +
    "Bridge created before `readsFrom` is skipped and counted. Then, only when the stored cursor still equals " +
    "`previous`, moves it to the page's last event (a late page cannot move it back); with more pages it renews the " +
    "lease this run holds and schedules the catch-up continuation with it. Returns `{ moved, inserted, readsFrom?, " +
    "skipped? }`; its wide event carries `page_events`, `inserted`, `reads_from` and `skipped_before_start`.",
  was: [`${CONVEX}:3`, `${R}/operations/advance.ts:7`, `${R}/writes.ts:101`, `${R}/writes.ts:128`, `${R}/writes.ts:144`, `${R}/rules.ts:20`, `${B}/webhooks/writes.ts:23`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the catch-up run, once per page read.",
  input: Schema.Struct({
    previous: Schema.NullOr(S),
    cursor: S,
    hasMore: Schema.Boolean,
    events: Schema.Array(CatchUpEvent),
    leaseId: opt(S),
  }),
  output: Schema.Struct({ moved: Schema.Boolean, inserted: N, readsFrom: opt(N), skipped: opt(N) }),
  errors: [],
  reads: [table_rail_sync_state, table_rail_events],
  writes: [table_rail_sync_state, table_rail_events],
  ...none,
});

export const workflow_banking_reconcile_catch_up = defineWorkflow({
  id: "banking.reconcile.catch-up",
  title: "Catch up on Bridge webhook events, once a minute",
  about:
    "Registered as the internal action `banking/reconcile:catchUp`, the cron job `recover Bridge events`, every minute " +
    "(`crons.interval`, not clock-aligned, registered unconditionally); a devnet's `capxul dev jobs run` runs it once. " +
    "Attributed to `bridge_reconcile`. One run at a time: it takes the lease (a continuation takes over its parent's); a " +
    "run that finds another's live lease records `catch_up: skipped_overlap` and returns. It runs the recovery scan, then " +
    "the page read even when the scan failed: the deposit credit reconcile (`banking.deposits.reconcile`), the cursor, " +
    "one page of up to 100 events from Bridge's event list after the cursor (`listWebhookEvents`), each encrypted as the " +
    "webhook does; the Bridge door decodes the whole page, so one entry Capxul cannot use fails the page as " +
    "PROVIDER_RESPONSE_INVALID before any insert. `advance` inserts the page and moves the cursor; a full page hands the " +
    "lease to a continuation scheduled at once. A page with events or a delivered deposit queues " +
    "`banking_reconcile_completed`. It releases the lease unless handed off, then fails with every failed step's cause " +
    "combined. A tick that recovered nothing and read an idle page is a no-op. Timeout is Convex's action limit; the " +
    "code sets none.",
  was: [
    `${CONVEX}:1`,
    `${BACKEND}/src/platform/jobs.ts:59`,
    `${R}/operations/catch-up.ts:78`,
    `${R}/operations/catch-up.ts:93`,
    `${R}/operations/catch-up.ts:99`,
    `${R}/operations/catch-up.ts:103`,
    `${R}/operations/catch-up.ts:21`,
    `${R}/operations/catch-up.ts:24`,
    `${R}/operations/catch-up.ts:28`,
    `${R}/operations/catch-up.ts:31`,
    `${R}/operations/catch-up.ts:44`,
    `${R}/operations/catch-up.ts:66`,
    `${R}/operations/catch-up.ts:107`,
    `${R}/operations/catch-up.ts:117`,
    `${R}/external.ts:4`,
    `${R}/events.ts:6`,
    `${BACKEND}/src/integrations/bridge/service.ts:183`,
    `${R}/README.md:3`,
  ],
  concept: concept_banking,
  priority: "critical",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job `bridge_reconcile` with a correlation id." },
    { name: "lease", about: "Runs `banking.reconcile.lease`; refused: `catch_up: skipped_overlap`, and the run returns." },
    { name: "recover", about: "Runs `banking.reconcile.recover`; its failure is kept and does not stop the read." },
    { name: "credit", about: "Runs `banking.deposits.reconcile`: schedules a held credit run for each due delivered deposit." },
    { name: "cursor", about: "Runs `banking.reconcile.cursor`." },
    { name: "fetch", about: "Reads up to 100 events after the cursor from Bridge, decoded at the Bridge door." },
    { name: "encrypt", about: "Encrypts each event's JSON with `bridge:<eventId>`." },
    { name: "advance", about: "Runs `banking.reconcile.advance` with the page; a full page (100) schedules the continuation." },
    { name: "observe", about: "Unless the page and the credit reconcile were idle, queues `banking_reconcile_completed` (`recovered`, `has_more`)." },
    { name: "release", about: "Runs `banking.reconcile.release` unless a continuation took the lease." },
    { name: "fail", about: "Fails with the scan's, the read's and the release's causes combined, if any failed." },
  ],
  reads: [table_rail_sync_state, table_rail_events, table_rail_deposits],
  writes: [table_rail_sync_state, table_rail_events, table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [event_banking_reconcile_completed],
  calls: [integration_bridge.c.listWebhookEvents],
  chain: [],
  idempotency:
    "The lease keeps one run at a time; the inbox guard inserts each event once; the cursor moves only from the cursor the page was read after; each recovered row is held for one run.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
