// Moved out of the built book by the cut, 10 November 2026, from books/target/payroll/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_board, concept_books, concept_budgets, concept_notices, concept_payments, concept_payroll } from "../shared/foundation.ts";
import { contract_agreements, integration_indexer } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_FEATURE_NOT_AVAILABLE,
  error_TOKEN_REQUIRED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_approval, table_approvals } from "../approvals/data.ts";
import { procedure_approvals_open, procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_proposal, table_board_proposals } from "../board/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import {
  event_agreement_transitioned,
  event_agreement_write_transitioned,
  event_payroll_entry_transitioned,
  event_salary_slip_transitioned,
  machine_agreement,
  machine_agreement_write,
  machine_employee,
  machine_payroll_entry,
  machine_salary_slip,
  machine_salary_structure,
  machine_salary_structure_assignment,
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
import { rpc_payroll_employees_add, rpc_payroll_employees_change, rpc_payroll_employees_get, rpc_payroll_employees_list } from "./employees.ts";
import { flow_client_org_payroll_runs_pay, rpc_payroll_runs_pay, workflow_payroll_runs_lifecycle } from "./staged.ts";
import {
  rpc_payroll_structures_assign,
  rpc_payroll_structures_cancel,
  rpc_payroll_structures_component,
  rpc_payroll_structures_create,
  rpc_payroll_structures_list,
} from "./structures.ts";
import {
  IMPORT_RUN,
  rpc_payroll_runs_cancel,
  rpc_payroll_runs_create,
  rpc_payroll_runs_list,
  rpc_payroll_runs_show,
  rpc_payroll_runs_submit,
  rpc_payroll_runs_withhold,
} from "./runs.ts";
import { rpc_payroll_slips_mine } from "./slips.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_list,
  rpc_payroll_holders_offer,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect, rpc_payroll_payees_list, rpc_payroll_payees_show } from "./payees.ts";
import { rpc_payroll_writes_watch } from "./writes.ts";
import {
  flow_client_org_hr_advances_pay,
  flow_client_org_hr_advances_settle,
  flow_client_org_hr_expense_claims_pay,
  rpc_payroll_advances_settle,
} from "./expenses.ts";
import { rpc_payroll_leave_list } from "./leave.ts";
import { workflow_payroll_agreements_lifecycle, workflow_payroll_head_sync, workflow_payroll_startup_open } from "./processes.ts";
import {
  flow_client_me_payroll_payslips_get,
  flow_client_me_payroll_payslips_list,
  flow_client_org_hr_employees_add,
  flow_client_org_hr_employees_change,
  flow_client_org_hr_employees_deactivate,
  flow_client_org_hr_employees_get,
  flow_client_org_hr_employees_leave,
  flow_client_org_hr_employees_list,
  flow_client_org_hr_employees_reinstate,
  flow_client_org_hr_employees_suspend,
  flow_client_org_payroll_components_add,
  flow_client_org_payroll_components_change,
  flow_client_org_payroll_components_disable,
  flow_client_org_payroll_components_enable,
  flow_client_org_payroll_components_list,
  flow_client_org_payroll_runs_cancel,
  flow_client_org_payroll_runs_create,
  flow_client_org_payroll_runs_get,
  flow_client_org_payroll_runs_list,
  flow_client_org_payroll_runs_submit,
  flow_client_org_payroll_structures_assign,
  flow_client_org_payroll_structures_cancel,
  flow_client_org_payroll_structures_create,
  flow_client_org_payroll_structures_list,
  flow_client_org_payroll_structures_unassign,
  flow_client_org_payroll_payslips_release,
  flow_client_org_payroll_payslips_withhold,
  flow_client_me_payroll_agreements_accept,
  flow_client_me_payroll_agreements_collect,
  flow_client_org_payroll_agreements_change,
  flow_client_org_payroll_agreements_end,
  flow_client_org_payroll_agreements_offer,
  flow_client_org_payroll_agreements_pause,
  flow_client_org_payroll_agreements_resume,
  flow_client_org_payroll_agreements_withdraw,
} from "./flows.ts";
import {
  operation_agreement_accept,
  operation_agreement_collect,
  operation_agreement_list,
  operation_agreement_show,
  operation_org_agreement_change,
  operation_org_agreement_end,
  operation_org_agreement_list,
  operation_org_agreement_offer,
  operation_org_agreement_pause,
  operation_org_agreement_resume,
  operation_org_agreement_withdraw,
  CRITICAL_OPERATIONS,
  HR_OPERATIONS,
  NEW_OPERATIONS,
  operation_org_hr_employee_add,
  operation_org_hr_employee_change,
  operation_org_hr_employee_leave,
  operation_org_hr_employee_list,
  operation_org_hr_employee_suspend,
  operation_org_payroll_component_add,
  operation_org_payroll_component_change,
  operation_org_payroll_component_disable,
  operation_org_payroll_component_enable,
  operation_org_payroll_component_list,
  operation_org_payroll_run_create,
  operation_org_payroll_run_list,
  operation_org_payroll_run_pay,
  operation_org_payroll_structure_assign,
  operation_org_payroll_structure_create,
  operation_org_payroll_structure_list,
  operation_org_payroll_structure_unassign,
  operation_payroll_payslip_get,
  operation_payroll_payslip_list,
} from "./operations.ts";

const HR_RPCS = [
  rpc_payroll_employees_add,
  rpc_payroll_employees_change,
  rpc_payroll_employees_get,
  rpc_payroll_employees_list,
  rpc_payroll_structures_component,
  rpc_payroll_structures_create,
  rpc_payroll_structures_assign,
  rpc_payroll_structures_cancel,
  rpc_payroll_structures_list,
  rpc_payroll_runs_create,
  rpc_payroll_runs_submit,
  rpc_payroll_runs_withhold,
  rpc_payroll_runs_cancel,
  rpc_payroll_runs_show,
  rpc_payroll_runs_list,
];

const HR_TABLES = [
  table_employees,
  table_salary_components,
  table_salary_structures,
  table_salary_structure_assignments,
  table_payroll_entries,
  table_salary_slips,
];

/** One SDK method per HR command (payroll.hr-surface, payroll.command-flows), in the pack's order. */
const HR_FLOWS = [
  flow_client_org_hr_employees_add,
  flow_client_org_hr_employees_change,
  flow_client_org_hr_employees_get,
  flow_client_org_hr_employees_list,
  flow_client_org_hr_employees_suspend,
  flow_client_org_hr_employees_deactivate,
  flow_client_org_hr_employees_reinstate,
  flow_client_org_hr_employees_leave,
  flow_client_org_payroll_components_add,
  flow_client_org_payroll_components_change,
  flow_client_org_payroll_components_list,
  flow_client_org_payroll_components_disable,
  flow_client_org_payroll_components_enable,
  flow_client_org_payroll_structures_create,
  flow_client_org_payroll_structures_cancel,
  flow_client_org_payroll_structures_assign,
  flow_client_org_payroll_structures_unassign,
  flow_client_org_payroll_structures_list,
  flow_client_org_payroll_runs_create,
  flow_client_org_payroll_runs_submit,
  flow_client_org_payroll_runs_pay,
  flow_client_org_payroll_runs_cancel,
  flow_client_org_payroll_runs_list,
  flow_client_org_payroll_runs_get,
  flow_client_org_payroll_payslips_withhold,
  flow_client_org_payroll_payslips_release,
  flow_client_me_payroll_payslips_list,
  flow_client_me_payroll_payslips_get,
];

export const decision_payroll_frappe_doctypes = defineDecision({
  id: "payroll.frappe-doctypes",
  title: "Six Frappe HR doctypes, one table each, with Frappe's field names",
  question: "Which of Frappe HR's doctypes does Capxul keep itself, and in what shape?",
  options: [
    {
      label: "six",
      text:
        "Employee, Salary Component, Salary Structure (its Salary Detail rows embedded), Salary Structure Assignment, " +
        "Payroll Entry (its Payroll Employee Detail rows embedded) and Salary Slip, with Frappe's field names and " +
        "options; Capxul's own fields only where money or identity needs them (a Party, a Safe, a budget, a payment's " +
        "settled facts), each a Custom Field on a head. Submittable doctypes are written submitted and never edited.",
    },
    { label: "own-shape", text: "Capxul's own payroll tables, mapped to Frappe's only by the sync." },
    { label: "all", text: "Every payroll doctype Frappe HR has: tax slabs, payroll periods, benefits, gratuity, arrears, leave, attendance." },
  ],
  chosen: "six",
  why:
    "These six are the whole path from a person to a paid slip in Frappe HR (`payroll_entry.py` makes slips from " +
    "assignments of structures of components), so with them an Organization's payroll is complete without a head and a " +
    "head reads it field for field: the sync renames nothing. Child tables are embedded because no reader queries a row " +
    "alone. Writing submitted documents at once keeps Frappe's rule that a submitted document is amended, never edited, " +
    "without a draft lifecycle for structures nobody reviews in Capxul. The rest (Income Tax Slab, Payroll Period, " +
    "benefits, gratuity, timesheets) are a head's: a run that needs them is computed there " +
    "(payroll.one-computer-per-run). Leave and attendance were here too until payroll came to mean HR: the HR that " +
    "changes pay or moves money is native now (payroll.hr-scope). Additional Salary stays a head's own but for an " +
    "advance's recovery (payroll.advance-recovery): a collection is pushed as its own slip, never as one, which Frappe " +
    "would fold into the next slip (payroll.agreements-in-frappe-shape).",
  source: AFTER_RULING(`aaron.frappe-shape, aaron.erp-on-capxul; ${HRMS} (salary_slip, payroll_entry, salary_structure_assignment JSON)`),
  affects: [...HR_TABLES, concept_payroll],
});

export const decision_payroll_portable_formulas = defineDecision({
  id: "payroll.portable-formulas",
  title: "Capxul works out Frappe's formulas in a subset, evaluated as Python does",
  question:
    "Frappe HR evaluates a component's condition and formula as Python with a few helpers (`_safe_eval`, " +
    "COMPONENT_EVAL_GLOBALS). Capxul must work slips out without a head, to the cent a head would. With what?",
  options: [
    {
      label: "portable-subset",
      text:
        "Keep every formula as Frappe writes it, and evaluate a subset of Python expressions: numbers, `+ - * /`, " +
        "comparisons, `and`, `or`, `not`, a conditional expression, eight of Frappe's helpers (`round`, `rounded`, " +
        "`floor`, `ceil`, `min`, `max`, `int`, `float`), and the names a slip has (`base`, `variable`, the day counts, " +
        "`gross_pay`, earlier rows' abbreviations). It is evaluated exactly as CPython evaluates it, in IEEE 754 binary64 " +
        "(true division, Python's `round` half to even on the binary value, `int` toward zero), and `rounded` with the " +
        "Banker's Rounding a head is set to. Each row's result is then rounded at once, as Frappe's `flt` does, and kept " +
        "as an exact decimal. Proration follows this version of Frappe HR: a row that depends on payment days is its " +
        "full-period amount (its formula over the earlier rows' full-period amounts) times payment days over working days; " +
        "any other row is its formula over the earlier rows' prorated amounts. A component outside the subset is kept, " +
        "marked not portable, for a head to compute.",
    },
    { label: "exact-decimals", text: "Evaluate the subset in exact decimal arithmetic." },
    { label: "amounts-only", text: "Fixed amounts only: no formulas until a head is connected." },
    { label: "python", text: "Run Frappe's own Python evaluator in a sandbox inside Capxul." },
  ],
  chosen: "portable-subset",
  why:
    "The subset covers what most structures use (a percentage of base, a cap, a prorated allowance). What makes it " +
    "portable is evaluating it the way the head does: Frappe's operands are Python floats, so exact decimals would " +
    "differ at the edges (`ceil(0.1 * 3 * 10)` is 4 on a head and 3 in exact decimals; `round(2.675, 2)` is 2.67 on a " +
    "head and 2.68 in exact half-even), and a Capxul run would then fail the head's check. Binary64 arithmetic and " +
    "Python's helpers are fully specified, so the same expression gives the same bits in both, and money is exact from " +
    "the row's rounding on (payroll.money-and-rounding). Amounts only would leave common structures without a head. A " +
    "Python sandbox is a second runtime with its own failure modes, and would still not have the head's leave, " +
    "attendance or tax slabs.",
  source: AFTER_RULING(`aaron.frappe-shape; ${HRMS}/salary_slip/salary_slip.py:1359, :1471, :2250; ${HRMS}/salary_structure_assignment/salary_structure_assignment.py:240`),
  affects: [table_salary_components, rpc_payroll_structures_component, rpc_payroll_structures_create, rpc_payroll_runs_create],
});

export const decision_payroll_slip_machine = defineDecision({
  id: "payroll.slip-machine",
  title: "A slip's states: Frappe's four and Capxul's paying, escrowed and paid",
  question: "Frappe's Salary Slip has Draft, Submitted, Withheld and Cancelled, and no paid. What states does a Capxul slip have?",
  options: [
    {
      label: "seven",
      text:
        "draft, submitted, withheld and cancelled as Frappe has them; paying, escrowed and paid from payments' settlement " +
        "of the slip's Payment, which a head reads as Submitted with a `capxul_status` Custom Field; a collection's slip " +
        "born paid; a head's slip born submitted, or withheld when its Salary Withholding holds it. Back moves: a lapsed " +
        "approval to submitted, keeping its payment id for the same command's resume; a refunded escrow to submitted, its " +
        "payment fields cleared; a reorg's unsettle to paying.",
    },
    { label: "frappe-four", text: "Frappe's four only; paid is read from the ledger when asked." },
  ],
  chosen: "seven",
  why:
    "Frappe knows a run is paid only when its Bank Entry exists (`has_bank_entries`, true at the first entry), which " +
    "cannot say which person is paid. On Capxul each slip's net is its own Payment, so each slip has its own paid, from " +
    "chain proof at finality, and the employee sees it. Escrowed is its own state because a new hire's money has left " +
    "the budget but is not theirs until they collect it (at setup, or later with `payment claim`), and may come back. A lapsed slip keeps its Payment because " +
    "payments keeps that Payment retryable (`needs_retry`); a new Payment beside it could pay twice, so only its own " +
    "command's resume pays it, and it cannot be withheld or cancelled meanwhile. A refunded escrow's Payment is " +
    "cancelled for good, so the slip forgets it and a later command pays it anew. Frappe's Withheld is not a flag but a " +
    "Salary Withholding covering the slip's period (`check_salary_withholding`), so a head's withheld slip must arrive " +
    "withheld, never payable. One status column keeps it one machine with one event (P7); the head's Submitted is " +
    "unchanged, so no Frappe option is altered.",
  source: AFTER_RULING(`aaron.frappe-shape, aaron.budget-pay-unclaimed; ${HRMS}/payroll_entry/payroll_entry.py:1069; ${HRMS}/salary_slip/salary_slip.py:257, :355; payments/data.ts (payment)`),
  affects: [machine_salary_slip, event_salary_slip_transitioned, table_salary_slips],
});

export const decision_payroll_run_machine = defineDecision({
  id: "payroll.run-machine",
  title: "A run: draft, submitted, paying, paid or cancelled",
  question: "Frappe's Payroll Entry is Draft, Submitted, Cancelled, Queued or Failed. What does a Capxul run move through?",
  options: [
    {
      label: "five",
      text:
        "draft, submitted, paying, paid, cancelled; imported runs are born submitted; cancel only while no slip holds a " +
        "Payment; a lapse returns the run to submitted only while nothing of it is paid or escrowed. A head reads paying " +
        "and paid as Submitted with a `capxul_status` Custom Field.",
    },
    { label: "frappe", text: "Frappe's five, with paid read from the slips." },
  ],
  chosen: "five",
  why:
    "Queued and Failed are Frappe's background jobs for making and submitting many slips; Capxul works a run out in " +
    "one transaction, so it never has them. Paying and paid are what a holder and the FDE agent need to know: whether " +
    "the one approval was signed and whether every slip that is not withheld is paid. Frappe validates a Select against " +
    "its options on save, so paying and paid cannot be written to the head's `status`; they ride in `capxul_status`. A " +
    "run with anything paid is never cancelled: money that moved is reversed forward, never undone; and a run holding a " +
    "lapsed Payment is not cancelled either, because payments keeps that Payment retryable.",
  source: AFTER_RULING(`aaron.frappe-shape; ${HRMS}/payroll_entry/payroll_entry.py:104, :1735; ${HRMS}/payroll_entry/payroll_entry.json (status options)`),
  affects: [machine_payroll_entry, event_payroll_entry_transitioned, table_payroll_entries],
});

export const decision_payroll_deduction_remittance = defineDecision({
  id: "payroll.deduction-remittance",
  title: "Deductions stay owed; their payee is paid outside the run",
  question: "Frappe HR leaves each deduction a liability nobody pays. Who pays the tax office or the pension fund, and how?",
  options: [
    {
      label: "payee-recorded",
      text:
        "A deduction or employer contribution may name the Party its liability is owed to (a Custom Field on a head). " +
        "The run's command carries nets only. When a remittance falls due, whoever wears the department budget's hat, or " +
        "one above it (the hosted FDE only for a member who asked it, as that member: rules.fde-acts-for-asker), pays that Party with an ordinary budget payment " +
        "against the component's liability account, which books " +
        "posts as a Bank Entry on that liability. A component with no payee stays a liability, as in Frappe HR.",
    },
    {
      label: "in-run",
      text:
        "Add one remittance item per payee, the run's total for it, to the run's command, under a schedule document.",
    },
    { label: "never", text: "As Frappe HR: payroll records no payee at all." },
  ],
  chosen: "payee-recorded",
  why:
    "Remitting inside the run's command was the first design, and does not hold: a run can hold several commands (a " +
    "resumed one, a released or refunded slip's), and each would add the run's remittance again and pay the tax office " +
    "twice; the remittance Payments would have no record in payroll to follow or retry; and documents has no kind for " +
    "a remittance schedule. Remittances also fall due on their own calendar (usually once a period for every run), " +
    "which is how the vision has them, not on payday. An ordinary budget payment already carries an account for books " +
    "and keeps its own request key, so nothing new is needed, and Frappe HR's behaviour is kept. Recording the payee " +
    "lets whoever pays it, the hosted FDE for a member who asked it among them, pay it without asking whom (the departments " +
    "ruling: authority over the money is the hat's, payroll.command-authority).",
  source: AFTER_RULING("aaron.frappe-shape, aaron.departments; docs/vision/erp.md (section 4, step 2); /tmp/hrms/hrms/payroll/doctype/salary_component_account; docs/design/frappe/accounting.md (payment send --account)"),
  affects: [table_salary_components, rpc_payroll_structures_component],
});

export const decision_payroll_mailbox_for_pay = defineDecision({
  id: "payroll.mailbox-for-pay",
  title: "An Employee is paid at the mailbox they keep, never a work address",
  question: "A person's Safe is a function of their mailbox, and nothing moves it to another (C27). Which mailbox does payroll pay?",
  options: [
    { label: "personal", text: "`personal_email`, the one the person keeps; a `company_email` is never a payee locator." },
    { label: "any", text: "Whatever mailbox HR typed, work or personal." },
  ],
  chosen: "personal",
  why:
    "Pay to a work mailbox would land in a Safe the person loses with the job. Frappe's Employee already separates " +
    "`personal_email` from `company_email`, so payroll keys pay on the first and never reads the second; changing an " +
    "Employee never changes their Party or Safe. The head sync resolves a head-born Employee's Party the same way, as " +
    "the CRM lane asked (parties.mailbox-for-life), and never takes the pay mailbox from the head.",
  source: AFTER_RULING("aaron.erp-on-capxul; docs/vision/erp.md (C27); /tmp/erpnext/erpnext/setup/doctype/employee/employee.json"),
  affects: [table_employees, rpc_payroll_employees_add, rpc_payroll_employees_change, workflow_payroll_head_sync],
});

export const decision_payroll_hr_authority = defineDecision({
  id: "payroll.hr-authority",
  title: "The People hat is Frappe's HR Manager; paying is the budget's",
  question: "Who may change an Organization's payroll records, and who may pay a run?",
  options: [
    {
      label: "people-hat",
      text:
        "Records (Employees, components, structures, assignments, runs) are changed and read by a member whose Safe wears " +
        "the People hat, read from the chain's indexed wearers; paying a run is whoever Budgets authorises on its " +
        "department's budget. Employees read their own slips.",
    },
    { label: "any-member", text: "Any member may change payroll records." },
  ],
  chosen: "people-hat",
  why:
    "Salaries are private, and the People hat is the officer hat for people, as Frappe's HR Manager role is; the same " +
    "hat already guards the company's contact book. Splitting who records pay from who pays it is Frappe's own split " +
    "between HR and Accounts, and on Capxul the second is decided on chain.",
  source: AFTER_RULING("aaron.contacts-permissions, aaron.frappe-shape; organizations/data.ts (people_hat); indexing/data.ts (hat-wearers)"),
  affects: [...HR_RPCS],
});

export const decision_payroll_hr_surface = defineDecision({
  id: "payroll.hr-surface",
  title: "Frappe HR's capabilities reach the CLI now, beside the SDK and web app",
  question: "The HR rpcs are new capabilities, not among the 215. Which surfaces reach them, and when do they get CLI commands?",
  options: [
    {
      label: "sdk-now",
      text:
        "One SDK flow per rpc, on the SDK and the web app (the FDE agent, any agent, people; a head is synced by " +
        "payroll's own process, never through them); their " +
        "CLI commands (`org employee add|change|list`, `org payroll component|structure|assign|run|submit|withhold|pay|" +
        "cancel|show|list`, `payslip list|show`) are designed with acceptance claims in the payroll operations pass, from " +
        "docs/design/frappe/payroll.md.",
    },
    {
      label: "cli-now",
      text:
        "Recommended: book now, with acceptance claims and worlds, exactly the 28 commands of " +
        "docs/design/new-commands.md (section 5.3), in its one grammar; each calls one SDK method, whose flow keeps " +
        "`react` and adds `cli`: `org hr employee add|change|get|list|suspend|deactivate|reinstate|leave` " +
        "(`client.org(orgId).hr.employees.*`; the four status verbs are the Employee machine's, over " +
        "`payroll.employees.change`; `get` is a new rpc); `org payroll component add|change|list|disable|enable` (over " +
        "`payroll.structures.component` and `.list`); `org payroll structure create|cancel|assign|unassign|list` " +
        "(`unassign` cancels an assignment, over `payroll.structures.cancel`); `org payroll run " +
        "create|submit|pay|cancel|list|get` (`get` over `payroll.runs.show`); `org payroll payslip withhold|release` (over " +
        "`payroll.runs.withhold`); and the payee's own `payroll payslip list|get` (`client.me.payroll.payslips.*` over " +
        "`payroll.slips.mine`, filtered by `--employer`, never `--org`). Who (payroll.hr-authority): a member whose Safe " +
        "wears the People hat changes and reads the records; paying a run is whoever Budgets.authorised admits on its " +
        "department's budget; a payee reads their own slips. Reads are `read`, `org payroll run pay` `chain-submit`, " +
        "the rest `write`; the ten a first payroll needs are `critical` (payroll.critical-commands), the rest `normal`. " +
        "Every list pages, and every Employee write prints the Employee as `org hr employee get` does (payroll.command-fit).",
    },
  ],
  chosen: "cli-now",
  why:
    "Aaron asked on 8 November 2026 for the new commands to be designed in the book, and the same day accepted this " +
    "recommendation with the others he did not mention; booked under rules.new-operations on it. The capability serves aaron.frappe-shape (payroll in " +
    "Frappe HR's shape in every Organization), and the FDE works it through the same CLI (aaron.fde-agent). The rpcs " +
    "and flows came first (sdk-now); the commands now follow the one grammar every new command keeps " +
    "(docs/design/new-commands.md): nouns then verbs, a status step as its own verb, `get` for one record, and one SDK " +
    "method per command, so a flow that served two steps is two commands. Every rpc stays reached (P2), and each flow " +
    "keeps its class default budget. Booked on 8 November 2026: the 28 operations in this record's `affects`, each " +
    "one flow (payroll.command-flows); who runs each (payroll.command-authority), the ten a first payroll needs " +
    "(payroll.critical-commands), the worlds (payroll.command-worlds), and where a row reads its rpc more exactly " +
    "(payroll.command-details, payroll.run-pay-codes) each have their decision. Review then found more, each a " +
    "decision: a declined run approval leaves the run owed (payroll.declined-run-approval), the run keeps the caller's " +
    "request key (payroll.run-request-key), a component's flags are off unless given (payroll.component-defaults), a " +
    "run takes its department's Employees and its leavers' last period (payroll.run-employees), and the commands keep " +
    "the grammar's lists, outputs and codes as the 215 and the other packs do (payroll.command-fit). He accepted the " +
    "Employee commands as `org employee …` and the payslips as `payslip …` and `org payslip …`; the command tree since " +
    "spells them `org hr employee …`, `payroll payslip …` and `org payroll payslip …`, with nothing else changed " +
    "(payroll.surface-moves).",
  source: AFTER_RULING("aaron.frappe-shape, aaron.fde-agent, aaron.projects (new capabilities designed book first)"),
  affects: [...NEW_OPERATIONS, ...HR_FLOWS, ...HR_RPCS, rpc_payroll_slips_mine, rpc_payroll_runs_pay],
});

export const decision_payroll_command_authority = defineDecision({
  id: "payroll.command-authority",
  title: "HR records are the People hat's; paying a run is its department hat's",
  question:
    "Budgets belong to departments, and people are swapped in and out of a department by its hat. Who may run each of " +
    "payroll's new commands, and what follows for the person who records pay and the person who pays it?",
  options: [
    {
      label: "hat-not-person",
      text:
        "The People hat changes and reads the HR records (Employees, components, structures, assignments, runs, " +
        "withholding), as Frappe's HR Manager. `org payroll run pay` is whoever `Budgets.authorised` admits on the run's " +
        "department budget when it pays, read on chain then: a wearer of its hat or of an ancestor's, never the person who " +
        "drafted the run, paid it before or is named on it. `payroll payslip list|get` is the payee's own Safe. A self-run own agent " +
        "acts only with the hats its Safe wears; the hosted FDE acts only as the member who asked it, whose Safe signs " +
        "(rules.fde-acts-for-asker). The Board pays no run: it spends from no budget.",
    },
    { label: "person", text: "Whoever drafted a run, or whom Capxul records as the department's holder, pays it." },
  ],
  chosen: "hat-not-person",
  why:
    "The departments ruling makes a department's money its hat's, and v4's `Budgets.spend` checks exactly that at the call, so " +
    "a holder swapped out between drafting and paying is refused by the chain whatever Capxul says; reading it at the " +
    "call keeps Capxul's refusal and the chain's the same. Recording pay and paying it stay apart, as Frappe splits HR " +
    "from Accounts. Because budgets.role-conflict-people-hat keeps a People-hat wearer out of every department and team " +
    "office, whoever drafts and submits a run is never who pays it from a department (Pat drafts, Lead pays). A founder " +
    "wears the People hat from setup, so a solo founder pays a run only from an allowance the Board assigned them, or " +
    "after giving the People hat up; stating that for every money command is budgets' and organizations' " +
    "(docs/design/authority.md, contradiction 9), and payroll follows it. This pass also corrected payroll.runs.pay, " +
    "which admitted 'an agent whose Seat holds its allowance' and 'the Organization's own agent': a Seat gives no " +
    "authority on chain, and the FDE starts with no hat (agents.fde-authority).",
  source: COMMANDS("aaron.departments, aaron.frappe-shape", "docs/design/authority.md; Budgets.sol authorised; payroll.hr-authority"),
  affects: [...NEW_OPERATIONS, rpc_payroll_runs_pay],
});

export const decision_payroll_command_flows = defineDecision({
  id: "payroll.command-flows",
  title: "One SDK method per HR command, each a flow, the reads included",
  question:
    "The grammar (G7) implements a method that is one rpc call by that rpc, and lists `org hr employee get` over a new rpc. " +
    "Payroll's HR rpcs already had one flow each, on the SDK and the web app. How are the 28 commands implemented?",
  options: [
    {
      label: "flows",
      text:
        "Every command is one flow under `client.org(orgId)` or `client.me`, on the CLI, the SDK and the web app, each one " +
        "call of one payroll rpc except `org hr employee leave`, which reads, previews and writes, and `org payroll run pay`, " +
        "which signs its approval and follows the chain. Where one rpc serves " +
        "several verbs each verb is its own flow fixing its part of the input: `employees.suspend|deactivate|reinstate|" +
        "leave` over `payroll.employees.change`; `payroll.components.add|change|disable|enable` over " +
        "`payroll.structures.component`, `.list` over `payroll.structures.list`; `payroll.structures.cancel|unassign` " +
        "over `payroll.structures.cancel`; `payslips.withhold|release` over `payroll.runs.withhold`; `me.payslips.list|" +
        "get` over `payroll.slips.mine`. Renamed: `payroll.employees.*` to `employees.*`, `payroll.runs.show` to " +
        "`.get`, `payroll.runs.withhold` to `payslips.withhold`, `me.payslips` to `me.payslips.list`; " +
        "`payroll.structures.component` is gone.",
    },
    { label: "rpc-reads", text: "As G7 reads: `org hr employee get` implemented by its new rpc directly, every other command by its flow." },
  ],
  chosen: "flows",
  why:
    "The web app and the FDE call these methods too, so a read implemented by its rpc would give payroll's SDK two " +
    "kinds of method, flows for every HR method but one. One flow per command keeps one method per command and one " +
    "command per method (A4), the generated client the same on every surface, and every rpc reached (P2). `change` " +
    "no longer carries a status, so a status moves only by its lifecycle verb (G3). The leave flow's preview is G5's: " +
    "a decline is CANCELLED and a script without `--confirm` CLI_USAGE (vocabulary.declined-preview-cancelled).",
  source: COMMANDS("aaron.frappe-shape, aaron.fde-agent", "docs/design/new-commands.md (G3, G5, G7, section 4)"),
  affects: [...HR_FLOWS, rpc_payroll_employees_get, operation_org_hr_employee_leave],
});

export const decision_payroll_command_details = defineDecision({
  id: "payroll.command-details",
  title: "Where the booked HR commands read their rpcs more exactly than the rows",
  question:
    "Booking the 28 commands against payroll's rpcs found five places where a row of docs/design/new-commands.md " +
    "section 5.3 says less than, or other than, the rpc it calls. What does each command do there?",
  options: [
    {
      label: "rpc-rules",
      text:
        "The rpc's rule stands and the command reads it: (1) `org payroll structure unassign` is WRONG_STATE while a slip " +
        "that is not cancelled names the assignment, as the assignment machine's guard has it; a later assignment " +
        "supersedes it instead. (2) `org payroll component change` reaches only structures made after it, since a " +
        "structure keeps the rows it copied; `disable` and `enable` set `disabled` through the same rpc, which on a change " +
        "now takes only the fields given. (3) `org payroll run create` defaults `--frequency` to monthly. (4) `payroll payslip " +
        "list` pages (`--after`, `--limit`, `nextCursor`), and `--employer` is a handle the rpc reads as the payer. (5) " +
        "`org payroll run pay` takes `--request-key`: the same key again returns the same command and approval; " +
        "`--timeout-seconds` and `--no-wait` are its flow's.",
    },
    { label: "rows", text: "Change the rpcs to match the rows word for word: unassign cancels an assignment slips name." },
  ],
  chosen: "rpc-rules",
  why:
    "A slip names its assignment as the record of what it was worked out with, so cancelling one under a submitted slip " +
    "would leave a payslip naming a cancelled assignment. Structures copying their rows is Frappe's Salary Detail, and " +
    "payroll.frappe-doctypes never edits a submitted document. Monthly is Frappe's default and the frequency of every " +
    "structure in the worlds. Paging and the request key are G5's for every list and money command; the run's attempt " +
    "key already made asking twice pay once (K1), and the request key lets a script say which ask it repeats.",
  source: COMMANDS("aaron.frappe-shape", "docs/design/new-commands.md (5.3, G5); payroll/data.ts (salary-structure-assignment.cancel)"),
  affects: [
    operation_org_payroll_structure_unassign,
    operation_org_payroll_component_change,
    operation_org_payroll_run_create,
    operation_payroll_payslip_list,
    operation_org_payroll_run_pay,
    rpc_payroll_structures_cancel,
    rpc_payroll_structures_component,
    rpc_payroll_runs_create,
    rpc_payroll_slips_mine,
    rpc_payroll_runs_pay,
  ],
});

export const decision_payroll_run_pay_codes = defineDecision({
  id: "payroll.run-pay-codes",
  title: "A run the company Safe cannot cover is INSUFFICIENT_BALANCE, as payment send",
  question:
    "payroll.runs.pay refused a company Safe holding less than the run as PAYER_BALANCE_TOO_LOW, the code a payee's " +
    "collection uses. The grammar (G6) gives a case the code the 215 give it. Which code is it?",
  options: [
    {
      label: "insufficient",
      text:
        "INSUFFICIENT_BALANCE, which `payment send` from a budget gives when the paying Safe holds too little; a budget " +
        "with too little left stays PAYROLL_BUDGET_EXCEEDED, as `payment send` and `org department pay` give it.",
    },
    { label: "payer-low", text: "PAYER_BALANCE_TOO_LOW, as the rpc first had it." },
  ],
  chosen: "insufficient",
  why:
    "Paying a run is a payment from a budget, the chain path of `payment send --from`, made by whoever acts for the " +
    "department, not by a payee collecting; PAYER_BALANCE_TOO_LOW's message speaks of a collection. The frozen " +
    "`payroll agreement collect` keeps its own code.",
  source: COMMANDS("aaron.departments, aaron.frappe-shape", "docs/design/new-commands.md (G6); the frozen refusals of payment.send, org.department.pay, agreement.collect"),
  affects: [rpc_payroll_runs_pay, operation_org_payroll_run_pay],
});

export const decision_payroll_critical_commands = defineDecision({
  id: "payroll.critical-commands",
  title: "The commands of an Organization's first payroll are critical; the rest normal",
  question:
    "The grammar makes every new command normal; the commands pass marks those a pilot or a start-up needs critical. " +
    "Which of payroll's 28?",
  options: [
    {
      label: "first-payroll",
      text:
        "Ten: `org hr employee add|list`, `org payroll component add`, `org payroll structure create|assign`, `org payroll " +
        "run create|submit|pay|get`, and `payroll payslip list`: hire, define the pay, assign it, draft, submit and pay the first " +
        "month, check it, and let the Employee see it. The rest (field changes, status verbs, leaving, component upkeep, " +
        "cancelling, unassigning, withholding, the lists of structures and runs, `payroll payslip get`) refine that loop.",
    },
    { label: "none", text: "Every command normal, as G8 has it." },
    { label: "all", text: "Every payroll command critical." },
  ],
  chosen: "first-payroll",
  why:
    "Payroll is in every Organization from its first day (the Frappe-shape ruling), and the FDE sets an Organization up " +
    "through the same commands (the FDE ruling); a start-up that pays people runs its first month with exactly these " +
    "ten. As in projects.critical-commands and organizations.command-priorities, critical orders the build's work and " +
    "the evals a pilot depends on, and changes no budget. None is on the B3 pilots' money path.",
  source: COMMANDS("aaron.frappe-shape, aaron.fde-agent", "docs/design/new-commands.md (G8); projects.critical-commands; CONVENTIONS rule 4"),
  affects: [...CRITICAL_OPERATIONS],
});

export const decision_payroll_command_worlds = defineDecision({
  id: "payroll.command-worlds",
  title: "Five worlds hold Acme's HR records and runs in every state a refusal needs",
  question:
    "No catalogued world holds Employees, components, structures and runs but org-with-documents, whose one run serves " +
    "documents. Which worlds do the HR commands' claims and refusals start from?",
  options: [
    {
      label: "five",
      text:
        "signed-out, and five built with payroll's own commands on org-with-department (Directors Dana and Eli; Pat with " +
        "the People hat and no office; Lead wearing `salaries`' office hat; Sam a member with no hat; Olga outside): " +
        "org-with-employees (Sam, and Noor, Ana and Leo with no accounts; Ana suspended, Leo left; components Basic, " +
        "Pension and a disabled Bonus; structures Standard and Contractors; Standard assigned to Sam, Noor and Ana); " +
        "org-with-payroll-runs (three runs of `salaries`: the first paid by Lead with Noor's net in a claim escrow, the " +
        "second submitted with Noor's slip withheld, this month's a draft); org-with-payroll-budget-used (`salaries` " +
        "spent to 1,350 USDC left); org-with-payroll-short-safe (the company Safe down to 1,000 USDC); and " +
        "org-with-payroll-runs-chain-unreachable (chain-rpc's fault switch failing every read, added by the fit review " +
        "so `org payroll run pay`'s chain read refuses PROVIDER_ERROR from a world, as the department commands' does).",
    },
    { label: "in-eval", text: "Each eval builds what it needs from org-with-department." },
  ],
  chosen: "five",
  why:
    "Most of the 28 commands' claims and refusals share these states, so one build each serves them all, made only " +
    "with booked commands and `dev approve`. org-with-department gives each authority claim its actor: Pat records pay " +
    "but holds no office, Lead holds the department but not the People hat, so every People refusal and every Budget " +
    "refusal is reached by a real member, and the swap claim moves `salaries`' office to Plat, as the departments " +
    "ruling has it. People with no account show that an Employee needs none and that their pay waits in a claim " +
    "escrow from the budget, as the ruling on unclaimed budget pay has it.",
  source: COMMANDS("aaron.frappe-shape, aaron.departments, aaron.budget-pay-unclaimed", "books/target/devnet/worlds.ts (org-with-department); devnet.worlds"),
  affects: [...NEW_OPERATIONS],
});

export const decision_payroll_money_and_rounding = defineDecision({
  id: "payroll.money-and-rounding",
  title: "Amounts are rounded per row as Frappe rounds, then exact, paid in raw units",
  question: "Frappe's Currency is a float rounded by the site's method. How does Capxul keep the figures?",
  options: [
    {
      label: "row-rounded-then-exact",
      text:
        "Each row's amount, once its formula is evaluated as Python does (payroll.portable-formulas), is rounded to the " +
        "token's display precision (2 places) with Frappe's non-legacy Banker's Rounding (`_bankers_rounding`: half to " +
        "even within its epsilon), which the Capxul app sets on a head. From there every amount is an exact decimal " +
        "string: totals are exact sums, there is no rounded total, and the net is paid as `net_pay_raw` in the token's " +
        "raw units.",
    },
    { label: "exact-throughout", text: "Exact decimals from the formula on, rounded half to even." },
    { label: "float", text: "Frappe's floats with its legacy rounding." },
  ],
  chosen: "row-rounded-then-exact",
  why:
    "A float that drifts a cent makes the chain pay a figure the slip does not show, so money is exact once a row is " +
    "rounded. Before that, the head's figure is what the head's floats give, and the only way to give the same cent is " +
    "to compute it the same way. The legacy method (Frappe's default) rounds half up above zero places, so the app sets " +
    "the non-legacy one. A head stores Currency to nine places, so exact sums of two-place rows are what it stores too; " +
    "Payroll Settings' disabled rounded total keeps the net the sum of the rows.",
  source: AFTER_RULING("aaron.frappe-shape; /tmp/frappe/frappe/utils/data.py:1255 (rounded), :1276 (legacy), :1329 (_bankers_rounding)"),
  affects: [table_salary_slips, table_salary_structures, table_payroll_settings, rpc_payroll_runs_create],
});

export const decision_payroll_startup = defineDecision({
  id: "payroll.startup",
  title: "Payroll starts by writing its Payroll Settings at the setup's begin",
  question:
    "organizations.startup has each fundamental app start itself at the setup's `begin`, payroll with its Payroll " +
    "Settings and salary components. What does payroll make there?",
  options: [
    {
      label: "settings-at-begin",
      text:
        "A payroll process triggered by the setup's `begin` (`payroll.startup.open`) writes the Organization's Payroll " +
        "Settings, as Frappe HR's install sets that single's defaults: the values Capxul computes by (leave-based, " +
        "holidays counted, no rounded total, no Frappe email) and the change counter at zero. No salary component: " +
        "components are the Organization's own to define, and the agreement component is made at its first acceptance.",
    },
    {
      label: "nothing-at-begin",
      text:
        "The earlier choice: nothing at begin; the `payroll-settings` row is born with the Organization's first payroll " +
        "write.",
    },
    { label: "settings-and-components", text: "Write the settings and a starting set of components (basic pay, a tax deduction) at begin." },
  ],
  chosen: "settings-at-begin",
  why:
    "Rewritten at the assembly: this record first chose nothing-at-begin, since the settings are constants. The row is " +
    "not only constants: it holds the change log's counter, whose lock every payroll write takes (rpcs, the agreement's " +
    "process, the head sync), so with it born at begin no writer has to birth a lock row in a race, and payroll starts " +
    "as projects does (projects.startup) and as organizations.startup expects, in Frappe's shape from the first day. " +
    "A writer that still finds no row (the start-up not yet run) births it, so nothing waits on the process. Starting " +
    "components would be guesses about a business's pay that its People hat or FDE makes better in conversation, and " +
    "Frappe HR installs none either outside its India regional setup (its `make_fixtures` has no Salary Component); " +
    "organizations.startup's mention of salary components is answered with none. The values written are Capxul's, " +
    "not Frappe HR's install defaults (which count no holidays, round the total and email slips).",
  source: AFTER_RULING("aaron.frappe-shape, aaron.fde-agent; organizations.startup; /tmp/hrms/hrms/setup.py:606 (set_single_defaults); payroll_settings.json"),
  affects: [table_payroll_settings, concept_payroll, workflow_payroll_startup_open],
});

export const decision_payroll_books_accounts = defineDecision({
  id: "payroll.books-accounts",
  title: "Payroll's accounts are books' ids: role accounts by default, checked when given",
  question:
    "Payroll keeps Frappe's account links (a component's expense and liability, a run's and an assignment's Payroll " +
    "Payable, a run's treasury) as books' account ids, and asked books for the defaults. How does payroll fill and " +
    "check them, now that it depends on books?",
  options: [
    {
      label: "roles-and-checks",
      text:
        "A run's and an assignment's Payroll Payable is books' `payroll_payable` account, and a run's `payment_account` " +
        "the `safe` account of the company Safe and the run's token, each read from books' chart when the record is " +
        "made, null before the chart. A component's `account` and `liabilityAccount` are given by code or id, active " +
        "ledger accounts read as Frappe HR's accrual reads them: an earning's or employer contribution's `account` under " +
        "Expenses, a deduction's `account` under Liabilities, `liabilityAccount` only an employer contribution's, under " +
        "Liabilities; left out they are null, and the accrual posts the line to its role's account " +
        "(books.payroll-defaults). The agreement component's accounts may be set, so collections accrue to the expense " +
        "the business chooses (contractors, say).",
    },
    { label: "unchecked", text: "Keep whatever account ids are given, and let books' fallback catch an unfit one." },
  ],
  chosen: "roles-and-checks",
  why:
    "Frappe HR refuses a run with no payable and a component with no account; Capxul's books never refuse an accrual, " +
    "so payroll is where a wrong account is caught, at the command, while a person can still fix it. One Payroll " +
    "Payable per Company keeps a run's accrual and its slips' Bank Entries on the same account, chart or no chart " +
    "(books.payroll-postings). Payroll reads books' chart as a plain read: books sits below it.",
  source: FRAPPE_ASSEMBLY("docs/design/frappe/payroll.md (For other lanes: Books); books.payroll-defaults; hrms payroll_entry.py:408, :810, :891 (a deduction credits its `account`)"),
  affects: [
    table_salary_components,
    table_salary_structure_assignments,
    table_payroll_entries,
    rpc_payroll_structures_component,
    rpc_payroll_structures_assign,
    rpc_payroll_runs_create,
  ],
});

export const decision_payroll_timesheet_pay = defineDecision({
  id: "payroll.timesheet-pay",
  title: "Capxul's slips pay no timesheets yet, so projects.pay-time is deferred",
  question:
    "The projects lane asked: if salary slips pay timesheets, payroll should depend on projects and design with it a " +
    "door (`projects.pay-time`, the hours a slip pays) driving `timesheet.pay`. Do Capxul's slips pay timesheets?",
  options: [
    {
      label: "defer",
      text:
        "Not yet. Capxul computes slips from structures only; Frappe HR's timesheet-based slip " +
        "(`salary_slip_based_on_timesheet`) is computed by a head, like leave and attendance (payroll.frappe-doctypes). " +
        "Such a run comes in by payroll.import-run as an ordinary run, and the head's slip marks its timesheets paid " +
        "through projects' own head sync, under its paid-once guard (projects.billing-and-payslips). Payroll does not " +
        "depend on projects, and no door is designed until Capxul computes slips from hours.",
    },
    {
      label: "pay-time-now",
      text: "Payroll depends on projects now and designs `projects.pay-time` for a Capxul-computed slip from timesheets.",
    },
  ],
  chosen: "defer",
  why:
    "A door nothing invokes is a gap, not a design, and projects.billing-and-payslips says the same of doors designed " +
    "early. Hours paid twice would be money paid twice, but with no Capxul slip that pays hours there is only one " +
    "writer of the paid mark, the head's slip through projects' sync. When a customer needs Capxul to pay by the hour, " +
    "this record is reopened: payroll adds projects to its dependencies (projects sits below it) and the two concepts " +
    "design `projects.pay-time` together.",
  source: FRAPPE_ASSEMBLY("docs/design/frappe/projects-and-startup.md (For other lanes: payroll); projects.billing-and-payslips; hrms salary_slip.py:2402"),
  affects: [concept_payroll, rpc_payroll_runs_create, workflow_payroll_head_sync],
});

export const decision_payroll_employee_wise_accounting = defineDecision({
  id: "payroll.employee-wise-accounting",
  title: "Payroll accounts by Employee: each Payroll Payable line carries its party",
  question:
    "Frappe HR's Payroll Settings `process_payroll_accounting_entry_based_on_employee` (off by default) decides whether a " +
    "run's accrual and Bank Entry put each Employee on the Payroll Payable lines, or post one party-less line. Capxul " +
    "posts each slip's Bank Entry with party the Employee. Which does payroll set?",
  options: [
    {
      label: "by-employee",
      text:
        "On, the same for every Organization, as a fixed value of Payroll Settings that a head must match: Capxul's " +
        "accrual credits each net on Payroll Payable with party the Employee, and a head-computed run's accrual does the " +
        "same, so each slip's Bank Entry closes its own Employee's payable.",
    },
    { label: "frappe-default", text: "Off, Frappe HR's default: one party-less Payroll Payable line per run." },
  ],
  chosen: "by-employee",
  why:
    "Capxul pays each slip as its own Payment and posts one Bank Entry per slip with party the Employee " +
    "(books.payroll-postings), so the accrual must credit per Employee too, or every Employee would show a debit on " +
    "Payroll Payable against one party-less credit; a head-computed run Capxul pays meets the same Bank Entries. With " +
    "it off, ERPNext lets a Payroll Entry's Payable lines go without a party (`party_not_required`), which no other " +
    "Capxul voucher does. The Capxul app sets it on a head with the other fixed settings.",
  source: FRAPPE_ASSEMBLY("hrms payroll_entry.py:621, :1196; payroll_settings.json; erpnext journal_entry.py:509 (party_not_required)"),
  affects: [table_payroll_settings, workflow_payroll_startup_open, rpc_payroll_runs_submit, workflow_payroll_head_sync],
});

export const decision_payroll_declined_run_approval = defineDecision({
  id: "payroll.declined-run-approval",
  title: "A declined or refused run approval returns its slips owed, for a new command",
  question:
    "`payroll.runs.pay` moves the run and its slips to `paying` when its command is born, before anyone signs. When " +
    "the approval is then declined, refused at sponsorship (a payer swapped out of the department) or withdrawn, " +
    "payments cancels its Payments. The run's process handled only a lapse and an escrow refund, so such a run stayed " +
    "`paying` for good and no command could pay it. What happens to it?",
  options: [
    {
      label: "owed-again",
      text:
        "The process takes a cancel that moved no money like a refund: the command's paying slips return to `submitted` " +
        "with their payment fields cleared (salary-slip.unsend), and the run returns to `submitted` when nothing of it " +
        "is paid or escrowed (payroll-entry.lapse). The next `org payroll run pay` sends them as a new command under the " +
        "next attempt, since a cancelled Payment is never resumed.",
    },
    { label: "stuck", text: "Leave the run `paying`; a person cancels and redrafts it." },
  ],
  chosen: "owed-again",
  why:
    "A cancelled Payment is terminal in payments, and the run's cancel needs no slip holding a Payment, so a stuck run " +
    "could be neither paid nor cancelled, while its accrual stood owed. A decline is the CANCELLED ending every payroll " +
    "flow already gives, and under the departments ruling a refusal at sponsorship is the normal end of an approval its payer " +
    "lost the hat for: the department's next wearer must be able to pay the run. Clearing the payment fields keeps one " +
    "Payment per slip and attempt, so nothing pays twice.",
  source: REVIEW("aaron.departments, aaron.frappe-shape", "payments/data.ts (payment.cancel: declined, refused, withdrawn); payroll/staged.ts (payroll.runs.lifecycle); docs/design/authority.md"),
  affects: [machine_salary_slip, machine_payroll_entry, workflow_payroll_runs_lifecycle, rpc_payroll_runs_pay, operation_org_payroll_run_pay],
});

export const decision_payroll_run_request_key = defineDecision({
  id: "payroll.run-request-key",
  title: "The run keeps the caller's request key, so the same ask returns its command",
  question:
    "`org payroll run pay --request-key` must return the command and approval a repeat of the same ask began. The " +
    "command's own key is `payroll:<entry>:<attempt>`, which a resume derives from a slip's attempt, and nothing kept " +
    "the caller's key, while a repeat finds its slips already paying or escrowed and would be WRONG_STATE. Where is it kept?",
  options: [
    {
      label: "asked-key",
      text:
        "On the run, as `asked_key`, beside the latest attempt's `request_key`, `command_id` and `approval_id`. A " +
        "`requestKey` equal to it answers that command and approval as they stand, `replayed`, before any slip check. " +
        "The command keeps its derived key.",
    },
    { label: "as-command-key", text: "Use the caller's key as the command's key, and derive nothing from the attempt." },
  ],
  chosen: "asked-key",
  why:
    "A resume finds a lapsed command by its slips' attempt, so the derived key must stay. Keeping the caller's key apart " +
    "lets a script repeat the ask it lost the answer to (G5), and payments' K1 still guards the command itself.",
  source: REVIEW("aaron.frappe-shape, aaron.fde-agent", "docs/design/new-commands.md (G5); payments/procedures.ts (payments.prepare-command: one owner and request key, one command)"),
  affects: [table_payroll_entries, rpc_payroll_runs_pay, operation_org_payroll_run_pay],
});

export const decision_payroll_component_defaults = defineDecision({
  id: "payroll.component-defaults",
  title: "A salary component's flags are off unless its command sets them",
  question:
    "Frappe's Salary Component starts `depends_on_payment_days` and `is_tax_applicable` on. The grammar gives `org " +
    "payroll component add` opt-in flags (`--payment-days`, `--statistical`, `--not-in-total`, `--taxable`), and the " +
    "worlds give Basic `--payment-days` and Pension none, but payroll's rpc never said what an absent flag means. What " +
    "does it mean?",
  options: [
    {
      label: "off-unless-given",
      text:
        "Off: a component prorates by payment days, is statistical, stays out of totals or is taxable on a head only when " +
        "its command says so; `remove_if_zero_valued` stays on, as Frappe's. A head shows the values Capxul set.",
    },
    { label: "frappe-form", text: "Frappe's form defaults: payment days and taxable on unless turned off." },
  ],
  chosen: "off-unless-given",
  why:
    "A flag that only turns something on must default off, or `--payment-days` would say nothing. With Frappe's default " +
    "a fixed deduction such as Pension would shrink with unpaid leave without anyone asking. The head's tax engine then " +
    "taxes only components marked `--taxable`, which the FDE sets as the Organization's rules need.",
  source: REVIEW("aaron.frappe-shape", "/tmp/hrms/hrms/payroll/doctype/salary_component/salary_component.json (two flags default 1); docs/design/new-commands.md (component add)"),
  affects: [rpc_payroll_structures_component, operation_org_payroll_component_add, operation_org_payroll_run_create],
});

export const decision_payroll_run_employees = defineDecision({
  id: "payroll.run-employees",
  title: "A run takes its department's active Employees and its leavers' last period",
  question:
    "Frappe's Payroll Entry takes every Employee of the department whose status is not Inactive and whose relieving " +
    "date is on or after the period's start, so it pays a leaver's last period and a suspended Employee too. Payroll's " +
    "run took only `active` Employees, so a leaver was never paid their last period, and an assignment's own " +
    "department claimed to decide who pays it while the run paid from its own. Which Employees does a run take, and " +
    "from which budget?",
  options: [
    {
      label: "frappe-filter",
      text:
        "The department's Employees are those whose own `department` is it, as Frappe filters the Employee, and the run " +
        "pays them from it. It takes the active ones and those who left on or after the period's first day, paid to " +
        "their relieving day; never an inactive or a suspended one. An assignment records the Employee's department, as " +
        "Frappe fetches it, and `--department` on assign must name that one.",
    },
    { label: "active-only", text: "Only `active` Employees, as before; a leaver's last period is paid before they are marked left." },
    { label: "frappe-exact", text: "As Frappe, suspended Employees included." },
  ],
  chosen: "frappe-filter",
  why:
    "Frappe pays a leaver's last period, and payroll's own machine says no run pays them after their relieving day, " +
    "which only means something if a run may pay them up to it. Leaving out a suspended Employee is Capxul's stricter " +
    "rule, which the worlds and the suspend command keep. One department per Employee, as Frappe has it, keeps one " +
    "answer to which budget pays them and so whose hat may pay the run, as the departments ruling has it.",
  source: REVIEW("aaron.frappe-shape, aaron.departments", "/tmp/hrms/hrms/payroll/doctype/payroll_entry/payroll_entry.py:1522 (status, relieving_date); salary_structure_assignment.json (department fetched)"),
  affects: [
    rpc_payroll_runs_create,
    rpc_payroll_structures_assign,
    table_salary_structure_assignments,
    table_employees,
    operation_org_payroll_run_create,
    operation_org_payroll_structure_assign,
    operation_org_hr_employee_suspend,
    operation_org_hr_employee_leave,
    operation_org_hr_employee_change,
  ],
});

export const decision_payroll_command_fit = defineDecision({
  id: "payroll.command-fit",
  title: "The HR commands keep the grammar's pages, outputs and codes, as the 215 do",
  question:
    "A fit review of the 28 booked commands against docs/design/new-commands.md and the 215 found commands that read " +
    "a row of section 5.3 more loosely than the grammar's own rules (G5, G6, G9, G10), or that gave a case another code " +
    "than the 215 and the other packs give it. What does each command do there?",
  options: [
    {
      label: "grammar",
      text:
        "(1) Every list pages and prints `items` and `nextCursor`; a cursor it did not give is INVALID_INPUT, as `org " +
        "head app list` and `org projects activity-type list` do: `org hr employee list` and `org payroll run list` page in their rpc, and " +
        "`org payroll component list` and `org payroll structure list`, short catalogs, in their method over one read; " +
        "structures list by name, each with the assignments that name it. (2) Every Employee write prints the Employee as " +
        "`org hr employee get` does, with today's assignment. (3) `org payroll run pay` prints as `payment send` and the " +
        "agreement writes do: `status` (`awaiting_approval` at the hand-over, else the run's), `approvalId`, " +
        "`approvalUrl`, `expiresAt`, the run and `next`. (4) Disabling a disabled component, or enabling an enabled one, " +
        "is WRONG_STATE, as a second `org projects activity-type disable` and a frozen token's freeze are. (5) `--amends` naming a " +
        "structure an assignment still names, or one already cancelled, is WRONG_STATE, as cancelling it is; " +
        "INVALID_INPUT stays for one that names nothing. (6) `org hr employee leave` from a script without `--confirm` is a " +
        "CLI_USAGE refusal from a world, and `org payroll run pay` refuses PROVIDER_ERROR when the chain cannot be read, " +
        "from org-with-payroll-runs-chain-unreachable, as the department commands do. (7) `org hr employee add` takes a " +
        "Party as G5 names one (a Safe's 0x address too), refuses a mailbox no claim escrow could hold (not ASCII) as " +
        "INVALID_INPUT, and takes `--last-name` as optional, as Frappe's `last_name` is, where the row shows it bare. " +
        "(8) Each flag that is not its field's name is named on its input shape.",
    },
    {
      label: "rows",
      text:
        "Keep the booking as section 5.3's rows read: only `payroll payslip list` pages, each write prints its rpc's answer, and " +
        "each case keeps the code it was first booked with.",
    },
  ],
  chosen: "grammar",
  why:
    "The grammar says every new command follows its rules with no exception, and payroll.command-details already took " +
    "paging as G5's for every list; the rows of 5.3 left four lists unpaged, while the other packs' lists page. A write " +
    "that prints less than `get` gives one record two shapes, and a money command that prints no status or approval " +
    "page leaves a script nothing to wait on. One case keeps one code across the book (G6): a second disable is " +
    "projects' and budgets' WRONG_STATE, and an amendment cancels the structure it amends, which the cancel's own guard " +
    "refuses WRONG_STATE. A mailbox no escrow can hold would make every run that pays that Employee INVALID_RECIPIENT, " +
    "so it is refused where it is typed. Naming each flag's field leaves the build nothing to guess. None of this " +
    "changes who may run a command or what it does with money, which the departments ruling and payroll.command-authority settle.",
  source: FIT(
    "aaron.frappe-shape, aaron.departments",
    "docs/design/new-commands.md (G5, G6, G9, G10, 5.3); projects and organizations operations.ts (lists, disable); " +
      "payments/operations.ts (MoneyJson)",
  ),
  affects: [
    operation_org_hr_employee_add,
    operation_org_hr_employee_change,
    operation_org_hr_employee_list,
    operation_org_hr_employee_leave,
    operation_org_payroll_component_list,
    operation_org_payroll_component_disable,
    operation_org_payroll_component_enable,
    operation_org_payroll_structure_create,
    operation_org_payroll_structure_list,
    operation_org_payroll_run_list,
    operation_org_payroll_run_pay,
    rpc_payroll_employees_add,
    rpc_payroll_employees_change,
    rpc_payroll_employees_list,
    rpc_payroll_runs_list,
    rpc_payroll_structures_component,
    rpc_payroll_structures_create,
    flow_client_org_payroll_components_list,
    flow_client_org_payroll_structures_list,
    flow_client_org_payroll_runs_pay,
  ],
});

/** The commands the tree moved: HR's into `hr` and `org hr`, the payslips and the 215's agreements into `payroll` and `org payroll`. */
const SURFACE_MOVED = [...OPERATIONS, ...NEW_OPERATIONS, ...HR_OPERATIONS].filter((o) =>
  /^(org hr|hr|org payroll payslip|payroll payslip|org payroll agreement|payroll agreement) /.test(o.command),
);

export const decision_payroll_claims_thickened = defineDecision({
  id: "payroll.claims-thickened",
  title: "HR and payroll commands claim their success, change, answer and retry",
  question:
    "Thirty-one of the HR and payroll commands beyond the 215 were booked with one acceptance claim each, so their " +
    "evals checked one path. Which claims does each gain, and from what?",
  options: [
    {
      label: "from-the-booking",
      text:
        "Each gains the claims its booked behaviour already has, observed through the CLI from a named world " +
        "(org-with-employees, org-with-payroll-runs, org-with-leave, org-with-attendance, org-with-expenses): what a write " +
        "changes and the one transition it sends; what a read answers in the other states the world holds (a draft or " +
        "withheld run, an unpaid type's balance on a day no allocation covers, a recovery once an advance is settled), " +
        "its filters and pages, and that it writes nothing; and what running a decision again does: WRONG_STATE naming " +
        "the status it is already in, with an empty diff. No claim adds a behaviour.",
    },
    { label: "one-each", text: "Keep one claim each; the refusals cover the rest." },
  ],
  chosen: "from-the-booking",
  why:
    "A claim is the eval the build is held to (rules.new-operations, aaron.frappe-shape): with one each, a command " +
    "that decided a claim twice, booked a second accrual cancellation, or kept a reserved advance after its claim was " +
    "rejected would pass. Each new claim is read off the record that already decides it: the rpc's guard on the " +
    "status it moves from (a second reject, cancel or unassign is WRONG_STATE), its shape's fields (`unclaimed`, " +
    "`recovery`, `rejectionReason`, `withholdingReason`), the leave balance rule (allocated less taken, only unpaid " +
    "types on a day no allocation covers), the reader guards (the People hat reads every claim and advance, a " +
    "department's hat its own) and every list's page (payroll.command-fit). Refusals stay refusals; a claim names one " +
    "only to show a retry changes nothing. A truth review (9 November 2026) set three observations by their records: " +
    "disabled components list by type and then name (Bonus before Pension), as `org payroll component list`'s flow " +
    "orders them; a second claim takes 150.00 of an advance only when it asks at least that (ALLOCATE); and a holiday " +
    "added must be a day that is not one already (`payroll.holidays.add`). A fit review then took out four claims " +
    "that only repeated another claim's evidence and titled three by what they show (payroll.surface-fit).",
  source: surfaceBy(
    "books/target/payroll/hr-shapes.ts (Advance); leave.ts (BALANCE, the guards); expenses.ts; attendance.ts; runs.ts; " +
      "structures.ts; payroll.hr-worlds; payroll.command-worlds; aaron.frappe-shape",
  ),
  affects: [...NEW_OPERATIONS, ...HR_OPERATIONS].filter((o) => THICKENED.includes(o.id)),
});

export const decision_payroll_surface_fit = defineDecision({
  id: "payroll.surface-fit",
  title: "Who reads as authority.md has it, and no claim repeats another",
  question:
    "Fit review of the surface pass (9 November 2026; Aaron: 'It's the logical groupings'). Five things did not fit. " +
    "`org payroll run pay`'s who said an agent, 'the FDE included, pays only through a hat its Safe was granted', " +
    "beside WHO_HR, which already said the hosted FDE acts only as its asker. `org hr advance settle` previews (G5), " +
    "yet neither it nor payroll.advances.settle refused a hosted FDE's act-for call, as rules.fde-acts-for-asker names " +
    "it for and `org hr employee leave` does. `org hr leave list` took the deciders' who ('never the applicant') and " +
    "the title 'the leave applications you may decide', though its own claim shows Lead listing his own application, " +
    "which only another decides. Four thickened claims only repeated evidence another claim already holds, and three " +
    "claim titles promised what their evidence did not show (`hr leave balance`'s first said 'with no Seat', though no " +
    "world has an Employee with an account and no Seat). And payroll.hr-surface's rejected sdk-now option, which " +
    "is history, had been respelt into a command that never was (`payroll payslip list|show`). What should each say?",
  options: [
    {
      label: "aligned",
      text:
        "Run pay's who: a self-run own agent pays through a hat its Safe was granted; the hosted FDE only as the member " +
        "who asked it, handing the approval to their Safe. Settle's who and rpc refuse a hosted FDE's act-for call " +
        "(ROLE_PERMISSION_DENIED), as `org hr employee leave` does. The leave list takes a reader's who, WHO_LEAVE_READER " +
        "(the People hat every application, a department's hat its own and those below, the wearer's own among them), " +
        "and the title 'List the Organization's leave applications', as `org hr expense-claim list` is. Take out the " +
        "third claims of `org payroll run list`, `org hr leave-type list`, `org payroll component list` and `org hr " +
        "expense-type add`; trim `org payroll component change`'s third to the new structure; title `org payroll " +
        "component list`'s second, `org hr shift-type list`'s second and `hr leave balance`'s first by their evidence " +
        "(the Seat a self command does not need stays in its who, WHO_SELF_HR). Restore the sdk-now option's " +
        "words (`org employee add|change|list`, `payslip list|show`).",
    },
    { label: "as-is", text: "Leave them: the guards already resolve the hosted FDE to its asker." },
  ],
  chosen: "aligned",
  why:
    "docs/design/authority.md: 'A call with no live token is refused, so the hosted FDE never acts as itself, and the " +
    "hats the Board grants its own Safe go unused while Capxul hosts it'; and 'a command that previews is the asker's " +
    "own to answer, so its rpc refuses the FDE's call'. rules.fde-acts-for-asker lists the advance's settle among those " +
    "rpcs. payroll.hr-approvers already decides who reads leave: 'Lists read by the People hat (all) or a department's " +
    "hat (its own and below)'; 'nobody decides their own' is a decider's rule, not a reader's. A claim is an eval the " +
    "build is held to, so one whose evidence another claim of the same command already holds, or that only reads back " +
    "another command's success, tests nothing new: run list's first claim already shows a submitted run's next step; " +
    "leave-type change and component add already show their own change; expense-type list's two claims show an added " +
    "type to any member. A claim's title is what its evidence proves (organizations.head-fit). Every command keeps at " +
    "least two claims. payroll.command-authority, payroll.run-one-approval and payroll.deduction-remittance predated " +
    "aaron.fde-hosted and said the FDE acts with its own Safe's hats; the surface pass's build amended their text to " +
    "rules.fde-acts-for-asker: a self-run own agent does, and the hosted FDE acts as its asker. Text only, but for settle's act-for refusal, which " +
    "rules.fde-acts-for-asker already decided.",
  source: surfaceBy(
    "docs/design/authority.md (agents and the FDE); rules.fde-acts-for-asker; payroll.hr-approvers; organizations.head-fit; " +
      "payroll operations, leave.ts, expenses.ts",
  ),
  affects: [
    ...[...NEW_OPERATIONS, ...HR_OPERATIONS].filter((o) => FIT_REVIEWED.includes(o.id)),
    rpc_payroll_advances_settle,
    rpc_payroll_leave_list,
    decision_payroll_hr_surface,
    decision_payroll_command_authority,
    decision_payroll_run_one_approval,
    decision_payroll_deduction_remittance,
  ],
});

export const decision_payroll_no_door = defineDecision({
  id: "payroll.no-door",
  title: "Payroll has no procedures",
  question: "Does any other concept write payroll's tables inside its own transaction?",
  options: [
    { label: "none", text: "No: payroll's door is empty; readers above it (notices) read its tables and follow its events." },
    { label: "settle-run", text: "Keep old payroll's door procedures (settle-run, department spend, holder reads)." },
  ],
  chosen: "none",
  why:
    "Every old door procedure served runs, departments or notices, all gone or moved. A collection's Payment is born in " +
    "payments from the indexed PaymentSent, a fact both concepts read, so no money fact spans payroll and a concept above " +
    "it. What follows an agreement's change (an email, a projection) lags harmlessly and goes through the outbox (P4).",
  source: by("docs/as-is/archive/payroll/procedures.ts; P4; dependencies.payments-payroll"),
  affects: [concept_payments, concept_notices],
});

export const decision_payroll_pays_through_payments = defineDecision({
  id: "payroll.pays-through-payments",
  title: "A run pays through payments' door, now that payroll depends on payments",
  question:
    "Capxul pays a slip's net on chain. Payroll could build the budget spends and open their approval itself, as it " +
    "does for an agreement's calls, or birth them through payments' `payments.prepare-command`, as requests and banking " +
    "do. Which, given payroll did not depend on payments when this was decided?",
  options: [
    {
      label: "payments-door",
      text:
        "Through `payments.prepare-command` (purpose payroll, route budget), then follow `payment_transitioned` for the " +
        "settled facts. Payroll gains payments as a dependency; payments still never depends on payroll. The paying half " +
        "is payroll/staged.ts, staged until the shared foundation added the edge and registered since.",
    },
    { label: "own-spends", text: "Payroll builds `Budgets.spend` calls and opens their approval itself; payments births the Payments from the chain facts." },
  ],
  chosen: "payments-door",
  why:
    "A budget spend is a Payment and its route is payments' (concepts.payments): one request key per command (K1), the " +
    "funding check (K3), payment ids fixed before signing, retries that cannot pay twice, the claim escrow for a new " +
    "hire, and one settlement path with its reorg reversal. Building spends in payroll would copy all of it. An agreement " +
    "collection is different because Agreements pays it, not Budgets.spend. The edge points down the concept order " +
    "(payroll sits above payments), so it makes no cycle, and dependencies.payments-payroll's rule that payments never " +
    "depends on payroll holds. Registering the staged records before the edge would have broken the build's boundary " +
    "rules; with it they build with 0 problems and drive the run's and the slip's paying transitions.",
  source: AFTER_RULING("aaron.frappe-shape, aaron.budget-pay-unclaimed; shared/decisions.ts (concepts.payments, dependencies.payments-payroll); payments/procedures.ts"),
  affects: [concept_payments, concept_payments, ],
});

export const decision_payroll_run_one_approval = defineDecision({
  id: "payroll.run-one-approval",
  title: "A whole run is one payment command and one approval (C9)",
  question: "How many approvals does paying a run of N people take, does each payment keep its own payslip, and how is a lapse retried?",
  options: [
    {
      label: "one-command",
      text:
        "One payment command per run attempt, request key `payroll:` with the run's id and attempt, one item per slip " +
        "(its net to the Employee's Safe, its own payslip document), under one approval from the payer's own Safe. Asking " +
        "twice answers the same command. A lapsed approval is retried by resuming that same command (same key, " +
        "`resume`, same payment ids, one new approval); the attempt moves on only for slips that hold no Payment, such as " +
        "a slip released from withholding or refunded from escrow. Each slip keeps its command and payment id, by which " +
        "every later transition of its Payment finds it.",
    },
    { label: "new-key-on-lapse", text: "A lapse is retried as a new command under the next attempt's key, for new Payments." },
    { label: "per-slip", text: "One `payment send` per slip, each its own approval." },
  ],
  chosen: "one-command",
  why:
    "`payments.prepare-command` already takes many items, each with its own document, under one approval from the " +
    "payer's own Safe: what blocked C9 was only `payment send`'s one recipient, which payroll does not use. A person " +
    "signs a run once; a self-run own agent whose Safe wears the budget's hat or one above it signs it with its key " +
    "and needs no person (the hosted FDE only prepares it for the member who asked it, who signs: " +
    "rules.fde-acts-for-asker), and the chain still caps it at what the budget has left. Each Payment keeps its own " +
    "payslip hash on chain, so every employee can prove their pay alone. A new key after a lapse would birth new " +
    "Payments while the lapsed ones stay `needs_retry` and retryable by `payment retry`, so one slip could be paid " +
    "twice; payments' own `resume` reopens the same Payments under the same key and can never pay twice. A run can " +
    "then hold several commands, so routing by the run's one command column would lose an earlier command's late " +
    "events (an escrow claimed after a refunded slip was paid again); routing by each slip's own command does not.",
  source: AFTER_RULING(
    "aaron.frappe-shape, aaron.fde-agent, aaron.seats; docs/vision/erp.md (C9, C11, section 4 step 8); payments/procedures.ts (items, one approval, resume); payments/data.ts (lapse, retry)",
  ),
  affects: [concept_payments],
});
