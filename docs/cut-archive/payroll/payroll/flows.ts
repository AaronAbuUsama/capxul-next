// Moved out of the built book by the cut, 10 November 2026, from books/target/payroll/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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

const EmployeeOut = rpc_payroll_employees_change.output as Schema.Top;

export const flow_client_org_hr_employees_add = hrFlow({
  sdk: "client.org(orgId).hr.employees.add",
  rpc: rpc_payroll_employees_add,
  title: "Add an Employee",
  about:
    "`org hr employee add`: adds a person, by mailbox, handle or Party, as an active Employee paid from a department; a " +
    "new hire needs no account. Was `client.org(orgId).payroll.employees.add`.",
  write: true,
});

export const flow_client_org_hr_employees_change = hrFlow({
  sdk: "client.org(orgId).hr.employees.change",
  rpc: rpc_payroll_employees_change,
  title: "Change an Employee's fields",
  about: "`org hr employee change`: changes an Employee's department, designation or type; never their status, Party or pay mailbox.",
  write: true,
  input: EmployeeEdit,
  call: "Runs payroll.employees.change with the fields given and no status.",
});

export const flow_client_org_hr_employees_get = hrFlow({
  sdk: "client.org(orgId).hr.employees.get",
  rpc: rpc_payroll_employees_get,
  title: "Read an Employee",
  about: "`org hr employee get`: one Employee, with their status and the structure assignment that pays them today.",
  write: false,
});

export const flow_client_org_hr_employees_list = hrFlow({
  sdk: "client.org(orgId).hr.employees.list",
  rpc: rpc_payroll_employees_list,
  title: "List the Employees",
  about: "`org hr employee list`: the Organization's Employees, with whether each has claimed their account. Was `client.org(orgId).payroll.employees.list`.",
  write: false,
});

const statusFlow = (verb: "suspend" | "deactivate" | "reinstate", status: string, title: string, what: string) =>
  hrFlow({
    sdk: `client.org(orgId).hr.employees.${verb}`,
    rpc: rpc_payroll_employees_change,
    title,
    about: `\`org hr employee ${verb}\`: ${what}`,
    write: true,
    input: EmployeeRef,
    output: EmployeeOut,
    call: `Runs payroll.employees.change with status \`${status}\` and nothing else.`,
  });

export const flow_client_org_hr_employees_suspend = statusFlow(
  "suspend",
  "suspended",
  "Suspend an Employee",
  "an active Employee becomes suspended (employee.suspend), and no new run takes them.",
);

export const flow_client_org_hr_employees_deactivate = statusFlow(
  "deactivate",
  "inactive",
  "Deactivate an Employee",
  "an active or suspended Employee becomes inactive (employee.deactivate): kept on the books, paid by no run.",
);

export const flow_client_org_hr_employees_reinstate = statusFlow(
  "reinstate",
  "active",
  "Reinstate an Employee",
  "an inactive or suspended Employee becomes active again (employee.reinstate), and runs take them.",
);

export const flow_client_org_hr_employees_leave = defineFlow({
  id: "client.org.hr.employees.leave",
  title: "Let an Employee go on a day, after a preview",
  about:
    "`org hr employee leave`: the Employee leaves on `relievingDate`, their last day worked, and this is final for the " +
    "record (a person who comes back is a new Employee, payroll.one-live-employee). At a terminal it first shows who " +
    "leaves, from when, the assignment that stops and any withheld slip that stays owed, and asks; a decline ends it " +
    "CANCELLED with nothing written, and `confirm` (`--confirm`) answers yes in a script, which without it is the " +
    "CLI's CLI_USAGE (vocabulary.declined-preview-cancelled).",
  component: component_core_sdk,
  sdk: "client.org(orgId).hr.employees.leave",
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

export const flow_client_org_payroll_payslips_withhold = hrFlow({
  sdk: "client.org(orgId).payroll.payslips.withhold",
  rpc: rpc_payroll_runs_withhold,
  title: "Withhold a payslip from its run's payment",
  about: "`org payroll payslip withhold`: holds a submitted slip out of its run's payment, with a reason. Was `.payroll.runs.withhold`.",
  write: true,
  input: SlipWithhold,
  call: "Runs payroll.runs.withhold with `withhold` true and the reason.",
});

export const flow_client_org_payroll_payslips_release = hrFlow({
  sdk: "client.org(orgId).payroll.payslips.release",
  rpc: rpc_payroll_runs_withhold,
  title: "Release a withheld payslip",
  about: "`org payroll payslip release`: a withheld slip is owed again, paid with its run's next payment.",
  write: true,
  input: SlipRef,
  call: "Runs payroll.runs.withhold with `withhold` false.",
});

export const flow_client_me_payroll_payslips_list = hrFlow({
  sdk: "client.me.payroll.payslips.list",
  rpc: rpc_payroll_slips_mine,
  title: "List your payslips",
  about:
    "`payroll payslip list`: the payslips that pay your Safe, from every Organization, run slips and agreement collections " +
    "alike, a page at a time; `--employer` keeps one payer's. Was `client.me.payslips`.",
  write: false,
  input: MySlipsList,
  call: "Runs payroll.slips.mine, the `--employer` handle as `orgId`.",
});

export const flow_client_me_payroll_payslips_get = hrFlow({
  sdk: "client.me.payroll.payslips.get",
  rpc: rpc_payroll_slips_mine,
  title: "Read one of your payslips",
  about: "`payroll payslip get`: one payslip that pays your Safe, with its rows, totals, payer and, once paid, its payment.",
  write: false,
  input: MySlipRef,
  output: MySlip,
  call: "Runs payroll.slips.mine with `salarySlipId` and returns its one item.",
});
