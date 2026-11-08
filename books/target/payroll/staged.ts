// Paying a submitted run, and the settled facts coming back: the run's paying half
// (payroll.pays-through-payments, payroll.run-one-approval, payroll.new-hire-escrow). It invokes
// payments' door, reads payments' table and waits on payments' event, so it was staged until payroll
// depended on payments. That edge exists now (dependencies.payments-payroll), and payroll/index.ts lists
// this module; the file keeps its name so its history reads.

import { Schema } from "effect";
import { budget, defineFlow, defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { component_core_sdk, concept_payroll } from "../shared/foundation.ts";
import { contract_budgets, contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { event_payment_transitioned, table_payments } from "../payments/data.ts";
import {
  machine_payroll_entry,
  machine_salary_slip,
  table_employees,
  table_payroll_entries,
  table_salary_slips,
} from "./data.ts";
import { rpc_payroll_runs_show } from "./runs.ts";
import { Run } from "./shapes.ts";
import { FLOW_ERRORS, SIGN, SPONSORED, SUBMIT, WAIT } from "./flows.ts";
import { LOGGED } from "./employees.ts";

const e = machine_payroll_entry.t;
const s = machine_salary_slip.t;
const FRAPPE = "/tmp/hrms/hrms/payroll/doctype/payroll_entry/payroll_entry.py";

const PayInput = Schema.Struct({
  orgId: Schema.String,
  payrollEntryId: Schema.String,
  /** Only these slips, each submitted with no live Payment (released, refunded, or lapsed); absent: every submitted slip of a submitted run. */
  salarySlipIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const rpc_payroll_runs_pay = defineRpc({
  id: "payroll.runs.pay",
  title: "Pay a submitted run: one payment command, one approval, every net",
  about:
    "Whoever Budgets authorises on the run's department budget pays it: its office holder or anyone above, an agent " +
    "whose Seat holds its allowance, or the Organization's own agent (ROLE_PERMISSION_DENIED otherwise, read from the " +
    "chain). Which slips: with none named, every submitted slip of a `submitted` run; named, slips of a `submitted`, " +
    "`paying` or `paid` run that are each `submitted` (WRONG_STATE otherwise). One call is one command. When the slips " +
    "hold Payments their command's approval lapsed (`needs_retry`), it resumes that command: `payments.prepare-command` " +
    "under the same key with `resume`, the same items and payment ids and one new approval, so a lapse can never pay " +
    "twice; slips with no Payment wait for the next call. Otherwise the slips hold no " +
    "Payment (never sent, released from withholding, or refunded from escrow) and go out as a new command under the " +
    "next attempt's key `payroll:<entry>:<attempt>`. Each item is one slip: its `net_pay_raw` to the Employee's " +
    "`payee_safe`, kind one-off, its payslip's document id and hash, its source (the slip, its run, its Employee) and " +
    "its `against` (party the Employee, the Payroll Entry allocated the rest, the run's Payroll Payable if it has " +
    "one: books.payroll-postings); " +
    "an Employee with no account yet goes as their mailbox, which payments pays into a claim escrow from the budget " +
    "(aaron.budget-pay-unclaimed). The command carries nets only: a deduction's payee is paid outside the run " +
    "(payroll.deduction-remittance). Funding is read first: `leftOf` must cover the total (PAYROLL_BUDGET_EXCEEDED) and " +
    "the company Safe hold it (PAYER_BALANCE_TOO_LOW). Then, in one transaction, the command is born or resumed, purpose " +
    "payroll, route budget, with one approval from the caller's own Safe for every item (K1: asking twice pays once); a " +
    "submitted run moves to `paying` (payroll-entry.pay), a paid one reopens (payroll-entry.reopen), a paying one stays, " +
    "and each slip moves to `paying` (salary-slip.pay) with its payment id, command and attempt.",
  was: [`${FRAPPE}:1093`, `${FRAPPE}:1196`],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in member, person or agent, whose own Safe Budgets authorises on the run's department budget.",
  input: PayInput,
  output: Schema.Struct({ run: Run, approvalId: Schema.String, expiresAt: Schema.String, replayed: Schema.Boolean }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_ROLE_PERMISSION_DENIED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_INVALID_RECIPIENT,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_PAYER_BALANCE_TOO_LOW,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [table_org_members, table_organizations, table_budgets, table_parties, table_employees, table_payroll_entries, table_salary_slips],
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
  drives: [e.pay, e.reopen, s.pay],
  invokes: [procedure_payments_prepare_command],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.authorised, contract_budgets.f.leftOf, contract_erc20.f.balanceOf, contract_budgets.f.spend],
  spans: [],
  budget: budget("chain-read"),
});

export const workflow_payroll_runs_lifecycle = defineWorkflow({
  id: "payroll.runs.lifecycle",
  title: "One run's payment, from its command to every slip paid",
  about:
    "Started when a run is sent to be paid (payroll-entry.pay, through the outbox), one instance per Payroll Entry. It " +
    "follows every command of the run (its first, a resumed one, a released or refunded slip's), each Payment " +
    "transition reaching the slip that holds its command and payment id (`by_command`): `escrowed` moves the slip to " +
    "`escrowed` (a new hire's net waits in a claim escrow); `settled` moves it to `paid`, copying the settled facts " +
    "(the payment id, `settled_tx_hash`, block number and `settled_at`, the block's time); `needs_retry` (the approval " +
    "lapsed unsent) moves that command's paying slips back to `submitted`, keeping their payment ids for " +
    "`runs.pay` to resume the same command, and the run back to `submitted` when nothing of it is paid or escrowed; " +
    "`cancelled` with outcome refunded (the budget's holder or the Board took an escrow back) moves its slip back to " +
    "`submitted` with its payment fields cleared, owed again; `unsettle` (a reorg) moves a paid slip back to `paying` " +
    "and a paid run with it, until it settles again. When every slip that is not withheld is paid the run is `paid` " +
    "(payroll-entry.settle). It ends when every slip of the run is paid (none withheld, released, escrowed or owed " +
    "again) and its last settlement is confirmed (twice payments' finality depth, after which payments reopens nothing); until then it " +
    "waits durably, with no deadline, so a released or refunded slip's later command always finds it. Books posts each " +
    "settled Payment's Bank Entry from its own fact (payroll.accrual); this process writes only payroll's rows and " +
    "their change log, which carries each slip's payment facts to a connected head.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: e.pay },
  instance: { per: table_payroll_entries },
  signals: [rpc_payroll_runs_pay],
  waits: [
    {
      name: "payments",
      for: "signal",
      key: [{ on: [event_payment_transitioned], props: ["command_id", "payment_id"] }],
      about:
        "payment_transitioned for each Payment of each of the run's commands, routed by its command and payment id to the " +
        "slip that holds them: escrowed, settled, needs_retry, cancelled (refunded), unsettle.",
    },
  ],
  steps: [
    { name: "follow", about: "Each Payment's transition to its slip's: escrow, settle (with the settled facts), lapse, refund or reverse." },
    { name: "close-run", about: "Every slip that is not withheld paid: payroll-entry.settle; a slip reopened after: payroll-entry.reopen." },
  ],
  reads: [table_payroll_entries, table_salary_slips, table_payments],
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
  drives: [s.escrow, s.settle, s.lapse, s.refund, s.reverse, e.lapse, e.settle, e.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency:
    "One instance per payroll_entry_id; each Payment transition applies once, by payment id and transition, and only to " +
    "the slip that holds that payment id now (a refunded Payment's late event finds no slip).",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: it copies payments' decided facts onto payroll's own rows, and a failed step runs again on resume.",
  budget: budget("background"),
});

export const flow_client_org_payroll_runs_pay = defineFlow({
  id: "client.org.payroll.runs.pay",
  title: "Pay a payroll run: one approval for every net, then follow it",
  about:
    "Pays a submitted run as one payment command, resumes its lapsed command, or pays named released or refunded slips " +
    "under the next attempt: the caller signs one approval for every slip's net (an agent with its own key, a person on " +
    "the approval page), and the flow follows the run until each slip is paid or escrowed.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payroll.runs.pay",
  input: PayInput,
  output: Schema.Struct({ run: Run, approvalId: Schema.String }),
  steps: [
    { name: "prepare", rpc: rpc_payroll_runs_pay, about: "Runs payroll.runs.pay: the checks, the command and its one approval." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    { name: "follow", rpc: rpc_payroll_runs_show, about: "Reads the run until every slip is paid or escrowed, or the approval lapsed." },
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  surfaces: ["sdk", "react"],
  budget: budget("chain-submit"),
});
