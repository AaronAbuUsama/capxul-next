// One decision per concept (or parked set) that left the built book in the cut: what moved, where it is, and what carries it.
// The coordinator's, on Aaron's delegation (cut.principle); each is generated from docs/cut-archive/index.json's moves and
// is the decision the frozen operations it classifies name (packages/blueprint-engine/scripts/check-frozen.ts). Nothing here is Aaron's ruling.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";
import {
  decision_cut_agreements_in_payments, decision_cut_equity_parked, decision_cut_fde_parked, decision_cut_individuals_parked,
  decision_cut_plug_placeholders, decision_cut_principle,
} from "./cut.ts";
import { decision_aaron_seasons, decision_aaron_seasons_dropped } from "./rulings.ts";

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
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): org.books.accounts.import (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.list (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.add (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.rename (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.archive (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.review (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.accounts.reclassify (reached): ERPNext Accounts through the door (`doc` on Account, Journal Entry; the chart importer). org.books.export.quickbooks (dropped): nothing: dropped; Frappe has its own exports. org.books.reports.balance-sheet (reached): an ERPNext report through the door (`report run`: Balance Sheet). org.books.reports.profit-and-loss (reached): an ERPNext report through the door (`report run`: Profit and Loss Statement). org.books.reports.reconcile (reached): an ERPNext report through the door (`report run`: Bank Reconciliation Tool). org.books.reports.trial-balance (reached): an ERPNext report through the door (`report run`: Trial Balance)."
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

export const decision_cut_requests = defineDecision({
  id: "cut.requests",
  title: "sellable services are parked: ERPNext Item and Payment Request may own them",
  question: "What happens to requests in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Sellable services are parked: ERPNext Item and Payment Request may own them. Moved to docs/cut-archive/books/ and docs/cut-archive/parked/services/ with their text intact: 4 tables, 1 event, 1 machine, 3 flows, 5 operations, 5 rpcs, 3 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. ERPNext Accounts owns the books (Account, GL Entry, Journal Entry, Payment Entry, Bank Transaction). Capxul's own records leave the built book; the chain reader that writes them from the chain stays as a plug."
      },
      {
          "label": "frozen-1",
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): service.create (parked): ERPNext Item and Payment Request through the door; `request issue` makes the payer's request. service.revise (parked): ERPNext Item and Payment Request through the door; `request issue` makes the payer's request. service.deactivate (parked): ERPNext Item and Payment Request through the door; `request issue` makes the payer's request. service.get (parked): ERPNext Item and Payment Request through the door; `request issue` makes the payer's request. service.list (parked): ERPNext Item and Payment Request through the door; `request issue` makes the payer's request."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): books/procedures.ts: export const procedure_books_record_money_fact = defineProce no longer reads or invokes table_book_cost_centers. books/annotations.ts: export const rpc_books_annotations_save no longer reads or invokes table_book_cost_centers. requests/checkout.ts: export const rpc_requests_checkout_get no longer reads or invokes table_services. requests/checkout.ts: export const rpc_requests_checkout_get no longer reads or invokes table_service_revisions. requests/checkout.ts: export const rpc_requests_checkout_open no longer reads or invokes table_services. requests/checkout.ts: export const rpc_requests_checkout_open no longer reads or invokes table_service_revisions."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle],
});

export const decision_cut_organizations = defineDecision({
  id: "cut.organizations",
  title: "the connected head leaves: Capxul hosts every site",
  question: "What happens to organizations in the built book?",
  options: [
      {
          "label": "moved",
          "text": "The connected head leaves: Capxul hosts every site. Moved to docs/cut-archive/organizations/ with their text intact: 4 tables, 2 workflows, 1 event, 1 machine, 2 flows, 3 rpcs, 2 operations, 6 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Capxul hosts every organisation's Frappe site and creates it with the organisation (aaron.one-door); nothing is connected from outside, so the connect and disconnect records go."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): organizations/heads.ts: export const rpc_organizations_heads_show no longer reads or invokes table_org_heads."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_plug_placeholders],
});

export const decision_cut_documents = defineDecision({
  id: "cut.documents",
  title: "document printing leaves: Frappe prints; the hash stamp stays",
  question: "What happens to documents in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Document printing leaves: Frappe prints; the hash stamp stays. Moved to docs/cut-archive/documents/ with their text intact: 2 flows, 2 operations, 1 rpc, 3 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Printing and exporting a document is Frappe's Print Format through the door. The hash stamp and its verification stay."
      },
      {
          "label": "frozen-1",
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): document.render (reached): Frappe Print Format through the door (`doc print`). document.export (reached): Frappe Print Format through the door (`doc print`)."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle],
});

export const decision_cut_equity = defineDecision({
  id: "cut.equity",
  title: "equity is parked until Aaron settles it",
  question: "What happens to equity in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Equity is parked until Aaron settles it. Moved to docs/cut-archive/parked/equity/ with their text intact: 7 tables, 7 events, 7 machines, 39 rpcs, 26 flows, 38 operations, 7 workflows, 2 journeys, 8 contracts, 1 concept, 31 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Parked: aaron.frappe-native keeps equity, START-HERE and GROUNDING drop it. Aaron settles it (cut.equity-parked)."
      },
      {
          "label": "frozen-1",
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): org.equity.setup (parked): nothing until Aaron settles equity (cut.equity-parked). org.equity.issue (parked): nothing until Aaron settles equity (cut.equity-parked). org.cap-table (parked): nothing until Aaron settles equity (cut.equity-parked). org.options.grant (parked): nothing until Aaron settles equity (cut.equity-parked). org.options.end (parked): nothing until Aaron settles equity (cut.equity-parked). org.options.show (parked): nothing until Aaron settles equity (cut.equity-parked). shares.accept (parked): nothing until Aaron settles equity (cut.equity-parked). shares.exercise (parked): nothing until Aaron settles equity (cut.equity-parked). shares (parked): nothing until Aaron settles equity (cut.equity-parked). shares.convert (parked): nothing until Aaron settles equity (cut.equity-parked). shares.sell (parked): nothing until Aaron settles equity (cut.equity-parked). org.equity.transfer.approve (parked): nothing until Aaron settles equity (cut.equity-parked). org.exit.preview (parked): nothing until Aaron settles equity (cut.equity-parked). org.exit.pay (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.preview (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.create (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.invite (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.allocate (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.close (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.cancel (parked): nothing until Aaron settles equity (cut.equity-parked). org.round.show (parked): nothing until Aaron settles equity (cut.equity-parked)."
      },
      {
          "label": "frozen-2",
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): org.safe.create (parked): nothing until Aaron settles equity (cut.equity-parked). org.safe.invite (parked): nothing until Aaron settles equity (cut.equity-parked). org.safe.close (parked): nothing until Aaron settles equity (cut.equity-parked). org.safe.show (parked): nothing until Aaron settles equity (cut.equity-parked). invest (parked): nothing until Aaron settles equity (cut.equity-parked). invest.show (parked): nothing until Aaron settles equity (cut.equity-parked). invest.commit (parked): nothing until Aaron settles equity (cut.equity-parked). invest.pay (parked): nothing until Aaron settles equity (cut.equity-parked). invest.sign (parked): nothing until Aaron settles equity (cut.equity-parked). org.vote.create (parked): nothing until Aaron settles equity (cut.equity-parked). org.vote.execute (parked): nothing until Aaron settles equity (cut.equity-parked). org.vote.list (parked): nothing until Aaron settles equity (cut.equity-parked). org.vote.show (parked): nothing until Aaron settles equity (cut.equity-parked). org.vote.wait (parked): nothing until Aaron settles equity (cut.equity-parked). vote.cast (parked): nothing until Aaron settles equity (cut.equity-parked). vote.delegate (parked): nothing until Aaron settles equity (cut.equity-parked). vote.list (parked): nothing until Aaron settles equity (cut.equity-parked)."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. The call is parked, not made: see the cut decision that parks it.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_equity_parked],
});

export const decision_cut_fde_hosted = defineDecision({
  id: "cut.fde-hosted",
  title: "the hosted FDE is parked until Aaron settles it",
  question: "What happens to the hosted FDE in the built book?",
  options: [
      {
          "label": "moved",
          "text": "The hosted FDE is parked until Aaron settles it. Moved to docs/cut-archive/parked/fde-hosted/ with their text intact: 4 tables, 6 workflows, 2 events, 2 machines, 7 rpcs, 2 flows, 7 operations, 2 procedures, 3 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Parked: GROUNDING makes the FDE an upsell, aaron.fde-hosted a hosted agent. Aaron settles it (cut.fde-parked)."
      },
      {
          "label": "trimmed-1",
          "text": "Kept records that read or invoked a removed record and no longer do (the dependency is Frappe's now): payments/processes.ts: export const workflow_payments_lifecycle_payment = defineWor no longer reads or invokes procedure_organizations_extend_fde_hosting. payments/processes.ts: export const workflow_payments_lifecycle_payment = defineWor no longer reads or invokes procedure_organizations_return_fde_hosting."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. The call is parked, not made: see the cut decision that parks it.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_fde_parked],
});

export const decision_cut_individuals = defineDecision({
  id: "cut.individuals",
  title: "referrals and the waitlist are parked: companies only for now",
  question: "What happens to referrals, the waitlist and the personal book in the built book?",
  options: [
      {
          "label": "moved",
          "text": "Referrals and the waitlist are parked: companies only for now. Moved to docs/cut-archive/parked/individuals/ with their text intact: 6 operations, 1 workflow, 6 rpcs. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Parked: companies only for now (cut.individuals-parked). The personal account and Safe stay."
      },
      {
          "label": "frozen-1",
          "text": "Frozen operations classified by the cut (packages/blueprint-engine/scripts/check-frozen.ts): referral.invite (parked): parked until individuals are settled (cut.individuals-parked). referral.list (parked): parked until individuals are settled (cut.individuals-parked). referral.show (parked): parked until individuals are settled (cut.individuals-parked). waitlist.invites.grant (parked): parked until individuals are settled (cut.individuals-parked). waitlist.join (parked): parked until individuals are settled (cut.individuals-parked). waitlist.status (parked): parked until individuals are settled (cut.individuals-parked)."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. The call is parked, not made: see the cut decision that parks it.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_cut_individuals_parked],
});

export const decision_cut_head = defineDecision({
  id: "cut.head",
  title: "the old Frappe head is replaced by the site, the features and the door",
  question: "What happens to head in the built book?",
  options: [
      {
          "label": "moved",
          "text": "The old Frappe head is replaced by the site, the features and the door. Moved to docs/cut-archive/organizations/ with their text intact: 16 operations, 16 rpcs, 1 flow, 1 table, 1 integration, 21 decisions. Listed in docs/cut-archive/INDEX.md with a reason and what carries each. Capxul hosts every organisation's Frappe site and creates it with the organisation (aaron.one-door); nothing is connected from outside, so the connect and disconnect records go."
      }
  ],
  chosen: "moved",
  why: "The cut's rule (cut.principle): Frappe owns what it owns and the door reaches it; nothing is deleted. Aaron's rulings aaron.frappe-native and aaron.one-door.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle],
});

export const decision_cut_seasons = defineDecision({
  id: "cut.seasons",
  title: "seasons are parked: a shared world keeps its clock, snapshots and grants",
  question: "What happens to a shared world's seasons now that Aaron has dropped them for now (aaron.seasons-dropped)?",
  options: [
    {
      label: "moved",
      text:
        "Seasons leave the built book. Moved to docs/cut-archive/parked/seasons/ with their text intact: 11 operations (the `dev " +
        "season` commands), their 11 Core SDK flows, 9 decisions (devnet.seasons, devnet.season-players, devnet.season-jumps, " +
        "devnet.season-reset, devnet.season-protocol, devnet.season-worlds, devnet.season-claims, devnet.seasons-on-a-world, " +
        "time.seasons) and 2 invariants (time.season-schedule, time.season-reset). There was no table, state machine or rpc of " +
        "their own: the supervisor kept seasons outside the chain. Listed in docs/cut-archive/INDEX.md with a reason. Aaron's " +
        "earlier ruling aaron.seasons (9 November 2026) is set aside by his answer, not deleted: it stays in rulings.ts " +
        "unedited. None of the eleven operations is one of the 215 frozen ones, so the frozen check classifies nothing.",
    },
    {
      label: "trimmed-1",
      text:
        "Kept records that named a season and no longer do: the `devnet-control` integration (shared/external.ts) loses its eleven " +
        "season calls and their helpers (kept as text in docs/cut-archive/parked/seasons/shared/external.ts) and the lines of its " +
        "text and its calls' failures that named a season; the shared-world environment (shared/foundation.ts) no longer says its time " +
        "runs in seasons; the eval world catalog (devnet/worlds.ts) loses season-planned, season-running and season-ended (kept as text in " +
        "docs/cut-archive/parked/seasons/devnet/worlds.ts); shared-world-joiner and shared-world-owner are reworded; devnet.budgets and the " +
        "operations' lists stop naming season commands.",
    },
    {
      label: "stays-1",
      text:
        "What seasons shared with worlds stays: the clock and its rate (dev time, devnet.clock-rate), snapshots (dev snapshot), grants and " +
        "the owner-only rules (devnet.shared-world). The `season` field of the supervisor's Clock, ClockEvent and Snapshot shapes (devnet/flows.ts) stays and is " +
        "always null now; remove it if seasons stay dropped. Prose in kept decisions that names a season (for example " +
        "devnet.supervisor-owns-time-and-worlds, devnet.stateful-followers, time.worlds, time.one-clock, payments' claim-retry) is read as parked.",
    },
    {
      label: "to-revisit-1",
      text:
        "To revisit, not decided here: a shared world's gateway admitted a joiner's backend calls only while a season the joiner plays ran " +
        "(devnet.season-players); with seasons parked the rule that admits a joiner is undefined, and so is what devnet.shared-world's " +
        "supersession by aaron.seasons now means. It goes with the time study (docs/design/time-deep-dive.md), since a shared world's clock is the question there.",
    },
  ],
  chosen: "moved",
  why:
    "Aaron, 10 November 2026, dictated, on devnet.seasons: 'Let's just drop this for now, man. This seems like it's just adding complexity where it doesn't really need it. It's not even needed yet. We can add this later if we want it.' " +
    "The cut's rule (cut.principle) is that nothing is deleted: parking keeps the design for when he wants it.",
  source: BY,
  affects: [f.system_capxul, decision_cut_principle, decision_aaron_seasons_dropped, decision_aaron_seasons],
});
