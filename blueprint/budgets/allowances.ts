// The allowances area: a spending allowance is a small budget under a hat its wearers wear (v4,
// decision concepts.budgets). The Board makes one in one batch (its hat under the Board's top hat,
// its child budget under a parent, and the hat minted to its first wearer); its amount, wearers and
// closing are the generic budget writes (tree.ts, offices.ts). Its reads show its budget and hat.
// Manage allowances is no longer an allowance: it is the People hat, granted by board (`org member
// grant`), and the Zodiac Roles module of allowances is gone, so `org allowance replace` has no rpc.

import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_budgets, contract_hats, integration_chain_rpc, integration_indexer } from "../shared/external.ts";
import { error_CHILDREN_EXCEED_PARENT, error_INVALID_INPUT, error_TOKEN_NOT_SUPPORTED } from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_chain_budgets, table_chain_hats, table_hat_wearers } from "../indexing/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget, machine_budget_change, table_budget_changes, table_budgets } from "./data.ts";
import { AllowanceCreated, AllowanceGetInput, AllowanceLine, AllowanceListInput, AllowancePage, CreateAllowanceInput } from "./shapes.ts";
import { BIRTH, GUARD, READ_ERRORS, WRITE_ERRORS, WRITE_READS } from "./departments.ts";
import { Schema } from "effect";

const PERM = "packages/backend/src/permissions/allowances";
const AS_IS = "docs/as-is/archive/permissions/data.ts";

/** What both allowance reads read: Capxul's name for each allowance, the chain's numbers, and who wears its hat. */
const ALLOWANCE_READS = [
  table_org_members,
  table_principals,
  table_organizations,
  table_budgets,
  table_budget_changes,
  table_chain_budgets,
  table_hat_wearers,
] as const;

const SHOWS =
  "Each allowance shows its budget's amount per period, what it spent and committed and what is left this period " +
  "(`Budgets.budgetOf` and `leftOf` at the latest block: an allowance has left what `leftOf` reads), when it is whole " +
  "again (the start of the next calendar period, by the chain's clock, `getBlock`), whether it is closed, its hat and the " +
  "hat's wearers (indexing; a member by email, any other Safe by its address with no invented name). What it paid into " +
  "a claim escrow counts as spent, and stays spent if it is taken back: the money returns to the company Safe, not the room (budgets.claim-escrows). A proposed one " +
  "shows its planned amount and no chain id. Each read reads only its own allowances' budgets, so it does not grow with " +
  "the Organization's other budgets. Nothing is written.";

export const rpc_budgets_allowances_create = defineRpc({
  id: "budgets.allowances.create",
  title: "Prepare a spending allowance and its first wearer",
  about:
    GUARD + " The caller must wear the Director hat: the Board signs (ROLE_PERMISSION_DENIED; nothing is saved). The " +
    "policy is a name, an asset (one the deployment admits, else TOKEN_NOT_SUPPORTED), an amount above 0 and a period. A " +
    "per-payment cap, a recipient rule, or anything allowed but paying has no v4 form and is INVALID_INPUT. The parent is " +
    "the budget named, or the one open top budget in that asset with that period (none or several is INVALID_INPUT); it " +
    "must be the Organization's and active, in the same asset and period (a child takes its parent's: INVALID_INPUT), open " +
    "with every budget above it and fewer than eight deep (WRONG_STATE), with the amount left to give (CHILDREN_EXCEED_" +
    "PARENT, naming what is left), from `Budgets.budgetOf` and `leftOf` now. `assignTo` (an email, or an agent's @handle) must be a current member whose " +
    "Safe is set up (INVALID_INPUT). No other create may wait under the Board's top hat: it would take the same hat id " +
    "(WRONG_STATE, naming it). The hat id is planned from the top hat's `Hats.viewHat` `lastHatId` at the latest block. " +
    "The calls, one Board batch: `Hats.createHat(boardTopHat, details, 1, safe, safe, true, image)`, its details " +
    "beginning `allowance:<key>` (board.people-hat-role-conflict), " +
    "`Budgets.createChildBudget(parent, amount, hat)` and, with `assignTo`, `Hats.mintHat(hat, memberSafe)`. " + BIRTH +
    " The allowance is born proposed (budget.propose) with no chain id; the same request key answers it active with its " +
    "id once the proposal executes.",
  was: [`${PERM}/operations/create.ts:51`, `${PERM}/rules.ts:24`, `${PERM}/writes.ts:92`, `${AS_IS}:400`],
  concept: concept_budgets,
  kind: "action",
  who: "A Director of the Organization: the Board signs.",
  input: CreateAllowanceInput,
  output: AllowanceCreated,
  errors: [...WRITE_ERRORS, error_CHILDREN_EXCEED_PARENT, error_TOKEN_NOT_SUPPORTED],
  reads: [...WRITE_READS, table_chain_hats],
  writes: [table_budgets, table_budget_changes],
  drives: [machine_budget.t.propose, machine_budget_change.t.propose],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_indexer.c.head],
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_hats.f.viewHat,
    contract_hats.f.createHat,
    contract_budgets.f.createChildBudget,
    contract_hats.f.mintHat,
  ],
  spans: ["rpc.budgets.allowances.create"],
  budget: budget("chain-read"),
});

export const rpc_budgets_allowances_list = defineRpc({
  id: "budgets.allowances.list",
  title: "List the Organization's allowances as the chain answers now",
  about:
    GUARD + " A page of the Organization's allowances, active and proposed, each listed once in id order, so `after` (the " +
    "last id of the page before) advances; `limit` is 1 to 100, 25 by default. " + SHOWS,
  was: [`${PERM}/operations/list.ts:1`, `${PERM}/reads/worn.ts:27`, `${PERM}/reads/left.ts:14`],
  concept: concept_budgets,
  kind: "action",
  who: "Any member of the Organization.",
  input: AllowanceListInput,
  output: AllowancePage,
  errors: [...READ_ERRORS, error_INVALID_INPUT],
  reads: [...ALLOWANCE_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.leftOf],
  spans: ["rpc.budgets.allowances.list"],
  budget: budget("chain-read"),
});

export const rpc_budgets_allowances_get = defineRpc({
  id: "budgets.allowances.get",
  title: "Show one allowance as the chain answers now",
  about:
    GUARD + " The allowance by its `allowance_` id or key; an id that is not one in form is INVALID_INPUT, and one that " +
    "names no allowance of this Organization answers null (the CLI refuses it INVALID_INPUT). " + SHOWS,
  was: [`${PERM}/reads/left.ts:14`, `${PERM}/views.ts:1`],
  concept: concept_budgets,
  kind: "action",
  who: "Any member of the Organization.",
  input: AllowanceGetInput,
  output: Schema.NullOr(AllowanceLine),
  errors: [...READ_ERRORS, error_INVALID_INPUT],
  reads: [...ALLOWANCE_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.leftOf],
  spans: ["rpc.budgets.allowances.get"],
  budget: budget("chain-read"),
});
