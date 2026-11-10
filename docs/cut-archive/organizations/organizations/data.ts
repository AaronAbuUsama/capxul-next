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
