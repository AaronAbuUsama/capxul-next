// The Core SDK flows of the target budgets concept (A4): one SDK method per write operation, which
// the CLI calls and nothing else. Every write has the same shape: keep one request key, prepare the
// change (one rpc, which opens the Board proposal or the office holder's approval), check the calls
// the approval carries are exactly the change asked for, have the person sign, wait for the chain or
// the other Directors, and read the change back. The reads are one rpc each, so their operations are
// implemented by the rpc and have no flow. `org allowance replace` is refused on v4 without a call.

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_FEATURE_NOT_AVAILABLE } from "../shared/vocabulary.ts";
import { rpc_budgets_allowances_create } from "./allowances.ts";
import { rpc_budgets_ceilings_freeze, rpc_budgets_ceilings_set, rpc_budgets_ceilings_unfreeze } from "./ceilings.ts";
import { rpc_budgets_changes_get } from "./changes.ts";
import { rpc_budgets_departments_create } from "./departments.ts";
import { InviteInput, InviteResult, rpc_budgets_invitations_plan, rpc_budgets_invitations_propose } from "./invitations.ts";
import { rpc_organizations_invitations_invite } from "../organizations/invitations.ts";
import { rpc_budgets_offices_add_holder, rpc_budgets_offices_remove_holder } from "./offices.ts";
import { rpc_budgets_tree_close, rpc_budgets_tree_reopen, rpc_budgets_tree_set_amount } from "./tree.ts";
import {
  AllowanceCreated,
  AmountPrepared,
  BudgetWriteInput,
  CeilingFreezeInput,
  CeilingPrepared,
  CeilingSetInput,
  CeilingUnfreezeInput,
  CreateAllowanceInput,
  CreateDepartmentInput,
  DepartmentCreated,
  HolderInput,
  HolderPrepared,
  Nothing,
  OpenStatePrepared,
  SetAmountInput,
} from "./shapes.ts";

const SDK_PAY = "packages/sdk/src/payroll";
const SDK_PERM = "packages/sdk/src/permissions";

/** A write's client time: the prepare rpc and the reads back; a person's wait and chain confirmation never count. */
const WRITE_BUDGET = { ...budget("chain-submit"), excludes: ["wait.person", "chain.confirm"] };

/** The steps every write flow takes, around its one prepare rpc and the check of its calls. */
const steps = (prepare: Rpc, calls: string) => [
  {
    name: "request-key",
    local: "cache" as const,
    about: "Keeps one request key for this command: `--request-key`, or a new one held until it ends, so a retried prepare answers the same change.",
  },
  { name: "prepare", rpc: prepare, about: "Refuses or prepares the change, with the caller's approval and any Board proposal." },
  {
    name: "check-calls",
    local: "build" as const,
    about: `Decodes the calls the approval carries and refuses to sign anything but ${calls}.`,
  },
  {
    name: "sign",
    local: "sign" as const,
    about: "The person signs their own approval on the approval page (an agent with its own key): the Board proposal's first approval, or the change itself.",
  },
  {
    name: "wait",
    local: "wait" as const,
    about: "Unless `--no-wait`, follows the approval until it lands; with `--wait`, the Board proposal until it executes or can never run.",
  },
  { name: "read-back", rpc: rpc_budgets_changes_get, about: "Reads the change as it stands now: waiting, executed, or how it ended." },
];

// ── departments ─────────────────────────────────────────────────────────────────────────────

export const flow_client_org_departments_create = defineFlow({
  id: "client.org.departments.create",
  title: "Create a department or a team, and sign it",
  about:
    "Parses `--budget <amount>/<year|quarter|month>` (a week is refused by the rpc), prepares the create, checks the batch " +
    "holds only the office hat, its holders' mints, the ceiling's calls for a top budget and the one budget create, then " +
    "signs. On a 1-of-N Board the caller's approval executes it at once; otherwise the result says how many Directors must " +
    "still run `org proposal approve`.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.create",
  input: CreateDepartmentInput,
  output: DepartmentCreated,
  steps: steps(rpc_budgets_departments_create, "the office hat, its holders' mints, the token's ceiling calls and one budget create under the planned hat"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`, `${SDK_PAY}/department-batch.ts:1`],
});

export const flow_client_org_departments_set_amount = defineFlow({
  id: "client.org.departments.set-amount",
  title: "Set a department's budget, and sign it",
  about:
    "Prepares the budget's new amount per its own period and checks the calls are one `Budgets.setAmount` on that " +
    "budget's id, with a top budget's ceiling resize before it, then signs.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.setAmount",
  input: SetAmountInput,
  output: AmountPrepared,
  steps: steps(rpc_budgets_tree_set_amount, "one `Budgets.setAmount` on the budget's own id and, for a top budget, its ceiling resize"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`, `${SDK_PAY}/department-checks.ts:1`],
});

export const flow_client_org_departments_close = defineFlow({
  id: "client.org.departments.close",
  title: "Close a department's budget, and sign it",
  about: "Prepares the close and accepts only one `Budgets.close` on the department's own budget before it signs.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.close",
  input: BudgetWriteInput,
  output: OpenStatePrepared,
  steps: steps(rpc_budgets_tree_close, "one `Budgets.close` on the department's own budget id"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/department-checks.ts:1`],
});

export const flow_client_org_departments_reopen = defineFlow({
  id: "client.org.departments.reopen",
  title: "Reopen a closed department, and sign it",
  about: "Prepares the reopen and accepts only one `Budgets.reopen` on the department's own budget before it signs.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.reopen",
  input: BudgetWriteInput,
  output: OpenStatePrepared,
  steps: steps(rpc_budgets_tree_reopen, "one `Budgets.reopen` on the department's own budget id"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/department-checks.ts:1`],
});

export const flow_client_org_departments_holders_add = defineFlow({
  id: "client.org.departments.holders.add",
  title: "Add a holder to a department's office, and sign it",
  about: "Prepares the holder's mint and accepts only the hat's one more place, when full, and its one mint to the holder's Safe.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.holders.add",
  input: HolderInput,
  output: HolderPrepared,
  steps: steps(rpc_budgets_offices_add_holder, "a `changeHatMaxSupply` when the hat is full and one `mintHat` of the office hat to the holder's Safe"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`],
});

export const flow_client_org_departments_holders_remove = defineFlow({
  id: "client.org.departments.holders.remove",
  title: "Take a holder off a department's office, and sign it",
  about: "Prepares the removal and accepts only the one ruling, or the one hand-back, of the office hat for that holder's Safe.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.holders.remove",
  input: HolderInput,
  output: HolderPrepared,
  steps: steps(rpc_budgets_offices_remove_holder, "one `setHatWearerStatus` or `transferHat` of the office hat for the holder's Safe"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`],
});

// ── payout ceilings ─────────────────────────────────────────────────────────────────────────

export const flow_client_org_departments_ceiling_set = defineFlow({
  id: "client.org.departments.ceiling.set",
  title: "Set a token's payout ceiling, and sign it",
  about:
    "Parses `<amount>/year` (no period, `/336d` or 0 is CLI_USAGE before any call), prepares the ceiling and accepts " +
    "only the one `Roles.setAllowance` on that token's ceiling key before it signs.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.ceiling.set",
  input: CeilingSetInput,
  output: CeilingPrepared,
  steps: steps(rpc_budgets_ceilings_set, "one `Roles.setAllowance` on the token's `v4-payout-ceiling:` key"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`],
});

export const flow_client_org_departments_ceiling_freeze = defineFlow({
  id: "client.org.departments.ceiling.freeze",
  title: "Freeze payouts in one token, and sign it",
  about: "Prepares the freeze and accepts only the one `Roles.setAllowance` that leaves `--leave` with no refill.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.ceiling.freeze",
  input: CeilingFreezeInput,
  output: CeilingPrepared,
  steps: steps(rpc_budgets_ceilings_freeze, "one `Roles.setAllowance` on the token's ceiling key with no refill"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`],
});

export const flow_client_org_departments_ceiling_unfreeze = defineFlow({
  id: "client.org.departments.ceiling.unfreeze",
  title: "Unfreeze payouts in one token, and sign it",
  about: "Prepares the unfreeze and accepts only the one `Roles.setAllowance` that restores what the freeze kept.",
  component: component_core_sdk,
  sdk: "client.org(orgId).departments.ceiling.unfreeze",
  input: CeilingUnfreezeInput,
  output: CeilingPrepared,
  steps: steps(rpc_budgets_ceilings_unfreeze, "one `Roles.setAllowance` on the token's ceiling key restoring the freeze's saved allowance"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PAY}/departments.ts:1`],
});

// ── allowances ──────────────────────────────────────────────────────────────────────────────

export const flow_client_org_allowances_create = defineFlow({
  id: "client.org.allowances.create",
  title: "Create a spending allowance, and sign the Board proposal",
  about:
    "Reads the policy from `--input` (a file or stdin, at most 64 KiB) or asks for it at a terminal; `--confirm` is " +
    "CLI_USAGE, because the approval page is the confirmation. Prepares the allowance and accepts only its hat, its child " +
    "budget and, with `--assign-to`, the hat's one mint.",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.create",
  input: CreateAllowanceInput,
  output: AllowanceCreated,
  steps: steps(rpc_budgets_allowances_create, "one `createHat` under the Board's top hat, one `createChildBudget` under the parent, and the first wearer's `mintHat`"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PERM}/allowance-create.ts:1`, `${SDK_PERM}/allowance-dispatch.ts:1`],
});

export const flow_client_org_allowances_change = defineFlow({
  id: "client.org.allowances.change",
  title: "Change an allowance's amount, and sign it",
  about:
    "Reads the new `amount` from `--input`; a changed asset or period is refused by the rpc. Prepares the budget's new " +
    "amount and accepts only one `Budgets.setAmount` on the allowance's budget id.",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.change",
  input: SetAmountInput,
  output: AmountPrepared,
  steps: steps(rpc_budgets_tree_set_amount, "one `Budgets.setAmount` on the allowance's own budget id"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PERM}/allowance-writes.ts:1`],
});

export const flow_client_org_allowances_assign = defineFlow({
  id: "client.org.allowances.assign",
  title: "Give an allowance to one more member, and sign the Board proposal",
  about:
    "Prepares the hat's mint to the member's Safe and accepts only a `changeHatMaxSupply` when full and the one `mintHat`. " +
    "It names the budget as every command does (key, `allowance_` or `dep_` id, chain id), and the shared rpc holds the " +
    "budget to its kind's rules: a department's or team's office named here is refused to a wearer of the People hat " +
    "with ROLE_CONFLICT, as `org department holder add` is (decisions budgets.one-write-per-chain-call, " +
    "budgets.role-conflict-people-hat).",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.assign",
  input: HolderInput,
  output: HolderPrepared,
  steps: steps(rpc_budgets_offices_add_holder, "a `changeHatMaxSupply` when the hat is full and one `mintHat` of the allowance's hat to the member's Safe"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PERM}/allowance-writes.ts:1`],
});

export const flow_client_org_allowances_revoke = defineFlow({
  id: "client.org.allowances.revoke",
  title: "Take one member off an allowance, and sign the Board proposal",
  about: "Prepares the ruling and accepts only one `setHatWearerStatus(hat, memberSafe, false, true)`.",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.revoke",
  input: HolderInput,
  output: HolderPrepared,
  steps: steps(rpc_budgets_offices_remove_holder, "one `setHatWearerStatus(hat, memberSafe, false, true)` of the allowance's hat"),
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [`${SDK_PERM}/allowance-writes.ts:1`],
});

export const flow_client_org_allowances_replace = defineFlow({
  id: "client.org.allowances.replace",
  title: "Refuse the Roles module replacement, which v4 removed",
  about:
    "Removed in v4: allowances are budgets and hats, Roles holds only Budgets' payout role, and contracts are not " +
    "upgraded in place. The CLI calls it without resolving an environment's deployment, a sign-in or an Organization, " +
    "and it fails FEATURE_NOT_AVAILABLE at once, before any call, so every caller on every environment gets that refusal " +
    "and nothing is prepared or signed (decision budgets.replace-removed).",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.replace",
  input: Schema.Struct({ orgId: Schema.String }),
  output: Nothing,
  steps: [],
  errors: [error_FEATURE_NOT_AVAILABLE],
  calls: [],
  spans: [],
  budget: budget("read"),
  was: ["packages/backend/src/permissions/replacements/rules.ts:1", `${SDK_PERM}/allowance-dispatch.ts:1`],
});

// ── invitations ─────────────────────────────────────────────────────────────────────────────

export const flow_client_org_invitations_invite = defineFlow({
  id: "client.org.invitations.invite",
  title: "Invite someone to a Seat, and sign the Board proposal of its grants",
  about:
    "`org member invite` (decision operations.member-invite-in-budgets). Keeps one request key, plans the offer (the " +
    "People hat, the Director hat for any grant, every grant's calls) and, with `--preview`, prints it and stops. Then " +
    "organizations writes the invitation and admits a person invitee to the beta; a Seat-only offer is pending at once " +
    "and needs no approval. An offer with grants is `authorizing`: budgets opens one Board proposal of all of them, bound " +
    "to the invitation, the flow checks the batch holds only the planned mints (and a new allowance's hat and child " +
    "budget), and the inviter signs their approval on the approval page. A rerun with the same request key answers the " +
    "same invitation and proposal; when the invitation was written but its proposal was not (a refusal after the " +
    "invite), the rerun proposes it. `--confirm` is CLI_USAGE: the approval page is the confirmation.",
  component: component_core_sdk,
  sdk: "client.org(orgId).invitations.invite",
  input: InviteInput,
  output: InviteResult,
  steps: [
    {
      name: "request-key",
      local: "cache",
      about: "Keeps one request key for this command (`--request-key`, or a new one at a terminal), printed before anything is written.",
    },
    { name: "plan", rpc: rpc_budgets_invitations_plan, about: "Refuses before anything is written, and plans each grant." },
    { name: "preview", local: "prompt", about: "With `--preview`: prints the grantee, each offer and whether the Board signs, then stops." },
    { name: "invite", rpc: rpc_organizations_invitations_invite, about: "Writes the invitation, or returns the one this request key made." },
    { name: "propose", rpc: rpc_budgets_invitations_propose, about: "An offer with grants: the one Board proposal of all of them, bound to the invitation." },
    { name: "check-calls", local: "build", about: "Decodes the batch and refuses to sign anything but the planned mints, hat and child budget." },
    { name: "sign", local: "sign", about: "The inviter signs their approval of the proposal on the approval page (an agent with its own key)." },
    { name: "wait", local: "wait", about: "Unless `--no-wait`, follows the inviter's approval until it lands; the other Directors approve with `org proposal approve`." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
  was: [
    "packages/sdk/src/organizations/invitations.ts:1",
    "packages/sdk/src/organizations/invite-execution.ts:1",
    "apps/cli/src/commands/org-invite/member/subcommands/invite/command.ts:43",
  ],
});
