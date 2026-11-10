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

export const decision_cut_contacts = defineDecision({
  id: "cut.contacts",
  title: "contacts leaves the built book: Frappe owns the CRM and the address book",
  question: "What happens to contacts in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Contacts leaves the built book: Frappe owns the CRM and the address book. Moved to docs/cut-archive/contacts/ with their text intact: 22 rpcs, 14 tables, 7 events, 7 machines, 19 flows, 24 operations, 3 workflows, 25 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Frappe CRM owns leads, deals, tasks, notes, calls, email and WhatsApp, and Frappe core owns Contact and Address. Capxul's own records leave the built book; they are reached through the door."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_individuals_parked],
});

export const decision_cut_payroll = defineDecision({
  id: "cut.payroll",
  title: "payroll leaves the built book: Frappe HR owns it; pay agreements move to paymen",
  question: "What happens to payroll in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Payroll leaves the built book: Frappe HR owns it; pay agreements move to payments. Moved to docs/cut-archive/payroll/ with their text intact: 18 workflows, 65 rpcs, 22 tables, 11 events, 11 machines, 31 flows, 76 operations, 53 decisions, 1 concept. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Frappe HR owns payroll, HR, leave, attendance, shifts and expense claims (Employee, Salary Structure, Payroll Entry, Salary Slip, Leave Application, Attendance, Expense Claim). Capxul's own records leave the built book; they are reached through the door."
      },
      {
          "label": "carried-1",
          "text": "Operations that still move money or change authority, and what carries them (stage 3 writes the plug; cut.plug-placeholders): org.hr.employee.add -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.employee.suspend -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.employee.deactivate -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.employee.reinstate -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.employee.leave -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.payroll.run.pay -> plug: the signer (a Frappe payment is held until the chain confirms), then Core operation org.department.pay. org.payroll.payslip.withhold -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.payroll.payslip.release -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.leave.approve -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.leave.reject -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.expense-claim.approve -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant."
      },
      {
          "label": "carried-2",
          "text": "Operations that still move money or change authority, and what carries them (stage 3 writes the plug; cut.plug-placeholders): org.hr.expense-claim.reject -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant. org.hr.expense-claim.pay -> plug: the signer (a Frappe payment is held until the chain confirms), then Core operation org.department.pay. org.hr.advance.pay -> plug: the signer (a Frappe payment is held until the chain confirms), then Core operation org.department.pay. org.hr.advance.reject -> plug: roles follow hats (the payroll-approver hat gives the Frappe approval roles); the hat itself is granted by org.member.grant."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes table_employees. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes table_salary_components. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes table_salary_structures. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes table_salary_structure_assignments. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes table_salary_slips. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes LOGGED. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes machine_employee. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes machine_salary_structure. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes machine_salary_structure_assignment. payroll/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes machine_salary_slip."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_plug_placeholders, decision_cut_agreements_in_payments],
});

export const decision_cut_books = defineDecision({
  id: "cut.books",
  title: "books leaves the built book but its chain reader: ERPNext owns the books",
  question: "What happens to books in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Books leaves the built book but its chain reader: ERPNext owns the books. Moved to docs/cut-archive/books/ with their text intact: 14 rpcs, 1 event, 1 machine, 2 tables, 2 invariants, 2 flows, 12 operations, 1 procedure, 2 workflows, 7 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. ERPNext Accounts owns the books (Account, GL Entry, Journal Entry, Payment Entry, Bank Transaction). Capxul's own records leave the built book; the chain reader that writes them from the chain stays as a plug."
      },
      {
          "label": "frozen-1",
          "text": "Frozen operations classified by the cut (tools/check-frozen.ts): org.books.accounts.import (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.list (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.add (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.rename (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.archive (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.review (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.reclassify (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.export.quickbooks (dropped): nothing: dropped; Frappe has its own exports. org.books.reports.balance-sheet (reached): an ERPNext report through the door (`report run`: Balance Sheet). org.books.reports.profit-and-loss (reached): an ERPNext report through the door (`report run`: Profit and Loss Statement). org.books.reports.reconcile (reached): an ERPNext report through the door (`report run`: Bank Reconciliation Tool). org.books.reports.trial-balance (reached): an ERPNext report through the door (`report run`: Balance Sheet)."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): books/procedures.ts: export const procedure_books_record_money_fact = defineProce no longer reads or invokes table_book_prices. payments/agreements/processes.ts: export const workflow_payroll_agreements_lifecycle = defineW no longer reads or invokes procedure_books_record_payroll_accrual. activity/holdings.ts: export const rpc_activity_holdings_balances no longer reads or invokes table_book_prices."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_plug_placeholders],
});
