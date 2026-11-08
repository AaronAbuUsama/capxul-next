// Payroll's Core SDK flows (A4): one per write command. Each prepares its write with one payroll rpc,
// has its one call signed, waits for the person and the chain, and follows the write to its end. The
// CLI calls exactly the flow's SDK method; the reads (agreement list and show, org agreement list)
// are one rpc each and have no flow.
//
// Signing composes approvals' rpcs, as approvals asks every opener to: read the approval until it is
// sponsored, sign its digest (an agent with its own key; a person on the approval page the CLI opens),
// give the signature to the approval, which sends it once (K4), and follow the write to its end. With `--no-wait` a flow returns at the approval
// with the approval link and `capxul payment wait <approvalId>` as `next`.

import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_TRANSACTION_FAILED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_offer,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect } from "./payees.ts";
import { rpc_payroll_writes_watch } from "./writes.ts";
import { rpc_payroll_employees_add, rpc_payroll_employees_change, rpc_payroll_employees_list } from "./employees.ts";
import {
  rpc_payroll_structures_assign,
  rpc_payroll_structures_cancel,
  rpc_payroll_structures_component,
  rpc_payroll_structures_create,
  rpc_payroll_structures_list,
} from "./structures.ts";
import {
  rpc_payroll_runs_cancel,
  rpc_payroll_runs_create,
  rpc_payroll_runs_list,
  rpc_payroll_runs_show,
  rpc_payroll_runs_submit,
  rpc_payroll_runs_withhold,
} from "./runs.ts";
import { rpc_payroll_slips_mine } from "./slips.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { AcceptInput, AgreementRef, ChangeInput, EndInput, Followed, HolderWriteReturns, OfferInput, PayeeRef } from "./shapes.ts";
import { Schema } from "effect";

const SDK = "packages/sdk/src/payroll";

export const SPONSORED = {
  name: "sponsored",
  rpc: rpc_approvals_signing_get,
  about: "The write's approval, live, until approvals has sponsored it (`pending`, with its digest) or it ends.",
} as const;

export const SIGN = {
  name: "sign",
  local: "sign",
  about: "An agent signs the digest with its own key; a person is handed the approval page (client.approvals.sign), which signs there.",
} as const;

export const SUBMIT = {
  name: "submit",
  rpc: rpc_approvals_signing_sign,
  about: "An agent's signature goes to its approval, which approvals sends once; a person's page submits its own.",
} as const;

export const WAIT = {
  name: "wait",
  local: "wait",
  about: "wait.person for the signature, then wait.chain until the operation is on chain and indexed; `--no-wait` returns before it.",
} as const;

export const FOLLOW = {
  name: "follow",
  rpc: rpc_payroll_writes_watch,
  about: "Subscribed until the agreement's process lands, fails or abandons the write; returns the agreement as it now stands.",
} as const;

/**
 * How the write's carrier ended, as the frozen codes (approvals.machine; payroll.carrier-endings): a declined approval
 * ends the flow CANCELLED; one that expired unsent, WRONG_STATE; a write the chain refused, another write beat, or a
 * Board proposal that ran and failed (board's `fail`), TRANSACTION_FAILED.
 */
export const FLOW_ERRORS = [error_CANCELLED, error_WRONG_STATE, error_TRANSACTION_FAILED];

const holderFlow = (
  verb: string,
  rpc: Rpc,
  input: Schema.Top,
  title: string,
  what: string,
) =>
  defineFlow({
    id: `client.org.agreements.${verb}`,
    title,
    about:
      `${what} The holder's own Safe signs one Agreements call, sponsored by Capxul's paymaster; it is never a Director ` +
      "proposal. Returns the write's status, the approval, the agreement and its department, and `next` with `--no-wait`.",
    was: [`${SDK}/agreements.ts:61`, `${SDK}/agreements.ts:144`],
    component: component_core_sdk,
    sdk: `client.org(orgId).agreements.${verb}`,
    input,
    output: HolderWriteReturns,
    steps: [{ name: "prepare", rpc, about: `Runs ${rpc.id}: the checks, the write and its approval.` }, SPONSORED, SIGN, SUBMIT, WAIT, FOLLOW],
    errors: FLOW_ERRORS,
    calls: [],
    spans: [],
    budget: budget("chain-submit"),
  });

export const flow_client_org_agreements_offer = holderFlow(
  "offer",
  rpc_payroll_holders_offer,
  OfferInput,
  "Offer an agreement: prepare, sign the offer call, follow it on chain",
  "Offers a payee a salary, stream or retainer from a department's budget; once on chain the offer reserves its figure.",
);

export const flow_client_org_agreements_withdraw = holderFlow(
  "withdraw",
  rpc_payroll_holders_withdraw,
  AgreementRef,
  "Withdraw an offer: prepare, sign the withdrawal, follow it on chain",
  "Takes back an offer the payee has not accepted; its reservation frees once it lands.",
);

export const flow_client_org_agreements_change = holderFlow(
  "change",
  rpc_payroll_holders_change,
  ChangeInput,
  "Change a rate: prepare, sign the change, follow it on chain",
  "Raises a rate now, lowers it from a date, or with `cancel` cancels a waiting lowering.",
);

export const flow_client_org_agreements_pause = holderFlow(
  "pause",
  rpc_payroll_holders_pause,
  AgreementRef,
  "Pause an agreement: prepare, sign the pause, follow it on chain",
  "Stops pay building up on a running agreement; when done it gives the matching resume command.",
);

export const flow_client_org_agreements_resume = holderFlow(
  "resume",
  rpc_payroll_holders_resume,
  AgreementRef,
  "Resume an agreement: prepare, sign the resume, follow it on chain",
  "Starts pay building up again on a paused agreement; when done it says how many days the pause lasted.",
);

export const flow_client_org_agreements_end = holderFlow(
  "end",
  rpc_payroll_holders_end,
  EndInput,
  "End an agreement: prepare, sign the end, follow it on chain",
  "Sets the last day an accepted agreement pays; pay stops at 00:00 UTC the day after.",
);

// ── the payee ───────────────────────────────────────────────────────────────────────────────

const PAYEE_ORG =
  "With `orgId`, the payee Organization's Safe acts through a Board proposal: the caller signs their own approval of it, " +
  "and the flow follows the write only when that approval executes the proposal (a 1-of-N Board); otherwise it returns " +
  "`awaiting_approval` with the proposal, which `capxul org proposal wait` follows.";

export const flow_client_me_agreements_accept = defineFlow({
  id: "client.me.agreements.accept",
  title: "Accept an offer: prepare, sign its exact terms hash, follow it on chain",
  about:
    "The payee accepts an offer at its exact terms hash from their own Safe, sponsored by Capxul's paymaster. Pay builds " +
    "up from the start date, or from the acceptance if the offer has none. " +
    PAYEE_ORG,
  was: [`${SDK}/payee-agreements.ts`, `${SDK}/organization-payee.ts`],
  component: component_core_sdk,
  sdk: "client.me.agreements.accept",
  input: AcceptInput,
  output: Schema.Struct({
    status: Schema.String,
    approvalId: Schema.String,
    agreement: Followed.fields.agreement,
    next: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  steps: [
    { name: "prepare", rpc: rpc_payroll_payees_accept, about: "Runs payroll.payees.accept: the checks, the write and its approval or Board proposal." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    FOLLOW,
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
});

export const flow_client_me_agreements_collect = defineFlow({
  id: "client.me.agreements.collect",
  title: "Collect your pay: prepare, sign the collection, follow its payment",
  about:
    "Collects everything released as one payment from the payer's budget reservation. With nothing released it returns " +
    "`nothing_released` and the next release, and nothing is signed. Before the approval it shows the amount, the window " +
    "it covers and, when the payer allows it, the payslip; it follows the collection until its payment is on chain. " +
    PAYEE_ORG,
  was: [`${SDK}/payee-agreements.ts`, `${SDK}/organization-payee.ts`],
  component: component_core_sdk,
  sdk: "client.me.agreements.collect",
  input: PayeeRef,
  output: Schema.Struct({
    status: Schema.Literals(["settled", "submitted", "nothing_released", "awaiting_approval"]),
    collected: Schema.String,
    payment: Followed.fields.payment,
    agreement: Followed.fields.agreement,
    nextReleaseAt: Schema.NullOr(Schema.String),
  }),
  steps: [
    { name: "prepare", rpc: rpc_payroll_payees_collect, about: "Runs payroll.payees.collect: nothing released ends the flow here, with nothing signed." },
    SPONSORED,
    SIGN,
    SUBMIT,
    WAIT,
    FOLLOW,
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
});

// ── Frappe HR's doctypes ────────────────────────────────────────────────────────────────────
//
// One flow per HR rpc, each one call. They serve the Organization's own agent (its Forward Deployed
// Engineer, aaron.fde-agent), any agent or person on the SDK, and the web app. A connected head never calls
// them: payroll's own head sync pulls the head's changes and runs (payroll.head-sync). They implement no
// frozen operation, so they name their surfaces; their CLI commands come with the payroll operations pass
// (payroll.hr-surface).

const HR_SURFACES = ["sdk", "react"] as const;

const oneCall = (sdk: string, rpc: Rpc, title: string, about: string, write: boolean, surfaces: readonly ("sdk" | "react")[] = HR_SURFACES) =>
  defineFlow({
    id: sdk.replace("(orgId)", ""),
    title,
    about,
    component: component_core_sdk,
    sdk,
    input: rpc.input as Schema.Top,
    output: rpc.output as Schema.Top,
    steps: [{ name: "call", rpc, about: `Runs ${rpc.id}.` }],
    errors: [],
    calls: [],
    spans: [],
    surfaces: [...surfaces],
    budget: budget(write ? "write" : "read"),
  });

export const flow_client_org_payroll_employees_add = oneCall(
  "client.org(orgId).payroll.employees.add",
  rpc_payroll_employees_add,
  "Add an Employee",
  "Adds a person, by mailbox, handle or Party, as an Employee; a new hire needs no account. For the FDE agent, any agent and the web app.",
  true,
);
export const flow_client_org_payroll_employees_change = oneCall(
  "client.org(orgId).payroll.employees.change",
  rpc_payroll_employees_change,
  "Change an Employee",
  "Changes an Employee's department, designation, type or status, including letting them go on a day.",
  true,
);
export const flow_client_org_payroll_employees_list = oneCall(
  "client.org(orgId).payroll.employees.list",
  rpc_payroll_employees_list,
  "List the Employees",
  "Lists the Organization's Employees, with whether each has claimed their account.",
  false,
);
export const flow_client_org_payroll_structures_component = oneCall(
  "client.org(orgId).payroll.structures.component",
  rpc_payroll_structures_component,
  "Add or change a salary component",
  "Adds or changes an earning, deduction or employer contribution, with its amount or Frappe formula.",
  true,
);
export const flow_client_org_payroll_structures_create = oneCall(
  "client.org(orgId).payroll.structures.create",
  rpc_payroll_structures_create,
  "Create a salary structure",
  "Creates a submitted salary structure from components, optionally replacing an earlier one.",
  true,
);
export const flow_client_org_payroll_structures_assign = oneCall(
  "client.org(orgId).payroll.structures.assign",
  rpc_payroll_structures_assign,
  "Assign a salary structure",
  "Assigns a structure to an Employee from a day, on a base, paid from a department's budget.",
  true,
);
export const flow_client_org_payroll_structures_cancel = oneCall(
  "client.org(orgId).payroll.structures.cancel",
  rpc_payroll_structures_cancel,
  "Cancel a structure or assignment",
  "Cancels a structure nothing is assigned to, or an assignment no live slip names.",
  true,
);
export const flow_client_org_payroll_structures_list = oneCall(
  "client.org(orgId).payroll.structures.list",
  rpc_payroll_structures_list,
  "List components, structures and assignments",
  "Lists the Organization's salary components, structures and assignments.",
  false,
);
export const flow_client_org_payroll_runs_create = oneCall(
  "client.org(orgId).payroll.runs.create",
  rpc_payroll_runs_create,
  "Draft a payroll run",
  "Drafts a department's run for a period with every slip worked out: gross, deductions and net.",
  true,
);
export const flow_client_org_payroll_runs_submit = oneCall(
  "client.org(orgId).payroll.runs.submit",
  rpc_payroll_runs_submit,
  "Submit a payroll run",
  "Submits a drafted run: its slips are fixed, owed, and each payslip is stored.",
  true,
);
export const flow_client_org_payroll_runs_withhold = oneCall(
  "client.org(orgId).payroll.runs.withhold",
  rpc_payroll_runs_withhold,
  "Withhold or release a slip",
  "Withholds one submitted slip from its run's payment, or releases it.",
  true,
);
export const flow_client_org_payroll_runs_cancel = oneCall(
  "client.org(orgId).payroll.runs.cancel",
  rpc_payroll_runs_cancel,
  "Cancel a payroll run",
  "Cancels a run nothing of which was paid, with its slips.",
  true,
);
export const flow_client_org_payroll_runs_show = oneCall(
  "client.org(orgId).payroll.runs.show",
  rpc_payroll_runs_show,
  "Show a payroll run",
  "Shows one run with its slips and, once paid, the settled facts on each.",
  false,
);
export const flow_client_org_payroll_runs_list = oneCall(
  "client.org(orgId).payroll.runs.list",
  rpc_payroll_runs_list,
  "List payroll runs",
  "Lists the Organization's runs by department and period, with the next step for each.",
  false,
);
export const flow_client_me_payslips = oneCall(
  "client.me.payslips",
  rpc_payroll_slips_mine,
  "Your payslips",
  "Lists the payslips that pay your Safe, from every Organization, run slips and agreement collections alike.",
  false,
);
