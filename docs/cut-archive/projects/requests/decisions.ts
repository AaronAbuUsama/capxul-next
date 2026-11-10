// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_books, concept_projects, concept_requests } from "../shared/foundation.ts";
import { contract_escrow, contract_escrow_factory, integration_indexer, integration_service_signer } from "../shared/external.ts";
import * as d from "./data.ts";
import * as iss from "./issuing.ts";
import * as inb from "./inbox.ts";
import * as svc from "./services.ts";
import * as co from "./checkout.ts";
import * as dep from "./deposits.ts";
import * as p from "./processes.ts";
import * as fl from "./flows.ts";
import * as op from "./operations.ts";

export const decision_requests_bill_time_in_projects = defineDecision({
  id: "requests.bill-time-in-projects",
  title: "Billing hours sits in the projects group: `org projects timesheet bill`",
  question:
    "The command surface puts every timesheet command under `org projects timesheet` (surface.projects-group). Billing " +
    "hours is requests' operation, not projects'. Does its command move with the timesheet's, and does its owner change?",
  options: [
    {
      label: "projects-group",
      text:
        "Move the words only. `org timesheet bill` becomes `org projects timesheet bill`, so the new operation's id becomes " +
        "`org.projects.timesheet.bill` (rules.new-operations: its words joined by dots) and its SDK method " +
        "`client.org(orgId).projects.timesheets.bill`, flow `client.org.projects.timesheets.bill`. Requests keeps the " +
        "operation, its flow and its rpc `requests.issuing.bill-time`; its claims, refusals, worlds and `--json` stay.",
    },
    { label: "flat", text: "Keep `org timesheet bill` while the timesheet's other six commands move under `org projects`." },
    { label: "request-word", text: "Spell it under requests' own word, `request bill <timesheet…>`, beside `request issue`." },
  ],
  chosen: "projects-group",
  why:
    "A person finds billing where they find the timesheet: beside `org projects timesheet submit`, as ERPNext's 'Make " +
    "Sales Invoice' sits on the Timesheet itself. A group is a word in the tree, not a concept: the operation stays " +
    "requests' because an Invoice is a request and its marks one money fact (requests.bill-time), and requests sits " +
    "above projects, so nothing in the design moves. Flat would leave the only timesheet verb outside its group. " +
    "`request bill` would be a person's command with no `org` for an Organization-only write (grammar G1), and would " +
    "split a timesheet's verbs over two words. Nothing about the behaviour changes: billing still issues one Invoice and " +
    "marks its hours in one write, under the Invoicing hat (aaron.projects). The move follows the tree, which is for " +
    "Aaron with the rest of the 119 moves (surface.tree, as projects.surface-moves says of the timesheet's other six): if he " +
    "keeps the booked nouns, this command returns to `org timesheet bill` with them, and nothing else changes.",
  source: SURFACE("docs/design/command-surface.md (sections 4 and 9); books/target/shared/surface.ts (surface.projects-group, surface.tree); aaron.projects"),
  affects: [fl.flow_client_org_projects_timesheets_bill, op.operation_org_projects_timesheet_bill],
});
