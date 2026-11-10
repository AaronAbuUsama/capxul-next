// Payroll's Core SDK flows (A4). The agreement writes: one per write command, each preparing its write
// with one payroll rpc, having its one call signed, waiting for the person and the chain, and following
// the write to its end; the agreement reads (payroll agreement list and show, org payroll agreement list) are one rpc
// each and have no flow. Then Frappe HR's: one SDK method per HR command (below).
//
// Signing composes approvals' rpcs, as approvals asks every opener to: read the approval until it is
// sponsored, sign its digest (an agent with its own key; a person on the approval page the CLI opens),
// give the signature to the approval, which sends it once (K4), and follow the write to its end. With `--no-wait` a flow returns at the approval
// with the approval link and `capxul payment wait <approvalId>` as `next`.

import { budget, defineFlow, type Rpc } from "../../../../packages/book/src/index.ts";
import { component_core_sdk } from "../../shared/foundation.ts";
import { error_CANCELLED, error_TRANSACTION_FAILED, error_WRONG_STATE } from "../../shared/vocabulary.ts";
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
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../../approvals/signing.ts";
import {
  AcceptInput,
  AgreementRef,
  AssignmentRef,
  ChangeInput,
  Component,
  ComponentAddInput,
  ComponentChangeInput,
  ComponentListInput,
  ComponentRef,
  EmployeeEdit,
  EmployeeLeave,
  EmployeeRef,
  EndInput,
  Followed,
  HolderWriteReturns,
  MySlip,
  MySlipRef,
  MySlipsList,
  OfferInput,
  PayeeRef,
  SlipRef,
  SlipWithhold,
  StructureListed,
  StructurePageInput,
  StructureRef,
} from "./shapes.ts";
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
    id: `client.org.payroll.agreements.${verb}`,
    title,
    about:
      `${what} The holder's own Safe signs one Agreements call, sponsored by Capxul's paymaster; it is never a Director ` +
      "proposal. Returns the write's status, the approval, the agreement and its department, and `next` with `--no-wait`.",
    was: [`${SDK}/agreements.ts:61`, `${SDK}/agreements.ts:144`],
    component: component_core_sdk,
    sdk: `client.org(orgId).payroll.agreements.${verb}`,
    input,
    output: HolderWriteReturns,
    steps: [{ name: "prepare", rpc, about: `Runs ${rpc.id}: the checks, the write and its approval.` }, SPONSORED, SIGN, SUBMIT, WAIT, FOLLOW],
    errors: FLOW_ERRORS,
    calls: [],
    spans: [`sdk.client.org.payroll.agreements.${verb}`],
    budget: budget("chain-submit"),
  });

export const flow_client_org_payroll_agreements_offer = holderFlow(
  "offer",
  rpc_payroll_holders_offer,
  OfferInput,
  "Offer an agreement: prepare, sign the offer call, follow it on chain",
  "Offers a payee a salary, stream or retainer from a department's budget; once on chain the offer reserves its figure.",
);

export const flow_client_org_payroll_agreements_withdraw = holderFlow(
  "withdraw",
  rpc_payroll_holders_withdraw,
  AgreementRef,
  "Withdraw an offer: prepare, sign the withdrawal, follow it on chain",
  "Takes back an offer the payee has not accepted; its reservation frees once it lands.",
);

export const flow_client_org_payroll_agreements_change = holderFlow(
  "change",
  rpc_payroll_holders_change,
  ChangeInput,
  "Change a rate: prepare, sign the change, follow it on chain",
  "Raises a rate now, lowers it from a date, or with `cancel` cancels a waiting lowering.",
);

export const flow_client_org_payroll_agreements_pause = holderFlow(
  "pause",
  rpc_payroll_holders_pause,
  AgreementRef,
  "Pause an agreement: prepare, sign the pause, follow it on chain",
  "Stops pay building up on a running agreement; when done it gives the matching resume command.",
);

export const flow_client_org_payroll_agreements_resume = holderFlow(
  "resume",
  rpc_payroll_holders_resume,
  AgreementRef,
  "Resume an agreement: prepare, sign the resume, follow it on chain",
  "Starts pay building up again on a paused agreement; when done it says how many days the pause lasted.",
);

export const flow_client_org_payroll_agreements_end = holderFlow(
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

export const flow_client_me_payroll_agreements_accept = defineFlow({
  id: "client.me.payroll.agreements.accept",
  title: "Accept an offer: prepare, sign its exact terms hash, follow it on chain",
  about:
    "The payee accepts an offer at its exact terms hash from their own Safe, sponsored by Capxul's paymaster. Pay builds " +
    "up from the start date, or from the acceptance if the offer has none. " +
    PAYEE_ORG,
  was: [`${SDK}/payee-agreements.ts`, `${SDK}/organization-payee.ts`],
  component: component_core_sdk,
  sdk: "client.me.payroll.agreements.accept",
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
  spans: ["sdk.client.me.payroll.agreements.accept"],
  budget: budget("chain-submit"),
});

export const flow_client_me_payroll_agreements_collect = defineFlow({
  id: "client.me.payroll.agreements.collect",
  title: "Collect your pay: prepare, sign the collection, follow its payment",
  about:
    "Collects everything released as one payment from the payer's budget reservation. With nothing released it returns " +
    "`nothing_released` and the next release, and nothing is signed. Before the approval it shows the amount, the window " +
    "it covers and, when the payer allows it, the payslip; it follows the collection until its payment is on chain. " +
    PAYEE_ORG,
  was: [`${SDK}/payee-agreements.ts`, `${SDK}/organization-payee.ts`],
  component: component_core_sdk,
  sdk: "client.me.payroll.agreements.collect",
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
  spans: ["sdk.client.me.payroll.agreements.collect"],
  budget: budget("chain-submit"),
});

// ── Frappe HR's doctypes: one SDK method per command (payroll.hr-surface, payroll.command-flows) ──
//
// Every HR command of payroll.hr-surface calls exactly one of these methods, and each method serves one command
// (A4, the grammar's G7), on the CLI, the SDK (the FDE and any agent) and the web app. Each is one call of one
// payroll rpc, except `org hr employee leave`, which previews before it writes. Where one rpc serves several verbs (an
// Employee's status, a component's add, change, disable and enable, a slip's withhold and release), each verb is its
// own method that fixes what the verb means. A connected head never calls them: payroll's own head sync pulls the
// head's changes and runs (payroll.head-sync).

const HR_SURFACES = ["cli", "sdk", "react"] as const;

type HrFlow = {
  readonly sdk: string;
  readonly rpc: Rpc;
  readonly title: string;
  readonly about: string;
  readonly write: boolean;
  readonly input?: Schema.Top;
  readonly output?: Schema.Top;
  /** What the one call sends, where the method fixes part of the rpc's input. */
  readonly call?: string;
};

const hrFlow = (f: HrFlow) =>
  defineFlow({
    id: f.sdk.replace("(orgId)", ""),
    title: f.title,
    about: f.about,
    component: component_core_sdk,
    sdk: f.sdk,
    input: f.input ?? (f.rpc.input as Schema.Top),
    output: f.output ?? (f.rpc.output as Schema.Top),
    steps: [{ name: "call", rpc: f.rpc, about: f.call ?? `Runs ${f.rpc.id}.` }],
    errors: [],
    calls: [],
    spans: [`rpc.${f.sdk.replace("(orgId)", "")}`],
    surfaces: [...HR_SURFACES],
    budget: budget(f.write ? "write" : "read"),
  });

// Employees

// Salary components

/** How a catalog list pages: one read of payroll.structures.list, then one page of it (payroll.command-fit). */
const CATALOG_PAGE =
  "at most `limit` (1 to 100, 25 by default) after `after`, a cursor it gave (INVALID_INPUT otherwise), and " +
  "`nextCursor`, null on the last page.";

// Salary structures and assignments

// Payroll runs (paying one is staged.ts's flow, client.org.payroll.runs.pay)

// Payslips: the Organization's hold on one, and the payee's own

