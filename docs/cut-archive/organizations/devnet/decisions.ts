// Moved out of the built book by the cut, 10 November 2026, from books/target/devnet/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import {
  component_devnet,
  component_frappe_app,
  concept_accounts,
  concept_devnet,
  concept_documents,
  concept_notices,
  environment_devnet,
  environment_shared_world,
} from "../shared/foundation.ts";
import {
  integration_bridge,
  integration_bundler,
  integration_chain_rpc,
  integration_chainlink,
  integration_devnet_control,
  integration_fde_host,
  integration_frappe_head,
  integration_indexer,
  integration_mail,
  integration_posthog,
} from "../shared/external.ts";
import {
  table_fde_host_agents,
  table_head_changes,
  table_head_documents,
  table_head_sites,
  table_mail_faults,
  table_mail_messages,
  table_scripted_gates,
  table_scripted_prices,
} from "./data.ts";
import { NEW_OPERATIONS as ORG_NEW_OPERATIONS, operation_org_create, operation_org_seats_show } from "../organizations/operations.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { rpc_organizations_heads_ring } from "../organizations/heads.ts";
import { rpc_devnet_mail_fail, rpc_devnet_mail_list, rpc_devnet_mail_list_notices } from "./mail.ts";
import { rpc_devnet_gates_read, rpc_devnet_gates_script } from "./gates.ts";
import { rpc_devnet_prices_script } from "./prices.ts";
import { rpc_devnet_jobs_run } from "./jobs.ts";
import {
  flow_devnet_approve,
  flow_devnet_gates_set,
  flow_devnet_prices_set,
  flow_devnet_seasons_cancel,
  flow_devnet_seasons_change,
  flow_devnet_seasons_create,
  flow_devnet_seasons_end,
  flow_devnet_seasons_list,
  flow_devnet_seasons_players_add,
  flow_devnet_seasons_players_remove,
  flow_devnet_seasons_show,
  flow_devnet_seasons_start,
  flow_devnet_seasons_warps_add,
  flow_devnet_seasons_warps_remove,
  flow_devnet_snapshots_list,
  flow_devnet_snapshots_restore,
  flow_devnet_snapshots_save,
  flow_devnet_time_follow,
  flow_devnet_time_freeze,
  flow_devnet_time_resume,
  flow_devnet_time_set,
  flow_devnet_time_settle,
  flow_devnet_time_show,
  flow_devnet_time_start_at,
  flow_devnet_time_step,
  flow_devnet_time_warp,
  flow_devnet_time_watch,
} from "./flows.ts";
import * as ops from "./operations.ts";
import { concept_contacts, concept_payments } from "../shared/foundation.ts";

const HEAD_TABLES = [table_head_sites, table_head_documents, table_head_changes];

export const decision_devnet_head_stand_in = defineDecision({
  id: "devnet.head-stand-in",
  title: "The stand-in Frappe head serves HTTP from devnet's tables and follows the clock",
  question:
    "Every app concept syncs with a connected head through `frappe-head` (aaron.frappe-head). Evals need a head that " +
    "keeps documents, makes its own users' edits, rings the doorbell, fails on demand and survives a world's save and " +
    "restore, without booting Frappe. What is it, and where is its state?",
  options: [
    {
      label: "supervisor-http-tables",
      text:
        "A supervisor-run site per Organization (`capxul-devnet head up <org>`) speaking the Capxul app's whitelisted " +
        "methods over HTTP on loopback, so the backend's real `FrappeHead` client calls it. Its state is devnet's " +
        "head-sites, head-documents (by DocType and capxul_id) and head-changes (its scripted user's edits, as " +
        "listChanges rows). `capxul-devnet head edit` writes a document and its change, then rings " +
        "`organizations.heads.ring` signed with the site's ring secret. `capxul-devnet fault frappe-head " +
        "down|key-refused|conflict|refuse|replay|clear` arms its switch, kept on its site row. It joins the clock as a " +
        "follower: idle when no ring is in flight, with no next due.",
    },
    { label: "backend-layer", text: "A `FrappeHead` devnet layer inside the backend over the same tables, as the mail fake is." },
    { label: "in-memory", text: "An in-memory double the supervisor serves, its state saved in the world's manifest." },
  ],
  chosen: "supervisor-http-tables",
  why:
    "Served over HTTP, the stand-in exercises the backend's real head client, its timeouts, retries and error mapping " +
    "(PROVIDER_ERROR, ROLE_PERMISSION_DENIED, RATE_LIMITED), where a backend layer would skip them; and a head's ring " +
    "must arrive from outside, through the doorbell route a real Capxul app posts to. In Postgres' devnet schema, a " +
    "world's snapshot carries the head with the concepts' tables, so a restored world's head holds the very documents " +
    "its sync cursors point at (devnet.own-schema); in memory, the manifest and the database could disagree. The fault " +
    "switch sits on the site's row, as the mail switch does, for the same reason. An edit is a supervisor control, not " +
    "a Capxul command: it is the head's own user acting, which no Capxul surface makes (devnet.fault-switches), and a " +
    "devnet rpc for it would be reached by no operation (P2). `conflict`, `refuse` and `replay` exist because the " +
    "syncs' conflict, push-back and skip-what-was-applied paths are their hardest; a real bench with the Capxul app " +
    "still serves an eval that needs Frappe's own validations. Its rows' writer is that stand-in, outside the book's " +
    "records, so each table shows the build's unwritten-table gap, as the mail sink does. For the shared owner: " +
    "frappe-head's `fake` text still says 'in-memory'.",
  source: WORLD_GROUP("books/target/shared/external.ts (frappe-head fake); docs/design/frappe/projects-and-startup.md (section 4); devnet.fault-switches"),
  affects: [...HEAD_TABLES, integration_frappe_head, rpc_organizations_heads_ring, component_devnet, component_frappe_app],
});

export const decision_devnet_head_claims_stand_in = defineDecision({
  id: "devnet.head-claims-stand-in",
  title: "What the stand-in head serves for the head group's thicker claims",
  question:
    "The surface pass gave `org head show`, `org head doc submit`, `org head doc amend` and `org head doctype list` new " +
    "claims (organizations.head-claims, organizations.head-fit). They submit and amend Training Events, read a Job " +
    "Opening, list Leave Application and Expense Claim, and read the head while its daily check fails. What must the " +
    "stand-in head and org-with-head-docs give them?",
  options: [
    {
      label: "as-frappe",
      text:
        "As the pinned apps do. The Training Events in org-with-head-docs carry hrms@8816102's mandatory fields " +
        "(event_status, type, location, start_time before end_time, introduction), so a submit or amend through the " +
        "family passes the stand-in's mandatory check. An amendment is named as frappe@1a7ea57's `_set_amended_name` " +
        "does: `Old induction` amends to `Old induction-1`, and an amendment of `Old induction-1` to `Old induction-2`, " +
        "never `Old induction-1-1`. The fixture metas add Training Event Employee (istable, the field `employees`), " +
        "Leave Application and Expense Claim (each submittable, module HR), and keep Job Opening not submittable. While " +
        "`fault frappe-head down` is set, every call fails as an unreachable host, the daily check included, and after " +
        "`clear` the next check succeeds. `drop-answer` covers every family write, submit and amend included, and every " +
        "`capxul-devnet head edit` rings, as booked.",
    },
    { label: "relax", text: "Let the stand-in skip mandatory fields and keep its own amend naming; the claims hold only on the stand-in." },
  ],
  chosen: "as-frappe",
  why:
    "A claim the stand-in passes and a real bench refuses would prove nothing (devnet.head-stand-in): hrms requires " +
    "those six fields on a Training Event and checks the times, so without them the family's submit and amend claims " +
    "would be refused, the earlier submit claim included. Frappe's own naming gives `-2`, which is what the amend claim " +
    "reads. The metas are the DocTypes `org head doctype list`'s claims name. The fault and the ring were already " +
    "booked, so only the record says so.",
  source:
    "Claude, surface pass build, 9 November 2026; evidence: organizations.head-claims; hrms@8816102 training_event.json, " +
    "leave_application.json, expense_claim.json, job_opening.json; frappe@1a7ea57 naming.py `_set_amended_name`",
  affects: [concept_devnet, table_head_documents, table_head_sites, integration_frappe_head, component_devnet],
});
