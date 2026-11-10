// The offices area: who holds a budget's office. A budget's office is its hat: holding it lets its
// wearer spend, schedule, offer agreements and open teams from the budget (Budgets' rule). Adding a
// holder mints the hat to their Safe; removing one rules them out of it. `org department holder
// add|remove` and `org allowance assign|revoke` are the same two writes on two kinds of budget, so
// both pairs of flows call these rpcs (decision budgets.one-write-per-chain-call).
//
// Who signs is the hat's admin, as Hats has it: a hat under the Board's top hat (a top budget's
// office, every allowance's hat) is the Board's; a team's office hat sits under its parent's office
// hat, so the parent's office holder (or anyone above) signs with their own Safe.

import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_hats, integration_chain_rpc } from "../shared/external.ts";
import { error_ROLE_CONFLICT } from "../shared/vocabulary.ts";
import { table_chain_hats } from "../indexing/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget_change, table_budget_changes } from "./data.ts";
import { HolderInput, HolderPrepared } from "./shapes.ts";
import { BIRTH, GUARD, WRITE_ERRORS, WRITE_READS } from "./departments.ts";

const PAY = "packages/backend/src/payroll/departments/operations";
const PERM = "packages/backend/src/permissions/allowances/operations";

const WHO_ADMIN =
  "The admin of the budget's office hat: the Board, through a Director, for a top budget's office and every allowance; " +
  "for a team, the wearer of its parent's office hat or of any hat above it (their own Safe signs), or a Director.";

const ADMIN_RULE =
  "The budget is one Capxul made, by key or id (INVALID_INPUT otherwise: its hat's admin is unknown), active on chain " +
  "(WRONG_STATE while its create waits), with no other change of it waiting (WRONG_STATE, naming that proposal). Its " +
  "office hat's admin decides who signs: the Board's top hat needs a Director (a Board proposal); a parent's office hat " +
  "is signed by the caller's own Safe when it wears that hat or one above (`Hats.isWearerOfHat` now), else by the Board " +
  "when the caller is a Director; anyone else is ROLE_PERMISSION_DENIED, and nothing is saved.";

const HOLDER_TOUCHES = {
  writes: [table_budget_changes],
  drives: [machine_budget_change.t.propose],
  invokes: [procedure_board_propose, procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  spans: [],
} as const;

export const rpc_budgets_offices_add_holder = defineRpc({
  id: "budgets.offices.add-holder",
  title: "Prepare one more holder of a budget's office",
  about:
    GUARD + " " + ADMIN_RULE + " The member is named by email, or an agent already seated by its @handle (as " +
    "board.agent-officer-hats names one), and must be a current member whose Safe is set up " +
    "(INVALID_INPUT). A department's or team's office cannot go to a member who wears the People hat (ROLE_CONFLICT, " +
    "naming them); an allowance's hat can. A member whose Safe already wears the hat (`Hats.isWearerOfHat` now) is " +
    "WRONG_STATE. The calls: `Hats.changeHatMaxSupply(hat, supply + 1)` when every place on the hat is worn (its supply " +
    "and places from indexing's hats), then `Hats.mintHat(hat, memberSafe)`; nothing else. Every wearer spends from the " +
    "same budget. " + BIRTH,
  was: [`${PAY}/add-holder.ts:1`, `${PERM}/assign.ts:15`, "docs/as-is/archive/payroll/departments.ts:421"],
  concept: concept_budgets,
  kind: "action",
  who: WHO_ADMIN,
  input: HolderInput,
  output: HolderPrepared,
  errors: [...WRITE_ERRORS, error_ROLE_CONFLICT],
  reads: [...WRITE_READS, table_chain_hats],
  ...HOLDER_TOUCHES,
  chain: [contract_hats.f.isWearerOfHat, contract_hats.f.changeHatMaxSupply, contract_hats.f.mintHat],
  budget: budget("chain-read"),
});

export const rpc_budgets_offices_remove_holder = defineRpc({
  id: "budgets.offices.remove-holder",
  title: "Prepare taking one holder off a budget's office",
  about:
    GUARD + " " + ADMIN_RULE + " The holder is named by email or an agent's @handle, found by any Seat they held, so " +
    "one no longer a member can still be removed (INVALID_INPUT when no Seat ever had it). A Safe not wearing the hat " +
    "now is WRONG_STATE. Under the Board's top hat the one call is `Hats.setHatWearerStatus(hat, holderSafe, false, " +
    "true)`: the Safe, as eligibility, rules them out in good standing, burning the hat so it can be given again. " +
    "Under a parent's office hat, signed by that office holder, it is `Hats.transferHat(hat, holderSafe, companySafe)` " +
    "while the company Safe does not wear it (Hats refuses a second, AlreadyWearingHat); after that the removal is the " +
    "Board's `setHatWearerStatus` (a Director proposes; anyone else is WRONG_STATE naming the Board). The company " +
    "Safe's place is never listed as a holder. The budget, its agreements and other holders stay; once it executes " +
    "the holder acts for the budget no more, its claim escrows' take-back included (budgets.claim-escrows). " + BIRTH,
  was: [`${PAY}/remove-holder.ts:1`, `${PERM}/revoke.ts:1`, "docs/as-is/archive/payroll/departments.ts:444"],
  concept: concept_budgets,
  kind: "action",
  who: WHO_ADMIN,
  input: HolderInput,
  output: HolderPrepared,
  errors: [...WRITE_ERRORS],
  reads: [...WRITE_READS],
  ...HOLDER_TOUCHES,
  chain: [contract_hats.f.isWearerOfHat, contract_hats.f.setHatWearerStatus, contract_hats.f.transferHat],
  budget: budget("chain-read"),
});
