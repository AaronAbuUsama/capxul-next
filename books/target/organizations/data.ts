// The target organizations concept's tables, state machines and each machine's one event (P7).
//
// A workspace: the Organization's record, its setup (one durable process per setup, in
// setups.ts), the deployment its install produced, its Seats, and its invitations (one durable
// process per invitation, in invitations.ts). Directors, proposals and officer hat grants are
// board's; budgets and allowances are budgets'; the treasury's balance is activity's. Every chain
// fact (a Safe's owners, a hat's wearers, a budget) is read from indexing's views, never copied,
// except the deployment, which is written once from the indexed MoneyDeployed and never changes
// (decision organizations.deployment-row).
//
// Ids: `org_<ulid>`, `inv_<ulid>`, `mem_<ulid>`. Times are epoch milliseconds. Addresses and hat
// ids are lowercase hex strings. Every table is the Organization's (tenancy organization,
// `org_id` first in the key and every index but the few marked crossTenant).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";

const O = "packages/backend/src/organizations";
const T = `${O}/tables`;
const MODEL = "packages/protocol/src/organizations/model.ts";
const AS_IS = "docs/as-is/archive/organizations/data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const KEPT = "Kept for the life of the Organization: it is the record of what the workspace is and who joined it.";

// ── shared shapes ───────────────────────────────────────────────────────────────────────────

/** The setup steps already finished, in order (the frozen `steps` of `org show`). */
export const SetupStep = Schema.Literals(["safe_minted", "money_deployed", "installed"]);

/** Why a setup stopped and needs attention or failed; the frozen `lifecycle.issue`. */
export const SetupIssue = Schema.Struct({
  reason: Schema.Literals([
    "provider_unavailable",
    "mint_reverted",
    "safe_owner_mismatch",
    "deploy_reverted",
    "install_refused",
    "approval_expired",
    "approval_declined",
    "approval_displaced",
    "install_reverted",
    "provider_answer_invalid",
  ]),
  /** The error code the step ended with (PROVIDER_ERROR, TRANSACTION_FAILED, CANCELLED…). */
  code: S,
  at: N,
});

/** One grant an invitation offers, as data: budgets proposes it to the Board, the chain grants it (operations.member-invite-in-budgets). */
export const Offer = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("officer"), hat: Schema.Literals(["books", "invoicing", "people"]) }),
  Schema.Struct({ kind: Schema.Literal("allowance"), budgetId: S }),
  Schema.Struct({ kind: Schema.Literal("new-allowance"), name: S, asset: S, limit: S }),
]);

/**
 * What a Seat, or an offer of one, uses of the Organization's limits (organizations.seat-limit):
 * `seat` counts one against `seat_limit` (a person, or an agent nothing covers); `owner-seat` is an
 * agent riding on its owner's Seat here (one per Seat); `organization` is the agent the Organization
 * owns (one).
 */
export const SeatUse = Schema.Literals(["seat", "owner-seat", "organization"]);

// ── organizations ───────────────────────────────────────────────────────────────────────────

export const table_organizations = defineTable({
  id: "organizations",
  title: "Organizations",
  about:
    "One row per Organization: its name, its company Safe, its founder and its Party. Born in `org create`'s one " +
    "transaction with its setup and its Party (`parties.register`: the handle and the Safe it routes money to). The " +
    "company Safe's address is the minter's pure `companySafeAddressFor` of the founder's Safe and the handle, so it is " +
    "known, and money can be routed to it, before Companies House mints it. The handle lives on the Party (one namespace " +
    "with agents); the logo is a media file the row points at. `seat_limit` is how many Seats it may fill: ten at birth, " +
    "in the beta and after, raised only by a Capxul operator (organizations.seat-limit). Nothing here is a chain copy: " +
    "the Safe's owners, its threshold and its balances are read from indexing's views. It is also ERPNext's Company for " +
    "the Organization (aaron.erp-on-capxul): `abbr`, `default_currency`, `time_zone` and `fiscal_year_start` are the " +
    "Company and System Settings facts every fundamental app reads, set at birth from the country as ERPNext's setup " +
    "wizard sets them (organizations.company-shape); a head's Company and System Settings carry the same values.",
  was: [`${T}/organizations.ts:17`, `${AS_IS}:140`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    party_id: S,
    name: S,
    /** ISO 3166-1 alpha-2, upper case. */
    country: S,
    /** Trimmed; at most 280 characters, else INVALID_INPUT. */
    bio: NullOr(S),
    size: NullOr(S),
    /** A media file admitted as an image. */
    logo_file_id: NullOr(S),
    chain_id: N,
    safe_address: S,
    founder_party_id: S,
    founder_safe: S,
    /** Seats it may fill: 10 at birth (aaron.seats); only `organizations.seats.raise` changes it, and only upward. */
    seat_limit: N,
    /** The operator label and time of the last raise; null while it has its first ten. */
    seat_limit_raised_by: NullOr(S),
    seat_limit_raised_at: NullOr(N),
    /** ERPNext Company.abbr: the suffix of the Organization's account names; 1 to 5 upper-case letters or digits. */
    abbr: S,
    /** ERPNext Company.default_currency, ISO 4217: the country's currency unless the founder chose another. */
    default_currency: S,
    /** Frappe System Settings.time_zone, IANA: the country's first zone unless chosen; every app's calendar dates are in it. */
    time_zone: S,
    /** The month and day the fiscal year starts, `MM-DD` (ERPNext's fiscal year by country, else `01-01`). */
    fiscal_year_start: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [
    {
      name: "by_party",
      fields: ["party_id"],
      unique: true,
      crossTenant: true,
      for: "The Organization a Party stands for: `org create`'s replay by handle (the handle's Party), and a resolved recipient's Organization.",
    },
  ],
  retention: KEPT,
});

// ── setups ──────────────────────────────────────────────────────────────────────────────────

export const table_org_setups = defineTable({
  id: "org-setups",
  title: "Organization setups",
  about:
    "One row per Organization: the state of its one durable setup process (setups.ts). It holds what the process must " +
    "remember across a crash and what `org show` reports: the intent the founder began with (a repeat of the same intent " +
    "resumes it), the steps finished, the two service-key transactions it sent (the mint and `deployMoney`, each sent " +
    "once: the service signer records the signed bytes before it broadcasts), the founder's install approval, the issue " +
    "it stopped on, and when it last checked. The old row's scheduling plumbing (generation, lease, dispatch and send " +
    "tokens, due times, park, unresolved counters, the preparation and submission copies) is gone: the workflow engine " +
    "holds the schedule, and approvals hold the UserOperation. When the founder's machine made the Organization's FDE key " +
    "(organizations.fde-at-start-up), the setup keeps that key's address, where the machine keeps it, the FDE's predicted " +
    "Safe and its Party: the install batch creates the FDE on chain and the setup seats it.",
  was: [`${T}/setups.ts:35`, `${AS_IS}:203`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** The founder's principal: the approval's signer, and who may read and resume the setup before it is ready. */
    founder_principal_id: S,
    /** Hash of name, handle, country, bio, size and logo as begun: the same intent resumes, another refuses. */
    intent_hash: S,
    status: Schema.Literals(["processing", "awaiting_authorization", "needs_attention", "ready", "failed"]),
    steps: Schema.Array(SetupStep),
    mint_tx_hash: NullOr(S),
    deploy_tx_hash: NullOr(S),
    /** The founder's install batch: an approval opened with `approvals.open` in this concept's transaction. */
    install_approval_id: NullOr(S),
    issue: NullOr(SetupIssue),
    /** The FDE's key (its address only), made on the founder's machine; null when the Organization starts without one. */
    fde_signer: NullOr(S),
    /** Where that machine keeps the FDE's key, as agents' key_store names it. */
    fde_key_store: NullOr(Schema.Literals(["file", "env"])),
    /** AgentOwner.safeAddressFor(fde_signer, the company Safe), computed at begin. */
    fde_safe: NullOr(S),
    /** The FDE's Party, registered pending at begin, activated when the install lands, released if the setup fails. */
    fde_party_id: NullOr(S),
    checked_at: N,
    ready_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [
    {
      name: "by_founder_status",
      fields: ["founder_principal_id", "status"],
      crossTenant: true,
      for: "A founder's unfinished setups: `org list`'s unfinishedSetups and `org show` without `--org` (a founder is not yet a member).",
    },
  ],
  retention: KEPT,
});

// ── deployment ──────────────────────────────────────────────────────────────────────────────

export const table_org_deployments = defineTable({
  id: "org-deployments",
  title: "Organization deployments: which hat is which",
  about:
    "What `Installer.deployMoney` made for the Organization, as its MoneyDeployed event names it: the Board's top hat, " +
    "the Shareholders' top hat, the Director hat, the three officer hats by name (Books, Invoicing, People), the Roles " +
    "modifier and the Signer Gate. The setup writes it once, from the indexed event at finality, and nothing changes it: " +
    "the event is emitted once per company and its hat ids are fixed. Every concept above answers 'which officer hat is " +
    "which' from here (board, budgets, books, applications, requests). Who wears a hat now, the budget tree and the " +
    "Board's signers stay chain facts in indexing.",
  was: [`${T}/setups.ts:35`, `${O}/setups/external/deploys.ts:213`, `${T}/roles.ts:11`, `${T}/roles.ts:23`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    safe_address: S,
    board_top_hat: S,
    shareholders_top_hat: S,
    director_hat: S,
    books_hat: S,
    invoicing_hat: S,
    people_hat: S,
    roles_address: S,
    gate_address: S,
    deploy_tx_hash: S,
    block_number: N,
    created_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

// ── members ─────────────────────────────────────────────────────────────────────────────────

export const table_org_members = defineTable({
  id: "org-members",
  title: "Organization members (Seats)",
  about:
    "One Seat per Party per Organization, held by a person or an agent. The founder's is born when the setup is ready; " +
    "an invitee's when they accept. A Seat is what every concept above checks to authorize an Organization tenant (is " +
    "this session's principal a current member here); what a member may do comes from the hats their Safe wears, read " +
    "from indexing. `safe_address` is the Safe those hats are worn by (a person's or an agent's own). An agent's Seat " +
    "ends when the chain shows the agent removed. The old legacy states (pending, pending_safe, pending_grant, expired), " +
    "the reconciliation stamp and the duplicate rows per email are gone: an invited person who has not joined is an open " +
    "invitation, not a Seat. `seat_use` is what the Seat takes of the Organization's limits, as its offer reserved it: a " +
    "person's counts one of `seat_limit`; an agent's rides on its owner's Seat here (`covering_member_id`, one agent per " +
    "Seat) or is the Organization's own agent (one), and any other agent's counts one (organizations.seat-limit). The " +
    "Organization's FDE is seated by its setup, before it has ever signed in, so its `principal_id` is null until its " +
    "first signed challenge; an agent's session is matched to its Seat by its Safe (`by_org_safe`), which access' " +
    "principals hold one to one (organizations.fde-seat).",
  was: [`${T}/members.ts:10`, `${AS_IS}:391`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    member_id: S,
    party_id: S,
    /** The access principal: a person, or an agent; null only for an FDE's Seat before the FDE's first sign-in. */
    principal_id: NullOr(S),
    kind: Schema.Literals(["human", "agent"]),
    safe_address: S,
    /** The invitation it was accepted from; null for the founder's Seat. */
    invitation_id: NullOr(S),
    /** What it takes of the limits: the founder's and every person's is `seat`. */
    seat_use: SeatUse,
    /** For `owner-seat`: the Seat of the agent's owner that covers it; else null. */
    covering_member_id: NullOr(S),
    status: Schema.Literals(["active", "removed"]),
    removed_reason: NullOr(Schema.Literal("agent_removed")),
    joined_at: N,
    removed_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id", "member_id"],
  indexes: [
    {
      name: "by_org_principal",
      fields: ["org_id", "principal_id"],
      for: "The tenant guard every concept runs: is this session's principal a current member of this Organization.",
    },
    {
      name: "by_org_safe",
      fields: ["org_id", "safe_address"],
      for: "The same guard for an agent's session, by the Safe its principal proved: the FDE's Seat is born before its principal.",
    },
    {
      name: "by_org_party",
      fields: ["org_id", "party_id"],
      unique: true,
      for: "Whether a Party already holds a Seat here: an invitation's grantee check and accept's one Seat per Party.",
    },
    {
      name: "by_org_joined",
      fields: ["org_id", "joined_at", "member_id"],
      for: "`org member list` pages, in join order.",
    },
    {
      name: "by_org_seat_use",
      fields: ["org_id", "status", "seat_use"],
      for: "The seat count an offer is checked against: the active Seats that count one, and whether the Organization's own agent holds one.",
    },
    {
      name: "by_org_covering",
      fields: ["org_id", "covering_member_id"],
      for: "Whether a person's Seat already covers an agent of theirs, so a second takes a Seat of its own.",
    },
    {
      name: "by_principal",
      fields: ["principal_id", "org_id"],
      crossTenant: true,
      for: "The Organizations a principal sits in: `org list` and `use org`.",
    },
    {
      name: "by_safe",
      fields: ["safe_address"],
      crossTenant: true,
      for: "The Seats an agent's Safe holds, when AgentRemoved names that Safe.",
    },
  ],
  retention: KEPT,
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

export const table_org_invitations = defineTable({
  id: "org-invitations",
  title: "Organization invitations",
  about:
    "One offer of a Seat to one person or agent, with the grants it offers as data (officer hats, existing allowances, a " +
    "new allowance), and its one durable process (invitations.ts). A Seat-only offer is open at once; an offer with " +
    "grants waits while the Board's proposal of them runs: budgets' `org member invite` flow proposes them and binds the " +
    "company Safe transaction that carries them here (`organizations.bind-invitation-grants`), and the process opens the " +
    "offer when the chain shows that transaction executed. The digest the invitee accepts covers the Organization, the " +
    "grantee and the offers. `last_sent_at` anchors the resend cooldown; the email itself and its delivery record are " +
    "notices', which follows `org_invite_transitioned`. A live offer reserves the Seat it offers (`seat_use`), so ten " +
    "open offers fill ten seats until they are accepted or end. The old configure, grant, disable and compensate " +
    "commands, the generation lineage and the Roles bindings are gone (P9: grants are hats).",
  was: [`${T}/invitations.ts:25`, `${AS_IS}:518`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    invitation_id: S,
    /** The caller's key: the same key and request return the same invitation. */
    request_key: S,
    request_hash: S,
    inviter_party_id: S,
    grantee_party_id: S,
    grantee_kind: Schema.Literals(["human", "agent"]),
    /** The Safe the grants are minted to: the person's email-derived Safe, or the agent's. */
    grantee_safe: S,
    /** Null for an offer to an `@handle` (an agent): no email is sent. */
    grantee_mailbox: NullOr(S),
    /**
     * What the Seat it offers will take, reserved while the offer is live (authorizing or pending); null when the
     * grantee already holds an active Seat here, so the offer reserves nothing and acceptance keeps that Seat.
     */
    seat_use: NullOr(SeatUse),
    /** For `owner-seat`: the owner's Seat that will cover the agent, reserved with the offer; else null. */
    covering_member_id: NullOr(S),
    offers: Schema.Array(Offer),
    offer_digest: S,
    phase: Schema.Literals(["authorizing", "pending", "active", "revoking", "declined", "cancelled", "expired"]),
    ending_reason: NullOr(Schema.Literals(["declined", "cancelled", "expired"])),
    /** The company Safe transaction (hash and nonce) that carries the grants, bound by budgets. */
    grant_safe_tx_hash: NullOr(S),
    grant_safe_nonce: NullOr(S),
    /** The hats that transaction minted to `grantee_safe`, read from its indexed facts. */
    granted_hats: Schema.Array(S),
    last_sent_at: NullOr(N),
    opened_at: NullOr(N),
    /** Seven days after it opened; null while authorizing. A resend never moves it. */
    expires_at: NullOr(N),
    accepted_at: NullOr(N),
    accepted_digest: NullOr(S),
    member_id: NullOr(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "invitation_id"],
  indexes: [
    {
      name: "by_org_request_key",
      fields: ["org_id", "request_key"],
      unique: true,
      for: "An invite's replay: one request key names one invitation in an Organization.",
    },
    {
      name: "by_org_created",
      fields: ["org_id", "created_at", "invitation_id"],
      for: "`org invite list` pages in (createdAt, invitationId) order.",
    },
    {
      name: "by_org_phase_created",
      fields: ["org_id", "phase", "created_at", "invitation_id"],
      for: "`org invite list --phase`, merged per phase in page order, and the open invitations `org member list` shows.",
    },
    {
      name: "by_org_phase_seat_use",
      fields: ["org_id", "phase", "seat_use"],
      for: "The live offers that reserve a Seat (authorizing or pending), counted with the Seats held when another is offered.",
    },
    {
      name: "by_org_covering_phase",
      fields: ["org_id", "covering_member_id", "phase"],
      for: "Whether a live offer already reserves a person's Seat as an agent's cover, so a second agent of theirs takes a seat.",
    },
    {
      name: "by_org_grantee_phase",
      fields: ["org_id", "grantee_party_id", "phase"],
      for: "A grantee's live offers here: a second live offer of the same grant is refused.",
    },
    {
      name: "by_grantee_created",
      fields: ["grantee_party_id", "created_at", "invitation_id"],
      crossTenant: true,
      for: "`invite list`: the caller's own offers from every Organization, in page order.",
    },
    {
      name: "by_grantee_phase_created",
      fields: ["grantee_party_id", "phase", "created_at", "invitation_id"],
      crossTenant: true,
      for: "`invite list --phase`, merged per phase in page order.",
    },
  ],
  retention: KEPT,
});

// ── apps: which Frappe apps the Organization runs, and where ───────────────────────────────

/** The fundamental apps every Organization starts with (aaron.frappe-shape), and the modules Capxul holds natively. */
export const FUNDAMENTAL_APPS = [
  { app: "frappe", modules: ["core"] },
  { app: "erpnext", modules: ["accounts", "projects"] },
  { app: "hrms", modules: ["payroll"] },
  { app: "crm", modules: ["crm"] },
] as const;

export const table_org_apps = defineTable({
  id: "org-apps",
  title: "Organization apps: the Frappe apps it runs, native or on its head",
  about:
    "One row per Frappe app an Organization uses, in the shape of Frappe's Installed Applications (app name, version). " +
    "Born in `org create`'s transaction: the fundamental apps installed and native (`frappe`; `erpnext` for accounting and " +
    "projects; `hrms` for payroll; `crm`), whose records Capxul holds in their Frappe shapes from the first day, head or " +
    "no head; and any other app the founder asked for at start-up, wanted. Every other app lives only on a connected head " +
    "(organizations.apps-native-or-head): it is wanted until the head shows it installed, which the head connection's " +
    "process records. The FDE or a Director adds one later in conversation (organizations.commands). `version` is the " +
    "head's installed version, null while no head runs it. A fundamental app is never removed.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** The Frappe app's name, as `bench get-app` and `get_versions` name it: `erpnext`, `hrms`, `crm`, `helpdesk`. */
    app: S,
    /** For a native app, the modules whose records Capxul holds; empty for a head app. */
    modules: Schema.Array(S),
    native: Schema.Boolean,
    status: Schema.Literals(["wanted", "installed", "removed"]),
    /** Who asked for it: the founder at start-up, the FDE or a Director later; the system for a fundamental app. */
    added_by: NullOr(S),
    version: NullOr(S),
    installed_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "app"],
  indexes: [
    {
      name: "by_org_status",
      fields: ["org_id", "status", "app"],
      for: "The wanted apps a newly connected head is asked to install, and the installed apps `org show` lists.",
    },
  ],
  retention: KEPT,
});

// ── head: the Organization's connected Frappe site ──────────────────────────────────────────

export const table_org_heads = defineTable({
  id: "org-heads",
  title: "Organization heads: the Frappe site connected to an Organization",
  about:
    "One row per connection of a Frappe head (aaron.frappe-head). An Organization is complete without one; connecting is " +
    "a separate step a Director takes (organizations.commands), and at most one connection is live at a time. It holds the " +
    "site's URL, its host (Frappe Cloud or self-hosted), the API key and secret of the head user Capxul acts as, sealed " +
    "under record-bound encryption and never returned, what the site last said of itself (Frappe's version, the Capxul " +
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
    status: Schema.Literals(["connecting", "connected", "failing", "disconnected"]),
    /** The Director who connected it, and who disconnected it. */
    connected_by: S,
    disconnected_by: NullOr(S),
    frappe_version: NullOr(S),
    capxul_app_version: NullOr(S),
    /** The site's System Settings time zone: it must be the Organization's. */
    time_zone: NullOr(S),
    /** Why it stopped: the key refused, no Capxul app, a time zone that is not the Organization's, or the site down. */
    issue: NullOr(Schema.Struct({ reason: Schema.Literals(["key_refused", "app_missing", "time_zone", "unreachable"]), code: S, at: N })),
    /** The hash of the ring secret the connection gave the head's Capxul app for its doorbell. */
    ring_secret_hash: S,
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
      for: "The Organization's live head (connecting, connected or failing): one at a time, and every app's sync reads it.",
    },
  ],
  retention: KEPT,
});

// ── state machines and their events (P7: one event per machine, defined just above it) ────

const From = NullOr(S);

export const event_org_setup_transitioned = defineEvent({
  id: "org_setup_transitioned",
  about:
    "An Organization's setup changed state: begun, waiting for the founder's authorization, back to processing, ready, " +
    "needing attention, resumed or failed. Replaces organization_creation_started, _ready and _failed.",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    /** The founder. */
    person_id: S,
    issue_reason: NullOr(S),
  }),
  was: [`${O}/setups/events.ts:1`],
});

export const machine_org_setup = defineMachine({
  id: "org-setup",
  title: "Organization setup",
  about:
    "org-setups.status, owned by the setup's one durable process. Born processing with the Organization. The process " +
    "mints the company Safe and sends `deployMoney` (still processing, with `steps` recording each), opens the founder's " +
    "install approval (awaiting_authorization), follows the founder's signature and the install to the chain " +
    "(processing again), and is ready when the install landed at finality. A step that cannot finish now stops it at " +
    "needs_attention, resumable by `org retry`; only a company Safe that is not the founder's, or a provider answer that " +
    "will not change, is definitive (failed).",
  was: [`${AS_IS}:1067`, `${O}/setups/rules/policies.ts:40`],
  table: table_org_setups,
  field: "status",
  initial: "processing",
  states: [
    { id: "processing", about: "Capxul is minting, deploying or installing; nothing waits on the founder." },
    { id: "awaiting_authorization", about: "The install batch's approval is open: the founder signs it on the approval page." },
    { id: "needs_attention", about: "A step stopped (a provider outage outlasted its retries, the approval expired or was declined, a send reverted); `org retry` resumes it." },
    { id: "ready", about: "The install landed at finality: the Gate guards the Safe, the founder is its one Director and wears the officer hats.", terminal: true },
    { id: "failed", about: "Nothing can finish it: the minted company Safe is not the founder's, or a provider's answer will not change.", terminal: true },
  ],
  transitions: {
    begin: {
      from: [],
      to: "processing",
      about: "Birth, in `org create`'s transaction with the Organization and its Party.",
      emits: [event_org_setup_transitioned],
    },
    request_authorization: {
      from: ["processing"],
      to: "awaiting_authorization",
      about: "MoneyDeployed is indexed: the deployment is written and the install approval opened (`approvals.open`), in one transaction.",
      guard: "steps holds safe_minted and money_deployed.",
      emits: [event_org_setup_transitioned],
    },
    authorize: {
      from: ["awaiting_authorization"],
      to: "processing",
      about: "The founder signed the install approval and approvals sent it (approval_transitioned).",
      emits: [event_org_setup_transitioned],
    },
    complete: {
      from: ["processing"],
      to: "ready",
      about: "The install approval landed and its facts are final: steps gains installed, the founder's Seat is born.",
      guard: "The Gate is the Safe's only module and guard and the founder's Safe wears the Director and officer hats (indexing).",
      emits: [event_org_setup_transitioned],
    },
    stall: {
      from: ["processing", "awaiting_authorization"],
      to: "needs_attention",
      about: "A step stopped: its provider retries ran out, a service send reverted, or the install approval was refused, declined, displaced, expired or reverted.",
      emits: [event_org_setup_transitioned],
    },
    resume: {
      from: ["needs_attention"],
      to: "processing",
      about: "`org retry`: the process runs again from its last finished step, opening a fresh approval if the install is next.",
      emits: [event_org_setup_transitioned],
    },
    fail: {
      from: ["processing", "needs_attention"],
      to: "failed",
      about: "CompanySafeMinted names an owner other than the founder's Safe (the Party is released), or a step's answer is PROVIDER_RESPONSE_INVALID.",
      emits: [event_org_setup_transitioned],
    },
  },
});

export const event_org_member_transitioned = defineEvent({
  id: "org_member_transitioned",
  about: "A Seat was born (the founder at setup, an invitee at acceptance) or ended (an agent removed on chain).",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    member_id: S,
    party_id: S,
    kind: S,
  }),
  was: [`${O}/members/events.ts:1`],
});

export const machine_org_member = defineMachine({
  id: "org-member",
  title: "Seat",
  about:
    "org-members.status. A Seat is born active and ends only when the chain says its holder is gone (an agent removed " +
    "through AgentOwner). Losing a hat is not losing a Seat: authority is the hats, the Seat is membership. The old " +
    "legacy states and the reconciliation's revoke are gone.",
  was: [`${AS_IS}:1146`, `${MODEL}:11`],
  table: table_org_members,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "A current member: sees the workspace; acts as far as the hats its Safe wears allow." },
    { id: "removed", about: "The agent holding it was removed on chain.", terminal: true },
  ],
  transitions: {
    seat: {
      from: [],
      to: "active",
      about: "Birth: the founder's Seat and the FDE's (when the setup carries one) when the setup completes, or the invitee's when they accept.",
      emits: [event_org_member_transitioned],
    },
    remove: {
      from: ["active"],
      to: "removed",
      about: "AgentRemoved names the Seat's Safe.",
      emits: [event_org_member_transitioned],
    },
  },
});

export const event_org_invite_transitioned = defineEvent({
  id: "org_invite_transitioned",
  about:
    "An invitation changed phase: offered (with or without grants), opened, accepted, resent, declined, cancelled, " +
    "expired, or its chain cleanup began or ended. Notices sends the invitation email from it; budgets proposes the " +
    "removal of granted hats from it (`begin_cleanup`).",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    invitation_id: S,
    grantee_party_id: S,
    grantee_kind: S,
    ending_reason: NullOr(S),
  }),
  was: [`${O}/invitations/events/endings.ts:50`, `${O}/invitations/events/deliveries.ts:47`],
});

export const machine_org_invite = defineMachine({
  id: "org-invite",
  title: "Invitation phase",
  about:
    "org-invitations.phase, owned by the invitation's one durable process. A Seat-only offer is born pending; one with " +
    "grants is born authorizing and opens when the chain shows the company Safe ran the transaction budgets bound to it. " +
    "Pending until the invitee accepts or declines, the Organization cancels, or seven days pass. Ending an offer whose " +
    "grants are on chain goes through revoking: budgets proposes taking the hats back, and the process ends the offer when " +
    "the grantee's Safe wears none of them. `pending_grant` and `revoked` are gone: on v4 the grants are minted before " +
    "the offer opens, so accepting has nothing left to grant.",
  was: [`${AS_IS}:1264`, `${MODEL}:65`],
  table: table_org_invitations,
  field: "phase",
  initial: "pending",
  states: [
    { id: "authorizing", about: "Its grants wait for the Board's proposal of them to execute." },
    { id: "pending", about: "Open: the invitee may accept or decline until it expires." },
    { id: "active", about: "Accepted: the invitee holds a Seat.", terminal: true },
    { id: "revoking", about: "Ended with grants on chain: waiting for the Board to take the hats back." },
    { id: "declined", about: "The invitee declined.", terminal: true },
    { id: "cancelled", about: "The Organization cancelled it, or the proposal of its grants can no longer run.", terminal: true },
    { id: "expired", about: "Not accepted within seven days of opening.", terminal: true },
  ],
  transitions: {
    send: {
      from: [],
      to: "pending",
      about: "Birth of a Seat-only offer: open at once, expiring in seven days.",
      emits: [event_org_invite_transitioned],
    },
    send_with_grants: {
      from: [],
      to: "authorizing",
      about: "Birth of an offer with grants: budgets' flow proposes them next.",
      emits: [event_org_invite_transitioned],
    },
    open: {
      from: ["authorizing"],
      to: "pending",
      about: "The bound company Safe transaction executed (ExecutionSuccess indexed at finality); its minted hats are recorded.",
      emits: [event_org_invite_transitioned],
    },
    resend: {
      from: ["pending"],
      to: "pending",
      about: "Send the email again: the offer, its digest and its expiry do not move.",
      guard: "A mailbox, and at least a minute since last_sent_at.",
      emits: [event_org_invite_transitioned],
    },
    accept: {
      from: ["pending"],
      to: "active",
      about: "The invitee consents at the live digest; their Seat is born in the same transaction.",
      guard: "Not past expires_at, and the digest is the live one.",
      emits: [event_org_invite_transitioned],
    },
    decline: {
      from: ["pending"],
      to: "declined",
      about: "The invitee declines an offer with nothing on chain.",
      guard: "granted_hats is empty.",
      emits: [event_org_invite_transitioned],
    },
    cancel: {
      from: ["authorizing", "pending"],
      to: "cancelled",
      about: "The Organization cancels an offer with nothing on chain, or the proposal of its grants can no longer run (its nonce went to another transaction).",
      guard: "granted_hats is empty, and an authorizing offer's bound transaction cannot still execute.",
      emits: [event_org_invite_transitioned],
    },
    expire: {
      from: ["pending"],
      to: "expired",
      about: "The process's own timer at expires_at, for an offer with nothing on chain.",
      guard: "granted_hats is empty.",
      emits: [event_org_invite_transitioned],
    },
    begin_cleanup: {
      from: ["pending"],
      to: "revoking",
      about: "A decline, cancel or expiry of an offer whose hats are on chain: ending_reason is recorded, and budgets proposes their removal.",
      guard: "granted_hats is not empty.",
      emits: [event_org_invite_transitioned],
    },
    finish_declined: {
      from: ["revoking"],
      to: "declined",
      about: "The grantee's Safe wears none of the granted hats any more, for an offer the invitee declined.",
      emits: [event_org_invite_transitioned],
    },
    finish_cancelled: {
      from: ["revoking"],
      to: "cancelled",
      about: "The grantee's Safe wears none of the granted hats any more, for an offer the Organization cancelled.",
      emits: [event_org_invite_transitioned],
    },
    finish_expired: {
      from: ["revoking"],
      to: "expired",
      about: "The grantee's Safe wears none of the granted hats any more, for an offer that expired.",
      emits: [event_org_invite_transitioned],
    },
  },
});

export const event_org_app_transitioned = defineEvent({
  id: "org_app_transitioned",
  about:
    "An app was added to an Organization (installed native at birth, or wanted), installed on its head, removed or wanted " +
    "again. The head connection's process installs a wanted app from it.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, app: S, native: Schema.Boolean }),
});

export const machine_org_app = defineMachine({
  id: "org-app",
  title: "Organization app",
  about:
    "org-apps.status. A fundamental app is born installed and native and stays so. Any other app is born wanted and " +
    "becomes installed only when the connected head reports it in its installed apps; removing one stops Capxul from " +
    "asking the head for it (the head's owner uninstalls it).",
  table: table_org_apps,
  field: "status",
  initial: "installed",
  states: [
    { id: "wanted", about: "Asked for: waiting for a connected head to install it." },
    { id: "installed", about: "Running: natively in Capxul for a fundamental app, on the head for any other." },
    { id: "removed", about: "No longer wanted; never a fundamental app." },
  ],
  transitions: {
    install_native: {
      from: [],
      to: "installed",
      about: "Birth of a fundamental app, in `org create`'s transaction.",
      emits: [event_org_app_transitioned],
    },
    want: {
      from: [],
      to: "wanted",
      about: "Birth of any other app: asked for at start-up, or later by the FDE or a Director.",
      emits: [event_org_app_transitioned],
    },
    install: {
      from: ["wanted"],
      to: "installed",
      about: "The connected head's installed apps include it (readSite).",
      emits: [event_org_app_transitioned],
    },
    remove: {
      from: ["wanted", "installed"],
      to: "removed",
      about: "It is no longer wanted.",
      guard: "Not native.",
      emits: [event_org_app_transitioned],
    },
    want_again: {
      from: ["removed"],
      to: "wanted",
      about: "Asked for again.",
      emits: [event_org_app_transitioned],
    },
  },
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
