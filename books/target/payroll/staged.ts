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
  error_INSUFFICIENT_BALANCE,
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
  /** `--slip <slip>`, once per slip. Only these slips, each submitted with no live Payment (released, refunded, returned unsent, or lapsed); absent: every submitted slip of a submitted run. */
  salarySlipIds: Schema.optionalKey(Schema.Array(Schema.String)),
  /** `--request-key`: kept as the run's `asked_key`; asking again with it returns the command and approval it began, never a second (payroll.run-request-key). */
  requestKey: Schema.optionalKey(Schema.String),
});

/** What `org payroll run pay` gives the SDK method: the rpc's input, and how long to follow it. */
const PayFlowInput = Schema.Struct({
  ...PayInput.fields,
  /** `--timeout-seconds`: how long to follow the run before returning with it still paying. */
  timeoutSeconds: Schema.optionalKey(Schema.Int),
  /** `--no-wait`: return at the approval, with its link and `next`. */
  noWait: Schema.optionalKey(Schema.Boolean),
});

export const rpc_payroll_runs_pay = defineRpc({
  id: "payroll.runs.pay",
  title: "Pay a submitted run: one payment command, one approval, every net",
  about:
    "Whoever `Budgets.authorised` admits on the run's department budget now pays it: a wearer in good standing of its " +
    "hat or an ancestor's, read from the chain at the call (ROLE_PERMISSION_DENIED otherwise), so a " +
    "holder swapped out cannot pay and the next can (payroll.command-authority). A `requestKey` equal to the run's " +
    "`asked_key` answers its latest command and approval as they stand, `replayed`, before any slip check " +
    "(payroll.run-request-key). Which slips: none named, every submitted slip of a `submitted` run; named, slips of a " +
    "`submitted`, `paying` or `paid` run, each `submitted` (WRONG_STATE otherwise). One call is one command. Slips " +
    "whose command's approval lapsed (`needs_retry`) resume it: `payments.prepare-command` under the same key with " +
    "`resume`, the same payment ids and one new approval, so a lapse never pays twice. Slips holding no Payment " +
    "(never sent, released, refunded, or returned unsent) go out as a new command under the key " +
    "`payroll:<entry>:<attempt>`, the caller's `requestKey` kept as `asked_key`. Each item is one slip: its " +
    "`net_pay_raw` to the Employee's `payee_safe`, kind one-off, its payslip's document id and hash, its source (the slip, " +
    "run and Employee) and `against` (party the Employee, the Payroll Entry, its Payroll Payable: " +
    "books.payroll-postings); an Employee with no account yet goes as their mailbox, into " +
    "a claim escrow from the budget (aaron.budget-pay-unclaimed). The command carries nets only " +
    "(payroll.deduction-remittance). Funding is read first: `leftOf` must cover the total (PAYROLL_BUDGET_EXCEEDED) and " +
    "the company Safe hold it (INSUFFICIENT_BALANCE: payroll.run-pay-codes). Then, in one transaction, the command is " +
    "born or resumed, purpose payroll, route budget, with one approval from the caller's own Safe for every item (K1); " +
    "a submitted run moves to `paying` (payroll-entry.pay), a paid one reopens (payroll-entry.reopen), and each slip " +
    "to `paying` (salary-slip.pay) with its payment id, command and attempt.",
  was: [`${FRAPPE}:1093`, `${FRAPPE}:1196`],
  concept: concept_payroll,
  kind: "action",
  who:
    "A signed-in member, person or agent, whose own Safe `Budgets.authorised` admits on the run's department budget " +
    "now: a wearer of its hat or of the hat of a budget above it. Never the Board, which spends from no budget.",
  input: PayInput,
  output: Schema.Struct({ run: Run, approvalId: Schema.String, expiresAt: Schema.String, replayed: Schema.Boolean }),
  errors: [
    error_NOT_AUTHENTICATED,
    error_ROLE_PERMISSION_DENIED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_INVALID_RECIPIENT,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_INSUFFICIENT_BALANCE,
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
    "`cancelled` before any money moved (the approval declined, refused or withdrawn) moves that command's paying " +
    "slips back to `submitted` with their payment fields cleared (salary-slip.unsend), owed again for the next " +
    "attempt, and the run back to `submitted` the same way (payroll.declined-run-approval); " +
    "`cancelled` with outcome refunded (a wearer of the budget's hat or one above it, or the Board, took an escrow back) moves its slip back to " +
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
        "slip that holds them: escrowed, settled, needs_retry, cancelled (unsent, or refunded), unsettle.",
    },
  ],
  steps: [
    { name: "follow", about: "Each Payment's transition to its slip's: escrow, settle (with the settled facts), lapse, unsend, refund or reverse." },
    { name: "close-run", about: "Every slip that is not withheld paid: payroll-entry.settle; a slip reopened after: payroll-entry.reopen." },
  ],
  reads: [table_payroll_entries, table_salary_slips, table_payments],
  writes: [table_payroll_entries, table_salary_slips, ...LOGGED],
  drives: [s.escrow, s.settle, s.lapse, s.unsend, s.refund, s.reverse, e.lapse, e.settle, e.reopen],
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
    "Pays a submitted run as one payment command, resumes its lapsed command, or pays named released, refunded or " +
    "returned slips under the next attempt. A declined approval ends it CANCELLED, the run owed again. The caller signs one approval for every slip's net (an agent with its own key, a person on " +
    "the approval page), and the flow follows the run until each slip it pays is paid or escrowed, or `timeoutSeconds` passes. " +
    "It prints as `payment send` and the agreement writes do (G9, payroll.command-fit): with `noWait` it returns at " +
    "the approval, `status` `awaiting_approval` with the approval's id, page and expiry and `capxul payment wait " +
    "<approvalId>` as `next`; followed, `status` is the run's, with the run and each slip's settled facts. It serves " +
    "`org payroll run pay`, the SDK and the web app.",
  component: component_core_sdk,
  sdk: "client.org(orgId).payroll.runs.pay",
  input: PayFlowInput,
  output: Schema.Struct({
    status: Schema.Union([Schema.Literal("awaiting_approval"), Run.fields.status]),
    approvalId: Schema.String,
    /** The approval page, the sponsored approval's `url`: where a person signs. */
    approvalUrl: Schema.String,
    expiresAt: Schema.String,
    run: Run,
    next: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  steps: [
    { name: "prepare", rpc: rpc_payroll_runs_pay, about: "Runs payroll.runs.pay: the checks, the command and its one approval." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    { name: "follow", rpc: rpc_payroll_runs_show, about: "Reads the run until every slip this command pays is paid or escrowed, or its approval lapsed." },
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  surfaces: ["cli", "sdk", "react"],
  budget: budget("chain-submit"),
});
