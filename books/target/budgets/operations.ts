// The target operation records of the 18 frozen operations budgets owns (OPERATION_OWNERS): the
// eleven `org department` commands of old payroll's departments area except `pay` (payments'), and
// the seven `org allowance` commands. Each is built from its frozen text, keeps its command, and is
// implemented by one Core SDK flow (a write) or one rpc (a read) (A4).
//
// Acceptance (P1): each frozen claim is kept word for word, with its test citation in `was`, unless
// it names a mechanism a black box cannot see or a pre-v4 contract path; then it is rewritten as an
// observable v4 claim, the old line first in `was`, and the rewrite is recorded in decisions.ts
// (budgets.acceptance-*). The "On v4", "On a v4 company" openings are stripped (P9). Retired lines
// stay `null`. Refusals follow the designed v4 text (P10) and the frozen top-level codes that still
// mean something on v4; each is reached from a world named in decision budgets.worlds.

import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CAPABILITY_UNAVAILABLE,
  error_CHILDREN_EXCEED_PARENT,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_org_allowances_assign,
  flow_client_org_allowances_change,
  flow_client_org_allowances_create,
  flow_client_org_allowances_replace,
  flow_client_org_allowances_revoke,
  flow_client_org_departments_ceiling_freeze,
  flow_client_org_departments_ceiling_set,
  flow_client_org_departments_ceiling_unfreeze,
  flow_client_org_departments_close,
  flow_client_org_departments_create,
  flow_client_org_departments_holders_add,
  flow_client_org_departments_holders_remove,
  flow_client_org_departments_reopen,
  flow_client_org_departments_set_amount,
} from "./flows.ts";
import { rpc_budgets_allowances_get, rpc_budgets_allowances_list } from "./allowances.ts";
import { rpc_budgets_departments_list } from "./departments.ts";
import { rpc_budgets_tree_show } from "./tree.ts";
import {
  AllowanceCreated,
  AllowanceLine,
  AllowancePage,
  AmountPrepared,
  CeilingPrepared,
  DepartmentCreated,
  DepartmentList,
  DepartmentTree,
  HolderPrepared,
  Nothing,
  OpenStatePrepared,
} from "./shapes.ts";

// ── worlds (decision budgets.worlds) ────────────────────────────────────────────────────────

/** A v4 Organization with a budget tree, a ceiling, officers, members and an outsider. */
export const W_TREE = "org-with-budget-tree";
/** org-with-budget-tree plus waiting Board proposals: a create, a USDC ceiling freeze, a close and an allowance change. */
export const W_WAITING = "org-with-waiting-budget-changes";
/** org-with-budget-tree with the USDC ceiling frozen by a Capxul freeze that left 10,000. */
export const W_FROZEN = "org-with-frozen-ceiling";
/** org-with-budget-tree with the USDC ceiling frozen by a Safe transaction Capxul did not propose. */
export const W_FROZEN_OUTSIDE = "org-with-ceiling-frozen-outside-capxul";
/** org-with-budget-tree with the devnet's chain node switched to fail every read. */
export const W_CHAIN_DOWN = "org-with-budget-tree-chain-unreachable";
/** A machine whose CLI has no valid sign-in. */
export const W_SIGNED_OUT = "cli-signed-out";
/** A machine whose CLI has chosen the beta environment, which is not provisioned. */
export const W_BETA = "cli-on-beta-environment";

// ── acceptance helpers ──────────────────────────────────────────────────────────────────────

type Line = { readonly claim: string; readonly was: readonly string[] };
const line = (id: FrozenId, n: number): Line => {
  const l = (frozen[id].acceptance as readonly Line[])[n - 1];
  if (!l) throw new Error(`${id} has no acceptance line ${n}`);
  return l;
};

/** The frozen claim, word for word, with its test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  return { claim: l.claim, observes, was: [...l.was] };
};

/** The frozen claim with its "On v4" opening stripped (P9); the old line goes to `was`. */
const v4 = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  const stripped = l.claim.replace(/^On (?:a v4 company|Protocol v4|a v4|v4),? /, "");
  return { claim: stripped.charAt(0).toUpperCase() + stripped.slice(1), observes, was: [l.claim, ...l.was] };
};

/** A rewritten claim (decisions budgets.acceptance-*); the old line first in `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const l = line(id, n);
  return { claim, observes, was: [l.claim, ...l.was] };
};

const PROPOSED_ONCE = "trace: the local collector receives exactly one `budget_change_transitioned` with `to` proposed for the change";
const NOTHING_PROPOSED =
  "world: the snapshot diff shows no budget, change, proposal or approval row and no chain change; trace: no `budget_change_transitioned`";

// ── refusal helpers ─────────────────────────────────────────────────────────────────────────

const signedOut = { error: error_NOT_AUTHENTICATED, given: W_SIGNED_OUT, when: "No valid sign-in on this machine." };
const beta = {
  error: error_CAPABILITY_UNAVAILABLE,
  given: W_BETA,
  when: "The environment you chose, beta or production, is not provisioned yet. Use staging or devnet.",
};
const notDirector = { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a Director of the Organization. Nothing was signed." };

const WRITE = budget("chain-submit");
const READ = budget("chain-read");

// ── departments ─────────────────────────────────────────────────────────────────────────────

const D_CREATE = "org.department.create";
export const operation_org_department_create = defineOperation({
  ...frozenText(D_CREATE),
  priority: "normal",
  implementedBy: flow_client_org_departments_create,
  acceptance: [
    rewrite(
      D_CREATE,
      1,
      "The first department is one Director proposal holding the token's payout install, the department's office hat, its holders and its budget.",
      "chain: the proposal's one company Safe transaction holds `Installer.buildAddToken`'s calls, `Hats.createHat`, each holder's `Hats.mintHat` and `Budgets.createTopBudget`; read: `org proposal get` shows it waiting for the Directors",
    ),
    keep(D_CREATE, 2, "cli: exits with INVALID_INPUT naming the holder; " + NOTHING_PROPOSED),
    keep(D_CREATE, 3, "cli: a holder who wears the People hat (Manage allowances on v4) is refused ROLE_CONFLICT naming them; " + NOTHING_PROPOSED),
    keep(D_CREATE, 4, "cli: the second create exits WRONG_STATE; read: `org department list` still shows the first as proposed, and the world diff is empty"),
    rewrite(
      D_CREATE,
      5,
      "A budget written per month or quarter is kept per that period, and a later department resizes the ceiling keeping what this period spent.",
      "read: `org department show` shows the budget per its own period; chain: the later proposal's `Roles.setAllowance` keeps what the ceiling paid this period and changes only what is left",
    ),
    v4(D_CREATE, 6, "chain: the proposal's calldata holds the office hat, the mints, the ceiling call and `Budgets.createTopBudget`; cli: `--budget 100/week` exits INVALID_INPUT"),
  ],
  returns: DepartmentCreated,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "A holder is not an active member with a personal Safe, the budget is empty or per week, `--token` is given with `--parent`, or the parent is eight levels deep.",
    },
    { error: error_ROLE_CONFLICT, given: W_TREE, when: "A holder wears the People hat (Manage allowances): one person cannot hold both." },
    { error: error_WRONG_STATE, given: W_TREE, when: "A budget with that key exists, or the parent or a budget above it is closed." },
    {
      error: error_WRONG_STATE,
      given: W_WAITING,
      when: "A department with that key is proposed, another create waits under the same admin hat (it would take the same hat id), or another payout ceiling write in the token waits.",
    },
    { error: error_TOKEN_NOT_SUPPORTED, given: W_TREE, when: "Capxul does not admit the token." },
    { error: error_CHILDREN_EXCEED_PARENT, given: W_TREE, when: "The parent has less left to give its teams than this budget's amount." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_TREE,
      when: "For a top budget you are not a Director; for a team you are neither the parent's office holder nor above it, nor a Director.",
    },
  ],
  budget: WRITE,
});

const D_SET = "org.department.budget.set";
export const operation_org_department_budget_set = defineOperation({
  ...frozenText(D_SET),
  priority: "normal",
  implementedBy: flow_client_org_departments_set_amount,
  acceptance: [
    keep(D_SET, 1, "cli: a set on a department whose create is still proposed exits WRONG_STATE; " + NOTHING_PROPOSED),
    rewrite(
      D_SET,
      2,
      "It is `setAmount` and the ceiling resized, in one proposal, and the change is recorded once as proposed.",
      "chain: one company Safe transaction holds the ceiling's `Roles.setAllowance` and `Budgets.setAmount`; " + PROPOSED_ONCE,
    ),
    keep(D_SET, 3, "cli: AMOUNT_BELOW_USE, whose message names what the budget already uses and the amount asked for"),
    rewrite(
      D_SET,
      4,
      "A `--token` that is not the budget's own is refused `INVALID_INPUT`: a budget keeps its token, and a first budget in a token is made by `org department create`, which turns that token on for payouts in the same proposal.",
      "cli: INVALID_INPUT and " + NOTHING_PROPOSED + "; chain: a top budget create in a new token holds `Installer.buildAddToken`'s calls",
    ),
    keep(D_SET, 5, "cli: WRONG_STATE naming the waiting freeze proposal; " + NOTHING_PROPOSED),
    v4(D_SET, 6, "chain: the executed proposal moves the token's ceiling by the difference, then `Budgets.setAmount`; cli: a cut below use exits AMOUNT_BELOW_USE"),
  ],
  returns: AmountPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_WRONG_STATE,
      given: W_WAITING,
      when: "The department's create has not executed, or another change of it, or another payout ceiling write or freeze in its token, waits for approval.",
    },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The department is unknown, or the token or period is not the budget's own." },
    { error: error_AMOUNT_BELOW_USE, given: W_TREE, when: "A budget below what it already spent, committed and gave its teams this period." },
    { error: error_CHILDREN_EXCEED_PARENT, given: W_TREE, when: "Raising a team beyond what its parent has left to give." },
    { error: error_TOKEN_NOT_SUPPORTED, given: W_TREE, when: "`--token` names a token Capxul does not admit." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not the office above this budget; for a top budget, not a Director." },
  ],
  budget: WRITE,
});

const D_CLOSE = "org.department.close";
export const operation_org_department_close = defineOperation({
  ...frozenText(D_CLOSE),
  priority: "normal",
  implementedBy: flow_client_org_departments_close,
  acceptance: [
    rewrite(
      D_CLOSE,
      1,
      "A close is one Board proposal of `Budgets.close` on the department's top budget, and the change is recorded once as proposed.",
      "chain: the proposal's one call is `Budgets.close(id)`; " + PROPOSED_ONCE,
    ),
    keep(D_CLOSE, 2, "read: after the proposal executes `org department show` reads it closed, and after a reopen executes, open"),
    keep(D_CLOSE, 3, "cli: WRONG_STATE (`closed`); " + NOTHING_PROPOSED),
    rewrite(
      D_CLOSE,
      4,
      "A second close while one waits is refused with `WRONG_STATE`, naming the waiting proposal.",
      "cli: WRONG_STATE whose message names the waiting proposal; " + NOTHING_PROPOSED,
    ),
    null,
    rewrite(
      D_CLOSE,
      6,
      "The proposal carries exactly one `Budgets.close`, on the department's own top budget.",
      "chain: the company Safe transaction's calldata decodes to one `Budgets.close` whose id is the department's budget id",
    ),
  ],
  returns: OpenStatePrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_TREE, when: "It is already closed (`closed`)." },
    {
      error: error_WRONG_STATE,
      given: W_WAITING,
      when: "A close, a reopen or another change of it waits for approval (`open_state_change_waiting`), or its create has not executed.",
    },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The department is unknown." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not the office above it; for a top budget, not a Director." },
  ],
  budget: WRITE,
});

const D_REOPEN = "org.department.reopen";
export const operation_org_department_reopen = defineOperation({
  ...frozenText(D_REOPEN),
  priority: "normal",
  implementedBy: flow_client_org_departments_reopen,
  acceptance: [
    rewrite(
      D_REOPEN,
      1,
      "A reopen is one Board proposal of `Budgets.reopen`, and the change is recorded once as proposed.",
      "chain: the proposal's one call is `Budgets.reopen(id)`; " + PROPOSED_ONCE,
    ),
    keep(D_REOPEN, 2, "cli: WRONG_STATE (`open`); " + NOTHING_PROPOSED),
    rewrite(
      D_REOPEN,
      3,
      "The proposal carries exactly one `Budgets.reopen`, on the department's own top budget.",
      "chain: the company Safe transaction's calldata decodes to one `Budgets.reopen` whose id is the department's budget id",
    ),
  ],
  returns: OpenStatePrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_TREE, when: "It is not closed (`open`)." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "A close, a reopen or another change of it waits for approval, or its create has not executed." },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The department is unknown." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not the office above it; for a top budget, not a Director." },
  ],
  budget: WRITE,
});

const D_ADD = "org.department.holder.add";
export const operation_org_department_holder_add = defineOperation({
  ...frozenText(D_ADD),
  priority: "normal",
  implementedBy: flow_client_org_departments_holders_add,
  acceptance: [
    v4(D_ADD, 1, "chain: the proposal's one call is `Hats.mintHat(officeHat, holderSafe)`; read: after it executes `org department show` lists the holder"),
    rewrite(
      D_ADD,
      2,
      "A holder add carries only the office hat's mint, and the change is recorded once as proposed.",
      "chain: the carrier's calldata holds the mint and nothing else (a `changeHatMaxSupply` first only when the hat is full); " + PROPOSED_ONCE,
    ),
    keep(D_ADD, 3, "cli: INVALID_INPUT, ROLE_CONFLICT, WRONG_STATE, INVALID_INPUT and WRONG_STATE in turn; " + NOTHING_PROPOSED),
  ],
  returns: HolderPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: W_TREE, when: "The person is not an active member with a personal Safe, or the department is unknown." },
    { error: error_ROLE_CONFLICT, given: W_TREE, when: "The person wears the People hat (Manage allowances)." },
    { error: error_WRONG_STATE, given: W_TREE, when: "The person already holds the department." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "Its create has not executed, or another change of it waits." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_TREE,
      when: "You are not the admin of its office hat: not a Director, nor for a team the office holder above it.",
    },
  ],
  budget: WRITE,
});

const D_REMOVE = "org.department.holder.remove";
export const operation_org_department_holder_remove = defineOperation({
  ...frozenText(D_REMOVE),
  priority: "normal",
  implementedBy: flow_client_org_departments_holders_remove,
  acceptance: [
    v4(D_REMOVE, 1, "chain: the proposal's one call is `Hats.setHatWearerStatus(officeHat, holderSafe, false, true)`; after it executes `Hats.isWearerOfHat` is false"),
    rewrite(
      D_REMOVE,
      2,
      "A holder removal carries only that one ruling, and the change is recorded once as proposed.",
      "chain: the carrier's calldata holds the one ruling and nothing else; " + PROPOSED_ONCE,
    ),
    keep(D_REMOVE, 3, "cli: the removal of an agent holder whose Seat ended is prepared like any other; chain: it executes"),
    keep(D_REMOVE, 4, "read: `org department show` lists the holder until the proposal executes; then an agreement write by them is refused ROLE_PERMISSION_DENIED"),
    keep(D_REMOVE, 5, "cli: WRONG_STATE; " + NOTHING_PROPOSED),
  ],
  returns: HolderPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_TREE, when: "The person is not a holder of the department." },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The department is unknown." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a Director, nor for a team the office holder above it." },
  ],
  budget: WRITE,
});

const D_LIST = "org.department.list";
export const operation_org_department_list = defineOperation({
  ...frozenText(D_LIST),
  priority: "normal",
  implementedBy: rpc_budgets_departments_list,
  acceptance: [
    keep(D_LIST, 1, "cli: `items` is empty for an Organization with no budgets"),
    keep(D_LIST, 2, "cli: a department whose create waits shows `proposed`; after the proposal executes, `active` with the numbers `Budgets.budgetOf` reads"),
    keep(D_LIST, 3, "chain and cli: each amount and commitment equals `Budgets.budgetOf` at the latest block, also after Ponder replays the budget's events"),
    rewrite(
      D_LIST,
      4,
      "Each department shows its one budget's amount, in its own token and period.",
      "cli: each item carries one token, one period and one amount, those of its budget on chain",
    ),
    keep(D_LIST, 5, "cli: the list a member who is not a Director reads equals a Director's"),
    rewrite(D_LIST, 6, "A list sends no product event.", "trace: the local collector receives no product event for the list"),
  ],
  returns: DepartmentList,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are outside the Organization. You learn nothing of its departments." },
    { error: error_PROVIDER_ERROR, given: W_CHAIN_DOWN, when: "The chain cannot be read." },
  ],
  budget: READ,
});

const D_SHOW = "org.department.show";
export const operation_org_department_show = defineOperation({
  ...frozenText(D_SHOW),
  priority: "normal",
  implementedBy: rpc_budgets_tree_show,
  acceptance: [
    keep(D_SHOW, 1, "cli: the same department reads by `engineering` and by its `dep_` id, with the numbers `Budgets.budgetOf` and `leftOf` read"),
    keep(D_SHOW, 2, "cli: after a spend or a release lands, the next show reflects it with no wait for Ponder"),
    keep(D_SHOW, 3, "cli: a department whose create waits reads `proposed`"),
    keep(D_SHOW, 4, "cli: in org-with-frozen-ceiling the tree's payout ceiling reads frozen with what is left and no refill"),
    keep(D_SHOW, 5, "cli: an outsider is refused ROLE_PERMISSION_DENIED and the output names no budget"),
  ],
  returns: DepartmentTree,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_INVALID_INPUT, given: W_TREE, when: "No budget has that key or ID. The refusal names it." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are outside the Organization." },
  ],
  budget: READ,
});

// ── payout ceilings ─────────────────────────────────────────────────────────────────────────

const C_SET = "org.department.ceiling.set";
export const operation_org_department_ceiling_set = defineOperation({
  ...frozenText(C_SET),
  priority: "normal",
  implementedBy: flow_client_org_departments_ceiling_set,
  acceptance: [
    v4(C_SET, 1, "chain: the executed proposal's `Roles.setAllowance` is on `keccak256(\"v4-payout-ceiling:\" ++ token)` and at least the sum of the token's top budgets"),
    keep(C_SET, 2, "cli: `0/year` is CLI_USAGE and a ceiling below the top budgets' sum INVALID_INPUT naming the minimum; " + NOTHING_PROPOSED),
    keep(C_SET, 3, "cli: a set in a token no budget pays in is WRONG_STATE; chain: that token's ceiling key has no allowance"),
    keep(C_SET, 4, "chain: after the change executes every other token's ceiling allowance reads as before"),
    rewrite(C_SET, 5, "A change is recorded once as proposed, and a refused change proposes nothing.", PROPOSED_ONCE + "; for a refused one, " + NOTHING_PROPOSED),
    keep(C_SET, 6, "cli: `/336d` is CLI_USAGE whose message names the `<amount>/year` form"),
  ],
  returns: CeilingPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: W_TREE, when: "The amount has no period, uses `/336d`, or is 0." },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The ceiling is below what the token's top budgets add up to. It names the minimum." },
    { error: error_WRONG_STATE, given: W_TREE, when: "No budget pays in the token yet, so it has no ceiling." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "Another payout ceiling change in the token waits for approval." },
    { error: error_TOKEN_NOT_SUPPORTED, given: W_TREE, when: "Capxul does not admit the token." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a Director." },
  ],
  budget: WRITE,
});

const C_FREEZE = "org.department.ceiling.freeze";
export const operation_org_department_ceiling_freeze = defineOperation({
  ...frozenText(C_FREEZE),
  priority: "normal",
  implementedBy: flow_client_org_departments_ceiling_freeze,
  acceptance: [
    v4(C_FREEZE, 1, "chain: the executed proposal's one `Roles.setAllowance` is on the token's `v4-payout-ceiling:` key and keeps the allowance's period"),
    keep(C_FREEZE, 2, "chain: `Roles.allowances` reads the balance `--leave` and refill 0; cli: `org department show` reads the ceiling frozen"),
    keep(C_FREEZE, 3, "cli: in org-with-frozen-ceiling a freeze is WRONG_STATE; a leave above what is left is INVALID_INPUT naming the most"),
    keep(C_FREEZE, 4, "cli: a second ceiling write in the token while the first waits is WRONG_STATE naming it"),
    rewrite(C_FREEZE, 5, "A refused freeze proposes nothing.", NOTHING_PROPOSED),
  ],
  returns: CeilingPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_FROZEN, when: "The token is already frozen." },
    { error: error_WRONG_STATE, given: W_TREE, when: "The token has no ceiling: no budget pays in it." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "Another payout ceiling change in the token waits for approval." },
    { error: error_INVALID_INPUT, given: W_TREE, when: "`--leave` is above what the ceiling has left. It names the most you can leave." },
    { error: error_CLI_USAGE, given: W_TREE, when: "`--leave` is not an amount." },
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a Director." },
  ],
  budget: WRITE,
});

const C_UNFREEZE = "org.department.ceiling.unfreeze";
export const operation_org_department_ceiling_unfreeze = defineOperation({
  ...frozenText(C_UNFREEZE),
  priority: "normal",
  implementedBy: flow_client_org_departments_ceiling_unfreeze,
  acceptance: [
    v4(C_UNFREEZE, 1, "chain: the executed proposal's one `Roles.setAllowance` is on the token's `v4-payout-ceiling:` key at the period the freeze kept"),
    keep(C_UNFREEZE, 2, "chain: `Roles.allowances` reads the refill the freeze kept and the balance it kept less all of `--leave`"),
    keep(C_UNFREEZE, 3, "cli: in org-with-budget-tree an unfreeze is WRONG_STATE; " + NOTHING_PROPOSED),
    keep(C_UNFREEZE, 4, "cli: in org-with-ceiling-frozen-outside-capxul, or after the frozen ceiling changed on chain, WRONG_STATE"),
    rewrite(C_UNFREEZE, 5, "A refused unfreeze proposes nothing.", NOTHING_PROPOSED),
  ],
  returns: CeilingPrepared,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_WRONG_STATE, given: W_TREE, when: "The token is not frozen." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "A payout ceiling change in the token waits for approval." },
    {
      error: error_WRONG_STATE,
      given: W_FROZEN_OUTSIDE,
      when: "The freeze was made outside Capxul (`frozen_outside_capxul`), or the chain no longer holds the ceiling the freeze left.",
    },
    { error: error_ROLE_PERMISSION_DENIED, given: W_FROZEN, when: "You are not a Director." },
  ],
  budget: WRITE,
});

// ── allowances ──────────────────────────────────────────────────────────────────────────────

const A_CREATE = "org.allowance.create";
export const operation_org_allowance_create = defineOperation({
  ...frozenText(A_CREATE),
  priority: "normal",
  implementedBy: flow_client_org_allowances_create,
  acceptance: [
    keep(A_CREATE, 1, "chain: one company Safe transaction holds the hat, the child budget and the mint; read: `org proposal get` waits for the second Director, and the allowance reads proposed until it executes"),
    keep(A_CREATE, 2, "cli: a member who is not a Director is refused ROLE_PERMISSION_DENIED, and an `--assign-to` who is not a member INVALID_INPUT; " + NOTHING_PROPOSED),
    null,
    rewrite(
      A_CREATE,
      4,
      "The same request again proposes nothing more and answers the same allowance, and a refused proposal changes nothing.",
      "cli: the second run with the same request key answers the same change and allowance; world: no second change or proposal; for a refused one, " + NOTHING_PROPOSED,
    ),
    keep(A_CREATE, 5, "cli: a policy allowing anything but `pay` exits INVALID_INPUT; " + NOTHING_PROPOSED),
    keep(A_CREATE, 6, "cli: `--confirm` exits CLI_USAGE and nothing is prepared"),
  ],
  returns: AllowanceCreated,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE],
  refusals: [
    beta,
    signedOut,
    notDirector,
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "The period differs from the parent's, no parent is named and the asset has no single open top budget with that period, the policy has a per-payment cap, a recipient rule or allows anything but paying, `--assign-to` is not a member with a personal Safe, or the request key identifies another change.",
    },
    { error: error_WRONG_STATE, given: W_TREE, when: "The parent budget or one above it is closed, or the tree is 8 deep." },
    {
      error: error_WRONG_STATE,
      given: W_WAITING,
      when: "Another proposal that creates a hat waits for approval; this one would take the same hat id. Approve or reject it first. Or the request key names an abandoned change.",
    },
    { error: error_CHILDREN_EXCEED_PARENT, given: W_TREE, when: "The parent budget has less room left to give than the amount." },
    { error: error_TOKEN_NOT_SUPPORTED, given: W_TREE, when: "The asset is not a token this network admits." },
  ],
  budget: WRITE,
});

const A_CHANGE = "org.allowance.change";
export const operation_org_allowance_change = defineOperation({
  ...frozenText(A_CHANGE),
  priority: "normal",
  implementedBy: flow_client_org_allowances_change,
  acceptance: [
    v4(A_CHANGE, 1, "chain: for an allowance under a top budget the proposal's one call is `Budgets.setAmount`; cli: a repeat with the same request key answers the same change, applied once the proposal executes"),
    v4(A_CHANGE, 2, "cli: AMOUNT_BELOW_USE and CHILDREN_EXCEED_PARENT, each naming the figures; " + NOTHING_PROPOSED),
    keep(A_CHANGE, 3, "chain: on a Board of one Director the caller's own approval executes the proposal; read: the allowance shows the new amount"),
    keep(A_CHANGE, 4, "cli: for an allowance under a top budget, a member who is not a Director is refused ROLE_PERMISSION_DENIED; " + NOTHING_PROPOSED),
    rewrite(
      A_CHANGE,
      5,
      "A proposal another transaction replaced ends the change, and the allowance keeps the amount it had.",
      "chain: another transaction takes the proposal's nonce; read: the change reads `replaced` and `org allowance get` shows the old amount",
    ),
    keep(A_CHANGE, 6, "cli: `--confirm` exits CLI_USAGE and nothing is prepared"),
  ],
  returns: AmountPrepared,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE],
  refusals: [
    beta,
    signedOut,
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_TREE,
      when: "You do not act for the allowance's parent budget (nobody raises their own allowance), and for one under a top budget you are not a Director. Nothing was signed.",
    },
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "The allowance is not one of this Organization's, the change names another asset or period, or the request key identifies another change.",
    },
    { error: error_WRONG_STATE, given: W_WAITING, when: "Another change of this allowance waits and is named, or the request key names an abandoned change." },
    { error: error_AMOUNT_BELOW_USE, given: W_TREE, when: "The new amount is below what it spent and reserved this period." },
    { error: error_CHILDREN_EXCEED_PARENT, given: W_TREE, when: "The parent has too little room left to give for the raise." },
  ],
  budget: WRITE,
});

const A_ASSIGN = "org.allowance.assign";
export const operation_org_allowance_assign = defineOperation({
  ...frozenText(A_ASSIGN),
  priority: "normal",
  implementedBy: flow_client_org_allowances_assign,
  acceptance: [
    v4(A_ASSIGN, 1, "chain: the proposal holds `Hats.changeHatMaxSupply` when the hat is full, then `Hats.mintHat(hat, memberSafe)`; cli: a member who wears it already is WRONG_STATE"),
    keep(A_ASSIGN, 2, "chain: the carrier is one company Safe transaction the Directors approve; read: `org proposal get` shows it"),
    rewrite(A_ASSIGN, 3, "The holder must be a member.", "cli: an email with no current Seat is refused INVALID_INPUT; " + NOTHING_PROPOSED),
    keep(A_ASSIGN, 4, "cli: the preview names the exact allowance and the member by email, and a wearer Capxul cannot name by its Safe address, never an invented name"),
    keep(A_ASSIGN, 5, "read: after the proposal executes, `dev mail list` holds one email to the member with the allowance's amount as the chain had it then"),
  ],
  returns: HolderPrepared,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE],
  refusals: [
    beta,
    signedOut,
    notDirector,
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "The allowance is not one of this Organization's, the member is not an active member with a personal Safe, or the request key identifies another change.",
    },
    { error: error_WRONG_STATE, given: W_TREE, when: "The member already wears the allowance's hat." },
    {
      error: error_WRONG_STATE,
      given: W_WAITING,
      when: "Another change of this allowance waits and is named, its create has not executed, or the request key names an abandoned change.",
    },
  ],
  budget: WRITE,
});

const A_REVOKE = "org.allowance.revoke";
export const operation_org_allowance_revoke = defineOperation({
  ...frozenText(A_REVOKE),
  priority: "normal",
  implementedBy: flow_client_org_allowances_revoke,
  acceptance: [
    v4(A_REVOKE, 1, "chain: the proposal's one call is `Hats.setHatWearerStatus(hat, memberSafe, false, true)`; cli: a member who does not wear the hat is WRONG_STATE"),
    keep(A_REVOKE, 2, "chain: the carrier is one company Safe transaction the Directors approve"),
    keep(A_REVOKE, 3, "chain: the calldata rules out only that member's Safe; cli: the result lists the remaining wearers and the approvals still needed"),
    rewrite(A_REVOKE, 4, "A refused revoke proposes nothing.", NOTHING_PROPOSED),
  ],
  returns: HolderPrepared,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE],
  refusals: [
    beta,
    signedOut,
    notDirector,
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "The allowance is not one of this Organization's, no Seat ever had the member's email, or the request key identifies another change.",
    },
    { error: error_WRONG_STATE, given: W_TREE, when: "The member does not wear the allowance's hat." },
    { error: error_WRONG_STATE, given: W_WAITING, when: "Another change of this allowance waits and is named, or the request key names an abandoned change." },
  ],
  budget: WRITE,
});

const A_LIST = "org.allowance.list";
export const operation_org_allowance_list = defineOperation({
  ...frozenText(A_LIST),
  priority: "normal",
  implementedBy: rpc_budgets_allowances_list,
  acceptance: [
    rewrite(
      A_LIST,
      1,
      "Each allowance reads its amount, what is left this period and who wears its hat.",
      "cli: each item's amount and left equal `Budgets.budgetOf` and `leftOf` at the latest block, and its wearers the hat's wearers on chain",
    ),
    rewrite(
      A_LIST,
      2,
      "Each allowance is listed once, so paging with `--after` its ID advances.",
      "cli: paging with `--limit 1 --after <last id>` returns every allowance exactly once, in id order",
    ),
    rewrite(
      A_LIST,
      3,
      "A signed-in person with no Seat in the Organization has no Organization access.",
      "cli: ROLE_PERMISSION_DENIED and the output names no allowance",
    ),
    keep(A_LIST, 4, "trace: the list's chain reads are one `budgetOf` and one `leftOf` per allowance it shows, however many other budgets the Organization has"),
    rewrite(
      A_LIST,
      5,
      "It shows active and pending allowances with full IDs, and an inaccessible Organization is refused.",
      "cli: active and proposed allowances each print their whole `allowance_` id; an outsider is refused ROLE_PERMISSION_DENIED",
    ),
  ],
  returns: AllowancePage,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE],
  refusals: [
    beta,
    signedOut,
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a member of the Organization, so it holds no allowances you may read." },
    { error: error_INVALID_INPUT, given: W_TREE, when: "The Organization ID names no Organization on this chain, or `--limit` is outside 1 to 100." },
  ],
  budget: READ,
});

const A_GET = "org.allowance.get";
export const operation_org_allowance_get = defineOperation({
  ...frozenText(A_GET),
  priority: "normal",
  implementedBy: rpc_budgets_allowances_get,
  acceptance: [
    keep(A_GET, 1, "cli: an active allowance shows `left` and `refillsAt`"),
    v4(A_GET, 2, "chain and cli: `left` equals `Budgets.leftOf` at the latest block; after `dev time warp` past `refillsAt` it equals the amount"),
    rewrite(
      A_GET,
      3,
      "A malformed allowance ID is refused `INVALID_INPUT` before anything is read.",
      "cli: INVALID_INPUT; trace: no chain read span under the command",
    ),
    keep(A_GET, 4, "cli: the exact allowance for its id; the SDK answers null for an id no allowance has, and the CLI refuses it INVALID_INPUT"),
  ],
  returns: AllowanceLine,
  errors: [error_CLI_USAGE, error_CAPABILITY_UNAVAILABLE, error_INVALID_INPUT],
  refusals: [
    beta,
    signedOut,
    { error: error_ROLE_PERMISSION_DENIED, given: W_TREE, when: "You are not a member of the Organization, so it holds no allowances you may read." },
    {
      error: error_INVALID_INPUT,
      given: W_TREE,
      when: "The ID is wrong, belongs to another Organization or names no allowance. Find it with `capxul org allowance list`.",
    },
  ],
  budget: READ,
});

const A_REPLACE = "org.allowance.replace";
export const operation_org_allowance_replace = defineOperation({
  ...frozenText(A_REPLACE),
  priority: "normal",
  implementedBy: flow_client_org_allowances_replace,
  acceptance: [
    rewrite(
      A_REPLACE,
      1,
      "A replacement is refused `FEATURE_NOT_AVAILABLE` before anything is built, whatever invitations or previews exist.",
      "cli: exit 6 with FEATURE_NOT_AVAILABLE; trace: no rpc span under the command; world: unchanged",
    ),
    null,
    null,
    null,
  ],
  returns: Nothing,
  errors: [error_CLI_USAGE],
  refusals: [{ error: error_FEATURE_NOT_AVAILABLE, given: W_TREE, when: "Always: allowances are budgets in v4, and there is no Roles module to replace." }],
  budget: budget("read"),
});
