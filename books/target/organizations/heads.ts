// The heads area: a connected Frappe head's doorbell. Connecting, reading and disconnecting a head
// are new capabilities proposed to Aaron (organizations.commands), so their rpcs are not booked
// yet; the connection's durable process is in processes.ts, and each app concept syncs its own
// records with the head (organizations.head-ownership).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import { table_org_heads } from "./data.ts";

const S = Schema.String;

export const rpc_organizations_heads_ring = defineRpc({
  id: "organizations.heads.ring",
  title: "A connected head rings: something changed there",
  about:
    "The head's doorbell route. The Capxul app for Frappe posts it after a change to a synced DocType commits, signed " +
    "with the secret the connection gave it (HMAC over the head id and timestamp, five minutes of skew; else " +
    "NOT_AUTHENTICATED, nothing written). It carries no data: one transaction stamps the live connection's `rung_at`, " +
    "which wakes every app concept's sync of that head to pull the head's changes with Capxul's own key " +
    "(organizations.head-doorbell). A forged or repeated ring only causes an extra pull. A ring for a disconnected or " +
    "unknown head is answered the same as an accepted one and changes nothing, so it tells a caller nothing.",
  concept: concept_organizations,
  kind: "mutation",
  who: "frappe-head: the Capxul app on a connected head, signing with its connection's ring secret; no session is involved.",
  input: Schema.Struct({ headId: S, timestamp: S, signature: S }),
  output: Schema.Struct({ accepted: Schema.Boolean }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_org_heads],
  writes: [table_org_heads],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
