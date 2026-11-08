// Devnet's tables: what the integrations' devnet fakes read and write, and what the devnet tools
// script. Nothing here exists on staging or production: the seven tables live in Postgres' own
// `devnet` schema, which only the devnet build of the backend migrates (decision devnet.own-schema),
// so devnet-only data never enters the production schema. They sit inside the same Postgres server,
// so a world's snapshot carries them with the concepts' tables: a restored world brings back its mail,
// its armed faults, its scripted gates, its scripted rates and its stand-in Frappe heads (their
// documents, their own users' edits and their fault switches; decision devnet.head-stand-in).
//
// No table here has a lifecycle, so devnet has no state machine and sends no event (decision
// devnet.no-machines). Notices' delivery records are notices' (`dev mail notices` reads them there);
// the saved worlds and the clock are the devnet supervisor's, on this machine's disk, not rows
// (decision devnet.supervisor-owns-time-and-worlds). Every time these tables keep (`sent_at`, `armed_at`,
// `set_at`, `from_at`) is the one clock's now (decision time.one-clock).

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";

const OP = "packages/backend/src/operator";
const ASIS = "docs/as-is/archive/operator/data.ts";

const S = Schema.String;
const Int = Schema.Int;
const Instant = Schema.DateTimeUtc;
const DEVNET_ONLY = "Devnet only: in the `devnet` schema, which staging and production never create.";

// ── the mail sink ───────────────────────────────────────────────────────────────────────────

export const table_mail_messages = defineTable({
  id: "mail-messages",
  title: "Mail messages: every email Capxul sent on this devnet",
  about:
    "The mail sink. On a devnet the `mail` integration's fake keeps each message here instead of sending it: a notice's " +
    "email, an invitation, a sign-in code (access sends that inside its own rpc). One row per accepted send: the address " +
    "trimmed and lowercased, the template, the plain text and the http(s) links found in it, and the backend time it was " +
    "sent. A send that repeats an idempotency key keeps the first message and answers its id, as Resend does. A send that " +
    "an armed fault refuses keeps nothing. `dev mail list` reads it, and so does `dev approve`, for the sign-in code of the " +
    "person it plays; evals read invitation links and codes here. The HTML body is not kept: the text carries every link. " +
    DEVNET_ONLY,
  was: [`${ASIS}:50`, `${OP}/tables.ts:21`, `${OP}/outboxes/writes.ts:58`, "packages/backend/src/integrations/mail/service.ts:171"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    /** `mail_` and a ULID of the backend time it was sent. */
    mail_id: S,
    to: S,
    from: S,
    subject: S,
    template: S,
    text: S,
    links: Schema.Array(S),
    /** The idempotency key the sender gave (a notice's, or a sign-in code's hash). */
    idempotency_key: S,
    sent_at: Instant,
  }),
  key: ["mail_id"],
  indexes: [
    {
      name: "by_to_sent_at",
      fields: ["to", "sent_at"],
      for: "`dev mail list --to`: one address's mail, newest first; `dev approve` reads the newest sign-in code sent to the person it plays.",
    },
    { name: "by_sent_at", fields: ["sent_at"], for: "`dev mail list`: every message, newest first." },
    {
      name: "by_idempotency_key",
      fields: ["idempotency_key"],
      unique: true,
      for: "The fake's repeat check: a send with a key already kept answers the kept message.",
    },
  ],
  retention: "Kept for the world's life; a restore puts back the mail the world had when it was saved.",
});

export const table_mail_faults = defineTable({
  id: "mail-faults",
  title: "Mail faults: the mail sink's fail switch",
  about:
    "The next `remaining` sends to `address` fail as an unavailable Resend (PROVIDER_ERROR, which a notice's workflow " +
    "retries), so a notice's retry can be watched. `address` " +
    "is a lowercased email, or `*` for any address. `dev mail fail` arms (replacing that address's fault), lists and clears " +
    "them; the mail fake spends one in the send it refuses, the address's own fault first and then `*`, and deletes a " +
    "fault spent to zero. A refused send keeps no message. " +
    DEVNET_ONLY,
  was: [`${ASIS}:90`, `${OP}/tables.ts:38`, `${OP}/outboxes/writes.ts:14`, `${OP}/outboxes/writes.ts:37`],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    /** A lowercased email, or `*` for any address (a key column cannot be null). */
    address: S,
    /** Sends still to fail, 1 to 100. */
    remaining: Int,
    armed_at: Instant,
  }),
  key: ["address"],
  indexes: [],
  retention: "Deleted when spent to zero or cleared; at most one row per address.",
});

// ── scripted gates ──────────────────────────────────────────────────────────────────────────

export const table_scripted_gates = defineTable({
  id: "scripted-gates",
  title: "Scripted gates: feature gates set for an Organization on this devnet",
  about:
    "What `dev gates set` scripts: one row per Organization and gate key, on or off, and the member who set it. The " +
    "PostHog fake builds its flag list from these rows (a gate is on for the Organizations scripted on, and, when the " +
    "catalogue's devnet default for it is on, for every Organization not scripted off), and access' flag sync copies that " +
    "list into its feature flags, as it copies PostHog's on staging. So production code reads gates one way everywhere. " +
    "A gate whose devnet ceiling is off is never scripted on. " +
    DEVNET_ONLY,
  was: ["docs/as-is/archive/access/data.ts:256", "packages/backend/src/access/features/operations/set.ts:26"],
  concept: concept_devnet,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    /** A gate key of the catalogue that targets an Organization: `payment-agreements`, `books`, `equity`. */
    gate_key: S,
    on: Schema.Boolean,
    /** The principal who set it. */
    set_by: S,
    set_at: Instant,
  }),
  key: ["org_id", "gate_key"],
  indexes: [
    {
      name: "by_gate_key",
      fields: ["gate_key", "org_id"],
      crossTenant: true,
      for: "The PostHog fake's flag list: every Organization one gate is scripted for, across tenants.",
    },
  ],
  retention: "Kept for the world's life; setting a gate again replaces its row.",
});

// ── scripted prices ─────────────────────────────────────────────────────────────────────────

export const table_scripted_prices = defineTable({
  id: "scripted-prices",
  title: "Scripted prices: USD rates set for a pair on this devnet",
  about:
    "What `dev prices set` scripts: a pair's USD rate from a time on (`from_at`; the epoch for the base rate given without " +
    "`--from`), with who set it and when. The Chainlink fake answers a pair's feed from these rows: the row in force at the " +
    "backend's now (the latest `from_at` at or before it), dated the later of its `from_at` and its `set_at`, so books' " +
    "price sync keeps it as a new round and only money facts written after it was set take it. With no row the fake " +
    "answers the frozen default rates: USDC and USDT 1.00, EURC 1.08, WETH 3,000, WBTC 60,000. " +
    DEVNET_ONLY,
  was: ["packages/backend/src/books/facts/operations/price.ts:23", "packages/backend/src/books/facts/rules.ts:108"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    /** `ASSET/USD`, for an asset Capxul prices: `EURC/USD`. */
    pair: S,
    from_at: Instant,
    /** USD per unit, to eight decimals: `1.08500000`. */
    rate: S,
    set_by: S,
    set_at: Instant,
  }),
  key: ["pair", "from_at"],
  indexes: [],
  retention: "Kept for the world's life; the same pair and `--from` again replaces the row and its `set_at`.",
});

// ── the stand-in Frappe head (devnet.head-stand-in) ─────────────────────────────────────────

const HEAD = "The stand-in head (the `frappe-head` integration's devnet fake, served by the supervisor on loopback)";

export const table_head_sites = defineTable({
  id: "head-sites",
  title: "Head sites: each stand-in Frappe site, its apps and its fault switch",
  about:
    `${HEAD} keeps one row per site it serves: its URL (\`http://<handle>.head.localhost:<port>\`), the API key and ` +
    "secret it accepts (devnet keys, kept as given), the ring secret a connection gave it to sign its doorbell, the " +
    "Frappe, ERPNext, Frappe HR, Frappe CRM and Capxul app versions it reports, whether the Capxul app's Custom Fields " +
    "are in place, its System Settings time zone and its Company (with the Organization's id and currency), the apps " +
    "installed (`installApp` adds one at once), and its fault switch. `capxul-devnet head up <org>` makes it, as a " +
    "Frappe Cloud site or a self-hosted one; `capxul-devnet fault frappe-head <mode>` arms the switch: `down` (every " +
    "call is PROVIDER_ERROR), `key-refused` (401: ROLE_PERMISSION_DENIED), `conflict` (the next `upsertDocs` answers " +
    "its first document in conflict, as a head user's edit Capxul had not read would), `refuse` (the next document is " +
    "refused, as a Frappe validation would), `replay` (the next `listChanges` answers again from an earlier cursor, as " +
    "a head that lost its place would), or `clear`. `last_change` is the site's change counter. " +
    DEVNET_ONLY,
  was: ["books/target/shared/external.ts (frappe-head fake)", "docs/design/frappe/projects-and-startup.md (section 4)"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    site_url: S,
    org_id: S,
    host: Schema.Literals(["frappe-cloud", "self-hosted"]),
    api_key: S,
    api_secret: S,
    /** The doorbell secret the connection handed the site; null until a connection is confirmed. */
    ring_secret: Schema.NullOr(S),
    versions: Schema.Record(S, S),
    custom_fields: Schema.Boolean,
    time_zone: S,
    company_currency: S,
    installed_apps: Schema.Array(S),
    fault: Schema.Literals(["none", "down", "key-refused", "conflict", "refuse", "replay"]),
    last_change: Int,
    created_at: Instant,
    updated_at: Instant,
  }),
  key: ["site_url"],
  indexes: [{ name: "by_org", fields: ["org_id", "site_url"], for: "`capxul-devnet head` commands that name an Organization: its stand-in site." }],
  retention: "Kept for the world's life; `capxul-devnet head down <org>` deletes the site and its rows.",
});

export const table_head_documents = defineTable({
  id: "head-documents",
  title: "Head documents: what a stand-in site holds, by DocType and capxul_id",
  about:
    `${HEAD} keeps each document Capxul pushed or its own user made: its DocType, its \`capxul_id\` (null for one born ` +
    "in the head until Capxul's pull gives it one), its head name from the site's own naming series (`PROJ-0001`), " +
    "its docstatus and `amended_from`, its fields as Frappe's JSON, the Capxul version it last wrote, and the head " +
    "change it was last based on. `upsertDocs` writes over a document's own edits up to the change Capxul names and " +
    "answers conflict for a later one; it runs none of Frappe's validations, reports or hooks. " +
    DEVNET_ONLY,
  was: ["books/target/shared/external.ts (frappe-head: upsertDocs)"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    site_url: S,
    doctype: S,
    head_name: S,
    capxul_id: Schema.NullOr(S),
    docstatus: Schema.Literals([0, 1, 2]),
    amended_from: Schema.NullOr(S),
    fields: Schema.Record(S, Schema.Unknown),
    /** The Capxul version of the last push that wrote it; null for a document only the head has written. */
    capxul_version: Schema.NullOr(Int),
    /** The site's last change to it (head-changes `seq`); null when only Capxul has written it. */
    head_change: Schema.NullOr(Int),
    modified_at: Instant,
  }),
  key: ["site_url", "doctype", "head_name"],
  indexes: [
    {
      name: "by_capxul_id",
      fields: ["site_url", "doctype", "capxul_id"],
      unique: true,
      for: "`upsertDocs`: the document a push names by its capxul_id, to insert or update.",
    },
  ],
  retention: "Kept for the world's life, with its site.",
});

export const table_head_changes = defineTable({
  id: "head-changes",
  title: "Head changes: a stand-in site's own users' edits, as listChanges reads them",
  about:
    `${HEAD} records each edit its scripted user makes as one row, in the site's change order: the DocType, the head ` +
    "name and `capxul_id`, what was done (insert, update, submit, cancel, amend), the fields it set, the Capxul " +
    "version it was based on (an older one makes a conflict Capxul resolves), the head user (a mailbox, matched to a " +
    "member or not) and the instant on the one clock. `capxul-devnet head edit <org> <doctype> <capxul_id or new> " +
    "[field=value…] [--submit|--cancel|--amend] [--as <mailbox>] [--based-on <version>]` writes the document and its " +
    "row in one transaction, then rings the site's doorbell (`organizations.heads.ring`, signed with its ring secret), " +
    "as the Capxul app does after a change commits; `--no-ring` leaves the ring out, for the daily catch-up. " +
    "`listChanges` answers the rows after a cursor, oldest first. " +
    DEVNET_ONLY,
  was: ["books/target/shared/external.ts (frappe-head: listChanges)", "books/target/organizations/heads.ts (organizations.heads.ring)"],
  concept: concept_devnet,
  tenancy: "global",
  fields: Schema.Struct({
    site_url: S,
    seq: Int,
    doctype: S,
    head_name: S,
    capxul_id: Schema.NullOr(S),
    action: Schema.Literals(["insert", "update", "submit", "cancel", "amend"]),
    fields: Schema.Record(S, Schema.Unknown),
    based_on_version: Schema.NullOr(Int),
    head_user: S,
    rung: Schema.Boolean,
    at: Instant,
  }),
  key: ["site_url", "seq"],
  indexes: [],
  retention: "Kept for the world's life, with its site: it is the order listChanges replays.",
});
