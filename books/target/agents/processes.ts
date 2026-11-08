// The agents concept's durable work: one process per agent change (A3, rules.durable-processes:
// "an agent change"). A change is a long-lived object: its carrier waits for the owner's signature
// on the approval page, or for the Directors' approvals of a Board proposal, which can take days,
// then for the chain. The process is the only writer of a change's end and of every agent state
// after `creating`, and it moves them only on chain proof.
//
// The old system had two follow actions that rescheduled themselves every ten seconds (sixty reads)
// once a send was noted, a settle-on-read in get, show and every change action, two signed-send
// actions run by the approvals workflow, submission notes and their hand-backs, and a telemetry
// poster. Here approvals and board own the one send, and this process owns the rest (decision
// agents.one-process); the transition's event leaves through the outbox (P7).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_agents } from "../shared/foundation.ts";
import { integration_indexer } from "../shared/external.ts";
import { table_approvals } from "../approvals/data.ts";
import { table_board_proposals } from "../board/data.ts";
import { procedure_parties_activate, procedure_parties_release } from "../parties/procedures.ts";
import { machine_agent, machine_agent_change, table_agent_changes, table_agents } from "./data.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { event_proposal_transitioned } from "../board/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";

const OLD = "packages/backend/src/accounts/agents";
const MINUTE = 60_000;

export const workflow_agents_changes_carry = defineWorkflow({
  id: "agents.changes.carry",
  title: "One agent change, from its carrier to chain proof",
  about:
    "Started by the change's birth (`agent-change.open`, through the outbox), one instance per change. It waits for the " +
    "end of the change's carrier, which approvals and board announce through the outbox and it reads by id: the owner's " +
    "approval (approval_transitioned: landed, reverted, displaced, expired, declined, refused or withdrawn) or the Board " +
    "proposal (proposal_transitioned: executed, failed, rejected or replaced). A carrier that ended without landing fails " +
    "the change with its outcome. One that landed is read on chain: every indexed fact of its transaction at the " +
    "deployment's finality depth (`indexer.factsOf`). The change lands only when that transaction holds the AgentOwner " +
    "event it asked for, for this agent's Safe: AgentCreated with the owner's Safe and the key, AgentFrozen, " +
    "AgentUnfrozen, AgentSignerSwapped with both keys, AgentRemoved, and for a sweep or removal at most one AgentSwept per " +
    "named token, each to the change's recipient (a removal's is the owner's Safe); a named token with no AgentSwept was " +
    "empty and reports zero. Anything else (another Safe, key, token or recipient, a doubled AgentSwept, no event) fails " +
    "it as a mismatch and the agent keeps what it had. Each settlement is one transaction: the change lands with its " +
    "transaction, block and what each AgentSwept moved, and the agent moves with it (a create activates the agent and its " +
    "Party, `parties.activate`; a freeze, unfreeze or removal drives its transition; a rotation sets the agent's key and " +
    "its store; a sweep moves no state); or the change fails with its outcome and code, and a failed create fails its " +
    "agent and frees its handle (`parties.release`). Codes: decision agents.failure-codes. It replaces the old follow " +
    "and followChange actions, the settle mutations and the settle-on-read of every agents action.",
  was: [
    `${OLD}/operations/follow.ts:24`,
    `${OLD}/operations/follow-change.ts:23`,
    `${OLD}/operations/settle.ts:10`,
    `${OLD}/operations/settle-change.ts:10`,
    `${OLD}/writes/settles.ts:18`,
    `${OLD}/writes/settles.ts:55`,
    `${OLD}/writes/settles.ts:136`,
    `${OLD}/writes/rows.ts:189`,
    `${OLD}/writes/rows.ts:209`,
    `${OLD}/writes/changes.ts:186`,
    `${OLD}/external.ts:212`,
    `${OLD}/external.ts:255`,
    "books/as-is/accounts/agents.ts",
  ],
  concept: concept_agents,
  priority: "normal",
  trigger: { transition: machine_agent_change.t.open },
  instance: { per: table_agent_changes },
  waits: [
    {
      name: "carrier",
      for: "person",
      key: [{ on: [event_approval_transitioned, event_proposal_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about: "The owner signs or declines on the approval page, or the Directors approve or reject the proposal; the carrier's transition resumes it.",
    },
    {
      name: "executed",
      for: "chain",
      key: [{ on: [event_approval_transitioned, event_proposal_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about: "The carrier's transaction lands, reverts or is displaced, or its window lapses, on chain proof: approval_transitioned or proposal_transitioned, routed by opener agents and the change as subject.",
    },
    {
      name: "indexed",
      for: "indexer",
      timeoutMs: 10 * MINUTE,
      key: [{ on: [table_indexer_progress], props: ["chain_id"], reaches: "indexed_block" }],
      about: "Ponder has the carrier's transaction (by chain and hash) at the finality depth, so its AgentOwner logs can be read together.",
    },
  ],
  steps: [
    { name: "await-carrier", about: "Waits for the carrier's end; a second delivery of the same end is a no-op." },
    { name: "read-facts", about: "On landing: every indexed fact of the carrier's transaction, through `indexer.factsOf`." },
    { name: "check", about: "Finds the AgentOwner event the change's kind asks for, for this Safe, key, tokens and recipient; anything else is a mismatch." },
    { name: "settle", about: "In one transaction: lands or fails the change, moves the agent with it, and activates or releases a create's Party." },
  ],
  reads: [table_agent_changes, table_agents, table_approvals, table_board_proposals],
  writes: [table_agent_changes, table_agents],
  drives: [
    machine_agent_change.t.land,
    machine_agent_change.t.fail,
    machine_agent.t.activate,
    machine_agent.t.fail,
    machine_agent.t.freeze,
    machine_agent.t.unfreeze,
    machine_agent.t.remove,
  ],
  invokes: [procedure_parties_activate, procedure_parties_release],
  emits: [],
  calls: [integration_indexer.c.awaitBlock, integration_indexer.c.factsOf],
  chain: [],
  idempotency:
    "One instance per change_id; settle drives a transition only on a change still `waiting`, so a second run, a " +
    "replayed carrier event or a reindexed log changes nothing.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None: nothing is written until the carrier has ended, and the settlement is one transaction. A step that fails " +
    "retries; Ponder still behind after its wait leaves the change waiting and the process waiting for the next attempt.",
  budget: { ...budget("background"), excludes: ["wait.carrier", "wait.executed", "wait.indexed"] },
});
