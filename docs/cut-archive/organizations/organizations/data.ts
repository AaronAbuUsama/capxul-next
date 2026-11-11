// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";

export const table_org_heads = defineTable({
  id: "org-heads",
  title: "Organization heads: the Frappe site connected to an Organization",
  about:
    "One row per connection of a Frappe head (aaron.frappe-head). An Organization is complete without one; connecting is " +
    "a separate step a Director takes (organizations.commands), and at most one connection is live at a time. It holds the " +
    "site's URL, its host (Frappe Cloud or self-hosted), the API key and secret of the head user Capxul acts as and, on " +
    "Frappe Cloud, the team's API token its site API takes to install apps, each sealed under record-bound encryption " +
    "and never returned, the doorbell secret (sealed too, since a signature is checked with it), what the site last said " +
    "of itself (Frappe's version, the Capxul " +
    "app's, the time zone), and its one durable process's state (`organizations.heads.watch`). The sync itself is each " +
    "app concept's own: each follows `org_head_transitioned` and keeps its own cursors, by the rules of " +
    "organizations.head-ownership. The head rings its doorbell when something changed there (`rung_at`), and Capxul then " +
    "pulls with its own key. A disconnected row is kept: the sync records name it.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    head_id: S,
    site_url: S,
    host: Schema.Literals(["frappe-cloud", "self-hosted"]),
    /** `api_key:api_secret` for Frappe's token auth, sealed under RECORD_ENCRYPTION_KEY bound to this row. */
    credential_ciphertext: S,
    /**
     * Frappe Cloud only: the team's `api_key:api_secret` and team name its site API (install an app) takes, sealed the
     * same way; a site's own key cannot install apps. Null for a self-hosted head, whose owner runs `bench install-app`.
     */
    host_credential_ciphertext: NullOr(S),
    status: Schema.Literals(["connecting", "connected", "failing", "disconnected"]),
    /** The Director who connected it, and who disconnected it. */
    connected_by: S,
    disconnected_by: NullOr(S),
    frappe_version: NullOr(S),
    capxul_app_version: NullOr(S),
    /** The site's System Settings time zone: it must be the Organization's. */
    time_zone: NullOr(S),
    /**
     * Why it stopped: the key refused, no Capxul app, a time zone or Company currency that is not the Organization's,
     * or the site down.
     */
    issue: NullOr(
      Schema.Struct({
        reason: Schema.Literals(["key_refused", "app_missing", "time_zone", "currency", "unreachable"]),
        code: S,
        at: N,
      }),
    ),
    /** The ring secret the connection gave the head's Capxul app, sealed like the key: the ring's HMAC is checked with it. */
    ring_secret_ciphertext: S,
    /** When the head last rang: each ring wakes every app's sync of this head. */
    rung_at: NullOr(N),
    checked_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "head_id"],
  indexes: [
    {
      name: "by_org_live",
      fields: ["org_id", "status"],
      for:
        "The Organization's live head (connecting, connected or failing), and every app's sync reads it. One at a time: a " +
        "connect takes the Organization row's lock and refuses WRONG_STATE while a live row exists.",
    },
  ],
  retention: KEPT,
});

export const event_org_head_transitioned = defineEvent({
  id: "org_head_transitioned",
  about:
    "An Organization's head connection began, was confirmed, started failing, recovered or was disconnected. Every app " +
    "concept's sync process starts at `confirm` and ends at `disconnect`.",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    head_id: S,
    issue_reason: NullOr(S),
  }),
});

export const machine_org_head = defineMachine({
  id: "org-head",
  title: "Head connection",
  about:
    "org-heads.status, owned by the connection's one durable process. Born connecting; confirmed when the site answers " +
    "with the Capxul app at a version Capxul speaks, its Custom Fields in place and the Organization's time zone; failing " +
    "while it cannot be reached or refuses the key, and connected again when it answers; disconnected for good when a " +
    "Director disconnects it, after which a new connection is a new row.",
  table: table_org_heads,
  field: "status",
  initial: "connecting",
  states: [
    { id: "connecting", about: "Capxul is checking the site: the key, the Capxul app, the time zone." },
    { id: "connected", about: "The site answers as the Organization's head; every app's sync runs." },
    { id: "failing", about: "The site is down, refuses the key or lost the Capxul app; the syncs wait and nothing is lost." },
    { id: "disconnected", about: "A Director disconnected it; Capxul keeps every record it holds.", terminal: true },
  ],
  transitions: {
    connect: {
      from: [],
      to: "connecting",
      about: "Birth: a Director connects a site.",
      guard: "No other live connection for the Organization.",
      emits: [event_org_head_transitioned],
    },
    confirm: {
      from: ["connecting"],
      to: "connected",
      about: "readSite answers with the Capxul app, its Custom Fields, the fundamental apps and the Organization's time zone.",
      emits: [event_org_head_transitioned],
    },
    stall: {
      from: ["connecting", "connected"],
      to: "failing",
      about: "readSite failed past its retries, refused the key, found no Capxul app or another time zone.",
      emits: [event_org_head_transitioned],
    },
    recover: {
      from: ["failing"],
      to: "connected",
      about: "readSite answers as it should again.",
      emits: [event_org_head_transitioned],
    },
    disconnect: {
      from: ["connecting", "connected", "failing"],
      to: "disconnected",
      about: "A Director disconnects it.",
      emits: [event_org_head_transitioned],
    },
  },
});

export const table_org_doc_calls = defineTable({
  id: "org-doc-calls",
  title: "Document calls: every call the document family made to the head, and for whom",
  about:
    "The document family's log (aaron.sdk-reaches-everything: 'with the caller's authority, logged, on the world's " +
    "clock'; organizations.doc-log). One row per call an `org head doc` or `org head doctype` command made, read or write, " +
    "written in one transaction once the head has answered, or once Capxul refused before any call: whose authority it " +
    "ran with (the member's Seat; for the hosted FDE, its asker's, with the ask), the head User it ran as, the verb, " +
    "the DocType and the document's name, the outcome (done, or the refusal's code and reason), and the head's " +
    "`modified` and docstatus after a write. It keeps the names of the fields a write set, the filters a list used and " +
    "how many documents it answered, never a value: the documents are the head's, and Capxul copies none " +
    "(organizations.head-ownership). The SDK method gives each invocation one call id and repeats it on a retry, so a " +
    "call is logged once and a write is applied once: a row already under that id answers as recorded, and the Capxul " +
    "app answers a write it already applied under that id as it did the first time. The one exception is a call the " +
    "head did not answer (PROVIDER_ERROR or RATE_LIMITED), which may have been applied there all the same: its row is " +
    "logged refused, and a retry under the same id calls the head again and completes that row, once, with what the " +
    "head then answers (organizations.doc-log). `at` is the world's now when the row was written, and `completed_at` " +
    "when a retry completed it. No other row ever changes.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** `dcall_` and a ULID, made once by the SDK method and kept on every retry. */
    call_id: S,
    /** The live head it went to; null when refused before any head was found. */
    head_id: NullOr(S),
    verb: DocVerb,
    /** Null for `doctypes`. */
    doctype: NullOr(S),
    /** The document's name on the head: given, or the one a create or an amend made; null for a list. */
    name: NullOr(S),
    /** Whose authority it ran with: the caller's Seat, or for the hosted FDE its asker's. */
    member_id: S,
    /** The ask the hosted FDE made it under; null when a member called themselves. */
    ask_id: NullOr(S),
    /** The head User it ran as, by mailbox; null when refused before the head. */
    head_user: NullOr(S),
    outcome: Schema.Literals(["done", "refused"]),
    /** The refusal's code (INVALID_INPUT, ROLE_PERMISSION_DENIED, WRONG_STATE, PROVIDER_ERROR...) and the head's reason. */
    code: NullOr(S),
    reason: NullOr(S),
    /** The fields a create or change set, and the filters a list used: names only. */
    field_names: Schema.Array(S),
    /** How many documents a list or `doctypes` answered. */
    count: NullOr(N),
    /** After a write: the head's `modified` stamp and the document's docstatus (0 draft, 1 submitted, 2 cancelled). */
    head_modified: NullOr(S),
    docstatus: NullOr(N),
    at: N,
    /** When a retry under the same id completed a row the head had not answered; null otherwise. */
    completed_at: NullOr(N),
  }),
  key: ["org_id", "call_id"],
  indexes: [
    {
      name: "by_org_at",
      fields: ["org_id", "at", "call_id"],
      for: "`org head doc-call list`, newest first, for a Director.",
    },
    {
      name: "by_org_member",
      fields: ["org_id", "member_id", "at", "call_id"],
      for: "`org head doc-call list` for a member other than a Director: the calls made with their own authority, the FDE's for them included.",
    },
    {
      name: "by_org_document",
      fields: ["org_id", "doctype", "name", "at"],
      for: "`org head doc-call list --doctype --name`: every call that touched one document.",
    },
  ],
  retention: KEPT,
});
