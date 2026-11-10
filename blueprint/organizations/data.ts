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
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
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
    "in the beta and after, raised when a seat purchase's Payment settles or by a Capxul operator " +
    "(organizations.seat-limit, organizations.buy-seats). Nothing here is a chain copy: " +
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
    /**
     * Seats it may fill: 10 at birth (aaron.seats); a settled seat purchase adds its seats and a reorg's reversal takes
     * them back (organizations.add-bought-seats, .return-bought-seats); an operator's raise (`organizations.seats.raise`)
     * sets it higher. Nothing else changes it.
     */
    seat_limit: N,
    /** Who last raised it: an operator's label, or `purchase` for a settled seat purchase; null while it has its first ten. */
    seat_limit_raised_by: NullOr(S),
    seat_limit_raised_at: NullOr(N),
    /** ERPNext Company.abbr: the suffix of the Organization's account names; 1 to 5 upper-case letters or digits. */
    abbr: S,
    /**
     * ERPNext Company.default_currency, ISO 4217: the country's currency unless the founder chose another, and only one
     * Capxul can value (USD, or a currency whose USD price pair the deployment lists); a country default with no pair
     * falls back to USD, and a chosen one with none is INVALID_INPUT (books.company-settings values every voucher in it).
     */
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
    "holds the schedule, and approvals hold the UserOperation. Unless the founder started without one (`with_fde` " +
    "false), the setup asks Capxul's FDE host to make the Organization's Forward Deployed Engineer once the company Safe " +
    "is minted (organizations.fde-at-start-up, aaron.fde-hosted): the host makes and keeps its key, and the setup keeps " +
    "only that key's address, the FDE's predicted Safe and its Party; the install batch creates the FDE on chain and the " +
    "setup seats it. Its hosting is `org-fdes`'.",
  was: [`${T}/setups.ts:35`, `${AS_IS}:203`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** The founder's principal: the approval's signer, and who may read and resume the setup before it is ready. */
    founder_principal_id: S,
    /**
     * Hash of name, handle, country, bio, size, logo and the start-up choices (currency, time zone, fiscal-year start,
     * apps, and whether it starts with an FDE) as begun: the same intent resumes, another refuses.
     */
    intent_hash: S,
    /** Whether the Organization starts with its hosted FDE: false only for `org create --no-fde`. */
    with_fde: Schema.Boolean,
    status: Schema.Literals(["processing", "awaiting_authorization", "needs_attention", "ready", "failed"]),
    steps: Schema.Array(SetupStep),
    mint_tx_hash: NullOr(S),
    deploy_tx_hash: NullOr(S),
    /** The founder's install batch: an approval opened with `approvals.open` in this concept's transaction. */
    install_approval_id: NullOr(S),
    issue: NullOr(SetupIssue),
    /**
     * The FDE's key (its address only), made and held by Capxul's FDE host when the setup asked it; null before then and
     * when the Organization starts without one. The key itself never leaves the host.
     */
    fde_signer: NullOr(S),
    /** AgentOwner.safeAddressFor(fde_signer, the company Safe), computed when the host answered. */
    fde_safe: NullOr(S),
    /** The FDE's Party, registered pending when the host answered, activated when the install lands, released if the setup fails. */
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
    "Organization's FDE is seated by its setup, before it has ever signed in, so its `principal_id` stays null (nothing " +
    "writes it when the FDE signs in); an agent's session is always matched to its Seat by its Safe (`by_org_safe`), " +
    "which access' principals hold one to one, so every concept's tenant guard looks an agent up by Safe " +
    "(organizations.fde-seat).",
  was: [`${T}/members.ts:10`, `${AS_IS}:391`],
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    member_id: S,
    party_id: S,
    /** The access principal: a person, or an agent; null for an FDE's Seat, which is matched by its Safe. */
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

// ── seat purchases (aaron.buy-seats) ────────────────────────────────────────────────────────

export const table_org_seat_purchases = defineTable({
  id: "org-seat-purchases",
  title: "Seat purchases: the seats an Organization bought, one row per settled Payment",
  about:
    "One row per Payment that bought seats (organizations.buy-seats). Payments births the purchase's command at the " +
    "deployment's seat price and settles it on its terms; in the settling transaction it invokes " +
    "`organizations.add-bought-seats`, which records the purchase here and raises the Organization's `seat_limit` by its " +
    "seats under the Organization row's lock, so the limit rises exactly when the payment settles. A reorg below " +
    "finality that reopens the Payment takes the seats back (`organizations.return-bought-seats`), and the same Payment " +
    "settling again adds them again: the Organization holds bought seats exactly while the chain shows them paid for. " +
    "The amount, token and settling transaction are copied from the settled Payment so the seats read (`org seats " +
    "show`, organizations.seats-show) and the operator's raise can list what was bought without reading payments, which sits " +
    "above; the Payment and its book fact stay payments' and books'. `org_id` is the paying command's owner. A " +
    "bought seat is kept for good: nothing else frees one.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** The settled Payment that bought them: one purchase per Payment. */
    payment_id: S,
    command_id: S,
    /** How many seats it bought, 1 to 1,000. */
    seats: N,
    status: Schema.Literals(["counted", "returned"]),
    chain_id: N,
    token_address: S,
    /** The stablecoin's symbol, as the deployment lists it (`USDC`). */
    asset: S,
    /** What the Payment paid, in the token's units: the seats times the price in force when its command was born. */
    amount_raw: S,
    /** The member who bought them (their Party). */
    bought_by_party_id: S,
    /** The Organization's limit once these seats were counted. */
    limit_after: N,
    tx_hash: S,
    block_number: N,
    counted_at: N,
    returned_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "payment_id"],
  indexes: [
    {
      name: "by_org_counted",
      fields: ["org_id", "counted_at", "payment_id"],
      for: "The Organization's purchases in the order they were counted: the seats bought that the raise and `org seats show` report.",
    },
  ],
  retention: KEPT,
});

// ── apps: which Frappe apps the Organization runs, and where ───────────────────────────────

/**
 * The fundamental apps every Organization starts with (aaron.frappe-shape), and the modules Capxul holds natively, by
 * each app's module folder: Frappe CRM's one module is FCRM (`crm/fcrm`, modules.txt), not `crm`.
 */
export const FUNDAMENTAL_APPS = [
  { app: "frappe", modules: ["core"] },
  { app: "erpnext", modules: ["accounts", "projects"] },
  { app: "hrms", modules: ["payroll"] },
  { app: "crm", modules: ["fcrm"] },
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
    /** For a native app, the modules whose records Capxul holds, by module folder (`accounts`, `fcrm`); empty for a head app. */
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
      for: "The wanted apps a newly connected head is asked to install, and the installed apps `org head show` lists.",
    },
  ],
  retention: KEPT,
});

// ── head: the Organization's connected Frappe site ──────────────────────────────────────────

// ── the hosted FDE (aaron.fde-hosted): its hosting, what paid for it, and who asked it what ──

/** The calendar months one hosting payment may buy: 1 to 12 (organizations.fde-hosting). */
export const MAX_HOSTING_MONTHS = 12;

/** The Frappe apps Capxul can ask a head's host to install, beyond the fundamental ones (organizations.app-commands). */
export const HEAD_APPS = [
  "helpdesk", "insights", "lms", "wiki", "drive", "gameplan", "builder", "print_designer", "lending", "education",
  "healthcare", "webshop", "ecommerce_integrations",
] as const;

export const table_org_fdes = defineTable({
  id: "org-fdes",
  title: "Hosted FDEs: the Organization's Forward Deployed Engineer on Capxul's host",
  about:
    "One row per Organization whose Forward Deployed Engineer Capxul hosts (aaron.fde-hosted): a durable agent on a " +
    "durable runtime with sandboxes, which Capxul's FDE host (swarmD, organizations.fde-host) runs for the Organization. " +
    "Born when the setup's `host-fde` step has the host's answer: the host's id for the agent, the key's address the " +
    "host made and keeps (never the key), the FDE's predicted Safe and its Party. Its one durable process " +
    "(`organizations.fde.host`) starts the agent on the host when the setup is ready, pauses it when its hosting lapses " +
    "and resumes it when it is paid again (organizations.fde-hosting). `paid_through` is the instant its hosting is paid " +
    "to: the start-up month from the setup's readiness, then moved on by each settled hosting payment " +
    "(`organizations.extend-fde-hosting`, invoked by payments' settlement) and back by a reorg's reversal; null while the " +
    "deployment sets no FDE_HOSTING_PRICE, when hosting is not charged. Nothing here is a chain fact: the FDE's Safe, " +
    "its hats and its owner (the company Safe) are read from indexing, and its agent row is agents'.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** The host's id for this Organization's FDE agent: `fde:<orgId>`, so a repeated provision finds the same agent. */
    host_agent_id: S,
    party_id: S,
    safe_address: S,
    /**
     * The key's address the host made. Never replaced: only the company Safe can swap an agent's key (AgentOwner.swapSigner),
     * `agent key rotate` makes the new key on a Director's machine, and the host makes no second key, so a landed rotation
     * retires the hosting.
     */
    signer_address: S,
    status: Schema.Literals(["provisioned", "running", "due", "paused", "resuming", "retired"]),
    /** When the host first started it, once the setup was ready. */
    started_at: NullOr(N),
    /** The instant its hosting is paid to; null while hosting is not charged (no FDE_HOSTING_PRICE). */
    paid_through: NullOr(N),
    /** When it last paused for an unpaid month, and when it last resumed. */
    paused_at: NullOr(N),
    resumed_at: NullOr(N),
    retired_at: NullOr(N),
    retire_reason: NullOr(Schema.Literals(["setup_failed", "agent_removed", "key_moved"])),
    /** The last time anyone asked it something (`org fde ask`), and who: a member's id, or a guest's. */
    last_asked_at: NullOr(N),
    last_asked_by: NullOr(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [
    {
      name: "by_safe",
      fields: ["safe_address"],
      unique: true,
      crossTenant: true,
      for: "The hosting an AgentRemoved or AgentSignerSwapped names by the FDE's Safe.",
    },
  ],
  retention: KEPT,
});

/** How long an ask lets the hosted FDE act for its asker, at most, on the world's clock (organizations.fde-for-the-asker). */
export const FDE_ASK_HOURS = 4;

// ── the document family (aaron.sdk-reaches-everything): what it may reach, and its log ───────

/**
 * The DocTypes a native concept holds outside its app's native modules (FUNDAMENTAL_APPS' `modules`, whose every DocType
 * is native too): the document family refuses each by name, before any call, naming the commands that reach it
 * (organizations.doc-reach). Each concept that holds another DocType natively adds it here, book first. The HR rows are
 * exactly payroll.hr-scope's native ones, with the commands payroll.hr-commands booked (Leave Policy, Leave Period,
 * compensatory leave, Attendance Request and Shift Request stay on the head, reached through the family; Leave
 * Encashment is money), and Leave Adjustment, which writes only the head's leave ledger (payroll.hr-head-documents); the WhatsApp rows are the DocTypes of Frappe's WhatsApp app (github.com/frappe/whatsapp, module
 * WhatsApp) that contacts holds (contacts.conversations-shape). Communication is in Frappe's core module, native anyway,
 * and is listed so that its refusal names the CRM's email commands, which hold it, rather than core's none.
 */
export const NATIVE_DOCTYPES = [
  { doctype: "Company", concept: "organizations", commands: "`org show`" },
  { doctype: "Department", concept: "budgets", commands: "`org department`" },
  { doctype: "Employee", concept: "payroll", commands: "`org hr employee`" },
  { doctype: "Customer", concept: "parties", commands: "`contact` (the Organization's book)" },
  { doctype: "Supplier", concept: "parties", commands: "`contact` (the Organization's book)" },
  { doctype: "Contact", concept: "contacts", commands: "`contact`" },
  { doctype: "Address", concept: "contacts", commands: "`contact`" },
  { doctype: "Currency", concept: "books", commands: "`org books assets`" },
  { doctype: "Holiday List", concept: "payroll", commands: "`org hr holiday`" },
  { doctype: "HR Settings", concept: "payroll", commands: "none: Capxul fixes its values (payroll's `hr-settings`)" },
  { doctype: "Leave Type", concept: "payroll", commands: "`org hr leave-type`" },
  { doctype: "Leave Allocation", concept: "payroll", commands: "`org hr leave allocate`, `unallocate` and `balance`, and `hr leave balance`" },
  { doctype: "Leave Adjustment", concept: "payroll", commands: "`org hr leave allocate` and `unallocate` (it writes only the leave ledger, which Capxul does not keep)" },
  { doctype: "Leave Application", concept: "payroll", commands: "`hr leave` and `org hr leave`" },
  { doctype: "Shift Type", concept: "payroll", commands: "`org hr shift-type`" },
  { doctype: "Shift Assignment", concept: "payroll", commands: "`org hr shift-type assign` and `unassign`" },
  { doctype: "Employee Checkin", concept: "payroll", commands: "`hr attendance checkin` and `list`" },
  { doctype: "Attendance", concept: "payroll", commands: "`hr attendance list` and `org hr attendance`" },
  { doctype: "Expense Claim Type", concept: "payroll", commands: "`org hr expense-type`" },
  { doctype: "Expense Claim", concept: "payroll", commands: "`hr expense-claim` and `org hr expense-claim`" },
  { doctype: "Employee Advance", concept: "payroll", commands: "`hr advance` and `org hr advance`" },
  { doctype: "WA Account", concept: "contacts", commands: "`org crm whatsapp connect`, `show` and `disconnect`" },
  { doctype: "WA Message", concept: "contacts", commands: "`org crm whatsapp send` and `org crm timeline`" },
  { doctype: "Communication", concept: "contacts", commands: "`org crm email send` and `org crm timeline`" },
] as const;

/**
 * What a refusal of a native module's DocType names, by module folder (FUNDAMENTAL_APPS): the head's Capxul app answers
 * the module, which only the head knows for each DocType, and Capxul names these commands (organizations.doc-reach):
 * the module's group, with the person's side where one has it, as NATIVE_DOCTYPES' HR rows name both sides
 * (organizations.head-fit).
 */
export const NATIVE_MODULE_COMMANDS = {
  core: "none: Frappe's core (Users, roles, files, comments, messages) is identity and channels, which are Capxul's",
  accounts: "`org books`",
  projects: "`org projects`, with its `member`, `settings`, `task`, `timesheet`, `activity-type` and `project-type`",
  payroll: "`org payroll` and `payroll` (an advance's Additional Salary: `org hr advance settle`)",
  fcrm: "`org crm` and `contact`",
} as const;

/**
 * The head's own machinery outside Frappe's core module (which is native): DocTypes that change who may do what on the
 * head or what a DocType is (its fields, properties and Workflow), run code there, move data in or out in bulk, let
 * someone with no User write through a web form, hold the head's sign-in or outside credentials, or send through a
 * channel of the head's own (a Notification also sets a field on whatever document it fires for). The family refuses
 * each by name, before any call, because identity is Capxul's and each would reach native or money records, or the
 * world's channels, around the family's guard (organizations.doc-reach). Checked against Frappe develop
 * (github.com/frappe/frappe@1a7ea577): custom (Client Script, Custom Field, Property Setter, Customize Form), workflow
 * (Workflow), email (Notification, Email Account, Email Domain), website (Web Form, Website Script), desk (System
 * Console, Bulk Update), automation (Auto Repeat) and integrations (the rest). The last four, added by
 * organizations.reach-holes, exist to send through the head's own mail or SMS: Frappe's Auto Email Report (email) and
 * Newsletter (Frappe's email module up to v15, its own app since), and ERPNext's Email Digest (setup) and SMS Center
 * (selling), read in erpnext@6b946b0.
 */
export const HEAD_MACHINERY = [
  "Client Script", "Custom Field", "Property Setter", "Customize Form", "Workflow", "Notification", "System Console",
  "Bulk Update", "Webhook", "OAuth Client", "OAuth Bearer Token", "Social Login Key", "LDAP Settings", "Connected App",
  "Token Cache", "Email Account", "Email Domain", "Web Form", "Website Script", "Auto Repeat",
  "Auto Email Report", "Newsletter", "Email Digest", "SMS Center",
] as const;

/**
 * The hooks by which the head's installed apps declare the DocTypes that post to the ledger, close with a period, take
 * advance payments, reconcile with a bank, keep an audit trail or may have their ledger reposted (merged across apps, as
 * `frappe.get_hooks` merges them): the Capxul app refuses any DocType they list, and its child tables, as money
 * (organizations.doc-reach). They list most of what posts, not all: see LEDGER_UNHOOKED and MONEY_MODULES. A child table
 * they list under a parent they do not (Material Request Item, Request for Quotation Item, Asset Movement Item) makes no
 * money of its parent: the parent is judged by its own listing, and the child, as every child table, is reached only
 * through it (organizations.reach-holes).
 */
export const LEDGER_HOOKS = [
  "accounting_dimension_doctypes", "period_closing_doctypes", "advance_payment_receivable_doctypes",
  "advance_payment_payable_doctypes", "bank_reconciliation_doctypes", "audit_trail_doctypes", "repost_allowed_doctypes",
] as const;

/**
 * DocTypes outside the native modules that post or re-post the head's ledger though no hook lists them, refused as money
 * by name before any call (organizations.doc-reach): ERPNext's Repost Item Valuation (stock module; an Accounts Manager,
 * which the Books hat gives, may create and submit one, and its repost rewrites the stock and general ledger entries of
 * the vouchers it names, `repost_gl_entries`), and ERPNext's Transaction Deletion Record (setup module; submitted, it
 * deletes every transaction of a Company, its ledger entries with them; organizations.reach-holes). A lane that finds
 * another adds it here, book first.
 */
export const LEDGER_UNHOOKED = ["Repost Item Valuation", "Transaction Deletion Record"] as const;

/**
 * Modules of an app Capxul can ask a head to install (HEAD_APPS) whose every DocType counts as money, which the Capxul app
 * refuses by module as it refuses a native module's (organizations.doc-reach): Frappe Lending's Loan Management, whose
 * loans, disbursements, repayments, accruals, transfers and their reposting and processing documents post the loan
 * ledger, several of them (Loan Accrual Repost, Loan Repayment Repost, Loan Transfer, Process Loan Accounting) listed in
 * none of its hooks.
 */
export const MONEY_MODULES = [{ app: "lending", modules: ["loan_management"] }] as const;

/** The verbs the document family's calls take, as `org-doc-calls` records them. */
export const DocVerb = Schema.Literals([
  "list", "get", "create", "change", "submit", "cancel", "amend", "apply", "remove", "doctypes", "doctype",
]);

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

export const event_seat_purchase_transitioned = defineEvent({
  id: "seat_purchase_transitioned",
  about:
    "A seat purchase was counted (its Payment settled), taken back by a reorg, or counted again. A reader of the funnel " +
    "sees how many seats were bought and when; notices may tell the buyer.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, payment_id: S, seats: N }),
});

export const machine_seat_purchase = defineMachine({
  id: "seat-purchase",
  title: "Seat purchase",
  about:
    "org-seat-purchases.status, driven only by organizations' two doors inside payments' transactions. Born counted " +
    "when its Payment settles, which raises the limit; returned when a reorg reopens that Payment, which lowers it again; " +
    "counted again when the Payment settles once more. Seats and live offers already past a lowered limit stay; the next " +
    "offer is refused until the count is under it.",
  table: table_org_seat_purchases,
  field: "status",
  initial: "counted",
  states: [
    { id: "counted", about: "Its Payment is settled: its seats are in the Organization's limit." },
    { id: "returned", about: "A reorg took its PaymentSent away: its seats are out of the limit until the Payment settles again." },
  ],
  transitions: {
    add: {
      from: [],
      to: "counted",
      about: "Birth: the Payment that bought the seats settled; the limit rises by its seats.",
      emits: [event_seat_purchase_transitioned],
    },
    take_back: {
      from: ["counted"],
      to: "returned",
      about: "A reorg below finality reopened the Payment; the limit falls by its seats.",
      emits: [event_seat_purchase_transitioned],
    },
    add_again: {
      from: ["returned"],
      to: "counted",
      about: "The reopened Payment settled again; the limit rises by its seats once more.",
      emits: [event_seat_purchase_transitioned],
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

export const event_org_fde_transitioned = defineEvent({
  id: "org_fde_transitioned",
  about:
    "An Organization's hosted FDE was provisioned on the host, started, fell due, paused for an unpaid month, was paid " +
    "(extended, or woken from a pause), resumed or retired. Notices reminds the Directors from `fall_due` and `pause`; " +
    "agents writes the FDE's agent row from `provision`.",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    safe_address: S,
    paid_through: NullOr(N),
  }),
});

export const machine_org_fde = defineMachine({
  id: "org-fde",
  title: "Hosted FDE",
  about:
    "org-fdes.status, owned by the hosting's one durable process except the two moves a settled hosting payment makes " +
    "(`extend`, `wake`, driven by `organizations.extend-fde-hosting` in payments' settling transaction). Born provisioned " +
    "when the host has made the FDE's key; running once the setup is ready and the host started it; due seven days " +
    "before `paid_through`; paused when `paid_through` passes unpaid; resuming once paid again, until the host has " +
    "resumed it; retired for good when the setup failed, the chain removed the agent, or its key moved off the host.",
  table: table_org_fdes,
  field: "status",
  initial: "provisioned",
  states: [
    { id: "provisioned", about: "The host made the FDE's key; it waits for the install to create it on chain and the setup to be ready." },
    { id: "running", about: "Running on the host: it answers `org fde ask`, and acts for each asker through the CLI as that asker." },
    { id: "due", about: "Running, with its hosting paid through a day less than seven days ahead: the Directors are reminded." },
    { id: "paused", about: "Its hosting lapsed unpaid: the host keeps its key, conversation and workspace, and it takes no turn." },
    { id: "resuming", about: "Paid again: waiting for the host to resume it." },
    { id: "retired", about: "Hosting ended: the setup failed, the agent was removed, or its key is no longer the host's.", terminal: true },
  ],
  transitions: {
    provision: {
      from: [],
      to: "provisioned",
      about: "Birth: the setup's `host-fde` step has the host's answer (its agent id and key's address).",
      emits: [event_org_fde_transitioned],
    },
    start: {
      from: ["provisioned"],
      to: "running",
      about: "The setup is ready: the host started the FDE, and its start-up month begins (`paid_through`, when a price is set).",
      emits: [event_org_fde_transitioned],
    },
    fall_due: {
      from: ["running"],
      to: "due",
      about: "Seven days before `paid_through`, by the process's own timer.",
      emits: [event_org_fde_transitioned],
    },
    extend: {
      from: ["running", "due"],
      to: "running",
      about: "A hosting payment settled: `paid_through` moved on by its months (the door, in payments' settlement).",
      emits: [event_org_fde_transitioned],
    },
    pause: {
      from: ["running", "due"],
      to: "paused",
      about: "`paid_through` passed unpaid: the host paused the FDE.",
      emits: [event_org_fde_transitioned],
    },
    wake: {
      from: ["paused"],
      to: "resuming",
      about: "A hosting payment settled while it was paused: `paid_through` runs on from the settlement (the door).",
      emits: [event_org_fde_transitioned],
    },
    resume: {
      from: ["resuming"],
      to: "running",
      about: "The host resumed the FDE.",
      emits: [event_org_fde_transitioned],
    },
    retire: {
      from: ["provisioned", "running", "due", "paused", "resuming"],
      to: "retired",
      about: "The setup failed, AgentRemoved names its Safe, or AgentSignerSwapped names a key the host did not make; the host retired its runtime.",
      emits: [event_org_fde_transitioned],
    },
  },
});

