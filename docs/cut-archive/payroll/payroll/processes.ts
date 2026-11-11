// Moved out of the built book by the cut, 10 November 2026, from books/target/payroll/processes.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { contract_agreements, integration_chain_rpc, integration_frappe_head, integration_indexer } from "../shared/external.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { table_approvals } from "../approvals/data.ts";
import { table_board_proposals } from "../board/data.ts";
import {
  machine_agreement,
  machine_agreement_write,
  machine_employee,
  machine_salary_slip,
  machine_salary_structure,
  machine_salary_structure_assignment,
  machine_payroll_entry,
  table_agreement_writes,
  table_agreements,
  table_employees,
  table_payroll_changes,
  table_payroll_entries,
  table_payroll_head_syncs,
  table_payroll_settings,
  table_salary_components,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { table_parties } from "../parties/data.ts";
import {
  machine_attendance,
  machine_employee_advance,
  machine_leave_allocation,
  machine_leave_application,
  machine_shift_assignment,
  table_additional_salaries,
  table_attendances,
  table_employee_advances,
  table_employee_checkins,
  table_expense_claim_types,
  table_expense_claims,
  table_holiday_lists,
  table_hr_settings,
  table_leave_allocations,
  table_leave_applications,
  table_leave_types,
  table_shift_assignments,
  table_shift_types,
} from "./hr-data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_books_record_payroll_accrual } from "../books/procedures.ts";
import { table_budgets } from "../budgets/data.ts";
import {
  event_org_head_transitioned,
  machine_org_head,
  machine_org_setup,
  table_org_deployments,
  table_org_heads,
  table_org_members,
  table_organizations,
} from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { LOGGED } from "./employees.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect } from "./payees.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { event_proposal_transitioned } from "../board/data.ts";

export const workflow_payroll_startup_open = defineWorkflow({
  id: "payroll.startup.open",
  title: "Start the Organization's payroll: its Payroll and HR Settings",
  about:
    "Started by an Organization setup's `begin`, through the outbox: payroll is a fundamental app, in Frappe HR's shape " +
    "from the first day whether or not a head is ever connected (aaron.frappe-shape, payroll.startup). In one " +
    "transaction it writes the Organization's Payroll Settings and HR Settings, as Frappe HR's install writes those " +
    "singles (`set_single_defaults`), but with the values Capxul computes by and a head must match (attendance-based, " +
    "unmarked days present, self-approval refused, holidays " +
    "counted as working days, no rounded total, no Frappe email, accounting by Employee) and the change counter at " +
    "zero, so every payroll write finds its lock row. It makes no salary component: Frappe HR installs none outside " +
    "its India setup, and a business's pay is its own to define; " +
    "the agreement component is made at the first acceptance. It cannot be a step of `begin`, which is organizations' " +
    "and may not write another concept's tables.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: machine_org_setup.t.begin },
  steps: [{ name: "settings", about: "Write the Payroll Settings with last_seq zero and the HR Settings, unless the Organization already has them." }],
  reads: [table_payroll_settings, table_hr_settings],
  writes: [table_payroll_settings, table_hr_settings],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One run per Organization (`payroll-startup:<orgId>`): a second finds the settings row and writes nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: ["/tmp/hrms/hrms/setup.py:606", "/tmp/hrms/hrms/payroll/doctype/payroll_settings/payroll_settings.json"],
});

const e = machine_payroll_entry.t;

const s = machine_salary_slip.t;

const SYNCED = [
  table_employees,
  table_salary_components,
  table_salary_structures,
  table_salary_structure_assignments,
  table_payroll_entries,
  table_salary_slips,
  // the HR that changes pay or moves money (payroll.hr-head-sync)
  table_holiday_lists,
  table_leave_types,
  table_leave_allocations,
  table_leave_applications,
  table_shift_types,
  table_shift_assignments,
  table_employee_checkins,
  table_attendances,
  table_expense_claim_types,
  table_expense_claims,
  table_employee_advances,
  table_additional_salaries,
  table_hr_settings,
];

export const workflow_payroll_head_sync = defineWorkflow({
  id: "payroll.head.sync",
  title: "Sync the Organization's payroll with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection, for as long as the head is connected " +
    "(payroll.head-sync). The head never writes into Capxul: it rings, and this process calls it with Capxul's key " +
    "(organizations.head-doorbell). Push: it pages `payroll-changes` after `pushed_seq` and writes each changed record " +
    "as it stands (`upsertDocs`, in seq order, by `capxul_id`, with its version): Employees, components, submitted " +
    "structures and assignments, a submitted Payroll Entry Capxul computed (never a draft), each slip's payment facts " +
    "(`capxul_status`, payment id, transaction, block time), and an agreement's Employee, assignment and collection " +
    "slips, read-only there. For a Capxul run the head's Capxul app lets Frappe HR make its own draft slips, compares " +
    "them to the cent and submits each alone only when they agree, never through Submit Salary Slip, which would post " +
    "a second accrual (payroll.one-computer-per-run). Pull: it reads the head's changes after `pulled_change` " +
    "(`listChanges`) and applies each as the head's user, a member matched by mailbox whose Safe wears the People hat, " +
    "through payroll's own checks: an Employee born there is hired from its `personal_email` through " +
    "`parties.resolve-recipient`; edits to shared fields apply; a component, structure or assignment born there is " +
    "born here; a Salary Withholding withholds or releases; a Payroll Entry the head submitted is taken in by " +
    "payroll.import-run; a head run's cancel cancels it here while nothing of it is paid. Money and identity are " +
    "Capxul's (organizations.head-ownership): a head change to a Party, Safe, pay mailbox, budget, a Capxul run's " +
    "figures, a payment fact or an agreement's records is refused and Capxul's version pushed back, as is a change on " +
    "an older version, by a user without the People hat, or one the checks refuse; HR, as payroll.hr-head-sync. " +
    "It wakes on a change here, a ring, and daily; while the head is failing it " +
    "waits; it ends when the head is disconnected.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_payroll_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_payroll_changes], props: ["org_id"] }],
      about: "A payroll record changed here: push it.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    { name: "push", about: "Page payroll-changes after pushed_seq; upsertDocs in seq order, drafts left out; record the head's names; advance pushed_seq." },
    {
      name: "pull",
      about:
        "listChanges after pulled_change; apply each through payroll's checks (a head-born Employee's Party from its " +
        "`personal_email`, never `company_email`), or push back a conflict or a refusal; advance pulled_change.",
    },
    { name: "import", about: "A Payroll Entry the head submitted: take it in with its slips and payslips by payroll.import-run, once by its head name." },
    { name: "await", about: "Wait for a change here, a ring, the daily catch-up or the connection's next transition." },
  ],
  reads: [
    table_org_heads,
    table_organizations,
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
    table_parties,
    table_budgets,
    table_payroll_head_syncs,
    ...LOGGED,
    ...SYNCED,
  ],
  writes: [table_payroll_head_syncs, ...LOGGED, ...SYNCED],
  drives: [
    machine_employee.t.hire,
    machine_employee.t.suspend,
    machine_employee.t.deactivate,
    machine_employee.t.reinstate,
    machine_employee.t.leave,
    machine_salary_structure.t.submit,
    machine_salary_structure.t.cancel,
    machine_salary_structure_assignment.t.submit,
    machine_salary_structure_assignment.t.cancel,
    e.import,
    e.cancel,
    s.import,
    s.import_withheld,
    s.withhold,
    s.release,
    s.cancel,
    machine_leave_allocation.t.allocate,
    machine_leave_allocation.t.cancel,
    machine_leave_application.t.apply,
    machine_leave_application.t.approve,
    machine_leave_application.t.reject,
    machine_leave_application.t.cancel,
    machine_attendance.t.mark,
    machine_attendance.t.cancel,
    machine_shift_assignment.t.assign,
    machine_shift_assignment.t.unassign,
    machine_employee_advance.t.recover,
    machine_employee_advance.t.recover_partly,
  ],
  invokes: [procedure_parties_resolve_recipient, procedure_documents_store],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges],
  chain: [],
  idempotency:
    "One process per head connection (`payroll-head:<orgId>:<headId>`). A push is idempotent by version (the head " +
    "answers unchanged); a pulled change already applied is skipped by its head name and time; a head's Payroll Entry " +
    "is taken in once, by its unique head name.",
  timeoutMs: 60_000,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});
