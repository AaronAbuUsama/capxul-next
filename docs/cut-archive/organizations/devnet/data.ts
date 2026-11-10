// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineTable } from "../../../packages/book/src/index.ts";
import { concept_devnet } from "../shared/foundation.ts";

export const table_head_sites = defineTable({
  id: "head-sites",
  title: "Head sites: each stand-in Frappe site, its apps and its fault switch",
  about:
    `${HEAD} keeps one row per site it serves: its URL (\`http://<handle>.head.localhost:<port>\`), the API key and ` +
    "secret it accepts (devnet keys, kept as given), the ring secret a connection gave it to sign its doorbell, the " +
    "Frappe, ERPNext, Frappe HR, Frappe CRM and Capxul app versions it reports, whether the Capxul app's Custom Fields " +
    "are in place, its System Settings time zone and its Company (with the Organization's id and currency), the apps " +
    "installed, and its fault switch. `capxul-devnet head up <org> [--frappe-cloud]` makes it, a self-hosted site or, " +
    "with `--frappe-cloud`, one hosted as on Frappe Cloud, and writes its head user's key file and, for Frappe Cloud, " +
    "its team's token file (its token, then its name), in the forms `org head connect` reads. `installApp` with that team token adds an app at once on a Frappe " +
    "Cloud site, and answers WRONG_STATE on a self-hosted one, as a real bench's host cannot install for Capxul. " +
    "`capxul-devnet fault frappe-head <mode>` arms the switch: `down` (every " +
    "call is PROVIDER_ERROR), `key-refused` (401: ROLE_PERMISSION_DENIED), `conflict` (the next `upsertDocs` answers " +
    "its first document in conflict, as a head user's edit Capxul had not read would), `refuse` (the next document is " +
    "refused, as a Frappe validation would), `replay` (the next `listChanges` answers again from an earlier cursor, as " +
    "a head that lost its place would), `drop-answer` (the next family write is applied, then its answer held back " +
    "once, as a lost reply would be), or `clear`. It answers the document family's `docRead` and `docWrite` over its " +
    "head-documents with Frappe's docstatus rules and its fixture metas (devnet.world-pass-worlds), keeping each applied " +
    "call id and its answer in `applied_calls` for a day of the world's clock. `last_change` is the site's change counter. " +
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
    /** Frappe Cloud only: the team's `api_key:api_secret` and team name its `installApp` accepts; null for a self-hosted site. */
    team_token: Schema.NullOr(S),
    /** The doorbell secret the connection handed the site; null until a connection is confirmed. */
    ring_secret: Schema.NullOr(S),
    versions: Schema.Record(S, S),
    custom_fields: Schema.Boolean,
    time_zone: S,
    company_currency: S,
    installed_apps: Schema.Array(S),
    fault: Schema.Literals(["none", "down", "key-refused", "conflict", "refuse", "replay", "drop-answer"]),
    /** The document family's applied call ids and the answer each got, kept a world day: a retry answers the same. */
    applied_calls: Schema.Array(Schema.Struct({ call_id: S, answer: Schema.Unknown, at: Instant })),
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
    "member or not) and the instant on the one clock. `capxul-devnet head edit <org> <doctype> <capxul_id, head name or new> " +
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
