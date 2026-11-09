// The expenses area: Frappe HR's Expense Claim Type, Expense Claim and Employee Advance, kept by Capxul
// (hr-data.ts), and the money they move (payroll.hr-money). An Employee claims back what they spent and asks for
// an advance, member or not (payroll.hr-self). Whoever wears the department's hat, or one above it, decides
// (aaron.departments): `Budgets.authorised` on the department's budget, read on chain at the call, never the
// claimant themselves (payroll.hr-approvers). Approving a claim posts its accrual through books' door; paying a
// claim, or an advance, is one payment command from the department's budget through `payments.prepare-command`,
// one approval from the payer's own Safe, followed back by one durable process per claim or advance until its
// Payment settles. Every money path settles once, through payments (payroll.hr-money).

import { Schema } from "effect";
import { budget, defineFlow, defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { component_core_sdk, concept_payroll } from "../shared/foundation.ts";
import { contract_budgets, contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_book_accounts } from "../books/data.ts";
import { procedure_books_record_payroll_accrual } from "../books/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { event_payment_transitioned, table_payments } from "../payments/data.ts";
import { table_employees, table_salary_components, table_salary_slips, table_salary_structure_assignments } from "./data.ts";
import {
  machine_employee_advance,
  machine_expense_claim,
  table_additional_salaries,
  table_employee_advances,
  table_expense_claim_types,
  table_expense_claims,
} from "./hr-data.ts";
import { HR_ERRORS, HR_GUARD, HR_READS, WHO_HR } from "./employees.ts";
import {
  HR_LOGGED,
  MEMBER_GUARD,
  SELF_ERRORS,
  SELF_GUARD,
  SELF_LIST_GUARD,
  SELF_READS,
  SELF_RECORD_GUARD,
  WHO_MEMBER,
  WHO_SELF_HR,
} from "./leave.ts";
import { FLOW_ERRORS, SIGN, SPONSORED, SUBMIT, WAIT } from "./flows.ts";
import {
  Advance,
  AdvancePage,
  AdvancePayFlowInput,
  AdvancePayInput,
  AdvanceRef,
  AdvanceSettleFlowInput,
  AdvanceRejectInput,
  AdvanceRequestInput,
  AdvanceStatus,
  Claim,
  ClaimApproveInput,
  ClaimCreateInput,
  ClaimPage,
  ClaimPayFlowInput,
  ClaimPayInput,
  ClaimRef,
  ClaimRejectInput,
  ClaimStatus,
  ExpenseType,
  ExpenseTypeAddInput,
  ExpenseTypeListInput,
  ExpenseTypePage,
  MyAdvanceListInput,
  MyAdvanceRef,
  MyClaimListInput,
  MyClaimRef,
  OrgAdvanceListInput,
  OrgClaimListInput,
  Prepared,
  moneyOutcome,
} from "./hr-shapes.ts";

const HR = "/tmp/hrms/hrms/hr/doctype";
const EC = `${HR}/expense_claim/expense_claim.py`;
const EA = `${HR}/employee_advance/employee_advance.py`;
const c = machine_expense_claim.t;
const a = machine_employee_advance.t;
const READ_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT] as const;

/** Who decides and pays a claim or an advance: the department's hat, as the chain reads it then (aaron.departments). */
export const WHO_DEPARTMENT =
  "A signed-in member, person or agent, whose own Safe `Budgets.authorised` admits on the department budget the " +
  "claim or advance is from, read on chain at the call: a wearer in good standing of its hat or of the hat of a " +
  "budget above it. Authority follows the hat, so someone swapped out of the department loses it and whoever wears " +
  "it next has it. Never the claimant or requester themselves (HR Settings' `prevent_self_expense_approval`), and " +
  "never the Board, which spends from no budget.";
const DEPARTMENT_GUARD =
  "The caller must hold an active Seat whose Safe `Budgets.authorised` admits on the department's budget now, read " +
  "from the chain at the call (ROLE_PERMISSION_DENIED otherwise; PROVIDER_ERROR or PROVIDER_RESPONSE_INVALID when the " +
  "chain cannot answer), and must not be the Employee it is for (ROLE_PERMISSION_DENIED: self-approval is refused). ";
const DEPARTMENT_READS = [table_org_members, table_organizations, table_budgets] as const;
const CHAIN_ERRORS = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;
const DEPARTMENT_ERRORS = [...HR_ERRORS, ...CHAIN_ERRORS] as const;

/** Who reads the Organization's claims and advances: the People hat every one, a department's hat its own and below. */
export const WHO_EXPENSE_READER =
  "A signed-in member whose Safe wears the People hat, for every claim and advance; or a department's hat, for that " +
  "department's and those of the budgets below it, read from indexing's hat-wearers.";
const READER_GUARD =
  "The caller must hold an active Seat whose Safe wears the People hat or a department's hat (ROLE_PERMISSION_DENIED " +
  "otherwise); a department's hat reads that department's and those below it. ";

/** The funding read every money step makes first, as payroll.runs.pay does (payroll.run-pay-codes). */
const FUNDING =
  "Funding is read first: `leftOf` on the budget must cover the amount (PAYROLL_BUDGET_EXCEEDED) and the company Safe " +
  "hold it (INSUFFICIENT_BALANCE).";

// ── expense claim types ─────────────────────────────────────────────────────────────────────

export const rpc_payroll_expense_types_add = defineRpc({
  id: "payroll.expense-types.add",
  title: "Add an expense claim type",
  about:
    HR_GUARD +
    "An Expense Claim Type with its name (unique: WRONG_STATE naming the one that has it), `description`, and its " +
    "books expense account by code (INVALID_INPUT for one that is not a ledger expense account of the Organization's " +
    "books); none leaves books' default expense account, read when a claim of it is approved. It answers the type.",
  was: [`${HR}/expense_claim_type/expense_claim_type.json`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: ExpenseTypeAddInput,
  output: ExpenseType,
  errors: [...HR_ERRORS],
  reads: [...HR_READS, table_expense_claim_types, table_book_accounts],
  writes: [table_expense_claim_types, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_expense_types_list = defineRpc({
  id: "payroll.expense-types.list",
  title: "List the Organization's expense claim types",
  about: MEMBER_GUARD + "The expense claim types by name, each with its account. A page at a time. It reads only.",
  was: [`${HR}/expense_claim_type/expense_claim_type.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_MEMBER,
  input: ExpenseTypeListInput,
  output: ExpenseTypePage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_expense_claim_types],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── the claimant's side ─────────────────────────────────────────────────────────────────────

const ALLOCATE =
  "Each named advance must be theirs with this employer, paid, with something unclaimed (INVALID_INPUT naming it); " +
  "each takes, in the order named, as much of what is left of the sanctioned total as it has unclaimed, as Frappe's " +
  "Expense Claim Advance rows allocate (`validate_advances`), so the advances never take more than the total.";

export const rpc_payroll_expense_claims_create = defineRpc({
  id: "payroll.expense-claims.create",
  title: "Claim back what you spent for the Organization",
  about:
    SELF_GUARD +
    "Their Employee must be active and have a department, the budget that pays the claim (WRONG_STATE naming what is " +
    "missing). One to 50 lines, each of an expense claim type of the employer's (INVALID_INPUT naming the line), an " +
    "amount more than 0 in the department budget's token, a day no later than today (the posting day unless given) and " +
    "a description if given. Up to 10 receipts, each stored by `documents.store` as a receipt (subject the claim; " +
    "the Employee and the company Safe its readers; over 128 KB or not of its media type, INVALID_INPUT). " +
    ALLOCATE +
    " Then the claim is born `open` (expense-claim.create), every line sanctioned at its amount until the approver " +
    "says otherwise, and the department's approvers are told by notices from its event. It answers the claim.",
  was: [`${EC}:108`, `${EC}:546`, `${EC}:598`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: ClaimCreateInput,
  output: Claim,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_budgets, table_expense_claim_types, table_employee_advances, table_expense_claims],
  writes: [table_expense_claims, ...HR_LOGGED],
  drives: [c.create],
  invokes: [procedure_documents_store],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_expense_claims_withdraw = defineRpc({
  id: "payroll.expense-claims.withdraw",
  title: "Cancel your own open expense claim",
  about:
    SELF_RECORD_GUARD +
    "The claim must be `open` (WRONG_STATE naming the status: a decided claim is the " +
    "department's). It is `cancelled` (expense-claim.cancel), its advances' amounts free for another claim; its " +
    "receipts stay stored, as every document does. It answers the claim.",
  was: [`${EC}:227`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: MyClaimRef,
  output: Claim,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_expense_claims],
  writes: [table_expense_claims, ...HR_LOGGED],
  drives: [c.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_expense_claims_mine = defineRpc({
  id: "payroll.expense-claims.mine",
  title: "Your own expense claims",
  about:
    SELF_LIST_GUARD +
    "Their claims, newest first, `status` filtering, each with its employer, lines, totals, status, who decided, " +
    "and once paid its Payment. A page at a time. It reads only.",
  was: [`${HR}/expense_claim/expense_claim.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyClaimListInput,
  output: ClaimPage,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_expense_claims],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_expense_claims_mine_get = defineRpc({
  id: "payroll.expense-claims.mine-get",
  title: "One of your own expense claims",
  about:
    SELF_RECORD_GUARD +
    "One claim of theirs, with its lines, receipts, advances taken, totals, status " +
    "and, once paid, its Payment and settled facts. It reads only.",
  was: [`${HR}/expense_claim/expense_claim.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyClaimRef,
  output: Claim,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_expense_claims],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── the department's side ───────────────────────────────────────────────────────────────────

/** The claim's accrual, posted at approval through books' door, as Frappe's Expense Claim `make_gl_entries` posts it. */
const CLAIM_ACCRUAL =
  "books' door `books.record-payroll-accrual` records the claim's accrual in the same transaction (action " +
  "`expense_claim`, the claim's lines in its token): each line's sanctioned amount debited to its type's expense " +
  "account, each advance taken credited to Employee Advances, and the grand total credited to the payable, party the " +
  "Employee and reference the Expense Claim (payroll.hr-money).";

export const rpc_payroll_expense_claims_approve = defineRpc({
  id: "payroll.expense-claims.approve",
  title: "Approve an expense claim, posting what is owed",
  about:
    DEPARTMENT_GUARD +
    "The claim must be the Organization's (INVALID_INPUT) and `open` (WRONG_STATE naming the status). `sanction` sets " +
    "a line's sanctioned amount, from 0 to its amount (INVALID_INPUT naming the line); the rest are sanctioned at " +
    "their amounts. The advances' allocations are worked out again on the sanctioned total, each still unclaimed " +
    "(INVALID_INPUT naming one that is not), and each type's account read now. Then, in one transaction, the claim is " +
    "approved with the caller as `expense_approver` (expense-claim.approve), or, when its advances cover the whole " +
    "sanctioned total, paid at once (expense-claim.approve_covered), as Frappe's status reads at a zero grand total; " +
    "each advance's `claimed_amount` rises, one claimed in full moving to `claimed` (employee-advance.claim); and " +
    CLAIM_ACCRUAL +
    " Nothing moves on chain. It answers the claim.",
  was: [`${EC}:239`, `${EC}:302`, `${EC}:207`, `${EA}:251`],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: ClaimApproveInput,
  output: Claim,
  errors: [...DEPARTMENT_ERRORS],
  reads: [...DEPARTMENT_READS, table_employees, table_expense_claims, table_expense_claim_types, table_employee_advances],
  writes: [table_expense_claims, table_employee_advances, ...HR_LOGGED],
  drives: [c.approve, c.approve_covered, a.claim],
  invokes: [procedure_books_record_payroll_accrual],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_expense_claims_reject = defineRpc({
  id: "payroll.expense-claims.reject",
  title: "Reject an expense claim",
  about:
    DEPARTMENT_GUARD +
    "The claim must be the Organization's (INVALID_INPUT) and `open` (WRONG_STATE naming the status), and `reason` " +
    "given (INVALID_INPUT). It is `rejected` (expense-claim.reject) with the caller as `expense_approver`; nothing is " +
    "owed and its advances are free for another claim. It answers the claim.",
  was: [`${EC}:239`],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: ClaimRejectInput,
  output: Claim,
  errors: [...DEPARTMENT_ERRORS],
  reads: [...DEPARTMENT_READS, table_employees, table_expense_claims],
  writes: [table_expense_claims, ...HR_LOGGED],
  drives: [c.reject],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_expense_claims_cancel = defineRpc({
  id: "payroll.expense-claims.cancel",
  title: "Cancel an approved expense claim before it is paid",
  about:
    DEPARTMENT_GUARD +
    "The claim must be the Organization's (INVALID_INPUT) and `approved` with no Payment held: never sent, or returned " +
    "unsent (WRONG_STATE naming the status, or the Payment). Then, in one transaction, it is `cancelled` " +
    "(expense-claim.cancel), each advance it took gives that amount back, a claimed one returning to `paid` " +
    "(employee-advance.unclaim), and its accrual is cancelled through `books.record-payroll-accrual` (action " +
    "`expense_claim_cancel`), as Frappe's `on_cancel` reverses its ledger entries. It answers the claim.",
  was: [`${EC}:254`, `${EA}:251`],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: ClaimRef,
  output: Claim,
  errors: [...DEPARTMENT_ERRORS],
  reads: [...DEPARTMENT_READS, table_employees, table_expense_claims, table_employee_advances],
  writes: [table_expense_claims, table_employee_advances, ...HR_LOGGED],
  drives: [c.cancel, a.unclaim],
  invokes: [procedure_books_record_payroll_accrual],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_expense_claims_pay = defineRpc({
  id: "payroll.expense-claims.pay",
  title: "Pay an approved claim: one Payment from the department's budget",
  about:
    "Whoever `Budgets.authorised` admits on the claim's department budget now pays it, read from the chain at the call " +
    "(ROLE_PERMISSION_DENIED otherwise), and never its claimant (ROLE_PERMISSION_DENIED). A `requestKey` equal to the " +
    "claim's `asked_key` answers its latest command and approval as they stand, `replayed`. The claim must be the " +
    "Organization's (INVALID_INPUT) and `approved` (WRONG_STATE naming the status). A claim whose command's approval " +
    "lapsed resumes it: `payments.prepare-command` under the same key with `resume`, the same payment id and one new " +
    "approval. Otherwise one command is born under `expense:<claim>:<attempt>`: one item, the grand total in raw units " +
    "to the claimant's Safe (an Employee with no account goes as their mailbox, into a claim escrow from the budget), " +
    "kind one-off, its memo stored by `documents.store` (reference the claim's Frappe name), its source the claim " +
    "(kind `expense-claim`) and `against` the payable, party the Employee and reference the Expense Claim. " +
    FUNDING +
    " Then, in one transaction, the command is born or resumed, purpose payroll, route budget, with one approval from " +
    "the caller's own Safe (K1), and the claim moves to `paying` (expense-claim.pay) with its payment id, command and " +
    "attempt; its process follows the Payment (payroll.expense-claims.payment).",
  was: [`${EC}:675`, "/tmp/hrms/hrms/overrides/employee_payment_entry.py"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: ClaimPayInput,
  output: Schema.Struct({ claim: Claim, ...Prepared }),
  errors: [...DEPARTMENT_ERRORS, error_INVALID_RECIPIENT, error_PAYROLL_BUDGET_EXCEEDED, error_INSUFFICIENT_BALANCE],
  reads: [...DEPARTMENT_READS, table_parties, table_employees, table_expense_claims],
  writes: [table_expense_claims, ...HR_LOGGED],
  drives: [c.pay],
  invokes: [procedure_documents_store, procedure_payments_prepare_command],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised, contract_budgets.f.leftOf, contract_erc20.f.balanceOf, contract_budgets.f.spend],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_expense_claims_list = defineRpc({
  id: "payroll.expense-claims.list",
  title: "List the Organization's expense claims",
  about:
    READER_GUARD +
    "Claims newest first, each with its claimant, department, totals and status; `employeeId`, `department` and " +
    "`status` filter (INVALID_INPUT for one that names nothing the caller may read). A page at a time. It reads only.",
  was: [`${HR}/expense_claim/expense_claim.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_EXPENSE_READER,
  input: OrgClaimListInput,
  output: ClaimPage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_budgets, table_employees, table_expense_claims],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_expense_claims_get = defineRpc({
  id: "payroll.expense-claims.get",
  title: "Read one of the Organization's expense claims",
  about:
    READER_GUARD +
    "One claim (INVALID_INPUT for one the caller may not read), with its lines, receipts, advances taken, totals, who " +
    "decided, and once sent its Payment and settled facts. It reads only.",
  was: [`${HR}/expense_claim/expense_claim.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_EXPENSE_READER,
  input: ClaimRef,
  output: Claim,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_budgets, table_expense_claims],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── advances ────────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_advances_request = defineRpc({
  id: "payroll.advances.request",
  title: "Ask for an advance",
  about:
    SELF_GUARD +
    "Their Employee must be active and have a department (WRONG_STATE naming what is missing); the amount more than 0 " +
    "in the department budget's token and the purpose 1 to 280 characters (INVALID_INPUT naming the field). The " +
    "advance is born `requested` (employee-advance.request), and the department's approvers are told by notices from " +
    "its event. It answers the advance.",
  was: [`${EA}:60`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: AdvanceRequestInput,
  output: Advance,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_budgets],
  writes: [table_employee_advances, ...HR_LOGGED],
  drives: [a.request],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_advances_withdraw = defineRpc({
  id: "payroll.advances.withdraw",
  title: "Cancel your own advance request",
  about:
    SELF_RECORD_GUARD +
    "The advance must be `requested` with no Payment held (WRONG_STATE naming the status, " +
    "or the Payment of an approval still open). It is `cancelled` (employee-advance.cancel). It answers the advance.",
  was: [`${EA}:96`],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_SELF_HR,
  input: MyAdvanceRef,
  output: Advance,
  errors: [...SELF_ERRORS],
  reads: [...SELF_READS, table_employee_advances],
  writes: [table_employee_advances, ...HR_LOGGED],
  drives: [a.cancel],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_advances_mine = defineRpc({
  id: "payroll.advances.mine",
  title: "Your own advances",
  about:
    SELF_LIST_GUARD +
    "Their advances, newest first, `status` filtering, each with its employer, what was paid, claimed and " +
    "recovered, what is left unclaimed, and any recovery set for their next slip. A page at a time. It reads only.",
  was: [`${HR}/employee_advance/employee_advance.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_SELF_HR,
  input: MyAdvanceListInput,
  output: AdvancePage,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...SELF_READS, table_employee_advances, table_additional_salaries],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_advances_reject = defineRpc({
  id: "payroll.advances.reject",
  title: "Reject an advance request",
  about:
    DEPARTMENT_GUARD +
    "The advance must be the Organization's (INVALID_INPUT) and `requested` with no Payment held (WRONG_STATE naming " +
    "the status, or the Payment of an approval still open), and `reason` given (INVALID_INPUT). It is `rejected` " +
    "(employee-advance.reject) with the caller as `decided_by`. It answers the advance.",
  was: [`${EA}:96`],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: AdvanceRejectInput,
  output: Advance,
  errors: [...DEPARTMENT_ERRORS],
  reads: [...DEPARTMENT_READS, table_employees, table_employee_advances],
  writes: [table_employee_advances, ...HR_LOGGED],
  drives: [a.reject],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_advances_pay = defineRpc({
  id: "payroll.advances.pay",
  title: "Pay a requested advance: one Payment from the department's budget",
  about:
    "Whoever `Budgets.authorised` admits on the advance's department budget now pays it, which approves it, read from " +
    "the chain at the call (ROLE_PERMISSION_DENIED otherwise), and never its requester (ROLE_PERMISSION_DENIED). A " +
    "`requestKey` equal to the advance's `asked_key` answers its latest command and approval as they stand, " +
    "`replayed`. The advance must be the Organization's (INVALID_INPUT) and `requested` (WRONG_STATE naming the " +
    "status). One whose command's approval lapsed resumes it under the same key with `resume`. Otherwise one command " +
    "is born under `advance:<advance>:<attempt>`: one item, the amount in raw units to the Employee's Safe (into a " +
    "claim escrow for one with no account), kind one-off, its memo stored by `documents.store` (reference the " +
    "advance's Frappe name, note its purpose), its source the advance (kind `employee-advance`) and `against` Employee " +
    "Advances, party the Employee and reference the Employee Advance, as Frappe's advance Payment Entry posts it. " +
    FUNDING +
    " Then, in one transaction, the command is born or resumed, purpose payroll, route budget, with one approval from " +
    "the caller's own Safe (K1), and the advance moves to `paying` (employee-advance.pay) with the caller as " +
    "`decided_by`; its process follows the Payment (payroll.advances.payment).",
  was: [`${EA}:160`, "/tmp/hrms/hrms/overrides/employee_payment_entry.py"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_DEPARTMENT,
  input: AdvancePayInput,
  output: Schema.Struct({ advance: Advance, ...Prepared }),
  errors: [...DEPARTMENT_ERRORS, error_INVALID_RECIPIENT, error_PAYROLL_BUDGET_EXCEEDED, error_INSUFFICIENT_BALANCE],
  reads: [...DEPARTMENT_READS, table_parties, table_employees, table_employee_advances],
  writes: [table_employee_advances, ...HR_LOGGED],
  drives: [a.pay],
  invokes: [procedure_documents_store, procedure_payments_prepare_command],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised, contract_budgets.f.leftOf, contract_erc20.f.balanceOf, contract_budgets.f.spend],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_advances_settle = defineRpc({
  id: "payroll.advances.settle",
  title: "Recover what no claim took of an advance from the next salary",
  about:
    HR_GUARD +
    "The advance must be the Organization's (INVALID_INPUT), `paid`, with something unclaimed and no recovery yet " +
    "(WRONG_STATE naming the status, or the recovery), and its Employee active with a submitted structure assignment " +
    "to deduct from (WRONG_STATE naming what is missing). An open claim still taking from it is WRONG_STATE naming the " +
    "claim. Then, in one transaction, as Frappe's `create_return_through_additional_salary`: the Organization's advance " +
    "recovery component is born if it has none (a deduction, Advance Recovery `ADVREC`, origin `advance`, no amount, " +
    "not by payment days, not taxable, removed when zero); one Additional Salary deducts the unclaimed amount, its " +
    "payroll date the first day after the Employee's latest submitted slip (today if none is later), so the next run " +
    "takes it; and the advance is marked to be repaid from salary. Nothing moves now: the advance is `returned` (or " +
    "`partly_claimed_and_returned`) when the slip that takes it is submitted (payroll.advance-recovery). It answers the advance.",
  was: [`${EA}:309`, "/tmp/hrms/hrms/payroll/doctype/additional_salary/additional_salary.py:262"],
  concept: concept_payroll,
  kind: "mutation",
  who: WHO_HR,
  input: AdvanceRef,
  output: Advance,
  errors: [...HR_ERRORS],
  reads: [
    ...HR_READS,
    table_employees,
    table_employee_advances,
    table_expense_claims,
    table_additional_salaries,
    table_salary_components,
    table_salary_structure_assignments,
    table_salary_slips,
  ],
  writes: [table_employee_advances, table_additional_salaries, table_salary_components, ...HR_LOGGED],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});

export const rpc_payroll_advances_list = defineRpc({
  id: "payroll.advances.list",
  title: "List the Organization's advances",
  about:
    READER_GUARD +
    "Advances newest first, each with its Employee, department, amounts and status; `employeeId`, `department` and " +
    "`status` filter (INVALID_INPUT for one that names nothing the caller may read). A page at a time. It reads only.",
  was: [`${HR}/employee_advance/employee_advance.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_EXPENSE_READER,
  input: OrgAdvanceListInput,
  output: AdvancePage,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_budgets, table_employees, table_employee_advances, table_additional_salaries],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_payroll_advances_get = defineRpc({
  id: "payroll.advances.get",
  title: "Read one of the Organization's advances",
  about:
    READER_GUARD +
    "One advance (INVALID_INPUT for one the caller may not read), with what was paid, claimed and recovered, the claims " +
    "that took it, its recovery, and once sent its Payment and settled facts. It reads only.",
  was: [`${HR}/employee_advance/employee_advance.json`],
  concept: concept_payroll,
  kind: "query",
  who: WHO_EXPENSE_READER,
  input: AdvanceRef,
  output: Advance,
  errors: [...READ_ERRORS],
  reads: [...HR_READS, table_budgets, table_employee_advances, table_expense_claims, table_additional_salaries],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

// ── following the money back ────────────────────────────────────────────────────────────────

const FOLLOW =
  "routed by its command and payment id (`by_command`): `escrowed` keeps it paying (an Employee with no account claims " +
  "it later); `settled` moves it to paid, copying the settled facts (the payment id, `settled_tx_hash`, block number " +
  "and `settled_at`, the block's time); `needs_retry` (its approval lapsed unsent) moves it back, keeping its payment " +
  "id and command for the next pay to resume; `cancelled` before any money moved (declined, refused or withdrawn) or " +
  "refunded from escrow moves it back with its payment fields cleared, owed again; `unsettle` (a reorg) moves it back " +
  "to paying until it settles again. Books posts the settled Payment's entry from its own fact and `against`; this " +
  "process writes only payroll's rows and their change log.";

export const workflow_payroll_expense_claims_payment = defineWorkflow({
  id: "payroll.expense-claims.payment",
  title: "One expense claim's payment, from its command to paid",
  about:
    "Started when a claim is sent to be paid (expense-claim.pay, through the outbox), one instance per claim, as a " +
    "run's process follows its slips (payroll.runs.lifecycle). It follows every command of the claim (its first, a " +
    "resumed one, the next attempt's), each Payment transition " +
    FOLLOW +
    " It ends when the claim is paid and its settlement confirmed (twice payments' finality depth); until then it waits " +
    "durably, with no deadline, so a later attempt finds it.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: c.pay },
  instance: { per: table_expense_claims },
  signals: [rpc_payroll_expense_claims_pay],
  waits: [
    {
      name: "payments",
      for: "signal",
      key: [{ on: [event_payment_transitioned], props: ["command_id", "payment_id"] }],
      about: "payment_transitioned for the claim's Payment, by its command and payment id: escrowed, settled, needs_retry, cancelled, unsettle.",
    },
  ],
  steps: [{ name: "follow", about: "Each Payment transition to the claim's: settle (with the settled facts), lapse, unsend or reverse." }],
  reads: [table_expense_claims, table_payments],
  writes: [table_expense_claims, ...HR_LOGGED],
  drives: [c.settle, c.lapse, c.unsend, c.reverse],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One instance per expense_claim_id; each Payment transition applies once, by payment id and transition, and only while the claim holds that payment id.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: it copies payments' decided facts onto payroll's own row, and a failed step runs again on resume.",
  budget: budget("background"),
});

export const workflow_payroll_advances_payment = defineWorkflow({
  id: "payroll.advances.payment",
  title: "One advance's payment, from its command to paid",
  about:
    "Started when an advance is sent to be paid (employee-advance.pay, through the outbox), one instance per advance. " +
    "It follows every command of the advance, each Payment transition " +
    FOLLOW +
    " It ends when the advance is paid and its settlement confirmed; what becomes of it then (claimed, recovered) is " +
    "the claims' and the runs' to move.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: a.pay },
  instance: { per: table_employee_advances },
  signals: [rpc_payroll_advances_pay],
  waits: [
    {
      name: "payments",
      for: "signal",
      key: [{ on: [event_payment_transitioned], props: ["command_id", "payment_id"] }],
      about: "payment_transitioned for the advance's Payment, by its command and payment id: escrowed, settled, needs_retry, cancelled, unsettle.",
    },
  ],
  steps: [{ name: "follow", about: "Each Payment transition to the advance's: settle (with the settled facts), lapse, unsend or reverse." }],
  reads: [table_employee_advances, table_payments],
  writes: [table_employee_advances, ...HR_LOGGED],
  drives: [a.settle, a.lapse, a.unsend, a.reverse],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One instance per employee_advance_id; each Payment transition applies once, by payment id and transition, and only while the advance holds that payment id.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: it copies payments' decided facts onto payroll's own row, and a failed step runs again on resume.",
  budget: budget("background"),
});

// ── the two money commands' SDK methods (G7: they sign and wait, so each is a flow) ──────────────

const PRINTS =
  "It prints as `payment send` and `org payroll run pay` do (G9): with `noWait` it returns at the approval, `status` " +
  "`awaiting_approval` with the approval's id, page and expiry and `capxul payment wait <approvalId>` as `next`; " +
  "followed, `status` is the record's. A declined approval ends it CANCELLED, owed again.";

export const flow_client_org_expense_claims_pay = defineFlow({
  id: "client.org.expense-claims.pay",
  title: "Pay an approved expense claim, then follow it",
  about:
    "Pays an approved claim as one payment command from its department's budget, or resumes its lapsed command. The " +
    "caller signs one approval (an agent with its own key, a person on the approval page), and the flow follows the " +
    "claim until it is paid, or `timeoutSeconds` passes. " +
    PRINTS +
    " It serves `org expense-claim pay` and the SDK.",
  component: component_core_sdk,
  sdk: "client.org(orgId).expenseClaims.pay",
  input: ClaimPayFlowInput,
  output: moneyOutcome(Claim, ClaimStatus),
  steps: [
    { name: "prepare", rpc: rpc_payroll_expense_claims_pay, about: "Runs payroll.expense-claims.pay: the checks, the command and its one approval." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    { name: "follow", rpc: rpc_payroll_expense_claims_get, about: "Reads the claim until it is paid, or its approval lapsed." },
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  surfaces: ["cli", "sdk"],
  budget: budget("chain-submit"),
});

export const flow_client_org_advances_pay = defineFlow({
  id: "client.org.advances.pay",
  title: "Pay a requested advance, then follow it",
  about:
    "Approves and pays a requested advance as one payment command from its department's budget, or resumes its lapsed " +
    "command. The caller signs one approval, and the flow follows the advance until it is paid, or `timeoutSeconds` " +
    "passes. " +
    PRINTS +
    " It serves `org advance pay` and the SDK.",
  component: component_core_sdk,
  sdk: "client.org(orgId).advances.pay",
  input: AdvancePayFlowInput,
  output: moneyOutcome(Advance, AdvanceStatus),
  steps: [
    { name: "prepare", rpc: rpc_payroll_advances_pay, about: "Runs payroll.advances.pay: the checks, the command and its one approval." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    { name: "follow", rpc: rpc_payroll_advances_get, about: "Reads the advance until it is paid, or its approval lapsed." },
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  surfaces: ["cli", "sdk"],
  budget: budget("chain-submit"),
});

export const flow_client_org_advances_settle = defineFlow({
  id: "client.org.advances.settle",
  title: "Recover what is left of an advance from salary, after a preview",
  about:
    "`org advance settle`: what no claim took of a paid advance is deducted from the Employee's next payslip by an " +
    "Additional Salary, which no command takes back (payroll.advance-recovery), so it previews and asks, as G5 has " +
    "every command that cannot be undone. At a terminal it first shows the Employee and the unclaimed amount their " +
    "next payslip will lose, and asks; a decline ends it CANCELLED with nothing written, and `confirm` (`--confirm`) " +
    "answers yes in a script, which without it is the CLI's CLI_USAGE (vocabulary.declined-preview-cancelled). It " +
    "serves the command and the SDK.",
  component: component_core_sdk,
  sdk: "client.org(orgId).advances.settle",
  input: AdvanceSettleFlowInput,
  output: Advance,
  steps: [
    { name: "read", rpc: rpc_payroll_advances_get, about: "Only at a terminal without `confirm`: the advance and what is unclaimed of it, for the preview." },
    { name: "confirm", local: "prompt", about: "Only at a terminal without `confirm`: shows the deduction from the next payslip and asks; a decline is CANCELLED and writes nothing." },
    { name: "settle", rpc: rpc_payroll_advances_settle, about: "Runs payroll.advances.settle: the Additional Salary, and the advance marked to be repaid from salary." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  surfaces: ["cli", "sdk"],
  budget: budget("write"),
});
