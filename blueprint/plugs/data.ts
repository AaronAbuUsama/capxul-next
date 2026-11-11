// The plugs' data: what Core keeps so that a hosted Frappe site can sign in through Capxul, hold a payment until the chain
// confirms it, take its roles from hats, and write its books from the chain. Frappe keeps its own records of all of this
// (the User, the Payment Entry, the Capxul Feature rows); these are Core's, the chain's side of each join.
//
// Three state machines, each with its one event (P7): a held payment (payment-request), a hat's grant of roles (role-grant)
// and one event of the outbox (site-event). Times are epoch milliseconds, as organizations' are. Written from the spike in
// spikes/skeleton (its Core stand-in and its Frappe half); where a column states what Frappe does, FINDINGS is the evidence.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_plugs } from "../shared/foundation.ts";
import { B, J, N, Null, S, FIND } from "./kit.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";
const ORG = "The Organization is the tenant (P8): `org_id` leads the key and every index.";

export const SiteEventKind = Schema.Literals(["hat_granted", "hat_revoked", "payment_sent", "payment_failed", "payment_reversed", "org_created", "feature_changed"]);
export const SiteEventState = Schema.Literals(["pending", "applied", "set_aside", "unmatched"]);
export const PaymentRequestState = Schema.Literals(["waiting", "sent", "failed", "mismatch", "abandoned", "reversed"]);
export const RoleGrantState = Schema.Literals(["pending", "applied", "failed", "revoked"]);

// ── sign-in: the provider's side ────────────────────────────────────────────────────────────

export const table_oauth_clients = defineTable({
  id: "oauth-clients",
  title: "OAuth clients: the one client each company's site signs in with",
  about:
    "One row per site: its client id, the hash of its client secret (the secret is shown once, to the site service that writes it " +
    "into the site's Social Login Key), and the exact redirect addresses it registered. The provider matches a redirect " +
    "exactly; the skeleton's stand-in accepted any, which a real provider must not (FINDINGS, Core half: Other things the " +
    "contract got wrong). A secret is replaced by rotating it; the old hash stops resolving at once.",
  was: [`${SPIKE} (Core half: the OAuth stand-in)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    client_id: S,
    secret_hash: S,
    redirect_uris: Schema.Array(S),
    site_host: S,
    created_at: N,
    rotated_at: Null(N),
  }),
  key: ["org_id", "client_id"],
  indexes: [
    { name: "oauth-clients-by-id", fields: ["client_id"], unique: true, crossTenant: true, for: "The provider finds the client a request names before it knows the Organization." },
  ],
  retention: "Kept while the site exists.",
});

export const table_oauth_codes = defineTable({
  id: "oauth-codes",
  title: "OAuth codes: the single-use code a sign-in hands back to a site",
  about:
    "One row per authorization: the hash of the code, the person it was granted to, the client and when it expires (ten minutes). " +
    "The token request marks it used; a second use, an expired code or a code for another client is refused. A code is only " +
    "granted to a person who has a row in site-users for that Organization, so a person no hat created never gets one.",
  was: [`${SPIKE} (Frappe half: Sign-in verified end to end against the Core stub)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({ org_id: S, code_hash: S, person_id: S, client_id: S, expires_at: N, used_at: Null(N) }),
  key: ["org_id", "code_hash"],
  indexes: [{ name: "oauth-codes-by-hash", fields: ["code_hash"], unique: true, crossTenant: true, for: "The token request finds the code a client presents." }],
  retention: "Swept an hour after it expires.",
});

export const table_site_users = defineTable({
  id: "site-users",
  title: "Site users: the Frappe user each person's hat made",
  about:
    "One row per (Organization, person): the person's Capxul account address, their email and name, and the Frappe user id " +
    "that stands for them. A row exists only because a hat was granted (`created_by_grant_id`); a person who changes email keeps " +
    "the row, because the key is the person and the address, never the email (FINDINGS, End to end: What the design must now " +
    "decide, 1: the Frappe user carries the address). The site's Administrator has no row: it is Capxul's break-glass account, " +
    "never a customer's (plugs.administrator).",
  was: [`${SPIKE} (Frappe half: Roles follow hats; What the design must now decide, 1)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    person_id: S,
    address: S,
    email: S,
    name: S,
    frappe_user: S,
    created_by_grant_id: S,
    status: Schema.Literals(["active", "disabled"]),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "person_id"],
  indexes: [
    { name: "site-users-by-address", fields: ["org_id", "address"], unique: true, for: "A signer's address resolves to the person and their Frappe user." },
    { name: "site-users-by-frappe-user", fields: ["org_id", "frappe_user"], unique: true, for: "A call from a site names its session user; Core finds the person." },
  ],
  retention: "Kept for ever: a disabled user stays so the record of who did what keeps its names.",
});

// ── roles follow hats ───────────────────────────────────────────────────────────────────────

export const table_hat_role_map = defineTable({
  id: "hat-role-map",
  title: "The hat-to-role map: which Frappe roles each hat's jobs need",
  about:
    "Rows of (map version, hat, job, role): a hat's roles are decided from the jobs the hat does, one row per job, and each job has " +
    "one eval that does it on a real site as a person wearing only that hat. The map ships inside the Capxul app and is not " +
    "editable on a site; a new version is a release of the app and replays to people already wearing the hat (additions only, as " +
    "the spike's top-up did). `scope` says whether a role is limited to the person's department. The skeleton's first map failed real " +
    "work: `admin` could not create a Supplier, and `budget-holder` cannot either (FINDINGS, End to end: What broke, 1).",
  was: [`${SPIKE} (End to end: What broke when the halves met, 1; CRM: Roles)`],
  concept: concept_plugs,
  tenancy: "global",
  scope: "The same for every Organization: it ships with the app, so no Organization writes it.",
  fields: Schema.Struct({
    map_version: S,
    hat: S,
    job: S,
    role: S,
    scope: Schema.Literals(["organization", "department"]),
    about: S,
  }),
  key: ["map_version", "hat", "job", "role"],
  indexes: [{ name: "hat-role-map-by-hat", fields: ["map_version", "hat"], for: "The projection reads every role a hat gives under a map version." }],
  retention: "Kept: a grant names the version it applied.",
});

export const table_role_grants = defineTable({
  id: "role-grants",
  title: "Role grants: a hat's roles, applied to one person's Frappe user",
  about:
    "One row per (person, hat, department) the chain granted: the roles it added, the map version it used, the chain log it came " +
    "from and its state (role-grant). A role two hats give stays while one of the grants remains: a revoke removes only the roles no " +
    "remaining grant gives (FINDINGS, Frappe half: Roles follow hats). A change of the map between grant and revoke is not replayed " +
    "by a revoke; the drift check finds it.",
  was: [`${SPIKE} (Frappe half: Capxul Hat Grant)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    grant_id: S,
    person_id: S,
    address: S,
    hat: S,
    department: Null(S),
    roles: Schema.Array(S),
    map_version: S,
    chain_tx_hash: S,
    chain_log_index: N,
    status: RoleGrantState,
    failure: Null(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "grant_id"],
  indexes: [
    { name: "role-grants-by-person", fields: ["org_id", "person_id", "status"], for: "A revoke finds the person's other live grants to keep their shared roles." },
    { name: "role-grants-by-log", fields: ["org_id", "chain_tx_hash", "chain_log_index"], unique: true, for: "A replayed hat event finds the grant it made and changes nothing." },
  ],
  retention: "Kept for ever.",
});

// ── books from the chain: the ordered outbox ────────────────────────────────────────────────

export const table_site_events = defineTable({
  id: "site-events",
  title: "Site events: every chain event a site applies, in order",
  about:
    "The outbox. One row per event for one Organization: its number (`seq`, gap-free from 1, assigned by Core when it enqueues), its key " +
    "(`chainId:txHash:logIndex`, never the block hash, which a reorg changes; delivered only after finality), its kind, its data and " +
    "whether it moves money. Core resends until the site answers it applied, and the site answers a repeated key as already " +
    "applied. After retries an event the site cannot apply is set aside (non-money) or posted as an unmatched bank line (money) so " +
    "that it never blocks the rest (plugs.poison-event). It is the log of record: a new site for an old Organization receives " +
    "it from number 1 (plugs.history-lives-in-core). `payment_failed` is Core's own attestation, not a chain log, so it is rebuilt from " +
    "payment-requests, never from the chain.",
  was: [`${SPIKE} (Core half: What the ordering guarantee really costs; Frappe half: What I changed, 5)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    seq: N,
    event_key: S,
    kind: SiteEventKind,
    data: J,
    money: B,
    status: SiteEventState,
    attempts: N,
    last_error: Null(S),
    created_at: N,
    applied_at: Null(N),
    updated_at: N,
  }),
  key: ["org_id", "seq"],
  indexes: [
    { name: "site-events-by-key", fields: ["org_id", "event_key"], unique: true, for: "A repeated chain log enqueues nothing new." },
    { name: "site-events-by-status", fields: ["org_id", "status", "seq"], for: "Delivery reads the oldest pending event; the status command lists what is set aside." },
  ],
  retention: "Kept for ever: it is how a site is rebuilt.",
});

export const table_site_cursors = defineTable({
  id: "site-cursors",
  title: "Site cursors: where each site has got to in its event stream",
  about:
    "One row per Organization: the next number to assign, the last number the site applied, the epoch of the chain it follows and " +
    "whether delivery is flowing or blocked. A 409 from the site names the number it expects; Core moves back to it and resends in order, " +
    "going backwards if the site was restored from a backup. A chain reset is an epoch change: the cursor records it so a stale site is " +
    "reported, not guessed at (FINDINGS, Core half: A chain reset is an epoch change the contract does not model).",
  was: [`${SPIKE} (Core half: Frappe's view wins on 409)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    next_seq: N,
    last_applied_seq: N,
    chain_epoch: N,
    state: Schema.Literals(["flowing", "blocked"]),
    blocked_seq: Null(N),
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [{ name: "site-cursors-by-state", fields: ["org_id", "state"], for: "The delivery process and the status command read whether a site is blocked." }],
  retention: "Kept while the site exists.",
});

// ── the signer: the held payment ────────────────────────────────────────────────────────────

export const table_payment_requests = defineTable({
  id: "payment-requests",
  title: "Payment requests: a payment held until the chain confirms it",
  about:
    "One row per payment a person started in Frappe from the Safe's bank account: the document (doctype, name), its hash under CANON v1, who " +
    "asked, whose signature is awaited (`awaiting`, the signer's address, which may not be the requester), the payee and amount, the cost centre " +
    "and account code that travel with it on chain, the approval that carries the signature, and the transaction hash once it lands. It lives in " +
    "Core because a Frappe hook that throws rolls its own rows back: the skeleton measured a request inserted in a before-submit hook vanishing " +
    "(FINDINGS, Frappe half: Paying a document, route 1). The Payment Entry in Frappe stays a draft in `waiting` and is submitted only when " +
    "this row says sent. The request starts as a row the site writes in its own outbox, in the same transaction as the document's waiting state; the " +
    "service collects it by asking the site for requests after a cursor, so the site never calls the service (plugs.service-calls-site), and this row records it with the trace id and idempotency key that travelled with it.",
  was: [`${SPIKE} (Frappe half: Paying a document; INTERFACE.md: Frappe to Core /prepare, now collected by the service)`],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({
    org_id: S,
    request_id: S,
    doctype: S,
    docname: S,
    document_hash: S,
    requested_by: S,
    awaiting: S,
    to_party: S,
    to_address: S,
    amount: S,
    asset: S,
    department: Null(S),
    cost_centre: Null(S),
    account_code: Null(S),
    approval_id: Null(S),
    payment_id: Null(S),
    trace_id: S,
    idempotency_key: S,
    site_cursor: S,
    status: PaymentRequestState,
    failure_reason: Null(S),
    tx_hash: Null(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "request_id"],
  indexes: [
    { name: "payment-requests-by-document", fields: ["org_id", "doctype", "docname", "status"], for: "A second prepare for the same draft and hash answers the same request." },
    { name: "payment-requests-by-hash", fields: ["org_id", "document_hash"], for: "A PaymentSent matches its request by the document hash it carries." },
    { name: "payment-requests-awaiting", fields: ["org_id", "awaiting", "status"], for: "The signer's list: what each address has been asked to sign." },
  ],
  retention: "Kept for ever: a payment is a record of money.",
});


export const table_site_request_cursors = defineTable({
  id: "site-request-cursors",
  title: "Request cursors: where the service has got to in a site's request outbox",
  about:
    "One row per Organization: the cursor of the last payment request the service collected from the site's outbox and the time of the last poll. The service asks the site for requests after the cursor " +
    "(a poll or a long-poll) and answers each by calling the site with the approval or the refusal. A site that was down simply has more after the cursor when it returns: nothing is lost, and the site never needs " +
    "a route to the service (plugs.service-calls-site).",
  was: ["spikes/skeleton/INTERFACE.md (Frappe to Core /prepare, which this replaces)"],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({ org_id: S, cursor: S, polled_at: N, state: Schema.Literals(["polling", "unreachable"]), updated_at: N }),
  key: ["org_id"],
  indexes: [{ name: "site-request-cursors-by-state", fields: ["org_id", "state"], for: "The collect process and the status command read whether a site is unreachable." }],
  retention: "Kept while the site exists.",
});

export const table_site_links = defineTable({
  id: "site-links",
  title: "Site links: the one-time sign-in links the service asked a site to mint",
  about:
    "One row per link minted for a person who only watches (a viewer grant) or for a session the service obtained: the person, the kind (view or session), when it was minted and when it expires. The site mints and checks the " +
    "link; Core keeps only this audit row, never the link. A viewer's link is read-only and one-time.",
  was: ["docs/mission/worlds.md (decision 7: a viewer grant)"],
  concept: concept_plugs,
  tenancy: "organization",
  tenantField: "org_id",
  scope: ORG,
  fields: Schema.Struct({ org_id: S, link_id: S, person_id: S, kind: Schema.Literals(["view", "session"]), minted_at: N, expires_at: N }),
  key: ["org_id", "link_id"],
  indexes: [{ name: "site-links-by-person", fields: ["org_id", "person_id", "minted_at"], for: "A person's recent links, newest first." }],
  retention: "Kept for ever with the world's record.",
});

// ── events ──────────────────────────────────────────────────────────────────────────────────

export const event_payment_request_transitioned = defineEvent({
  id: "payment_request_transitioned",
  about:
    "A payment held for a Frappe document changed state: prepared (waiting for a signature), sent (the chain confirmed it), failed (refused or reverted), " +
    "hash mismatch (the draft changed after it was prepared), abandoned (the person cancelled the draft) or reversed (a paid document was cancelled, so " +
    "money came back by a new payment). Carries the Organization, the request, the doctype and the new state; never the amount, the party or the address. " +
    "The 'pay an invoice from Frappe' funnel reads it.",
  props: Schema.Struct({
    from: Null(PaymentRequestState),
    to: PaymentRequestState,
    transition: Schema.Literals(["prepare", "land", "fail", "mismatch", "abandon", "reverse"]),
    org_id: S,
    request_id: S,
    doctype: S,
  }),
  was: [`${SPIKE} (Frappe half: Paying a document)`],
});

export const event_role_grant_transitioned = defineEvent({
  id: "role_grant_transitioned",
  about:
    "A hat's grant of Frappe roles changed state: recorded from a chain log, applied to the person's user, failed to apply or revoked. Carries the " +
    "Organization, the hat, the department and the roles' count; never the person's address or email.",
  props: Schema.Struct({
    from: Null(RoleGrantState),
    to: RoleGrantState,
    transition: Schema.Literals(["record", "apply", "fail", "revoke", "retire"]),
    org_id: S,
    hat: S,
    department: Null(S),
    roles: N,
  }),
  was: [`${SPIKE} (Frappe half: Roles follow hats)`],
});

export const event_site_event_transitioned = defineEvent({
  id: "site_event_transitioned",
  about:
    "An outbox event changed state: enqueued, applied by the site, retried, set aside after its retries (non-money), posted as an unmatched bank line " +
    "(money) or released again by an operator. `alert` is true for a money event that could not be applied: it raises an alert to the Organization's " +
    "admin. Carries the Organization, the number, the kind and the attempts; never the event's data.",
  props: Schema.Struct({
    from: Null(SiteEventState),
    to: SiteEventState,
    transition: Schema.Literals(["enqueue", "apply", "retry", "set_aside", "post_unmatched", "release"]),
    org_id: S,
    seq: N,
    kind: SiteEventKind,
    attempts: N,
    alert: B,
  }),
  was: [`${SPIKE} (What the design must now decide, 2)`],
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

const PR = [event_payment_request_transitioned];
export const machine_payment_request = defineMachine({
  id: "payment-request",
  title: "A held payment: waiting, sent, failed, mismatch, abandoned or reversed",
  about:
    "payment-requests.status. Born waiting by the prepare a Frappe user's Submit asks for. The chain's PaymentSent with the same document hash lands " +
    "it (sent); a refusal or a revert fails it with the reason; a draft edited after the prepare changes the hash, so the chain payment no longer " +
    "matches and the request is a mismatch (the money still arrives, as an unmatched bank line); the person cancelling the draft abandons it. Only a sent " +
    "payment can be reversed, and only by a new payment: money cannot be un-sent (FINDINGS, Frappe half: Paying a document).",
  table: table_payment_requests,
  field: "status",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Prepared; the signer has not signed, or the chain has not confirmed." },
    { id: "sent", about: "The chain confirmed the payment; the Payment Entry is submitted and posted.", },
    { id: "failed", about: "Refused (no hat, no budget room) or reverted. The draft stays; the reason is kept.", terminal: true },
    { id: "mismatch", about: "The draft changed after the prepare. The chain payment is an unmatched bank line.", terminal: true },
    { id: "abandoned", about: "The person cancelled the draft before it landed.", terminal: true },
    { id: "reversed", about: "A new payment returned the money after a cancel of the paid document.", terminal: true },
  ],
  transitions: {
    prepare: { from: [], to: "waiting", about: "The birth: plugs.payments.hold.", guard: "the signer's address wears a hat that may pay from this budget, or the prepare is refused", emits: PR },
    land: { from: ["waiting"], to: "sent", about: "The chain's PaymentSent carries this request's document hash (plugs.payments.settle).", guard: "the hash equals the prepared hash", emits: PR },
    fail: { from: ["waiting"], to: "failed", about: "The approval reverted or was refused (plugs.payments.fail).", emits: PR },
    mismatch: { from: ["waiting"], to: "mismatch", about: "A PaymentSent for this payee and amount carries a different hash than the draft now has.", emits: PR },
    abandon: { from: ["waiting"], to: "abandoned", about: "The person cancelled the draft (plugs.payments.abandon).", emits: PR },
    reverse: { from: ["sent"], to: "reversed", about: "A reversal payment landed for a paid document that was cancelled.", emits: PR },
  },
  was: [`${SPIKE} (Frappe half: Paying a document; INTERFACE.md: the four behaviours)`],
});

const RG = [event_role_grant_transitioned];
export const machine_role_grant = defineMachine({
  id: "role-grant",
  title: "A hat's roles on a person's user: pending, applied, failed or revoked",
  about:
    "role-grants.status. Recorded pending from a hat event; applied once the site confirms the person's user has the roles; failed when the site " +
    "refuses (an Employee the member hat needs cannot be made); revoked when the hat is taken away. A grant revoked before it applied retires. A " +
    "person's roles are the union of their applied grants, so the machine never touches a role another grant still gives.",
  table: table_role_grants,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Recorded from the chain; not yet on the site." },
    { id: "applied", about: "The site holds the roles." },
    { id: "failed", about: "The site refused. The failure is kept; the projection retries it." },
    { id: "revoked", about: "The hat was taken away and the roles it alone gave are gone.", terminal: true },
  ],
  transitions: {
    record: { from: [], to: "pending", about: "The birth: a HatGranted log the projection read.", emits: RG },
    apply: { from: ["pending", "failed"], to: "applied", about: "The site answered applied for the person's user.", emits: RG },
    fail: { from: ["pending"], to: "failed", about: "The site refused the roles.", emits: RG },
    revoke: { from: ["applied", "failed"], to: "revoked", about: "A HatRevoked log; only roles no other live grant gives are removed.", emits: RG },
    retire: { from: ["pending"], to: "revoked", about: "The hat was revoked before the grant applied.", emits: RG },
  },
  was: [`${SPIKE} (Frappe half: A role two hats give stays while one remains)`],
});

const SE = [event_site_event_transitioned];
export const machine_site_event = defineMachine({
  id: "site-event",
  title: "An outbox event: pending, applied, set aside or an unmatched line",
  about:
    "site-events.status. Born pending when Core enqueues it with the next number. The site answers applied once, and a repeat as already applied. " +
    "After three failures a non-money event is set aside, so the cursor moves on, and stays visible to an operator who can release it. A money event is " +
    "never set aside: it posts to the site's books as an unmatched bank line and raises an alert, so the books still show that money left or arrived " +
    "(FINDINGS, End to end: What I changed, 5; plugs.poison-event).",
  table: table_site_events,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Waiting to be delivered, or being retried." },
    { id: "applied", about: "The site applied it exactly once.", terminal: true },
    { id: "set_aside", about: "A non-money event the site cannot apply; the stream moved on." },
    { id: "unmatched", about: "A money event posted as an unmatched bank line, with an alert.", terminal: true },
  ],
  transitions: {
    enqueue: { from: [], to: "pending", about: "The birth: plugs.events.enqueue assigns the next number.", emits: SE },
    apply: { from: ["pending"], to: "applied", about: "The site answered applied or already applied.", emits: SE },
    retry: { from: ["pending"], to: "pending", about: "A failed attempt: the count goes up and the backoff doubles.", emits: SE },
    set_aside: { from: ["pending"], to: "set_aside", about: "A non-money event after its third failure.", guard: "the event does not move money", emits: SE },
    post_unmatched: { from: ["pending"], to: "unmatched", about: "A money event after its third failure.", guard: "the event moves money", emits: SE },
    release: { from: ["set_aside"], to: "pending", about: "An operator's `org events retry`.", emits: SE },
  },
  was: [`${SPIKE} (Frappe half: Parked; What the design must now decide, 2)`],
});

void FIND;
