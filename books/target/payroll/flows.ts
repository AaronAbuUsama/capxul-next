// Payroll's Core SDK flows (A4): one per write command. Each prepares its write with one payroll rpc,
// has its one call signed, waits for the person and the chain, and follows the write to its end. The
// CLI calls exactly the flow's SDK method; the reads (agreement list and show, org agreement list)
// are one rpc each and have no flow.
//
// Signing: a person signs on the approval page, which the CLI opens and which hands the signature to
// the approval; an agent signs the approval's hash with its own key and hands it over the same way.
// Either way approvals sends the operation once (K4). With `--no-wait` a flow returns at the approval
// with the approval link and `capxul payment wait <approvalId>` as `next`.

import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_TRANSACTION_FAILED } from "../shared/vocabulary.ts";
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
import { AcceptInput, AgreementRef, ChangeInput, EndInput, Followed, HolderWriteReturns, OfferInput, PayeeRef } from "./shapes.ts";
import { Schema } from "effect";

const SDK = "packages/sdk/src/payroll";

const SIGN = {
  name: "sign",
  local: "sign",
  about: "The approval's one call is signed by its owner: a person on the approval page the CLI opens, an agent with its own key.",
} as const;

const WAIT = {
  name: "wait",
  local: "wait",
  about: "wait.person for the signature, then wait.chain until the operation is on chain and indexed; `--no-wait` returns before it.",
} as const;

const FOLLOW = {
  name: "follow",
  rpc: rpc_payroll_writes_watch,
  about: "Subscribed until the agreement's process lands, fails or abandons the write; returns the agreement as it now stands.",
} as const;

/** A declined approval ends the flow CANCELLED; a write the chain refused or another write beat, TRANSACTION_FAILED. */
const FLOW_ERRORS = [error_CANCELLED, error_TRANSACTION_FAILED];

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
    steps: [{ name: "prepare", rpc, about: `Runs ${rpc.id}: the checks, the write and its approval.` }, SIGN, WAIT, FOLLOW],
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
    SIGN,
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
    SIGN,
    WAIT,
    FOLLOW,
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: budget("chain-submit"),
});
