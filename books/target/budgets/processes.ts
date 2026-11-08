// The durable processes of the target budgets concept: one per budget change (A3). A change is a
// long-lived object: its Board proposal may wait days for the Directors, an office holder's
// approval for its signer and the chain. Budgets has no sweep and no cron: everything the old code
// settled on read (each department action settled waiting changes in nonce order; allowance
// commands were settled by `settle`) is this process, resumed by its carrier's end.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { integration_indexer } from "../shared/external.ts";
import { table_chain_budgets } from "../indexing/data.ts";
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
      about: "The Directors approve the Board proposal, or the office holder signs or declines; proposal_transitioned or approval_transitioned resumes it.",
    },
    {
      name: "executed",
      for: "chain",
      about: "The carrier's transaction lands, reverts or is displaced on chain proof, as board and approvals report it.",
    },
    {
      name: "indexed",
      for: "indexer",
      timeoutMs: 10 * MINUTE,
      about: "Ponder has indexed the executed transaction at finality, so its Budgets and Hats facts can be read.",
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
