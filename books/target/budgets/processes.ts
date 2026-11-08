// The durable processes of the target budgets concept: one per budget change (A3). A change is a
// long-lived object: its Board proposal may wait days for the Directors, an office holder's
// approval for its signer and the chain. Budgets has no sweep and no cron: everything the old code
// settled on read (each department action settled waiting changes in nonce order; allowance
// commands were settled by `settle`) is this process, resumed by its carrier's end. One outbox
// follower takes an ended invitation's grants back (decision budgets.invitation-grants-return); the
// invitation's own process (organizations) waits for the chain to show them gone.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_budgets, contract_hats, integration_indexer } from "../shared/external.ts";
import { table_principals } from "../access/data.ts";
import { table_chain_budgets, table_hat_wearers } from "../indexing/data.ts";
import {
  machine_org_invite,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
} from "../organizations/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget, machine_budget_change, table_budget_changes, table_budgets } from "./data.ts";

const PAY = "packages/backend/src/payroll/departments";
const PERM = "packages/backend/src/permissions/allowances";
const MINUTE = 60_000;

export const workflow_budgets_changes_follow = defineWorkflow({
  id: "budgets.changes.follow",
  title: "One budget change, from its proposal to applied or abandoned",
  about:
    "Started by the change's birth (budget-change.propose, through the outbox), one instance per change, and the only " +
    "writer of the change's state and of a created budget's status after their birth. It waits for the end of the " +
    "carrier the change names, which board and approvals announce through the outbox: the Board proposal executed, or " +
    "can never run (a rejection or another transaction took its nonce, or it ran and failed), from proposal_transitioned; " +
    "the office holder's approval landed, reverted, declined or expired, from approval_transitioned. When the carrier " +
    "executed it reads the indexed facts of that transaction (`factsOf`, at the deployment's finality depth) and applies " +
    "the change only when they hold its own effect: BudgetCreated for the company Safe with the planned hat, token, " +
    "period and parent (which binds `budget_id` and activates the budget), BudgetAmountSet, BudgetClosed or " +
    "BudgetReopened on the budget's id, the hat's mint or burn for the holder's Safe, or the ceiling batch's execution. " +
    "A transaction that ran without its effect abandons it as failed, and a create's budget with it (its key is freed). " +
    "A carrier that can never run abandons it with that outcome. Each settlement is one transaction. `timeoutMs` bounds " +
    "each step; the waits are durable and have no deadline: a proposal nobody approves waits until a Director rejects it. " +
    "It replaces old payroll's settle-on-read and keep-budget-ids, and old permissions' allowance settle and settle-command.",
  was: [
    `${PAY}/operations/settle.ts:1`,
    `${PAY}/operations/keep-budget-ids.ts:1`,
    `${PAY}/writes.ts:232`,
    `${PERM}/operations/settle.ts:1`,
    `${PERM}/operations/settle-command.ts:1`,
    `${PERM}/rules/settlement.ts:23`,
  ],
  concept: concept_budgets,
  priority: "normal",
  trigger: { transition: machine_budget_change.t.propose },
  instance: { per: table_budget_changes },
  waits: [
    {
      name: "carrier",
      for: "person",
      about: "The Directors approve the Board proposal, or the office holder signs or declines; proposal_transitioned or approval_transitioned, routed by opener budgets and the change as subject, resumes it.",
    },
    {
      name: "executed",
      for: "chain",
      about: "The carrier's transaction lands, reverts or is displaced on chain proof, as board and approvals report it (opener budgets, the change as subject).",
    },
    {
      name: "indexed",
      for: "indexer",
      events: [contract_budgets.e.BudgetCreated, contract_budgets.e.BudgetAmountSet, contract_budgets.e.BudgetClosed, contract_budgets.e.BudgetReopened, contract_hats.e.TransferSingle],
      timeoutMs: 10 * MINUTE,
      about: "Ponder has indexed the executed transaction (by chain and hash) at finality, so its Budgets and Hats facts can be read.",
    },
  ],
  steps: [
    { name: "await-carrier", about: "Waits for the carrier's end; a second delivery of the same end is a no-op." },
    { name: "read-effect", about: "On execution: reads the transaction's indexed facts and finds the change's own effect." },
    { name: "settle", about: "In one transaction: applies or abandons the change, and activates (binding its chain id) or abandons a created budget." },
  ],
  reads: [table_budget_changes, table_budgets, table_chain_budgets],
  writes: [table_budget_changes, table_budgets],
  drives: [
    machine_budget_change.t.apply,
    machine_budget_change.t.abandon,
    machine_budget.t.activate,
    machine_budget.t.abandon,
  ],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.factsOf, integration_indexer.c.awaitBlock],
  chain: [],
  idempotency: "One instance per change_id; settle drives a transition only on a change still proposed, so a second run does nothing.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None: nothing is written until the carrier has ended, and the settlement is one transaction. A step that fails " +
    "retries; Ponder still behind after its wait leaves the change proposed and the process waiting for the next attempt.",
  budget: budget("background"),
});

export const workflow_budgets_invitations_return_grants = defineWorkflow({
  id: "budgets.invitations.return-grants",
  title: "Propose taking back the hats an ended invitation granted",
  about:
    "Triggered by an invitation's `begin_cleanup` (declined, cancelled or expired while the hats its Board batch minted " +
    "are on chain), through the outbox. It cannot be a step of the rpc that ended the offer: that is organizations', and " +
    "the expiry is the invitation's own timer. It reads the invitation's granted hats and the grantee's Safe, keeps the " +
    "hats that Safe still wears (indexing's hat-wearers), and opens one Board proposal of " +
    "`Hats.setHatWearerStatus(hat, granteeSafe, false, true)` for each (burned, the wearer kept in good standing, as " +
    "`org allowance revoke` does), with `board.propose` (opener budgets, subject `invitation-return:<invitationId>`). The " +
    "proposer is the invitation's inviter while their Seat wears the Director hat, else the Director with the oldest " +
    "current Seat; their approval waits on the approval page like any proposal. A new allowance the batch created stays a " +
    "budget with no wearer. Nothing is returned when the Safe wears none of them. If the Directors reject the proposal, " +
    "`org member revoke` and `org allowance revoke` take the hats back one at a time; the invitation's process ends the " +
    "offer when the chain shows none worn.",
  was: [
    "packages/backend/src/organizations/invitations/writes/endings.ts:175",
    "packages/backend/src/organizations/invitations/writes/retirements.ts:28",
    "books/as-is/organizations/invitations.ts:586",
  ],
  concept: concept_budgets,
  priority: "normal",
  trigger: { transition: machine_org_invite.t.begin_cleanup },
  steps: [
    { name: "read", about: "Reads the invitation's granted hats and grantee Safe, and the hats that Safe still wears." },
    { name: "proposer", about: "The inviter while a Director, else the Director with the oldest current Seat." },
    { name: "propose", about: "One transaction: the Board proposal of every hat's burn for the grantee's Safe (`board.propose`)." },
  ],
  reads: [table_org_invitations, table_org_members, table_org_deployments, table_principals, table_hat_wearers],
  writes: [],
  drives: [],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [],
  chain: [contract_hats.f.setHatWearerStatus],
  idempotency:
    "board.propose answers the proposal already carrying subject `invitation-return:<invitationId>` (`opened: false`), so a " +
    "replayed event opens nothing new.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});
