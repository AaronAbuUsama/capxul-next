// One decision per concept (or parked set) that left the built book in the cut: what moved, where it is, and what carries it.
// The coordinator's, on Aaron's delegation (cut.principle); each is generated from docs/cut-archive/index.json's moves and
// is the decision the frozen operations it classifies name (tools/check-frozen.ts). Nothing here is Aaron's ruling.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import {
  decision_cut_agreements_in_payments, decision_cut_equity_parked, decision_cut_fde_parked, decision_cut_individuals_parked,
  decision_cut_plug_placeholders, decision_cut_principle,
} from "./cut.ts";

const BY = "The coordinator, 10 November 2026, on Aaron's delegation of the book (aaron.one-door, aaron.frappe-native)";

export const decision_cut_projects = defineDecision({
  id: "cut.projects",
  title: "projects leaves the built book: Frappe owns projects and timesheets",
  question: "What happens to projects in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Projects leaves the built book: Frappe owns projects and timesheets. Moved to docs/cut-archive/projects/ with their text intact: 36 rpcs, 10 tables, 3 events, 3 machines, 36 operations, 1 procedure, 3 workflows, 1 concept, 1 flow, 33 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Frappe owns projects, tasks and timesheets (ERPNext Projects: Project, Task, Timesheet, Activity Type). Capxul's own records leave the built book; the work is reached through the door as the calling person."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): books/procedures.ts: export const procedure_books_record_money_fact = defineProce no longer reads or invokes table_projects. books/procedures.ts: export const procedure_books_record_payroll_accrual = define no longer reads or invokes table_projects. books/annotations.ts: export const rpc_books_annotations_save no longer reads or invokes table_projects. books/processes.ts: export const workflow_books_head_sync no longer reads or invokes table_projects. requests/issuing.ts: export const rpc_requests_issuing_cancel no longer reads or invokes procedure_projects_bill_time. requests/inbox.ts: export const rpc_requests_inbox_decline no longer reads or invokes procedure_projects_bill_time."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle],
});
