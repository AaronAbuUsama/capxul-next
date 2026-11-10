// The changes area: reading one budget change back, as the SDK flows do while they follow a change
// to its end. The change's durable process is in processes.ts.

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_org_members } from "../organizations/data.ts";
import { table_budget_changes, table_budgets } from "./data.ts";
import { ChangeGetInput, ChangeView } from "./shapes.ts";

export const rpc_budgets_changes_get = defineRpc({
  id: "budgets.changes.get",
  title: "Read one budget change as it stands",
  about:
    "The session's principal must hold a current Seat of the Organization (ROLE_PERMISSION_DENIED). The change by its " +
    "`bch_` id, one of this Organization's (INVALID_INPUT otherwise): its kind, state and outcome, its budget and that " +
    "budget's chain id once bound, the caller's approval and the Board proposal that carries it. `status` reads " +
    "`awaiting_approval` or `awaiting_approvals` while it is proposed, `executed` once applied, and the outcome once " +
    "abandoned. One indexed read of Capxul's own rows; it reads nothing from the chain.",
  was: ["packages/backend/src/payroll/departments/operations/read.ts:1", "packages/backend/src/permissions/allowances/operations/load-command.ts:1"],
  concept: concept_budgets,
  kind: "query",
  who: "Any member of the Organization.",
  input: ChangeGetInput,
  output: ChangeView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_budget_changes, table_budgets],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.budgets.changes.get"],
  budget: budget("read"),
});
