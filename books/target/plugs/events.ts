// Books from the chain: Frappe's books are written by reading the chain. Each event that matters (a hat granted, a payment sent) is enqueued
// for the Organization with the next number, delivered in order to the site, and applied once. Core keeps every event and resends until the
// site answers applied (the site being down loses nothing); the site answers a repeated key as already applied (at-least-once plus dedupe).
// One event that can never be applied must not stop the rest, so after three failures a non-money event is set aside and a money event always
// reaches the books as an unmatched bank line with an alert (plugs.poison-event). Evidence: FINDINGS, Core half and End to end.

import { Schema } from "effect";
import { concept_plugs } from "../shared/foundation.ts";
import { error_EVENT_UNAPPLIABLE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_org_deployments } from "../organizations/data.ts";
import { machine_site_event, SiteEventKind, SiteEventState, table_site_cursors, table_site_events } from "./data.ts";
import { N, Null, S, B, procedure, rpc } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const WHO_ADMIN = "The wearer of the Organization's Director hat (the skeleton's admin hat), read from indexing's wearers now.";

export const EventView = Schema.Struct({
  seq: N, eventKey: S, kind: SiteEventKind, status: SiteEventState, attempts: N, lastError: Null(S), money: B, createdAt: N, appliedAt: Null(N),
});

export const procedure_plugs_events_enqueue = procedure({
  id: "plugs.events.enqueue",
  title: "Add one event to an Organization's outbox with the next number",
  about:
    "Money fact for the stream: the number is assigned and the row written in one transaction, so numbers are gap-free from 1. It takes the key " +
    "(`chainId:txHash:logIndex`, or `approval:<id>:failed` for Core's own word that a payment failed), the kind, the data and whether it moves money. A key already held " +
    "enqueues nothing and answers its number. Chain events enter only after the finality depth; a reorg that removes one enqueues a `payment_reversed` instead of editing history.",
  concept: concept_plugs,
  input: Schema.Struct({ org_id: S, event_key: S, kind: SiteEventKind, data: S, money: B }),
  output: Schema.Struct({ seq: N, enqueued: B }),
  errors: [error_INVALID_INPUT],
  reads: [table_site_events, table_site_cursors],
  writes: [table_site_events, table_site_cursors],
  drives: [machine_site_event.t.enqueue],
  was: [`${SPIKE} (Core half: seq is assigned by Core at enqueue; event_key is not reorg-safe)`],
});

export const rpc_plugs_events_status = rpc({
  id: "plugs.events.status",
  title: "Read where an Organization's site has got to in its event stream",
  about:
    "The cursor (the next number, the last the site applied, whether delivery is flowing or blocked and at which number), the counts by state, and the events set aside or posted as " +
    "unmatched lines with their last error. It replaces the old books fact list: the gap-free feed the ledger follows is this one.",
  concept: concept_plugs,
  kind: "query",
  who: "Any member of the Organization.",
  input: Schema.Struct({ orgId: S, state: Null(SiteEventState), limit: N }),
  output: Schema.Struct({ nextSeq: N, lastAppliedSeq: N, state: Schema.Literals(["flowing", "blocked"]), blockedSeq: Null(N), counts: Schema.Record(S, N), events: Schema.Array(EventView) }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_site_events, table_site_cursors],
  was: [`${SPIKE} (Core half: events status)`],

  spans: ["rpc.plugs.events.status"],
});

export const rpc_plugs_events_resend = rpc({
  id: "plugs.events.resend",
  title: "Deliver an Organization's events again from a number",
  about:
    "Moves the cursor back to `from` (default 1) and marks nothing else: the delivery process offers every event from there in order, and the site answers 'already applied' to what it has. " +
    "It is how a new site for an old Organization, or a site restored from a backup, is brought up to date. A `from` beyond the next number is INVALID_INPUT. It never re-sends " +
    "an event the site set aside; `org events retry` does.",
  concept: concept_plugs,
  kind: "mutation",
  who: WHO_ADMIN,
  input: Schema.Struct({ orgId: S, from: N }),
  output: Schema.Struct({ from: N, nextSeq: N }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_site_cursors, table_org_deployments, table_hat_wearers],
  writes: [table_site_cursors],
  was: [`${SPIKE} (Core half: events resend; Frappe's view wins on 409)`],

  spans: ["rpc.plugs.events.resend"],
});

export const rpc_plugs_events_retry = rpc({
  id: "plugs.events.retry",
  title: "Release an event the site set aside",
  about:
    "A set-aside event goes back to pending so the delivery process tries it again, in its place in the stream: the operator fixed what made it fail (a Frappe user missing, a document " +
    "deleted). An event in any other state is WRONG_STATE. An event the site still cannot apply is set aside again after three more tries, with its new error.",
  concept: concept_plugs,
  kind: "mutation",
  who: WHO_ADMIN,
  input: Schema.Struct({ orgId: S, seq: N }),
  output: Schema.Struct({ seq: N, status: Schema.Literal("pending") }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_EVENT_UNAPPLIABLE],
  reads: [table_site_events, table_org_deployments, table_hat_wearers],
  writes: [table_site_events],
  drives: [machine_site_event.t.release],
  was: [`${SPIKE} (What the design must now decide, 2: there is no retry tool)`],

  spans: ["rpc.plugs.events.retry"],
});
