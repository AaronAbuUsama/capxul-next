// The journeys of the new shape: the four behaviours the walking skeleton proved (an organisation is one command, roles follow hats, a document is paid from Frappe, it stays true
// when broken) and one for a world's life. A journey is a list of operations proved by an event (policy P7), so the funnel and the first evals come from the book. They
// are the first evals of the critical path's milestones 1 to 3 (milestones.* decisions).

import { defineJourney } from "../../packages/blueprint-engine/src/index.ts";
import { operation_org_create } from "../organizations/operations.ts";
import { operation_org_member_grant } from "../board/operations.ts";
import { event_site_transitioned } from "./data.ts";
import { event_role_grant_transitioned, event_site_event_transitioned, event_payment_request_transitioned } from "../plugs/data.ts";
import { event_world_transitioned } from "../devnet/world-data.ts";
import * as s from "./operations.ts";
import * as p from "../plugs/operations.ts";
import * as w from "../devnet/world-ops.ts";

const SPIKE = "spikes/skeleton/INTERFACE.md (The behaviours the skeleton must show)";

export const journey_create_company_site = defineJourney({
  id: "create_company_site",
  title: "An organisation is one command and its site answers",
  about: "From `org create` to a ready site: the site is made when the setup completes, the feature defaults are in place and the person can open it. Skeleton behaviour 1.",
  steps: [
    { operation: operation_org_create, as: "founder", proves: "success" },
    { operation: s.operation_org_site_show, as: "founder", proves: event_site_transitioned },
    { operation: s.operation_org_feature_list, as: "director", proves: "success" },
    { operation: s.operation_org_site_open, as: "director", proves: "success" },
  ],
  was: [SPIKE],
});

export const journey_grant_hat_in_frappe = defineJourney({
  id: "grant_hat_in_frappe",
  title: "Grant a hat and the roles follow, with no hand edits",
  about: "A Director grants a hat; the person's Frappe roles follow within seconds; a role added behind the chain's back is found by the drift check. Skeleton behaviour 2.",
  steps: [
    { operation: operation_org_member_grant, as: "director", proves: "success" },
    { operation: p.operation_org_roles_show, as: "member", proves: event_role_grant_transitioned },
    { operation: p.operation_org_roles_drift, as: "director", proves: "success" },
  ],
  was: [SPIKE],
});

export const journey_pay_invoice_from_frappe = defineJourney({
  id: "pay_invoice_from_frappe",
  title: "Pay an invoice from Frappe and see it land in the books",
  about: "A person creates and submits a Purchase Invoice and a Payment Entry from the Safe's account; the payment waits for the named signer; the chain confirms it; the entry posts once and the invoice shows nothing outstanding. Skeleton behaviour 3.",
  steps: [
    { operation: s.operation_doc_create, as: "office-holder", proves: "success" },
    { operation: s.operation_doc_submit, as: "office-holder", proves: event_payment_request_transitioned },
    { operation: p.operation_payment_awaiting, as: "office-holder", proves: "success" },
    { operation: s.operation_report_run, as: "office-holder", proves: "success" },
  ],
  was: [SPIKE],
});

export const journey_stays_true_when_broken = defineJourney({
  id: "stays_true_when_broken",
  title: "A revert, a repeated event and Frappe down all end consistent",
  about: "A signer without the hat is refused and nothing posts; the same event twice posts once; Frappe stopped while a log lands posts it once when it returns; an event that can never be applied is set aside or posted as an unmatched line, never blocking the rest. Skeleton behaviour 4.",
  steps: [
    { operation: p.operation_org_events_status, as: "member", proves: event_site_event_transitioned },
    { operation: p.operation_org_events_retry, as: "director", proves: event_site_event_transitioned },
    { operation: p.operation_org_events_resend, as: "director", proves: "success" },
  ],
  was: [SPIKE],
});

export const journey_run_a_world = defineJourney({
  id: "run_a_world",
  title: "Make a world, move its clock, save it, restore it into another, read its record",
  about: "A world is made, a company is made in it, its clock is moved and the chain and the site follow, a snapshot is saved and restored into a separate world that names its parent, and the whole run is read back from the record.",
  steps: [
    { operation: w.operation_world_create, as: "person", proves: event_world_transitioned },
    { operation: w.operation_world_clock_warp, as: "person", proves: "success" },
    { operation: w.operation_world_snapshot_save, as: "person", proves: "success" },
    { operation: w.operation_world_snapshot_restore, as: "person", proves: event_world_transitioned },
    { operation: w.operation_world_show, as: "person", proves: "success" },
    { operation: w.operation_record_export, as: "person", proves: "success" },
  ],
  was: ["docs/mission/worlds.md", "docs/mission/critical-path.md (milestone 3)"],
});
