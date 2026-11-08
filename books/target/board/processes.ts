// The durable processes of the board concept (A3): one per Board proposal and one per Board change.
// Both are long-lived objects: a proposal waits days for its Directors and then for the transaction at
// its nonce; a Board change waits for its actor's signature and the chain. Board has no sweep and no
// cron: what the old code settled on every read (`refreshProposals`, each proposal action) and what
// its follow job polled for (`organizations.directors.follow`) is each process's own wait.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import { integration_indexer } from "../shared/external.ts";
import { table_hat_wearers, table_safe_approvals, table_safe_executions, table_safe_owners } from "../indexing/data.ts";
import { table_approvals } from "../approvals/data.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import {
  machine_board_change,
  machine_officer_change,
  machine_proposal,
  table_board_changes,
  table_board_proposals,
  table_officer_changes,
  table_proposal_approvals,
} from "./data.ts";

const OLD = "packages/backend/src/organizations";
const MINUTE = 60_000;

export const workflow_board_proposals_carry = defineWorkflow({
  id: "board.proposals.carry",
  title: "One Board proposal, from birth to the transaction at its nonce",
  about:
    "Born by its proposal's birth (proposal.propose, through the outbox) and the only writer of the proposal's status " +
    "after it. It waits for the Directors and then for the one transaction that uses its Safe nonce, from indexing's " +
    "safe-executions at the deployment's finality depth: an ExecutionSuccess naming its own hash executes it, an " +
    "ExecutionFailure naming it fails it, the hash of a Capxul rejection that rejects it rejects it, and any other hash " +
    "replaces it (a transaction made outside Capxul, or another proposal at the same nonce). Nothing resumes it but the " +
    "chain, so it has no signal: a Director's approval is an approval of its own, and the Gate, not Capxul, counts " +
    "them. Settling is one transaction: the status with the approvals and threshold it settled with; for a proposal " +
    "board opened itself, its officer change applied when the execution's indexed facts hold the hat minted to or " +
    "burned from the member's Safe, else ended; and each Director's approval of it still unsigned withdrawn " +
    "(`approvals.withdraw`), so nobody signs for a nonce already used. Every other opener follows " +
    "`proposal_transitioned` and settles its own intent. The waits are durable and have no deadline: a proposal nobody " +
    "approves waits until a Director rejects it or another transaction takes its nonce.",
  was: [
    `${OLD}/proposals/rules.ts:180`,
    `${OLD}/proposals/writes/settlements.ts:36`,
    `${OLD}/proposals/writes/subjects.ts:55`,
    `${OLD}/proposals/operations/follow-approval.ts:1`,
    "books/as-is/organizations/proposals.ts:1264",
  ],
  concept: concept_board,
  priority: "normal",
  trigger: { transition: machine_proposal.t.propose },
  instance: { per: table_board_proposals },
  waits: [
    {
      name: "directors",
      for: "person",
      about: "The Directors approve its hash from their own Safes until the approval that reaches the threshold executes it.",
    },
    {
      name: "nonce-used",
      for: "indexer",
      about: "Ponder has indexed, at finality, the ExecutionSuccess or ExecutionFailure that used the proposal's Safe nonce.",
    },
  ],
  steps: [
    { name: "await-nonce", about: "Waits for the indexed execution at its Safe nonce; a second delivery of the same execution is a no-op." },
    { name: "read-effect", about: "For its own execution of an officer change: reads that transaction's indexed facts for the hat's mint or burn." },
    { name: "settle", about: "In one transaction: the proposal's end, its officer change applied or ended, its unsigned Director approvals withdrawn." },
  ],
  reads: [
    table_board_proposals,
    table_proposal_approvals,
    table_officer_changes,
    table_approvals,
    table_safe_executions,
    table_safe_approvals,
    table_safe_owners,
    table_hat_wearers,
  ],
  writes: [table_board_proposals, table_officer_changes],
  drives: [
    machine_proposal.t.execute,
    machine_proposal.t.fail,
    machine_proposal.t.reject,
    machine_proposal.t.replace,
    machine_officer_change.t.apply,
    machine_officer_change.t.end,
  ],
  invokes: [procedure_approvals_withdraw],
  emits: [],
  calls: [integration_indexer.c.factsOf],
  chain: [],
  idempotency: "One instance per proposal_id; settle drives a transition only on a proposal still awaiting_approvals, so a second run does nothing.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None: nothing is written until the nonce is used, and the settlement is one transaction. A failed step retries; " +
    "Ponder behind the chain leaves the proposal waiting.",
  budget: budget("background"),
});

export const workflow_board_changes_carry = defineWorkflow({
  id: "board.changes.carry",
  title: "One Board change, from its actor's approval to the chain",
  about:
    "Born by the change's birth (board-change.open, through the outbox) and the only writer of its status after it. It " +
    "waits for its approval's end, which approvals announces with `approval_transitioned` (opener board, the change as " +
    "subject): an approval that ended unlanded fails it with approvals' mapping (decision board.approval-endings): " +
    "declined or withdrawn CANCELLED, expired or displaced WRONG_STATE, reverted TRANSACTION_FAILED, refused its stored " +
    "code (a lapsed seat, a refused simulation); landed reads the indexed facts of its transaction at finality and ends it as its action only " +
    "when they hold its effect: for a seat or a claim, the Safe added as an owner of the company Safe (and the Director " +
    "hat minted to it); for a removal or a refresh, each named Safe removed as an owner; for a threshold, the Safe's " +
    "ChangedThreshold to the new one; for a handover, the Governor wearing the Shareholders' top hat. A landing without " +
    "its effect fails it as TRANSACTION_FAILED. The change is as of its block, whatever the Board shows later. Its end " +
    "frees the Organization for the next Board change, and its `board_change_transitioned` is what notices emails a " +
    "seated member from.",
  was: [
    `${OLD}/directors/operations/follow.ts:1`,
    `${OLD}/directors/operations/record-outcome.ts:1`,
    `${OLD}/directors/external/settle.ts:1`,
    "books/as-is/organizations/directors.ts:791",
  ],
  concept: concept_board,
  priority: "low",
  trigger: { transition: machine_board_change.t.open },
  instance: { per: table_board_changes },
  waits: [
    {
      name: "signature",
      for: "person",
      about: "The actor signs their approval on the approval page (an agent with its own key), or declines it.",
    },
    {
      name: "approval",
      for: "chain",
      about: "The approval lands, reverts, expires or is displaced on chain proof, as approval_transitioned reports it, routed by opener board and the change as subject.",
    },
    {
      name: "indexed",
      for: "indexer",
      timeoutMs: 10 * MINUTE,
      about: "Ponder has indexed the landed transaction at finality, so its Safe and Hats facts can be read.",
    },
  ],
  steps: [
    { name: "await-approval", about: "Waits for the approval's end; a second delivery of the same end is a no-op." },
    { name: "read-effect", about: "On landing: reads the transaction's indexed facts and checks the change's own effect." },
    { name: "settle", about: "In one transaction: the change's end as its action, or failed with the code and reason." },
  ],
  reads: [table_board_changes, table_approvals, table_safe_owners, table_hat_wearers],
  writes: [table_board_changes],
  drives: [
    machine_board_change.t.seat,
    machine_board_change.t.claim,
    machine_board_change.t.remove,
    machine_board_change.t.lapse,
    machine_board_change.t.set_threshold,
    machine_board_change.t.hand_over,
    machine_board_change.t.fail,
  ],
  invokes: [],
  emits: [],
  calls: [integration_indexer.c.factsOf, integration_indexer.c.awaitBlock],
  chain: [],
  idempotency: "One instance per change_id; settle drives a transition only on a change still awaiting_approval, so a second run does nothing.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None: nothing is written until the approval has ended, and the settlement is one transaction. Ponder still behind " +
    "after its wait leaves the change waiting for the next attempt.",
  budget: budget("background"),
});
