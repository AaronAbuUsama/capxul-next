// The slips area: what an employee reads of their own pay. A person sees every payslip that pays their
// own Safe, from every Organization, run slips and agreement collections alike: Frappe HR's employee
// self-service, read through the slip's payee policy (payroll.payee-reads).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_organizations } from "../organizations/data.ts";
import { table_salary_slips } from "./data.ts";
import { MySlip, MySlipsInput } from "./shapes.ts";

export const rpc_payroll_slips_mine = defineRpc({
  id: "payroll.slips.mine",
  title: "Your payslips, from every Organization that pays you",
  about:
    "The slips that pay the caller's own Safe, newest first, each with its payer's name, rows, totals, status and, once " +
    "paid, the settled facts (payment id, transaction, block time) and its payslip document's id and hash for " +
    "`document render`. Draft and cancelled slips are not shown: nothing was owed. With `salarySlipId`, that one slip " +
    "(INVALID_INPUT for one that names no slip the caller may see; ROLE_PERMISSION_DENIED for one that pays another " +
    "Safe); with `orgId`, one payer's (INVALID_INPUT for a handle that names no Organization). A page holds at most " +
    "`limit` slips (1 to 100, 25 by default) and the cursor of the next, null on the last; `after` takes that cursor " +
    "(INVALID_INPUT for one this list did not give). It reads only.",
  was: ["/tmp/hrms/hrms/payroll/doctype/salary_slip/salary_slip.py:2361", "/tmp/hrms/hrms/hr/doctype/hr_settings"],
  concept: concept_payroll,
  kind: "query",
  who: "A signed-in person or agent, for the slips that pay its own Safe.",
  input: MySlipsInput,
  output: Schema.Struct({ items: Schema.Array(MySlip), nextCursor: Schema.NullOr(Schema.String) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_salary_slips, table_organizations],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
