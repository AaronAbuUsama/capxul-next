// STAGED, NOT REGISTERED: paying a submitted run, and the settled facts coming back.
//
// These records are the design of the run's paying half (payroll.pays-through-payments,
// payroll.run-one-approval, payroll.new-hire-escrow). They typecheck, but payroll/index.ts does not list
// this module yet, because they invoke payments' door, read payments' table and wait on payments' event,
// and payroll does not depend on payments until shared/foundation.ts adds it (asked of the shared
// records' owner, with dependencies.of-payroll and dependencies.payments-payroll). Until then the
// transitions below drive nothing, and the build lists each as an `undriven-transition` gap: the gap is
// this file. Once the edge exists: add `staged` to payroll/index.ts and rebuild to 0 problems.

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
  table_salary_components,
  table_salary_slips,
} from "./data.ts";
import { rpc_payroll_runs_show } from "./runs.ts";
import { Run } from "./shapes.ts";
import { FLOW_ERRORS, SIGN, SPONSORED, SUBMIT, WAIT } from "./flows.ts";

const e = machine_payroll_entry.t;
const s = machine_salary_slip.t;
const FRAPPE = "/tmp/hrms/hrms/payroll/doctype/payroll_entry/payroll_entry.py";

const PayInput = Schema.Struct({
  orgId: Schema.String,
  payrollEntryId: Schema.String,
  /** Only these released slips of a paid run; absent: every submitted slip of a submitted run. */
  salarySlipIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const rpc_payroll_runs_pay = defineRpc({
  id: "payroll.runs.pay",
  title: "Pay a submitted run: one payment command, one approval, every net",
  about:
    "Whoever Budgets authorises on the run's department budget pays it: its office holder or anyone above, an agent " +
    "whose Seat holds its allowance, or the Organization's own agent (ROLE_PERMISSION_DENIED otherwise, read from the " +
    "chain). The run must be `submitted`, or `paid` with released slips named (WRONG_STATE). Every submitted slip is one " +
    "item: its `net_pay_raw` to the Employee's `payee_safe`, kind one-off, its payslip's document id and hash; an " +
    "Employee with no account yet goes as their mailbox, which payments pays into a claim escrow from the budget " +
    "(aaron.budget-pay-unclaimed). A component with a payee adds one remittance item per payee, its total for the run, " +
    "under its schedule document (payroll.deduction-remittance). Funding is read first: `leftOf` must cover the total " +
    "(PAYROLL_BUDGET_EXCEEDED) and the company Safe hold it (PAYER_BALANCE_TOO_LOW). Then, in one transaction, " +
    "`payments.prepare-command` births one command under `payroll:<entry>:<attempt>`, purpose payroll, route budget, " +
    "with one approval from the caller's own Safe for every item (K1: asking twice pays once), and the run moves to " +
    "`paying` (payroll-entry.pay) and each slip to `paying` (salary-slip.pay) with its payment id. The run's process follows it.",
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
  reads: [table_org_members, table_organizations, table_budgets, table_parties, table_employees, table_salary_components, table_payroll_entries, table_salary_slips],
  writes: [table_payroll_entries, table_salary_slips],
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
    "follows its command's Payments as payments' settlement decides them, keyed by the command: a Payment `escrowed` " +
    "moves its slip to `escrowed` (a new hire's net waits in a claim escrow); `settled` moves it to `paid`, copying the " +
    "settled facts from the Payment (its payment id, `settled_tx_hash`, block number and `settled_at`, the block's time); " +
    "`needs_retry` (the approval lapsed unsent) moves every paying slip back to `submitted` and the run with it, for a " +
    "retry under the next attempt that pays the same payment ids; a refunded escrow moves its slip back to `submitted`; " +
    "a reorg's reopen moves a paid slip back to `paying` until it settles again. When every slip that is not withheld " +
    "is paid the run is `paid` (payroll-entry.settle), and a later reversal or refund reopens it. Books posts each " +
    "settled Payment's Bank Entry from its own fact (payroll.accrual); this process writes only payroll's rows.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: e.pay },
  instance: { per: table_payroll_entries },
  signals: [rpc_payroll_runs_pay],
  waits: [
    {
      name: "payments",
      for: "signal",
      key: [{ on: [event_payment_transitioned], props: ["command_id"] }],
      about: "payment_transitioned for each Payment of the run's command: escrowed, settled, needs_retry, a refund, a reorg's reopen.",
    },
  ],
  steps: [
    { name: "follow", about: "Each Payment's transition to its slip's: escrow, settle (with the settled facts), lapse, refund or reverse." },
    { name: "close-run", about: "Every slip that is not withheld paid: payroll-entry.settle; a slip reopened after: payroll-entry.reopen." },
  ],
  reads: [table_payroll_entries, table_salary_slips, table_payments],
  writes: [table_payroll_entries, table_salary_slips],
  drives: [s.escrow, s.settle, s.lapse, s.refund, s.reverse, e.lapse, e.settle, e.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One instance per payroll_entry_id; each Payment transition applies once, by payment id and transition.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: it copies payments' decided facts onto payroll's own rows, and a failed step runs again on resume.",
  budget: budget("background"),
});

export const flow_client_org_payroll_runs_pay = defineFlow({
  id: "client.org.payroll.runs.pay",
  title: "Pay a payroll run: one approval for every net, then follow it",
  about:
    "Pays a submitted run as one payment command: the caller signs one approval for every slip's net (an agent with its " +
    "own key, a person on the approval page), and the flow follows the run until each slip is paid or escrowed.",
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
