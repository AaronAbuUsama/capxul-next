// The target budgets concept's own judgments, each a decision record linked to what it shapes.
// Made by Claude while designing the concept, under the accepted A1-A4 and P1-P10 and the shared
// decisions (concepts.budgets, concepts.permissions-dissolved, dependencies.of-budgets,
// dependencies.board-below-proposers, rules.procedures, rules.durable-processes), with the old code
// (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_budgets, concept_notices, concept_organizations, concept_payments, concept_board } from "../shared/foundation.ts";
import { contract_hats, integration_indexer } from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_ROLE_CONFLICT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { machine_budget, machine_budget_change, table_budget_changes, table_budgets, event_budget_change_transitioned } from "./data.ts";
import { rpc_budgets_allowances_create, rpc_budgets_allowances_get, rpc_budgets_allowances_list } from "./allowances.ts";
import { rpc_budgets_ceilings_freeze, rpc_budgets_ceilings_set, rpc_budgets_ceilings_unfreeze } from "./ceilings.ts";
import { rpc_budgets_changes_get } from "./changes.ts";
import { rpc_budgets_departments_create, rpc_budgets_departments_list } from "./departments.ts";
import { rpc_budgets_offices_add_holder, rpc_budgets_offices_remove_holder } from "./offices.ts";
import { rpc_budgets_tree_close, rpc_budgets_tree_reopen, rpc_budgets_tree_set_amount, rpc_budgets_tree_show } from "./tree.ts";
import { workflow_budgets_changes_follow, workflow_budgets_invitations_return_grants } from "./processes.ts";
import { rpc_budgets_invitations_plan, rpc_budgets_invitations_propose } from "./invitations.ts";
import {
  flow_client_org_allowances_assign,
  flow_client_org_allowances_change,
  flow_client_org_allowances_replace,
  flow_client_org_allowances_revoke,
  flow_client_org_departments_ceiling_freeze,
  flow_client_org_departments_ceiling_set,
  flow_client_org_departments_ceiling_unfreeze,
  flow_client_org_departments_close,
  flow_client_org_departments_holders_add,
  flow_client_org_departments_holders_remove,
  flow_client_org_departments_set_amount,
  flow_client_org_invitations_invite,
} from "./flows.ts";
import * as op from "./operations.ts";

const CLAUDE = "Claude, budgets design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

const ALL_OPERATIONS = [
  op.operation_org_department_create,
  op.operation_org_department_budget_set,
  op.operation_org_department_close,
  op.operation_org_department_reopen,
  op.operation_org_department_holder_add,
  op.operation_org_department_holder_remove,
  op.operation_org_department_list,
  op.operation_org_department_show,
  op.operation_org_department_ceiling_set,
  op.operation_org_department_ceiling_freeze,
  op.operation_org_department_ceiling_unfreeze,
  op.operation_org_allowance_create,
  op.operation_org_allowance_change,
  op.operation_org_allowance_assign,
  op.operation_org_allowance_revoke,
  op.operation_org_allowance_list,
  op.operation_org_allowance_get,
  op.operation_org_allowance_replace,
  op.operation_org_member_invite,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_budgets_two_tables = defineDecision({
  id: "budgets.two-tables",
  title: "Two tables: budgets and budget-changes, for departments and allowances alike",
  question:
    "Old permissions kept v4 allowances and their commands in two tables, old payroll kept departments and their changes " +
    "in two more, and pre-v4 permissions six more. What does the target store?",
  options: [
    { label: "two", text: "One `budgets` table (a department, team or allowance: what the chain cannot name) and one `budget-changes` table (every change Capxul proposed)." },
    { label: "four", text: "Keep allowances and departments apart, each with its own changes table, as the old code had them." },
    { label: "none", text: "Store nothing: read names and pending changes from the proposals' notes." },
  ],
  chosen: "two",
  why:
    "On v4 an allowance and a department are one contract's budgets under one authority rule (concepts.budgets), so their " +
    "rows differ only in kind and in which hat their office hat sits under. Keeping them apart would duplicate the key " +
    "namespace, the request keys and every conflict check (P9: consolidate duplicate stores). Nothing at all is not " +
    "possible: a budget's name and key, its Capxul id, its planned hat before the chain has its id, the request key, the " +
    "change that blocks another and the ceiling a freeze replaced exist nowhere on chain. The pre-v4 permission, " +
    "assignment, command, receipt and granter tables are dropped with the Roles commands they served.",
  source: by("books/as-is/permissions/data.ts:400, :451; books/as-is/payroll/data.ts:170, :216; P9"),
  affects: [table_budgets, table_budget_changes, machine_budget, machine_budget_change, concept_budgets],
});

export const decision_budgets_chain_is_the_record = defineDecision({
  id: "budgets.chain-is-the-record",
  title: "Amounts, spends, wearers and ceilings are read from the chain, never stored",
  question: "The old department row kept budgets per token, holders and `closed`. Which budget facts does the target copy?",
  options: [
    { label: "read", text: "None: the tree and wearers from indexing's views, the numbers from `Budgets.budgetOf`, `childrenOf` and `leftOf` at the latest block, the ceiling from `Roles.allowances`." },
    { label: "copy", text: "Copy amounts, holders and closed onto the row when a change applies, and read the row." },
  ],
  chosen: "read",
  why:
    "The frozen claims say it: 'Budget and commitment come from budgetOf, so a missed or reordered event changes nothing' " +
    "and 'Each read goes to the chain again'. A copy would drift whenever the Board acts at the Safe directly, and a " +
    "budget's period rolls on the calendar, which only `leftOf` knows. Live reads cost a chain-read budget (P5), which " +
    "fits: they run concurrently, one `budgetOf` and one `leftOf` per budget shown, so a read does not grow with the " +
    "Organization's other budgets. Closed and open are therefore not states of the budget machine.",
  source: by("org.department.list.yaml #3, org.department.show.yaml #2, org.allowance.list.yaml #4; concepts.indexing"),
  affects: [table_budgets, machine_budget, rpc_budgets_departments_list, rpc_budgets_tree_show, rpc_budgets_allowances_list, rpc_budgets_allowances_get],
});

export const decision_budgets_ids_and_keys = defineDecision({
  id: "budgets.ids-and-keys",
  title: "A budget is named by key, Capxul id or chain id; its key frees when abandoned",
  question: "How do commands name a budget, and when is a key taken?",
  options: [
    { label: "key-id-chain", text: "By its key (from its name), its `dep_` or `allowance_` id, or its chain id; the key is held while proposed or active (`key_claim`, unique)." },
    { label: "id-only", text: "Only by Capxul id." },
  ],
  chosen: "key-id-chain",
  why:
    "The frozen commands take a department's key or `dep_` id and an allowance's id or key (`org allowance change " +
    "office-costs`); payroll's offers name a department the same way. A budget made outside Capxul has only its chain id. " +
    "A unique index on a column that is null once abandoned frees the key of a create that never ran, which the frozen " +
    "list needs ('reads leave it out and its slug is free again'), without a partial index.",
  source: by("org.department.show.yaml notes; org.allowance.change.yaml (designed example); books/as-is/payroll/data.ts:500"),
  affects: [table_budgets],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_budgets_one_process_per_change = defineDecision({
  id: "budgets.one-process-per-change",
  title: "A budget change is a long-lived object with one durable process",
  question:
    "Old payroll settled every waiting change on the next department action, in nonce order; old allowances settled on " +
    "read. Who settles a change in the target?",
  options: [
    { label: "process", text: "One process per change, born with it, resumed by its carrier's proposal_transitioned or approval_transitioned, applying it only on the transaction's indexed effect." },
    { label: "reactors", text: "Workflows triggered by board's and approvals' terminal transitions, finding the change by its carrier." },
    { label: "settle-on-read", text: "Settle waiting changes at the start of every budgets rpc, as the old code did." },
  ],
  chosen: "process",
  why:
    "A change waits on people and the chain for days, which P3's test makes a workflow and A3 one process per object " +
    "(rules.durable-processes lets a designer add objects; this is budgets' analogue of an agent change). Reactors would " +
    "need one workflow per board and approvals transition and would scatter one object's settlement. Settle-on-read made " +
    "a read write and left a change unsettled until someone looked. Applying only on the indexed effect (BudgetCreated " +
    "with the planned hat, the amount set, the hat minted) means a proposal that ran but did nothing never reads applied.",
  source: by("packages/backend/src/payroll/departments/writes.ts:232; books/as-is/payroll/departments.ts:775; A3; P3"),
  affects: [workflow_budgets_changes_follow, machine_budget_change, machine_budget, rpc_budgets_changes_get],
});

export const decision_budgets_signer_rule = defineDecision({
  id: "budgets.signer-rule",
  title: "The office above a budget signs its changes; the Board signs tops and ceilings",
  question: "The frozen who-lines say 'a Director'; the designed text says the office above the budget. Who signs what?",
  options: [
    {
      label: "chain-rule",
      text:
        "Budgets' own rule: a top budget, a payout ceiling and a hat under the Board's top hat are the Board's; a team or " +
        "allowance under a parent is signed by whoever `Budgets.authorised` (or the hat's admin) says acts for the parent, " +
        "else by the Board when the caller is a Director.",
    },
    { label: "board-only", text: "Every change is a Board proposal, as the old top-level text has it." },
  ],
  chosen: "chain-rule",
  why:
    "P10: the designed v4 text is the specification, and it says 'Nobody raises their own budget: the office above it " +
    "does', with the parent office holder signing a team's create, amount, close and holders from their own Safe. Asking " +
    "the chain (`Budgets.authorised`, `Hats.isWearerOfHat`) rather than a Capxul row keeps authority where v4 puts it. " +
    "The Board can always act, because the company Safe wears the top hat. Allowances' hats sit under the Board's top hat " +
    "(the designed create), so their wearers change only by Board proposal, while their amount follows the parent's office.",
  source: by("org.department.create.yaml, org.department.budget.set.yaml, org.allowance.change.yaml, org.department.holder.add.yaml (designed)"),
  affects: [
    rpc_budgets_departments_create,
    rpc_budgets_tree_set_amount,
    rpc_budgets_tree_close,
    rpc_budgets_tree_reopen,
    rpc_budgets_offices_add_holder,
    rpc_budgets_offices_remove_holder,
    table_budget_changes,
  ],
});

export const decision_budgets_one_waiting_change = defineDecision({
  id: "budgets.one-waiting-change",
  title: "One waiting change per budget, per payout ceiling and per admin hat",
  question: "Which changes may wait at the same time?",
  options: [
    { label: "one-each", text: "At most one proposed change per budget, one per token's ceiling, and one hat-creating change per admin hat; a second is WRONG_STATE naming the first." },
    { label: "by-kind", text: "As old payroll: only conflicting kinds refuse each other (two ceiling writes, two closes), others may stack." },
  ],
  chosen: "one-each",
  why:
    "Each change is planned from the chain as it is now: two amounts would undo each other, two assigns would both plan " +
    "the hat's supply plus one, two creates under one admin hat would plan the same hat id, and two ceiling writes would " +
    "each restore what the other changed. The frozen refusals already name the ceiling and hat cases; one per budget is " +
    "stricter than the old department rule but the simplest that is always safe, and the refusal names the proposal to " +
    "approve or reject first.",
  source: by("org.department.create.yaml (designed WRONG_STATE department_create_waiting); org.department.budget.set.yaml (ceiling_change_waiting); org.allowance.assign.yaml"),
  affects: [table_budget_changes, error_WRONG_STATE, rpc_budgets_departments_create, rpc_budgets_allowances_create, rpc_budgets_ceilings_set],
});

export const decision_budgets_hat_planning = defineDecision({
  id: "budgets.hat-planning",
  title: "A new office hat's id is planned from Hats.viewHat at the chain head",
  question: "A create's batch must name the new hat before it exists. Where does its id come from?",
  options: [
    { label: "indexing-at-head", text: "From indexing's hats under the admin hat, refusing with PROVIDER_ERROR while Ponder is behind the chain head (`Indexer.head`). Chosen first, while the shared Hats record had no read of the next id." },
    { label: "view-hat", text: "From `Hats.viewHat(admin)`: its `lastHatId` at the latest block names the next child (lastHatId + 1 at the admin's next level), read through chain-rpc." },
    { label: "get-next-id", text: "From `Hats.getNextId(admin)`, as the old code did. v4's IHats does not declare it (contracts.hats-view-hat)." },
  ],
  chosen: "view-hat",
  why:
    "Assembly: shared/external.ts now books `viewHat` (contracts.hats-view-hat), so the live read replaces the index, as " +
    "the first version of this decision said it should. A lagging index can no longer name a hat that already exists. " +
    "Indexing's other reads (wearers, a full hat's supply, budgets) still wait for Ponder at the head. Two creates under " +
    "one admin would still plan the same id before either executes, so the one-create-per-admin WRONG_STATE stays. A hat " +
    "made outside Capxul under the same admin between proposal and execution shifts the id; the batch is atomic, and the " +
    "change's process applies it only when BudgetCreated names the planned hat.",
  source: by("packages/backend/src/permissions/allowances/external.ts:99 (readNextHat via hatsNextId); books/target/shared/decisions.ts (contracts.hats-view-hat)"),
  affects: [rpc_budgets_departments_create, rpc_budgets_allowances_create, rpc_budgets_invitations_plan, rpc_budgets_invitations_propose, contract_hats, integration_indexer],
});

export const decision_budgets_role_conflict = defineDecision({
  id: "budgets.role-conflict-people-hat",
  title: "ROLE_CONFLICT on v4: a department's office and the People hat",
  question:
    "Old ROLE_CONFLICT kept a Manage allowances holder from holding a department. What is it on v4, and can the frozen " +
    "ROLE_CONFLICT of `org allowance create` and `org allowance assign` (Manage allowances to a department holder) happen?",
  options: [
    { label: "people-hat", text: "A department's or team's office cannot go to a member who wears the People hat (Manage allowances on v4); an allowance's hat can." },
    { label: "drop", text: "Drop it: v4 has no Manage allowances allowance." },
  ],
  chosen: "people-hat",
  why:
    "The frozen department claims keep the separation of duties ('A member who holds Manage allowances cannot hold a " +
    "department'), and on v4 Manage people is the People hat (org.allowance.create designed, CAP-1101). Allowance wearers " +
    "were never in the old conflict: the old guard returned for every grant but Manage people (permissions/guards/" +
    "conflicts.ts:22), and the old v4 allowance path never raised it. So `org allowance create` and `org allowance assign` " +
    "drop their frozen ROLE_CONFLICT, which cannot happen on v4: its condition is an allowance that is Manage allowances, " +
    "and none can exist. A create's policy is a spending budget, and one that allows anything but paying is INVALID_INPUT " +
    "before any holder is read; an assign names a budget's `allowance_` id or key, and the People hat is no budget " +
    "(INVALID_INPUT); `budgets.offices.add-holder` raises ROLE_CONFLICT only for a department's or team's office. Neither " +
    "designed block lists it (P10 rung 1). No guard is loosened (P10 rung 3): the People hat is granted by board's `org " +
    "member grant`, which refuses a department's office holder ROLE_CONFLICT (board.people-hat-role-conflict), reading " +
    "the office hats from indexing's Budgets view. The allowance lines that named Manage Budgets as an allowance are cut " +
    "or retired (budgets.acceptance-pre-v4, budgets.acceptance-retired).",
  source: by(
    "packages/backend/src/payroll/departments/reads.ts:76, permissions/guards/conflicts.ts:22, permissions/allowances; " +
      "org.department.create.yaml #3; org.allowance.create.yaml, org.allowance.assign.yaml (designed)",
  ),
  affects: [
    error_ROLE_CONFLICT,
    rpc_budgets_departments_create,
    rpc_budgets_offices_add_holder,
    rpc_budgets_allowances_create,
    op.operation_org_department_create,
    op.operation_org_department_holder_add,
    op.operation_org_allowance_create,
    op.operation_org_allowance_assign,
    concept_board,
  ],
});

export const decision_budgets_no_door = defineDecision({
  id: "budgets.no-door",
  title: "Budgets has no procedures; payments' spend check is a read",
  question: "Old permissions answered `authorize` and `budget-left` for payments. What does the target's door hold?",
  options: [
    {
      label: "read",
      text:
        "Nothing: payments reads `budgets` (the budget by key or id, its chain id, token, period and status) and decides in " +
        "its own rpc with `Budgets.authorised(id, payerSafe)`, `Budgets.leftOf(id)` and the token's ceiling, refusing " +
        "ROLE_PERMISSION_DENIED, PAYROLL_BUDGET_EXCEEDED or WRONG_STATE before it births anything.",
    },
    { label: "procedure", text: "A `budgets.check-spend` procedure payments invokes in its transaction." },
    { label: "rpc", text: "A budgets rpc the payment flow calls before preparing." },
  ],
  chosen: "read",
  why:
    "A procedure is for a write that is one money fact with the invoker's (rules.procedures), and makes no outside call; " +
    "the check writes nothing and needs the chain's answer now. An rpc a payments flow calls would be checked apart from " +
    "the prepare it guards, so the answer could be stale by the time payments writes. Payments depends on budgets, so it " +
    "may read the table, and the chain is the authority anyway: the bundler's simulation refuses an unauthorised or " +
    "over-budget spend before anyone signs (OverBudget, NotAuthorised). No other concept writes budgets' tables.",
  source: by("books/as-is/permissions/authorities.ts:139, :228; rules.procedures; dependencies.of-payments"),
  affects: [concept_budgets, concept_payments, table_budgets],
});

export const decision_budgets_one_write_per_chain_call = defineDecision({
  id: "budgets.one-write-per-chain-call",
  title: "Departments and allowances share the amount, holder and close writes",
  question: "`budget set` and `allowance change`, `holder add` and `allowance assign`, `holder remove` and `allowance revoke`: one rpc each pair, or two?",
  options: [
    { label: "shared", text: "One rpc per chain write (set-amount, add-holder, remove-holder, close, reopen), called by each pair's own flow." },
    { label: "per-command", text: "One rpc per CLI command, as the old code had them in two concepts." },
  ],
  chosen: "shared",
  why:
    "Each pair is the same contract call on the same kind of object under the same authority rule (concepts.budgets), and " +
    "the differences (ROLE_CONFLICT for a department's office, the Board for an allowance's hat) follow from the budget's " +
    "kind and its hat's admin, which the rpc reads. Separate rpcs would duplicate every check. Each command keeps its own " +
    "SDK method and flow (A4), and `org department close` closes an allowance's budget too, as the designed revoke says.",
  source: by("org.allowance.revoke.yaml (designed: 'close its budget with org department close'); concepts.budgets"),
  affects: [
    rpc_budgets_tree_set_amount,
    rpc_budgets_offices_add_holder,
    rpc_budgets_offices_remove_holder,
    rpc_budgets_tree_close,
    flow_client_org_departments_set_amount,
    flow_client_org_allowances_change,
    flow_client_org_departments_holders_add,
    flow_client_org_allowances_assign,
    flow_client_org_departments_holders_remove,
    flow_client_org_allowances_revoke,
  ],
});

export const decision_budgets_ceilings = defineDecision({
  id: "budgets.ceilings",
  title: "Every payout ceiling write is the Installer's batch in a Board proposal",
  question: "How is a token's payout ceiling set, frozen, unfrozen and resized with the budgets it backs?",
  options: [
    { label: "installer", text: "The Board proposes the calls `Installer.buildSetCeiling` (or, for a first budget in a token, `buildAddToken`) returns from the allowance as it is now; a top budget's create or amount moves it in the same proposal." },
    { label: "direct", text: "Capxul encodes `Roles.setAllowance` itself." },
  ],
  chosen: "installer",
  why:
    "The Installer is v4's one encoder of the payout role's allowance, so Capxul cannot get the key or the period wrong. " +
    "The ceiling is a backstop sized from the top budgets, so their changes move it in the same proposal (frozen budget " +
    "set #2 and #6). A freeze keeps the allowance it replaced in its change, because an unfreeze must restore exactly " +
    "that, less all of what the freeze left; a freeze made outside Capxul has no such record and cannot be undone here.",
  source: by("org.department.ceiling.set.yaml (designed call); org.department.ceiling.unfreeze.yaml notes; packages/backend/src/payroll/departments/reads.ts:185"),
  affects: [rpc_budgets_ceilings_set, rpc_budgets_ceilings_freeze, rpc_budgets_ceilings_unfreeze, rpc_budgets_departments_create, rpc_budgets_tree_set_amount, table_budget_changes],
});

// ── surface ─────────────────────────────────────────────────────────────────────────────────

export const decision_budgets_sdk_methods = defineDecision({
  id: "budgets.sdk-methods",
  title: "SDK methods follow the designed names; reads are one rpc each",
  question: "Which SDK method does each command call?",
  options: [
    { label: "designed", text: "The designed methods: `departments.ceiling.set|freeze|unfreeze` and `departments.tree`; the frozen names elsewhere; each read implemented by its one rpc." },
    { label: "frozen", text: "Keep the old `setCeiling`, `freezeCeiling`, `unfreezeCeiling` and `get`." },
  ],
  chosen: "designed",
  why:
    "P10 makes the designed text the specification, and only the CLI and the operations are frozen, not the SDK. A read " +
    "is one rpc call, so A4 implements its operation by the rpc and it needs no flow.",
  source: by("org.department.ceiling.set.yaml, org.department.show.yaml (designed method and sdk example)"),
  affects: [flow_client_org_departments_ceiling_set, flow_client_org_departments_ceiling_freeze, flow_client_org_departments_ceiling_unfreeze, rpc_budgets_tree_show],
});

export const decision_budgets_returns = defineDecision({
  id: "budgets.returns-designed",
  title: "Returns are the designed v4 shapes; the pre-v4 command and permission fields go",
  question: "The frozen returns carry `permissionId`, `command.expectedRevision`, `roleKey`, `currentPolicy`. What do the commands print?",
  options: [
    { label: "designed", text: "The designed shapes (an allowance's budget and hat, a department's key, amount and parent's room) plus the frozen fields that still mean something: status, approvalId, requestKey, proposal." },
    { label: "frozen", text: "The frozen top-level fields, filled where v4 can." },
  ],
  chosen: "designed",
  why:
    "P10. A revision, a Roles key, an assignment id and a per-payment cap have no v4 meaning (P9); printing them null would " +
    "mislead scripts. The change id replaces the old command id, read with the same request key.",
  source: by("org.allowance.create.yaml, org.allowance.list.yaml, org.department.create.yaml (designed returns)"),
  affects: ALL_OPERATIONS,
});

export const decision_budgets_replace_removed = defineDecision({
  id: "budgets.replace-removed",
  title: "`org allowance replace` is refused FEATURE_NOT_AVAILABLE with no rpc",
  question:
    "v4 removed the Roles module of allowances. What implements the frozen command, and which of its page's refusals " +
    "(CAPABILITY_UNAVAILABLE, NOT_AUTHENTICATED, ROLE_PERMISSION_DENIED, INVALID_INPUT, WRONG_STATE) can still happen?",
  options: [
    {
      label: "flow-refuses",
      text:
        "Its SDK method refuses at once with FEATURE_NOT_AVAILABLE, for every caller on every environment; no rpc exists, " +
        "and none of the page's five refusals is reached.",
    },
    {
      label: "rpc-refuses",
      text: "An rpc that always refuses, after the CLI's environment and sign-in checks, so CAPABILITY_UNAVAILABLE and NOT_AUTHENTICATED stay.",
    },
  ],
  chosen: "flow-refuses",
  why:
    "The designed text says it is refused before anything is prepared, always, and that nobody may run it (CAP-1100, " +
    "ruled A); P10 rung 1 makes those designed refusal codes the surface. An rpc whose only behaviour is a refusal is a " +
    "server endpoint for nothing (P2). So the page's five refusals are dropped, because none can happen. The method makes " +
    "no call, and the CLI resolves no environment's deployment and no sign-in for it, so CAPABILITY_UNAVAILABLE (beta or " +
    "production chosen) and NOT_AUTHENTICATED (no sign-in, or a session that changed before a signature that never comes) " +
    "are never reached. ROLE_PERMISSION_DENIED (no verified Manage allowances assignment), INVALID_INPUT (an open " +
    "allowance command, a stale preview's snapshot, a request key of another command) and WRONG_STATE (an abandoned or " +
    "prepared command, a Roles module not admitted) each check pre-v4 Roles module state that P9 drops, and the command, " +
    "which takes no flags, reads none of it. Nothing is loosened (P10 rung 3): no caller gets anything. Its acceptance " +
    "keeps line 1 as the v4 refusal and retires 2-4, which describe carrying a Roles module's state across " +
    "(budgets.acceptance-retired).",
  source: by("org.allowance.replace.yaml (designed: refusals FEATURE_NOT_AVAILABLE 'Always', who 'Nobody', no flags); P2; P9; P10"),
  affects: [flow_client_org_allowances_replace, op.operation_org_allowance_replace, error_FEATURE_NOT_AVAILABLE],
});

export const decision_budgets_no_departments_gate = defineDecision({
  id: "budgets.no-departments-gate",
  title: "No departments feature gate",
  question: "Old close and reopen refused FEATURE_NOT_AVAILABLE when departments were not on for the Organization. Keep the gate?",
  options: [
    { label: "drop", text: "Drop it: budgets are v4's money authority, not an optional feature." },
    { label: "keep", text: "Read access' gate for departments before every budgets write." },
  ],
  chosen: "drop",
  why:
    "On v4 every install wires Budgets, payments' budget spends and payroll's agreements pay from budgets, and an " +
    "allowance is a budget; a gate that hid budgets alone would leave those unmanageable. The designed refusals of close " +
    "and reopen do not name it. Payroll keeps its own `payment-agreements` gate on agreements.",
  source: by("org.department.close.yaml (top-level refusal and designed refusals); books/target/payroll/holders.ts"),
  affects: [op.operation_org_department_close, op.operation_org_department_reopen, error_FEATURE_NOT_AVAILABLE],
});

export const decision_budgets_dropped_refusals = defineDecision({
  id: "budgets.dropped-refusals",
  title: "Frozen refusals that only had meaning before v4 are not produced",
  question: "Which frozen refusal reasons does the target drop?",
  options: [
    {
      label: "pre-v4",
      text:
        "`pre_v4` (P9 retires it), an invitation's binding that owns a person's rights or has no Account yet, a stale " +
        "preview or revision, no verified Manage allowances or a retired Roles module, and FEATURE_NOT_AVAILABLE for departments.",
    },
    { label: "keep", text: "Keep every frozen refusal reason, unreachable or not." },
  ],
  chosen: "pre-v4",
  why:
    "Each describes the pre-v4 Roles permissions (P9): on v4 an invitation's allowance offer is board's proposal of a hat " +
    "mint, a wearer with no Seat reads by its Safe, a change is planned from the chain with one waiting per budget so no " +
    "preview can go stale, and there is no Roles module of allowances. The codes stay (WRONG_STATE, INVALID_INPUT) for the " +
    "v4 reasons each operation's refusals list.",
  source: by("org.allowance.*.yaml top-level refusals; P9 ('the pre_v4 reason of WRONG_STATE is retired')"),
  affects: [
    op.operation_org_allowance_assign,
    op.operation_org_allowance_change,
    op.operation_org_allowance_create,
    op.operation_org_allowance_revoke,
    op.operation_org_allowance_get,
    op.operation_org_allowance_list,
    op.operation_org_department_close,
    op.operation_org_department_reopen,
  ],
});

// ── acceptance (P1, P9) ─────────────────────────────────────────────────────────────────────

export const decision_budgets_acceptance_events = defineDecision({
  id: "budgets.acceptance-events",
  title: "Lines that name a scheduled event now claim the change is recorded once",
  question: "Nine lines say a command 'schedules one `payroll_department_change_proposed`' or 'schedules nothing'. What do they claim?",
  options: [
    { label: "observable", text: "'The change is recorded once as proposed' (one `budget_change_transitioned` in the collector) and 'proposes nothing' (an empty world diff)." },
    { label: "verbatim", text: "Keep the old event names." },
  ],
  chosen: "observable",
  why:
    "P7 replaces the old catalog event with each machine's one event, and P1 makes telemetry and 'schedules' mechanism " +
    "words; the trace and world observers see the outcome. Rewritten: department budget set #2, ceiling set #5, close #1, " +
    "reopen #1, holder add #2, holder remove #2, list #6, ceiling freeze #5, ceiling unfreeze #5, allowance create #4 and " +
    "allowance revoke #4; each keeps its old line first in `was`.",
  source: by("books/frozen/operations.ts (acceptance of the 18 operations); P1; P7"),
  affects: [
    op.operation_org_department_budget_set,
    op.operation_org_department_ceiling_set,
    op.operation_org_department_ceiling_freeze,
    op.operation_org_department_ceiling_unfreeze,
    op.operation_org_department_close,
    op.operation_org_department_reopen,
    op.operation_org_department_holder_add,
    op.operation_org_department_holder_remove,
    op.operation_org_department_list,
    op.operation_org_allowance_create,
    op.operation_org_allowance_revoke,
    event_budget_change_transitioned,
  ],
});

export const decision_budgets_acceptance_pre_v4 = defineDecision({
  id: "budgets.acceptance-pre-v4",
  title: "Lines that describe a pre-v4 path are rewritten as their v4 claim",
  question:
    "Some lines name pre-v4 calls or shapes (setBudget, assignRoles, the department role, a yearly conversion, two tokens " +
    "per department, a per-payment cap, a revision, a Party binding, Manage Budgets as an allowance). What do they claim?",
  options: [
    { label: "v4-claim", text: "Rewrite each as the v4 outcome of the same test, the old line first in `was`; cut a pre-v4 clause." },
    { label: "retire", text: "Retire them all as null." },
  ],
  chosen: "v4-claim",
  why:
    "P9 drops the pre-v4 path and P10 makes the designed text the spec, but the test behind each line still has a v4 " +
    "form worth checking. Rewritten: department create #1 (payout install, office hat), #5 (kept per its period), budget " +
    "set #2 (setAmount), #4 (a token not its own), holder add #2 and remove #2 (only the hat call), list #4 (one budget " +
    "per department), allowance list #1 (pre-v4 clause cut, as P9 says), #2 (no revision), #3 (a Seat, not a Party " +
    "binding), #5 (no per-payment cap), and allowance assign #3 (the Manage Budgets clause cut). Each must still pass on " +
    "the old system's v4 path; budget set #4, list #4 and allowance list #3 need that run to confirm.",
  source: by("books/frozen/operations.ts; P1 (rewrite rule); P9 (the two lines with a pre-v4 clause)"),
  affects: [
    op.operation_org_department_create,
    op.operation_org_department_budget_set,
    op.operation_org_department_holder_add,
    op.operation_org_department_holder_remove,
    op.operation_org_department_list,
    op.operation_org_allowance_list,
    op.operation_org_allowance_assign,
  ],
});

export const decision_budgets_acceptance_mechanisms = defineDecision({
  id: "budgets.acceptance-mechanisms",
  title: "Lines that name the SDK, a record or client work claim what is observed",
  question: "'The SDK accepts only one Budgets.close', 'refused when it records', 'checked before any client work', 'ends its command': what do they claim?",
  options: [
    { label: "observable", text: "Rewrite each as what the chain's calldata, the CLI's refusal or the trace shows." },
    { label: "verbatim", text: "Keep them." },
  ],
  chosen: "observable",
  why:
    "P1: a component, a record and a process step are mechanisms a black box cannot see. Rewritten: close #4 (refused " +
    "naming the waiting proposal) and #6, reopen #3 (the proposal carries exactly one call, in its calldata), allowance " +
    "get #3 (no chain read before the refusal) and allowance change #5 (the change reads replaced, the amount unchanged).",
  source: by("books/frozen/operations.ts; P1"),
  affects: [op.operation_org_department_close, op.operation_org_department_reopen, op.operation_org_allowance_get, op.operation_org_allowance_change],
});

export const decision_budgets_acceptance_retired = defineDecision({
  id: "budgets.acceptance-retired",
  title: "Five lines with no v4 form are retired as null",
  question: "Which lines cannot be stated on v4 at all?",
  options: [
    { label: "retire", text: "Department close #5 (P9's pre-v4 line), allowance create #3 (Manage Budgets as an allowance), allowance replace #2-#4 (a Roles module's state carried across)." },
    { label: "rewrite", text: "Invent v4 claims for them." },
  ],
  chosen: "retire",
  why:
    "Close #5 is one of P9's two pre-v4-only lines. Manage Budgets is the People hat on v4 and an allowance cannot be it, " +
    "so create #3's test cannot be built. Replace has no module to replace: carrying invitations, queuing a manager's " +
    "event and showing frozen rows before an approval describe a command v4 removed. The numbers stay.",
  source: by("P9 (org.department.close #5); org.allowance.create.yaml and org.allowance.replace.yaml (designed)"),
  affects: [op.operation_org_department_close, op.operation_org_allowance_create, op.operation_org_allowance_replace],
});

export const decision_budgets_worlds = defineDecision({
  id: "budgets.worlds",
  title: "The worlds budgets' refusals and claims are reached from",
  question: "Which devnet snapshots does budgets introduce, and what does each hold?",
  options: [
    {
      label: "seven",
      text:
        "org-with-budget-tree: a v4 Organization, Directors dana@ and eli@ (2 of 2), the People hat on pat@, members mia@, " +
        "sam@, lead@ and plat@ with claimed Safes, outsider olga@ signed in; USDC top budget `company` 1,200,000 a year " +
        "(Board) with `engineering` 800,000 (lead@), its teams `platform` 300,000 (plat@) and `hiring` 100,000 closed, and " +
        "`operations` 300,000 whose team chain `ops-1`...`ops-7` is eight deep; top budget `monthly-spend` 10,000 a month " +
        "with allowance `office-costs` 2,000 a month worn by mia@, 600 spent; USDC ceiling 1,200,000 a year; EURC admitted " +
        "with no budget; DAI not admitted. org-with-waiting-budget-changes: that tree plus waiting Board proposals creating " +
        "`design`, freezing USDC, closing `operations` and changing `office-costs`. org-with-frozen-ceiling: USDC frozen by " +
        "a Capxul freeze leaving 10,000. org-with-ceiling-frozen-outside-capxul: USDC frozen by a Safe transaction Capxul " +
        "did not propose. org-with-budget-tree-chain-unreachable: the tree with the devnet node's fault switch on. " +
        "cli-signed-out: no sign-in. cli-on-beta-environment: the CLI on beta, not provisioned.",
    },
    { label: "per-refusal", text: "One world per refusal." },
  ],
  chosen: "seven",
  why:
    "One rich tree reaches most refusals by who runs the command and on which budget, which keeps eval worlds few and " +
    "restores fast; waiting proposals and frozen ceilings change what every write refuses, so they are their own worlds. " +
    "Claims that need a Board of one Director (allowance change #3) run in org-with-budget-tree after `org board " +
    "threshold 1`.",
  source: by("books/target/budgets/operations.ts (every refusal's given); environments.devnet (worlds are snapshots)"),
  affects: ALL_OPERATIONS,
});

// ── across concepts ─────────────────────────────────────────────────────────────────────────

export const decision_budgets_notices_need_budgets = defineDecision({
  id: "budgets.notices-need-budgets",
  title: "The allowance email needs notices to depend on budgets",
  question:
    "'Once a v4 assign executes, the member is emailed the allowance at its amount now.' Notices sends every email, but " +
    "its dependsOn did not list budgets. Who sends it?",
  options: [
    { label: "notices-depends", text: "Add budgets to notices' dependsOn: a notice workflow triggered by budget-change.apply reads the change and the allowance, and the chain's amount." },
    { label: "board-proposal", text: "Notices reacts to board's proposal_transitioned and reads nothing of budgets." },
  ],
  chosen: "notices-depends",
  why:
    "Only budgets knows a proposal carried an allowance assign, to whom and on which budget; board's proposal does not. " +
    "Budgets sits below notices, so the edge makes no cycle (dependencies.notices-top). Settled at assembly: the " +
    "architecture review added the edge (dependencies.notices-budgets) and notices follows budget-change.apply " +
    "(books/target/notices/budgets.ts). Budgets books nothing that sends mail.",
  source: by("org.allowance.assign.yaml #5; dependencies.notices-budgets; books/target/notices/budgets.ts"),
  affects: [concept_notices, concept_budgets, machine_budget_change],
});

export const decision_budgets_invitation_offers = defineDecision({
  id: "budgets.invitation-allowance-offers",
  title: "An invitation offers officer hats, existing allowances or one new allowance",
  question:
    "Organizations' invitation Offer has `officer` (a hat), `allowance` (a budget id) and `new-allowance` (name, asset, " +
    "limit). Which can the Board batch of an invitation's grants carry, and what does a new allowance's `limit` mean on v4?",
  options: [
    {
      label: "all-three",
      text:
        "All three, planned by budgets: an officer hat's or existing allowance's `Hats.mintHat`, and a new allowance's " +
        "`Hats.createHat`, `Budgets.createChildBudget(parent, limit, hat)` and `Hats.mintHat`, with its budgets row; " +
        "`limit` is its amount per period, under the one open top budget in that asset and in that budget's period.",
    },
    { label: "existing-only", text: "Only officer hats and existing allowances; a new allowance is `org allowance create --assign-to` once the invitee is a member." },
    { label: "period-flag", text: "All three, with a new `--period` flag for the new allowance." },
  ],
  chosen: "all-three",
  why:
    "Revised at assembly. This record first chose existing-only, because board owned the flow and could not plan an " +
    "allowance; the review moved `org member invite` to budgets (operations.member-invite-in-budgets), and P10 rung 1 " +
    "keeps the frozen offer of 'a new spending allowance'. The designed call names exactly `createHat`, " +
    "`createChildBudget` and `mintHat`, and `createChildBudget` takes one number, so the designed `--limit <amount>` is " +
    "the child budget's amount; v4 has no per-payment cap. The designed synopsis has no period, and a child takes its " +
    "parent's period, so the parent is the one open top budget in `--asset` (none or several is INVALID_INPUT, as " +
    "`org allowance create` refuses without `--parent`). Adding a flag would change the frozen surface. The pre-v4 " +
    "`--unlimited`, `--recipient-account`, `--any-recipient` and `--actions` are not in the designed synopsis.",
  source: by(
    "org.member.invite.yaml (about; designed synopsis and call); apps/cli/src/commands/org-invite/member/subcommands/invite/command.ts:10; " +
      "books/target/organizations/data.ts (Offer); operations.member-invite-in-budgets",
  ),
  affects: [rpc_budgets_invitations_plan, rpc_budgets_invitations_propose, op.operation_org_member_invite, rpc_budgets_allowances_create],
});

export const decision_budgets_member_invite_flow = defineDecision({
  id: "budgets.member-invite-flow",
  title: "`org member invite`: plan, invite, then one proposal bound to the invitation",
  question:
    "The invitation is organizations' row and the grants are one Board proposal. In what steps does budgets' flow write " +
    "them, and how is a refusal kept from leaving a half-made invitation?",
  options: [
    {
      label: "plan-invite-propose",
      text:
        "A read first (`budgets.invitations.plan`, also `--preview`) refuses what it can before anything is written; then " +
        "organizations' invite rpc; then `budgets.invitations.propose`, one transaction that births a new allowance's row and " +
        "create change, opens the proposal (`board.propose`) and binds it (`organizations.bind-invitation-grants`).",
    },
    {
      label: "one-rpc",
      text: "One budgets rpc that writes the invitation too, through a new organizations procedure that births an invitation.",
    },
  ],
  chosen: "plan-invite-propose",
  why:
    "An invitation is not a money fact on its own, so a new organizations procedure to birth one would go past P4; the " +
    "money fact is the grants and the Safe transaction carrying them, which is what the bind procedure already records. " +
    "The plan checks the People and Director hats and every grant first, so the frozen 'needs you to be a Director' is " +
    "refused with nothing written; if the propose step still fails (the Board's gate turned off, the parent's room " +
    "spent), the invitation stays `authorizing` with no binding, a rerun with the same request key proposes it, and " +
    "`org invite cancel` cancels it at once. The propose transaction invokes two procedures of two concepts (board, " +
    "organizations), within sys:tx-width; board.propose opens the approval inside it. The returns add `grants` and " +
    "`commandId` (the Board proposal, the old configure command) to organizations' invitation view, as the frozen " +
    "returns list them. Its refusals are reached from org-with-member (Sam has no People hat), org-with-budget-tree (Pat " +
    "wears it but is no Director), org-with-pending-invitation, org-with-granted-invitation and cli-signed-out.",
  source: by(
    "org.member.invite.yaml (who, changes, returns, refusals); books/target/organizations/invitations.ts (invite rpc); " +
      "books/target/organizations/procedures.ts; rules.procedures; P4",
  ),
  affects: [
    flow_client_org_invitations_invite,
    rpc_budgets_invitations_plan,
    rpc_budgets_invitations_propose,
    op.operation_org_member_invite,
    machine_budget,
    machine_budget_change,
  ],
});

export const decision_budgets_member_invite_acceptance = defineDecision({
  id: "budgets.member-invite-acceptance",
  title: "`org member invite` #1 is rewritten from rows to what a reader sees",
  question: "Line 1 says it 'writes one authorizing invitation and one configure command'. A black box sees neither row. What does it check?",
  options: [
    { label: "outcome", text: "The invitation reads `authorizing` with one Board proposal of all its grants (its commandId), and the invitee is admitted with no welcome email." },
    { label: "keep", text: "Keep the line, checked by reading Postgres." },
  ],
  chosen: "outcome",
  why:
    "P1: a claim that names a row is rewritten as an outcome an observer can check. The configure command is the v4 " +
    "Board proposal, which `org proposal get` reads; admission is `waitlist status` as the invitee; the welcome email's " +
    "absence is `dev mail list`. The old system passes it: one authorizing invitation with one configure command, the " +
    "invitee admitted. Lines 2 to 5 are kept word for word.",
  source: by("org.member.invite.yaml #1; P1"),
  affects: [op.operation_org_member_invite],
});

export const decision_budgets_invitation_grants_return = defineDecision({
  id: "budgets.invitation-grants-return",
  title: "Budgets proposes taking an ended invitation's hats back, once",
  question:
    "An invitation declined, cancelled or expired after its Board batch minted hats waits in `revoking` until the hats " +
    "are gone. Who proposes their return, and who proposes it when no person is acting?",
  options: [
    {
      label: "follower-once",
      text:
        "A budgets workflow on organizations' `begin_cleanup` opens one Board proposal burning every hat the grantee's " +
        "Safe still wears; the proposer is the inviter while a Director, else the Director with the oldest current Seat.",
    },
    { label: "manual", text: "Nothing automatic: the Directors run `org member revoke` and `org allowance revoke`." },
    { label: "until-gone", text: "The workflow proposes again after every proposal that ends without effect." },
  ],
  chosen: "follower-once",
  why:
    "The review gave the return to budgets with the grants (operations.member-invite-in-budgets), and organizations' " +
    "process waits for it. `board.propose` needs a proposing Director, and the end of an offer is often nobody's act (an " +
    "expiry) or the invitee's (a decline); the inviter granted the hats, so their approval opens first, and the oldest " +
    "Director is a deterministic fallback. The hats are burned with `setHatWearerStatus(…, false, true)`, as " +
    "`org allowance revoke` does, so the Safe can be granted again later. Proposing again after a rejection would loop " +
    "against the Directors' own answer; they keep the manual commands, and the invitation ends when the chain shows no " +
    "hat worn.",
  source: by(
    "books/target/organizations/processes.ts (organizations.invitations.follow: revoking); books/target/board/officers.ts (board.officers.revoke); " +
      "packages/backend/src/organizations/invitations/writes/endings.ts:175",
  ),
  affects: [workflow_budgets_invitations_return_grants, contract_hats],
});

export const decision_budgets_dropped_functions = defineDecision({
  id: "budgets.dropped-old-functions",
  title: "Old department and allowance plumbing is not ported",
  question: "Which old rpcs and workflows of departments and allowances have no target record?",
  options: [
    {
      label: "plumbing",
      text:
        "load, read, record, load-command, record-command, load-list, the replacement preview and prepare, keep-budget-ids " +
        "and settle (now the change's process), emit-change-proposed (the runtime's outbox, P7), notice-facts and notify " +
        "(notices'), and the pre-v4 authorities (payments' read).",
    },
    { label: "port", text: "Port them as internal rpcs." },
  ],
  chosen: "plumbing",
  why:
    "They were Convex's internal queries and mutations an action ran in the same call (P2: no unreached rpc), telemetry " +
    "plumbing (P7) or settlement on read (budgets.one-process-per-change). Their behaviour lives in the one transaction of " +
    "each target rpc and in the change's process.",
  source: by("books/as-is/payroll/departments.ts:656-903; packages/backend/src/permissions/allowances/operations; P2; P3"),
  affects: [concept_budgets, workflow_budgets_changes_follow, rpc_budgets_changes_get],
});
