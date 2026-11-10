// The milestones of docs/mission/critical-path.md as decision records, so the portal can show them and each is linked to what it needs. The tools' own task tree (packages/plan/src/tasks.ts)
// holds its hand-written milestone list and is not changed by this file; these records say what each milestone is done when, and which records and journeys carry it. The critical
// path file is the plan until these are the plan; then the book wins (its own words). The coordinator's, on Aaron's delegation; the priorities are Aaron's, 10 November
// (OpenFort out, breadth first, everything recorded, time movable, snapshots, visible, the cloud).

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import { journey_create_company_site, journey_grant_hat_in_frappe, journey_pay_invoice_from_frappe, journey_stays_true_when_broken, journey_run_a_world } from "../sites/journeys.ts";
import * as pl from "../plugs/operations.ts";
import * as si from "../sites/operations.ts";
import * as wo from "../devnet/world-ops.ts";
import { integration_frappe_site, integration_site_service } from "../plugs/integrations.ts";

const BY = "The coordinator, 10 November 2026, on Aaron's delegation of the book (aaron.one-door, aaron.frappe-native); evidence: docs/mission/critical-path.md (Milestones, Priorities, the measure)";
const m = (spec: { id: string; title: string; done: string; needs: string; affects: readonly object[] }) =>
  defineDecision({
    id: spec.id, title: spec.title,
    question: "What is this milestone done when, and what does it need?",
    options: [{ label: "milestone", text: `Done when: ${spec.done} Needs: ${spec.needs} Ordering: the critical path's order; every milestone is proved by evals of the records it links, never by a report.` }],
    chosen: "milestone",
    why: "Aaron, 10 November (critical-path.md, Priorities): optimise for time, speed and cost, with breadth first; OpenFort out of this path; everything tested by agents and deterministic code; everything recorded; time movable; a world saved and restored; visible; the cloud written down first. The measure is how many kept operations pass their evals on the real stack.",
    source: BY, affects: spec.affects as never,
  });

export const decision_milestones_m1 = m({
  id: "milestones.m1-foundation", title: "Milestone 1, Foundation: the cut and the new shape are in the book",
  done: "the book builds with 0 problems on the new shape (the cut, the plugs, the sites and the door, the world) and the portal shows the kept operations with their stand.",
  needs: "the stage 1 and 2 cut (cut.principle), stage 3 (plugs.*, sites.*, devnet.world-first-class), and a record of where each operation stands (the status file, being built by another agent).",
  affects: [f.system_capxul, f.concept_plugs, f.concept_sites, pl.operation_payment_prepare_document, si.operation_doc_list, wo.operation_world_create],
});
export const decision_milestones_m2 = m({
  id: "milestones.m2-real-chain", title: "Milestone 2, Real chain under the skeleton: the v4 contracts and a key signer",
  done: "the skeleton's checks pass against the real contracts: a hat granted through Hats, a budget set, a payment sent through Payments under that hat and budget with the document's hash.",
  needs: "the v4 contracts in this repository with their tests, a seeded chain state so nothing needs the network, a key-based agent signer (plugs.no-openfort), the alto bundler and a mock paymaster, and the contract changes of plugs.contract-changes.",
  affects: [f.system_capxul, f.concept_plugs, f.concept_payments, f.concept_budgets, journey_grant_hat_in_frappe, journey_pay_invoice_from_frappe, pl.operation_payment_prepare_document],
});
export const decision_milestones_m3 = m({
  id: "milestones.m3-door-recorder-clock", title: "Milestone 3, the door, the recorder and the clock, in parallel with 2",
  done: "an agent takes a lead to a paid invoice, onboards a staff member and runs a month end through the CLI only, on a clock it moved, and the whole run can be read back from the record.",
  needs: "the door (sites.door and its fourteen operations), the world's record (devnet.record-entry), the world's clock and snapshots (devnet.world-first-class), a site that follows the world's clock (devnet.site-follows-world, settled for option A; proved by devnet.time-is-right), and a person able to open the screens (devnet.viewer-grant). The door's verbs are checked against the spike (sites.door-awaits-spike); three things remain to prove in its first evals.",
  affects: [f.system_capxul, f.concept_sites, f.concept_devnet, journey_create_company_site, journey_pay_invoice_from_frappe, journey_run_a_world, si.operation_doc_submit, wo.operation_record_export, wo.operation_world_clock_warp],
});
export const decision_milestones_m3b = m({
  id: "milestones.m3b-cloud", title: "Milestone 3b, the cloud: a world in the cloud that a person can open",
  done: "a world running in the cloud that a person can open in a browser while agents drive it.",
  needs: "docs/mission/cloud.md (sites.machine-and-route: one machine, one wildcard route, backups of MariaDB and the sites folder), the hosted site service (component site-service), world registration for local devnets (devnet.world-registers-hosted), and the address `<company>-<world>.<base>` (docs/mission/sites-host/ingress.md). Assumption: OpenShip registering a wildcard route is not determined; the first request through the route settles it (m3b-create-machine).",
  affects: [f.system_capxul, f.component_site_service, f.concept_sites, integration_site_service, integration_frappe_site, wo.operation_world_register],
});
export const decision_milestones_m4 = m({
  id: "milestones.m4-compatibility-climb", title: "Milestone 4, the compatibility climb: the kept operations built to the book",
  done: "the score: kept operations passing their evals on the real stack, group by group (organisations, hats, budgets, payments, board, agents, approvals, activity). No number is promised before milestone 2 is done.",
  needs: "milestones 2 and 3, the old code as reference for behaviour, and the evals the book derives (every operation's acceptance, refusals, events and spans).",
  affects: [f.system_capxul, f.concept_organizations, f.concept_budgets, f.concept_payments, f.concept_board, f.concept_agents, f.concept_approvals, f.concept_activity],
});
export const decision_milestones_m5 = m({
  id: "milestones.m5-company-life", title: "Milestone 5, Company life: a multi-month run on the real stack",
  done: "the books agree with the chain at every month end, over a multi-month run from the old scenario histories.",
  needs: "the first template (devnet.first-template: four old companies at month three, with date shifts), the seed adapter, a world stepped frozen (devnet.clock-rate-and-stepping), and the month-end check that Frappe's books equal the chain (plugs.repoint-money-fact, plugs.books-currency untested for GBP).",
  affects: [f.system_capxul, f.concept_books, f.concept_devnet, journey_run_a_world, journey_stays_true_when_broken],
});
