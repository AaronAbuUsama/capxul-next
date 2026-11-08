// Payroll's Core SDK flows (A4). The agreement writes: one per write command, each preparing its write
// with one payroll rpc, having its one call signed, waiting for the person and the chain, and following
// the write to its end; the agreement reads (agreement list and show, org agreement list) are one rpc
// each and have no flow. Then Frappe HR's: one SDK method per HR command (below).
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
import { rpc_payroll_employees_add, rpc_payroll_employees_change, rpc_payroll_employees_get, rpc_payroll_employees_list } from "./employees.ts";
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

// ── Frappe HR's doctypes: one SDK method per command (payroll.hr-surface, payroll.command-flows) ──
//
// Every HR command of payroll.hr-surface calls exactly one of these methods, and each method serves one command
// (A4, the grammar's G7), on the CLI, the SDK (the FDE and any agent) and the web app. Each is one call of one
// payroll rpc, except `org employee leave`, which previews before it writes. Where one rpc serves several verbs (an
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
    spans: [],
    surfaces: [...HR_SURFACES],
    budget: budget(f.write ? "write" : "read"),
  });

const EmployeeOut = rpc_payroll_employees_change.output as Schema.Top;

// Employees

export const flow_client_org_employees_add = hrFlow({
  sdk: "client.org(orgId).employees.add",
  rpc: rpc_payroll_employees_add,
  title: "Add an Employee",
  about:
    "`org employee add`: adds a person, by mailbox, handle or Party, as an active Employee paid from a department; a " +
    "new hire needs no account. Was `client.org(orgId).payroll.employees.add`.",
  write: true,
});
export const flow_client_org_employees_change = hrFlow({
  sdk: "client.org(orgId).employees.change",
  rpc: rpc_payroll_employees_change,
  title: "Change an Employee's fields",
  about: "`org employee change`: changes an Employee's department, designation or type; never their status, Party or pay mailbox.",
  write: true,
  input: EmployeeEdit,
  call: "Runs payroll.employees.change with the fields given and no status.",
});
export const flow_client_org_employees_get = hrFlow({
  sdk: "client.org(orgId).employees.get",
  rpc: rpc_payroll_employees_get,
  title: "Read an Employee",
  about: "`org employee get`: one Employee, with their status and the structure assignment that pays them today.",
  write: false,
});
export const flow_client_org_employees_list = hrFlow({
  sdk: "client.org(orgId).employees.list",
  rpc: rpc_payroll_employees_list,
  title: "List the Employees",
  about: "`org employee list`: the Organization's Employees, with whether each has claimed their account. Was `client.org(orgId).payroll.employees.list`.",
  write: false,
});

const statusFlow = (verb: "suspend" | "deactivate" | "reinstate", status: string, title: string, what: string) =>
  hrFlow({
    sdk: `client.org(orgId).employees.${verb}`,
    rpc: rpc_payroll_employees_change,
    title,
    about: `\`org employee ${verb}\`: ${what}`,
    write: true,
    input: EmployeeRef,
    output: EmployeeOut,
    call: `Runs payroll.employees.change with status \`${status}\` and nothing else.`,
  });

export const flow_client_org_employees_suspend = statusFlow(
  "suspend",
  "suspended",
  "Suspend an Employee",
  "an active Employee becomes suspended (employee.suspend), and no new run takes them.",
);
export const flow_client_org_employees_deactivate = statusFlow(
  "deactivate",
  "inactive",
  "Deactivate an Employee",
  "an active or suspended Employee becomes inactive (employee.deactivate): kept on the books, paid by no run.",
);
export const flow_client_org_employees_reinstate = statusFlow(
  "reinstate",
  "active",
  "Reinstate an Employee",
  "an inactive or suspended Employee becomes active again (employee.reinstate), and runs take them.",
);

export const flow_client_org_employees_leave = defineFlow({
  id: "client.org.employees.leave",
  title: "Let an Employee go on a day, after a preview",
  about:
    "`org employee leave`: the Employee leaves on `relievingDate`, their last day worked, and this is final for the " +
    "record (a person who comes back is a new Employee, payroll.one-live-employee). At a terminal it first shows who " +
    "leaves, from when, the assignment that stops and any withheld slip that stays owed, and asks; a decline ends it " +
    "CANCELLED with nothing written, and `confirm` (`--confirm`) answers yes in a script, which without it is the " +
    "CLI's CLI_USAGE (vocabulary.declined-preview-cancelled).",
  component: component_core_sdk,
  sdk: "client.org(orgId).employees.leave",
  input: EmployeeLeave,
  output: EmployeeOut,
  steps: [
    { name: "read", rpc: rpc_payroll_employees_get, about: "Only at a terminal without `confirm`: the Employee and the assignment that pays them, for the preview." },
    { name: "confirm", local: "prompt", about: "Only at a terminal without `confirm`: shows what leaving does and asks; a decline is CANCELLED and writes nothing." },
    { name: "leave", rpc: rpc_payroll_employees_change, about: "Runs payroll.employees.change with status `left` and the relieving date." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  surfaces: [...HR_SURFACES],
  budget: budget("write"),
});

// Salary components

const ComponentOut = rpc_payroll_structures_component.output as Schema.Top;

export const flow_client_org_payroll_components_add = hrFlow({
  sdk: "client.org(orgId).payroll.components.add",
  rpc: rpc_payroll_structures_component,
  title: "Add a salary component",
  about: "`org payroll component add`: adds an earning, deduction or employer contribution, with its amount or Frappe formula.",
  write: true,
  input: ComponentAddInput,
  output: ComponentOut,
  call: "Runs payroll.structures.component with no `componentId`: an add.",
});
export const flow_client_org_payroll_components_change = hrFlow({
  sdk: "client.org(orgId).payroll.components.change",
  rpc: rpc_payroll_structures_component,
  title: "Change a salary component",
  about: "`org payroll component change`: changes the fields given; structures already made keep their own rows.",
  write: true,
  input: ComponentChangeInput,
  output: ComponentOut,
  call: "Runs payroll.structures.component with the component as `componentId` and only the fields given.",
});
/** How a catalog list pages: one read of payroll.structures.list, then one page of it (payroll.command-fit). */
const CATALOG_PAGE =
  "at most `limit` (1 to 100, 25 by default) after `after`, a cursor it gave (INVALID_INPUT otherwise), and " +
  "`nextCursor`, null on the last page.";

export const flow_client_org_payroll_components_list = hrFlow({
  sdk: "client.org(orgId).payroll.components.list",
  rpc: rpc_payroll_structures_list,
  title: "List the salary components",
  about: "`org payroll component list`: the Organization's salary components, enabled first, then by type and name, a page at a time.",
  write: false,
  input: ComponentListInput,
  output: Schema.Struct({ items: Schema.Array(Component), nextCursor: Schema.NullOr(Schema.String) }),
  call: `Runs payroll.structures.list once and pages its components, a short catalog, enabled first, then by type and name: ${CATALOG_PAGE}`,
});
export const flow_client_org_payroll_components_disable = hrFlow({
  sdk: "client.org(orgId).payroll.components.disable",
  rpc: rpc_payroll_structures_component,
  title: "Disable a salary component",
  about: "`org payroll component disable`: no new structure takes the component; structures that have it keep it.",
  write: true,
  input: ComponentRef,
  output: ComponentOut,
  call: "Runs payroll.structures.component with the component as `componentId` and `disabled` true.",
});
export const flow_client_org_payroll_components_enable = hrFlow({
  sdk: "client.org(orgId).payroll.components.enable",
  rpc: rpc_payroll_structures_component,
  title: "Enable a salary component",
  about: "`org payroll component enable`: new structures may take a disabled component again.",
  write: true,
  input: ComponentRef,
  output: ComponentOut,
  call: "Runs payroll.structures.component with the component as `componentId` and `disabled` false.",
});

// Salary structures and assignments

export const flow_client_org_payroll_structures_create = hrFlow({
  sdk: "client.org(orgId).payroll.structures.create",
  rpc: rpc_payroll_structures_create,
  title: "Create a salary structure",
  about: "`org payroll structure create`: a submitted salary structure from components, optionally replacing one it amends.",
  write: true,
});
export const flow_client_org_payroll_structures_cancel = hrFlow({
  sdk: "client.org(orgId).payroll.structures.cancel",
  rpc: rpc_payroll_structures_cancel,
  title: "Cancel a salary structure",
  about: "`org payroll structure cancel`: cancels a structure no submitted assignment names; an assignment is `unassign`'s.",
  write: true,
  input: StructureRef,
  call: "Runs payroll.structures.cancel with `structureId` only.",
});
export const flow_client_org_payroll_structures_assign = hrFlow({
  sdk: "client.org(orgId).payroll.structures.assign",
  rpc: rpc_payroll_structures_assign,
  title: "Assign a salary structure",
  about: "`org payroll structure assign`: a structure pays an Employee from a day, on a base, from a department's budget.",
  write: true,
});
export const flow_client_org_payroll_structures_unassign = hrFlow({
  sdk: "client.org(orgId).payroll.structures.unassign",
  rpc: rpc_payroll_structures_cancel,
  title: "Cancel a structure assignment",
  about: "`org payroll structure unassign`: cancels an assignment no live slip names and no agreement mirrors.",
  write: true,
  input: AssignmentRef,
  call: "Runs payroll.structures.cancel with `assignmentId` only.",
});
export const flow_client_org_payroll_structures_list = hrFlow({
  sdk: "client.org(orgId).payroll.structures.list",
  rpc: rpc_payroll_structures_list,
  title: "List structures and assignments",
  about:
    "`org payroll structure list`: the submitted structures by name, each with its rows and the assignments that name " +
    "it; with `--employee`, only the structures assigned to that Employee, each with their assignments alone.",
  write: false,
  input: StructurePageInput,
  output: Schema.Struct({ items: Schema.Array(StructureListed), nextCursor: Schema.NullOr(Schema.String) }),
  call: `Runs payroll.structures.list once, with \`employeeId\` when given, and pages its structures by name, each with its assignments: ${CATALOG_PAGE}`,
});

// Payroll runs (paying one is staged.ts's flow, client.org.payroll.runs.pay)

export const flow_client_org_payroll_runs_create = hrFlow({
  sdk: "client.org(orgId).payroll.runs.create",
  rpc: rpc_payroll_runs_create,
  title: "Draft a payroll run",
  about: "`org payroll run create`: a department's run for a period, every slip worked out: gross, deductions and net.",
  write: true,
});
export const flow_client_org_payroll_runs_submit = hrFlow({
  sdk: "client.org(orgId).payroll.runs.submit",
  rpc: rpc_payroll_runs_submit,
  title: "Submit a payroll run",
  about: "`org payroll run submit`: a drafted run's slips are fixed and owed, each payslip stored, its accrual posted.",
  write: true,
});
export const flow_client_org_payroll_runs_cancel = hrFlow({
  sdk: "client.org(orgId).payroll.runs.cancel",
  rpc: rpc_payroll_runs_cancel,
  title: "Cancel a payroll run",
  about: "`org payroll run cancel`: cancels a run nothing of which was paid, with its slips.",
  write: true,
});
export const flow_client_org_payroll_runs_list = hrFlow({
  sdk: "client.org(orgId).payroll.runs.list",
  rpc: rpc_payroll_runs_list,
  title: "List payroll runs",
  about: "`org payroll run list`: the Organization's runs by department and period, with the next step for each.",
  write: false,
});
export const flow_client_org_payroll_runs_get = hrFlow({
  sdk: "client.org(orgId).payroll.runs.get",
  rpc: rpc_payroll_runs_show,
  title: "Read a payroll run",
  about: "`org payroll run get`: one run with its slips and, once paid, the settled facts on each. Was `.runs.show`.",
  write: false,
});

// Payslips: the Organization's hold on one, and the payee's own

export const flow_client_org_payslips_withhold = hrFlow({
  sdk: "client.org(orgId).payslips.withhold",
  rpc: rpc_payroll_runs_withhold,
  title: "Withhold a payslip from its run's payment",
  about: "`org payslip withhold`: holds a submitted slip out of its run's payment, with a reason. Was `.payroll.runs.withhold`.",
  write: true,
  input: SlipWithhold,
  call: "Runs payroll.runs.withhold with `withhold` true and the reason.",
});
export const flow_client_org_payslips_release = hrFlow({
  sdk: "client.org(orgId).payslips.release",
  rpc: rpc_payroll_runs_withhold,
  title: "Release a withheld payslip",
  about: "`org payslip release`: a withheld slip is owed again, paid with its run's next payment.",
  write: true,
  input: SlipRef,
  call: "Runs payroll.runs.withhold with `withhold` false.",
});

export const flow_client_me_payslips_list = hrFlow({
  sdk: "client.me.payslips.list",
  rpc: rpc_payroll_slips_mine,
  title: "List your payslips",
  about:
    "`payslip list`: the payslips that pay your Safe, from every Organization, run slips and agreement collections " +
    "alike, a page at a time; `--employer` keeps one payer's. Was `client.me.payslips`.",
  write: false,
  input: MySlipsList,
  call: "Runs payroll.slips.mine, the `--employer` handle as `orgId`.",
});
export const flow_client_me_payslips_get = hrFlow({
  sdk: "client.me.payslips.get",
  rpc: rpc_payroll_slips_mine,
  title: "Read one of your payslips",
  about: "`payslip get`: one payslip that pays your Safe, with its rows, totals, payer and, once paid, its payment.",
  write: false,
  input: MySlipRef,
  output: MySlip,
  call: "Runs payroll.slips.mine with `salarySlipId` and returns its one item.",
});
