// The as-is book of the old organizations concept: the proposals area.
//
// Every operation registered at `organizations/proposals:*` (packages/backend/convex/organizations/
// proposals.ts), as the old code does it. Nine are public actions that implement a protocol row of
// `proposals` (packages/protocol/src/organizations/proposal-operations.ts); the others are internal
// queries, mutations and actions. followApproval and notify are scheduled by another call, so they
// are workflows; every other internal operation is an rpc. `pay-scheduled.ts` sits in the operations
// folder but is a helper of pay and cancelScheduled, not a registered function.
//
// How touches are booked (the payments book's rule, applied here):
// - An internal rpc lists what its own transaction does through organizations code. A neighbour's
//   in-transaction function it calls is an invoke of that neighbour's procedure; a neighbour table
//   organizations code queries by itself is a read of that table (a boundary finding).
// - A public action holds no transaction of its own. It lists what the internal rpcs of this concept
//   it runs touch, so the endpoint shows everything one call does. Every proposals action first runs
//   organizations.proposals.load and then `refreshProposals`, whose organizations.proposals.settle
//   writes what the chain settled: its touches are in every action that refreshes.
// - Another concept's internal rpc an action runs (`accounts.approvals.openForProposal`, the payments
//   commands and schedules rpcs) cannot be linked from an rpc in this schema: it is named in `about`
//   and its touches stay on that concept's record.
// - `chain` lists the contract functions an rpc reads over eth_call; a send rpc also lists what the
//   UserOperation it sends executes.
//
// The non-record constants exported here (`PROPOSALS_*`, `union`, `spanUnion`, shapes) are shared with the equity,
// rounds, directors and votes area files, whose actions reach the same proposal context and refresh.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_equity_grant_transitioned,
  event_equity_shares_transitioned,
  event_fundraise_round_transitioned,
  event_org_director_change_proposed,
  event_org_proposal_approval_opened,
  event_org_proposal_rejection_proposed,
} from "../shared/vocabulary.ts";
import {
  contract_budgets,
  contract_entry_point,
  contract_erc20,
  contract_hats_signer_gate,
  contract_multi_send_call_only,
  contract_payments,
  contract_safe,
  contract_safe_4337_module,
  integration_chain_rpc,
  integration_mail,
} from "../shared/external.ts";
import {
  machine_org_invitation,
  machine_org_safe_proposal,
  machine_org_share_transfer,
  machine_seat_permission_change,
  table_org_equities,
  table_org_equity_issues,
  table_org_invitations,
  table_org_lifecycles,
  table_org_members,
  table_org_option_grants,
  table_org_rounds,
  table_org_safe_proposals,
  table_org_safe_rounds,
  table_org_share_transfers,
  table_orgs,
  table_seat_permission_changes,
  table_seat_permissions,
} from "./data.ts";
import { table_smart_accounts } from "../accounts/data.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_read_workspace_setup_signer_in_tx } from "../accounts/procedures.ts";
import {
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_resolve_recipient_in_tx,
} from "../parties/procedures.ts";
import {
  procedure_permissions_abandon_proposed_permission_command_in_tx,
  procedure_permissions_record_proposed_configuration_execution_in_tx,
  procedure_permissions_record_proposed_permission_execution_in_tx,
} from "../permissions/procedures.ts";
import { procedure_profiles_read_profile_is_ai_in_tx } from "../profiles/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/organizations/proposals.ts`;
const ORG = `${BACKEND}/src/organizations`;
const SRC = `${ORG}/proposals`;
const OPS = `${SRC}/operations`;
const ROWS = "packages/protocol/src/organizations/proposal-operations.ts";
const ROW_ERRORS = "packages/protocol/src/organizations/operation-errors.ts";
const SCHEMA = "packages/protocol/src/organizations/proposal-schema.ts";
const RPC = `${BACKEND}/src/integrations/chain-rpc`;

/** Keep each link once, in first-seen order (the payments book's `union`). */
export const union = <const L extends ReadonlyArray<ReadonlyArray<{ readonly id: string }>>>(
  ...lists: L
): Array<L[number][number]> => {
  const seen = new Set<string>();
  const out: Array<L[number][number]> = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};

/** Keep each span name once, in first-seen order. */
export const spanUnion = (...lists: ReadonlyArray<ReadonlyArray<string>>): string[] => [...new Set(lists.flat())];

// ── errors ─────────────────────────────────────────────────────────────────────────────────

/** A code no `attempt` list admits becomes a defect: UNKNOWN on the wire. */
const DEFECT = [error_UNKNOWN];

/** CALL, DEFECTS, PARTICIPANT, CHAIN (operation-errors.ts:4, :10, :13; operation.ts:54). */
const READ_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
];

/** CALL, DEFECTS, PARTICIPANT, OWNER, STATE, CHAIN (operation-errors.ts:4-16). */
const OWNER_ROW_ERRORS = [...READ_ROW_ERRORS, error_SMART_ACCOUNT_MISSING, error_WRONG_STATE];

/** OWNER_ROW_ERRORS and GATED (operation-errors.ts:19). */
const GATED_ROW_ERRORS = [...OWNER_ROW_ERRORS, error_FEATURE_NOT_AVAILABLE];

/** `OWNER_PAYMENT` (proposal-operations.ts:24): a Director payment is built as a Payment. */
const OWNER_PAYMENT_ROW_ERRORS = [
  ...GATED_ROW_ERRORS,
  error_PROVIDER_RESPONSE_INVALID,
  error_INSUFFICIENT_BALANCE,
  error_NOT_IMPLEMENTED,
];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/** `requireOrgParticipant` (reads/participation.ts:85): the Organization, an active Seat bound to a Party, a usable bootstrap. */
export const PROPOSALS_PARTICIPANT_READS = [table_orgs, table_org_members, table_org_lifecycles];
export const PROPOSALS_PARTICIPANT_WAS = [
  `${ORG}/reads/participation.ts:85`,
  `${ORG}/reads/participation.ts:31`,
  `${ORG}/reads/participation.ts:64`,
  `${BACKEND}/src/permissions/guards/bootstraps.ts:8`,
];

/**
 * `proposalContextInTx` (reads.ts:52): the participant check, the Organization, the caller's claimed and
 * deployed personal Safe and signer (Accounts' `readWorkspaceSetupSignerInTx`), the newest 100 proposals
 * by nonce plus every waiting nonce-less one and the newest 100 of those, the asked-for proposal when older,
 * and the v4 company install from the setup row.
 */
export const PROPOSALS_LOAD = {
  reads: [...PROPOSALS_PARTICIPANT_READS, table_org_safe_proposals],
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
};
export const PROPOSALS_LOAD_WAS = [
  `${SRC}/reads.ts:52`,
  `${SRC}/reads.ts:58`,
  `${SRC}/reads.ts:61`,
  `${SRC}/reads.ts:62`,
  `${SRC}/reads.ts:69`,
  `${SRC}/reads.ts:74`,
  `${SRC}/reads.ts:82`,
  `${SRC}/reads.ts:93`,
  `${SRC}/reads.ts:107`,
  `${SRC}/reads.ts:126`,
  `${ORG}/reads/organizations.ts:73`,
  `${BACKEND}/src/accounts/reads/workspaces.ts:76`,
  ...PROPOSALS_PARTICIPANT_WAS,
];

/**
 * `settleInTx` (writes/settlements.ts:36): the Safe's signers onto the Organization row when they changed,
 * then each settlement on a still-waiting row. An executed row schedules its notices, applies its subject
 * (a Seat permission change applied, a share sale approved), schedules Payroll's agreement sweep and
 * Payments' store, send or cancel of a dated payment, and notes landed equity and round writes (each
 * reported once). A rejected or replaced row ends its subject: a Seat permission change ended, a Permission
 * command abandoned, an invitation still authorizing retired; a Board-scheduled payment's end is scheduled.
 */
export const PROPOSALS_SETTLE = {
  reads: [
    table_org_safe_proposals,
    table_orgs,
    table_seat_permission_changes,
    table_seat_permissions,
    table_org_share_transfers,
    table_org_equities,
    table_org_equity_issues,
    table_org_option_grants,
    table_org_safe_rounds,
    table_org_rounds,
    table_org_invitations,
  ],
  writes: [
    table_org_safe_proposals,
    table_orgs,
    table_seat_permission_changes,
    table_seat_permissions,
    table_org_share_transfers,
    table_org_equities,
    table_org_equity_issues,
    table_org_option_grants,
    table_org_safe_rounds,
    table_org_rounds,
    table_org_invitations,
  ],
  drives: [
    machine_org_safe_proposal.t.to_executed,
    machine_org_safe_proposal.t.to_rejected,
    machine_org_safe_proposal.t.to_replaced,
    machine_org_share_transfer.t.to_approved,
    machine_seat_permission_change.t.to_applied,
    machine_seat_permission_change.t.to_ended,
    machine_org_invitation.t.to_cancelled,
  ],
  invokes: [procedure_permissions_abandon_proposed_permission_command_in_tx],
  emits: [event_equity_shares_transitioned, event_equity_grant_transitioned, event_fundraise_round_transitioned],
};
export const PROPOSALS_SETTLE_WAS = [
  `${SRC}/writes/settlements.ts:36`,
  `${SRC}/writes/settlements.ts:38`,
  `${SRC}/writes/settlements.ts:46`,
  `${SRC}/writes/settlements.ts:56`,
  `${SRC}/writes/settlements.ts:57`,
  `${SRC}/writes/settlements.ts:58`,
  `${SRC}/writes/settlements.ts:67`,
  `${SRC}/writes/settlements.ts:73`,
  `${SRC}/writes/settlements.ts:80`,
  `${SRC}/writes/settlements.ts:86`,
  `${SRC}/writes/settlements.ts:87`,
  `${SRC}/writes/settlements.ts:99`,
  `${SRC}/writes/settlements.ts:106`,
  `${SRC}/writes/settlements.ts:112`,
  `${SRC}/writes/subjects.ts:49`,
  `${SRC}/writes/subjects.ts:55`,
  `${SRC}/writes/subjects.ts:58`,
  `${SRC}/writes/subjects.ts:75`,
  `${SRC}/writes/subjects.ts:82`,
  `${SRC}/writes/subjects.ts:84`,
  `${SRC}/writes/subjects.ts:85`,
  `${SRC}/writes/notices.ts:21`,
  `${SRC}/writes/notices.ts:45`,
  `${ORG}/writes.ts:41`,
  `${ORG}/members/writes/permissions.ts:232`,
  `${ORG}/members/writes/permissions.ts:42`,
  `${ORG}/equity/writes/transfer-settlements.ts:12`,
  `${ORG}/equity/writes/landed.ts:30`,
  `${ORG}/equity/writes/landed.ts:99`,
  `${ORG}/rounds/writes.ts:117`,
  `${ORG}/invitations/writes/retirements.ts:14`,
];

/** The Safe's own reads: owners, threshold, nonce and each counted owner's `approvedHashes` mark. */
const SAFE_READS = [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_safe.f.nonce, contract_safe.f.approvedHashes];
/** A v4 company Safe's Signer Gate, found in the Safe's guard slot: who it still counts, and its threshold config. */
const GATE_READS = [contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.thresholdConfig];

/**
 * `refreshProposals` from an action (writes.ts:303): `readSafeState` (the latest block, then owners,
 * threshold and nonce, the guard slot and the Gate's view of each owner, each open row's approvals) and
 * `readExecutionOutcomes` (each sent execution's receipt at a used nonce), then `settle` and, when anything
 * changed, organizations.proposals.settle in its own transaction.
 */
export const PROPOSALS_REFRESH = {
  reads: PROPOSALS_SETTLE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: PROPOSALS_SETTLE.invokes,
  emits: PROPOSALS_SETTLE.emits,
  calls: [
    integration_chain_rpc.c.fetchLatestBlockNumber,
    integration_chain_rpc.c.fetchSafeOwners,
    integration_chain_rpc.c.fetchEthCall,
    integration_chain_rpc.c.fetchStorageAtBlock,
    integration_chain_rpc.c.fetchUserOperationReceipt,
  ],
  chain: [...SAFE_READS, ...GATE_READS],
  spans: [
    "convex.query",
    "convex.mutation",
    "chain.read eth_blockNumber",
    "chain.read eth_call",
    "chain.read eth_getStorageAt",
    "chain.read eth_getUserOperationReceipt",
    "chain.attempt <upstream>",
  ],
};
export const PROPOSALS_REFRESH_WAS = [
  `${SRC}/writes.ts:281`,
  `${SRC}/writes.ts:303`,
  `${SRC}/external.ts:71`,
  `${SRC}/external.ts:76`,
  `${SRC}/external.ts:79`,
  `${SRC}/external.ts:87`,
  `${SRC}/external.ts:95`,
  `${SRC}/external.ts:133`,
  `${SRC}/external.ts:147`,
  `${SRC}/external/signer-gate.ts:25`,
  `${SRC}/rules.ts:43`,
  `${SRC}/rules.ts:197`,
  `${RPC}/internal/accountReads.ts:48`,
  `${BACKEND}/src/platform/execute.ts:273`,
  `${RPC}/internal/requests.ts:79`,
  `${RPC}/internal/requests.ts:255`,
];

/** `requireOwner` (guards.ts:76): a personal Safe, among the live owners, and behind a Gate still wearing the Director hat. */
const OWNER_WAS = [`${SRC}/guards.ts:76`, `${SRC}/guards.ts:83`, `${SRC}/guards.ts:84`, `${SRC}/guards.ts:86`];

/**
 * `requireSafeOwner` (guards.ts:129): what an equity, rounds or share-sale action starts with before it
 * stores its Board proposal: load, refresh, and the caller as a Director now.
 */
export const PROPOSALS_SAFE_OWNER = {
  reads: union(PROPOSALS_LOAD.reads, PROPOSALS_REFRESH.reads),
  invokes: union(PROPOSALS_LOAD.invokes, PROPOSALS_REFRESH.invokes),
};
export const PROPOSALS_SAFE_OWNER_WAS = [`${SRC}/guards.ts:129`, ...OWNER_WAS];

/**
 * `recordProposalInTx` (writes.ts:115): the next free nonce, assigned in the storing transaction. The row is
 * born `awaiting_approvals`; a birth has no transition in the machine, so nothing is driven.
 */
const RECORD = {
  reads: [table_org_safe_proposals],
  writes: [table_org_safe_proposals],
  drives: [] as typeof PROPOSALS_SETTLE.drives,
};
const RECORD_WAS = [
  `${SRC}/writes.ts:115`,
  `${SRC}/writes.ts:120`,
  `${SRC}/writes.ts:129`,
  `${SRC}/writes.ts:135`,
  `${SRC}/writes.ts:136`,
  `${SRC}/writes.ts:148`,
  `${SRC}/writes.ts:153`,
  `${SRC}/writes.ts:154`,
  `${SRC}/writes.ts:170`,
  `${SRC}/writes/cancels.ts:8`,
  `${SRC}/rules.ts:78`,
  `${SRC}/rules.ts:101`,
  `${SRC}/rules/owner-change-queue.ts:1`,
];
/** `recordOwnerProposalInTx` (writes.ts:180): another write stores its Board proposal in its own transaction. */
export const PROPOSALS_RECORD_OWNER = RECORD;
export const PROPOSALS_RECORD_OWNER_WAS = [`${SRC}/writes.ts:180`, `${SRC}/guards.ts:162`, ...RECORD_WAS];

/** Child spans of every proposals action besides its chain reads. */
const ACTION_SPANS = ["convex.query", "convex.mutation", "chain.attempt <upstream>"];

/**
 * A Director's sponsored approval: `buildSponsoredSafeUserOp` on the proposal's own EntryPoint lane
 * (external.ts:204, :210): the lane's nonce, the fee caps, then the paymaster's stub, the bundler's
 * estimate and the final sponsorship.
 */
export const SPONSORED_BUILD = {
  calls: [
    integration_chain_rpc.c.fetchEntryPointNonce,
    integration_chain_rpc.c.fetchUserOperationFees,
    integration_chain_rpc.c.sponsorUserOperation,
  ],
  chain: [contract_entry_point.f.getNonce],
  spans: [
    "chain.read eth_call",
    "chain.read eth_maxPriorityFeePerGas",
    "chain.read eth_getBlockByNumber",
    "chain.read pm_getPaymasterStubData",
    "chain.read eth_estimateUserOperationGas",
    "chain.read pm_getPaymasterData",
  ],
};
export const SPONSORED_BUILD_WAS = [
  `${BACKEND}/src/payments/executions/external/safes.ts:142`,
  `${BACKEND}/src/payments/executions/external/safes.ts:164`,
  `${BACKEND}/src/payments/executions/external/safes.ts:170`,
  `${BACKEND}/src/payments/executions/external/safes.ts:186`,
  `${BACKEND}/src/integrations/chain-rpc/service.ts:54`,
];

/** The Safe's own calls a sent approval or execution makes, from the Director's personal Safe through its 4337 module. */
const APPROVAL_SENT = [
  contract_safe_4337_module.f.executeUserOpWithErrorString,
  contract_multi_send_call_only.f.multiSend,
  contract_safe.f.approveHash,
  contract_safe.f.execTransaction,
  contract_hats_signer_gate.f.removeSigner,
];

const Call = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });

/** `SafeProposalSchema` (proposal-schema.ts:29): a proposal as callers read it. */
export const SafeProposal = Schema.Struct({
  proposalId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  nonce: Schema.NullOr(Schema.Number),
  safeTxHash: Schema.String,
  kind: Schema.Literals(["transaction", "rejection", "scheduled_payment"]),
  rejects: Schema.NullOr(Schema.String),
  transaction: Schema.Struct({
    to: Schema.String,
    value: Schema.String,
    data: Schema.String,
    operation: Schema.Literals(["call", "delegatecall"]),
  }),
  calls: Schema.Array(Call),
  note: Schema.NullOr(Schema.String),
  proposer: Schema.String,
  status: Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"]),
  threshold: Schema.Number,
  approvals: Schema.Array(Schema.Struct({ owner: Schema.String, state: Schema.Literals(["approved", "sent"]) })),
  executionUserOpHash: Schema.NullOr(Schema.String),
  payment: Schema.optionalKey(Schema.Struct({ id: Schema.String, sendsAt: Schema.Number })),
  createdAt: Schema.Number,
});

/** A stored `orgSafeProposals` row without its Convex fields (rules.ts `ProposalRow`). */
const ProposalRow = Schema.Unknown;

/** `ProposalContext` (reads.ts:32). */
const ProposalContext = Schema.Struct({
  orgId: Schema.String,
  name: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  deploymentJson: Schema.NullOr(Schema.String),
  caller: Schema.NullOr(Schema.Struct({ personalSafe: Schema.String, signer: Schema.String })),
  proposals: Schema.Array(ProposalRow),
  signers: Schema.NullOr(Schema.Struct({ owners: Schema.Array(Schema.String), threshold: Schema.Number, blockNumber: Schema.Number })),
});

/** The approval page's view of an opened approval (`ApprovalSchema`, accounts/approval-schema.ts:145): too deep to transcribe. */
export const Approval = Schema.Unknown;

const OneProposal = Schema.Struct({ orgId: Schema.String, proposalId: Schema.String });

/** Who may call a Director write. */
const DIRECTOR = "A signed-in current Seat of the Organization whose claimed personal Safe is a live owner of the Organization Safe and, behind a v4 Signer Gate, still wears the Director hat.";

// ── public actions ─────────────────────────────────────────────────────────────────────────

/** What a public proposals write touches besides its own store: load, refresh. */
const DIRECTOR_WRITE = {
  reads: union(PROPOSALS_LOAD.reads, PROPOSALS_SETTLE.reads),
  writes: PROPOSALS_SETTLE.writes,
  invokes: union([procedure_access_require_feature_from_action], PROPOSALS_LOAD.invokes, PROPOSALS_SETTLE.invokes),
};

export const rpc_organizations_proposals_propose = defineRpc({
  id: "organizations.proposals.propose",
  title: "A Director proposes raw calls at the Organization Safe's next nonce",
  about:
    "Row `organizations.proposals.propose`, registered as the public action `organizations/proposals:propose`. Signed in " +
    "(`signedInAction`). organizations.proposals.load proves the caller a participant and reads the context; the " +
    "`owner-safe-proposals` gate must be on; `refreshProposals` settles the stored proposals from the chain; `requireOwner` " +
    "admits only a live owner (a lapsed Director hat is ROLE_PERMISSION_DENIED `director_hat_lapsed`). The calls become one " +
    "Safe transaction (one call, or a MultiSendCallOnly delegatecall batch) and organizations.proposals.record stores it " +
    "at the next free nonce: at most 50 transactions wait, and a second Director change while one waits is refused " +
    "(WRONG_STATE). Nothing is signed or sent: approving is `requestApproval`. Answers the proposal view.",
  was: [
    `${CONVEX}:18`,
    `${OPS}/propose.ts:17`,
    `${OPS}/propose.ts:22`,
    `${OPS}/propose.ts:23`,
    `${OPS}/propose.ts:24`,
    `${OPS}/propose.ts:25`,
    `${OPS}/propose.ts:31`,
    `${ROWS}:44`,
    `${ROW_ERRORS}:4`,
    `${ROW_ERRORS}:19`,
    `${SCHEMA}:65`,
    `${SRC}/rules.ts:81`,
    `${SRC}/writes.ts:244`,
    `${SRC}/views.ts:9`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: Schema.String, calls: Schema.Array(Call), note: Schema.optionalKey(Schema.String) }),
  output: SafeProposal,
  errors: GATED_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: [...RECORD.drives, ...PROPOSALS_SETTLE.drives],
  invokes: DIRECTOR_WRITE.invokes,
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_change_owners = defineRpc({
  id: "organizations.proposals.change-owners",
  title: "A Director proposes a change to the Organization Safe's Directors",
  about:
    "Row `organizations.proposals.changeOwners`, registered as `organizations/proposals:changeOwners`. Signed in. Load, " +
    "the `owner-safe-proposals` gate, refresh. A v4 company Safe behind a Signer Gate is refused before anything else " +
    "(WRONG_STATE `ownerChangeGated`): its Board changes through organizations.directors.*. Then `requireOwner`; " +
    "organizations.proposals.owner-candidates reads the memberships the change's emails name; `planOwnerChange` builds the " +
    "Safe's own OwnerManager call (addOwnerWithThreshold, removeOwner with the owner before it, swapOwner or changeThreshold) " +
    "from the owners and threshold just read, refusing an unknown member (INVALID_INPUT), a member without a deployed Safe, " +
    "an owner already there or not there, or an out-of-range threshold. The record is refused while another Director change " +
    "waits, so the call still holds when it executes. Queues `org_director_change_proposed` for a newly stored row. " +
    "Answers the proposal view with the change's before and after.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/change-owners.ts:27`,
    `${OPS}/change-owners.ts:36`,
    `${OPS}/change-owners.ts:38`,
    `${OPS}/change-owners.ts:44`,
    `${OPS}/change-owners.ts:49`,
    `${OPS}/change-owners.ts:61`,
    `${OPS}/change-owners.ts:73`,
    `${ROWS}:54`,
    `${SCHEMA}:90`,
    `${SCHEMA}:138`,
    `${SRC}/rules/owner-changes.ts:1`,
    `${SRC}/rules/owner-calls.ts:13`,
    `${SRC}/events.ts:44`,
    `${SRC}/reads.ts:218`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    /** `OwnerChangeRequestSchema`: add, remove, replace or threshold. */
    change: Schema.Union([
      Schema.Struct({ action: Schema.Literal("add"), person: Schema.String, threshold: Schema.optionalKey(Schema.Number) }),
      Schema.Struct({ action: Schema.Literal("remove"), person: Schema.String, threshold: Schema.optionalKey(Schema.Number) }),
      Schema.Struct({ action: Schema.Literal("replace"), person: Schema.String, replacement: Schema.String }),
      Schema.Struct({ action: Schema.Literal("threshold"), threshold: Schema.Number }),
    ]),
  }),
  output: Schema.Struct({ ...SafeProposal.fields, change: Schema.Unknown }),
  errors: GATED_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: [...RECORD.drives, ...PROPOSALS_SETTLE.drives],
  invokes: DIRECTOR_WRITE.invokes,
  emits: [event_org_director_change_proposed, ...PROPOSALS_SETTLE.emits],
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_list = defineRpc({
  id: "organizations.proposals.list",
  title: "The Organization's newest proposals, settled from the chain",
  about:
    "Row `organizations.proposals.list`, registered as `organizations/proposals:list`. Signed in; any current participant. " +
    "Load and refresh (so a read can write the settle mutation), then the stored rows filtered by `status` when given, " +
    "newest nonce first as the load window holds them (the newest 100 by nonce plus nonce-less ones). No gate is checked.",
  was: [`${CONVEX}:10`, `${OPS}/list.ts:14`, `${OPS}/list.ts:20`, `${OPS}/list.ts:22`, `${ROWS}:84`, `${SCHEMA}:76`, ...PROPOSALS_LOAD_WAS, ...PROPOSALS_REFRESH_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({
    orgId: Schema.String,
    status: Schema.optionalKey(Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"])),
  }),
  output: Schema.Array(SafeProposal),
  errors: READ_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: [...PROPOSALS_LOAD.invokes, ...PROPOSALS_SETTLE.invokes],
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_get = defineRpc({
  id: "organizations.proposals.get",
  title: "One proposal, its approvals and status settled from the chain",
  about:
    "Row `organizations.proposals.get`, registered as `organizations/proposals:get`. Signed in; any current participant. " +
    "Load with the proposal id (added to the window when older), refresh, then the row; an id the Organization does not " +
    "hold is INVALID_INPUT (`proposalNotFound`). No gate is checked.",
  was: [`${CONVEX}:9`, `${OPS}/get.ts:15`, `${OPS}/get.ts:20`, `${OPS}/get.ts:23`, `${ROWS}:91`, `${SCHEMA}:71`, ...PROPOSALS_LOAD_WAS, ...PROPOSALS_REFRESH_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the Organization.",
  input: OneProposal,
  output: SafeProposal,
  errors: READ_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: [...PROPOSALS_LOAD.invokes, ...PROPOSALS_SETTLE.invokes],
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_reject = defineRpc({
  id: "organizations.proposals.reject",
  title: "A Director proposes the Safe's rejection of a waiting proposal",
  about:
    "Row `organizations.proposals.reject`, registered as `organizations/proposals:reject`. Signed in. Load, refresh, " +
    "`requireOwner`; no gate is checked. The rejection is a call that does nothing at the rejected proposal's nonce: an " +
    "empty call to the Safe itself, or behind a v4 Signer Gate (which refuses a call to the Safe) a zero-value read of the " +
    "deployment's Payments (`paid`, CAP-1187, reading the Protocol v4 config). organizations.proposals.record refuses a " +
    "target that is not this Organization's (INVALID_INPUT), a rejection or scheduled payment (WRONG_STATE), or one no " +
    "longer waiting; a rejection already waiting comes back with `created` false and reports nothing. A newly stored one " +
    "queues `org_proposal_rejection_proposed`.",
  was: [
    `${CONVEX}:21`,
    `${OPS}/reject.ts:24`,
    `${OPS}/reject.ts:31`,
    `${OPS}/reject.ts:32`,
    `${OPS}/reject.ts:46`,
    `${OPS}/reject.ts:53`,
    `${ROWS}:98`,
    `${SRC}/writes.ts:258`,
    `${SRC}/events.ts:88`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: OneProposal,
  output: SafeProposal,
  errors: OWNER_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: [...RECORD.drives, ...PROPOSALS_SETTLE.drives],
  invokes: [...PROPOSALS_LOAD.invokes, ...PROPOSALS_SETTLE.invokes],
  emits: [event_org_proposal_rejection_proposed, ...PROPOSALS_SETTLE.emits],
  calls: PROPOSALS_REFRESH.calls,
  chain: [...PROPOSALS_REFRESH.chain, contract_payments.f.paid],
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_request_approval = defineRpc({
  id: "organizations.proposals.request-approval",
  title: "Open a Director's approval of a proposal on the approval page",
  about:
    "Row `organizations.proposals.requestApproval`, registered as `organizations/proposals:requestApproval`. Signed in. " +
    "Load, the `owner-safe-proposals` gate, refresh, `requireOwner`. Another Director's approval sent in the last ten " +
    "minutes is waited for (`waitForUserOperationReceipt`) and the Safe refreshed again when one landed. `requireStep` " +
    "decides the step: `approveHash` from the caller's personal Safe, or `execTransaction` when this approval reaches the " +
    "threshold (a 1-of-1 Safe executes at once); a settled proposal or the caller's own approval already counted is " +
    "WRONG_STATE. A department change is gated again by `payment-departments`. Behind a v4 Signer Gate the execution first " +
    "`removeSigner`s each owner whose hat lapsed. The sponsored UserOperation is built on the proposal's own lane; a revert " +
    "the bundler's simulation reports for an execution is WRONG_STATE `executionRefused`. Its sponsorship window sets the " +
    "expiry (PROVIDER_RESPONSE_INVALID when unreadable). Then Accounts' internal mutation accounts.approvals.openForProposal " +
    "opens or returns the approval (booked by Accounts); only a newly opened one queues `org_proposal_approval_opened`. " +
    "Nothing is signed or sent here.",
  was: [
    `${CONVEX}:22`,
    `${OPS}/request-approval.ts:42`,
    `${OPS}/request-approval.ts:54`,
    `${OPS}/request-approval.ts:60`,
    `${OPS}/request-approval.ts:62`,
    `${OPS}/request-approval.ts:73`,
    `${OPS}/request-approval.ts:79`,
    `${OPS}/request-approval.ts:82`,
    `${OPS}/request-approval.ts:90`,
    `${OPS}/request-approval.ts:95`,
    `${OPS}/request-approval.ts:107`,
    `${OPS}/request-approval.ts:111`,
    `${OPS}/request-approval.ts:127`,
    `${ROWS}:109`,
    `${SRC}/guards.ts:92`,
    `${SRC}/rules.ts:128`,
    `${SRC}/rules.ts:156`,
    `${SRC}/external.ts:165`,
    `${SRC}/external.ts:204`,
    `${SRC}/external.ts:210`,
    `${SRC}/external/approvals-in-flight.ts:34`,
    `${SRC}/events.ts:125`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...SPONSORED_BUILD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: OneProposal,
  output: Approval,
  errors: [...GATED_ROW_ERRORS, error_INSUFFICIENT_BALANCE, error_PROVIDER_RESPONSE_INVALID],
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: DIRECTOR_WRITE.invokes,
  emits: [event_org_proposal_approval_opened, ...PROPOSALS_SETTLE.emits],
  calls: [...PROPOSALS_REFRESH.calls, integration_chain_rpc.c.waitForUserOperationReceipt, ...SPONSORED_BUILD.calls],
  chain: [...PROPOSALS_REFRESH.chain, ...SPONSORED_BUILD.chain],
  spans: spanUnion(PROPOSALS_REFRESH.spans, SPONSORED_BUILD.spans),
});

export const rpc_organizations_proposals_pay = defineRpc({
  id: "organizations.proposals.pay",
  title: "A Director proposes paying from the Organization account, now or on a date",
  about:
    "Row `organizations.proposals.pay`, registered as `organizations/proposals:pay`. Signed in. Load, the " +
    "`owner-safe-proposals` gate, refresh, `requireOwner`. Without `at`: the asset must be one the chain carries, " +
    "organizations.proposals.payment-recipient resolves the recipient (Parties), the Safe's ERC-20 balance is read and a " +
    "shortfall is PAYER_BALANCE_TOO_LOW; on Protocol v4 the calls are `approve` and one `Payments.send` with its own job, " +
    "before it one ERC-20 `transfer`; organizations.proposals.record stores them at the next nonce. With `at` " +
    "(`payScheduled`, gated again by `scheduled-payments`): before v4, Payments' internal mutation " +
    "payments.commands.prepareOwnersIntent births a Payment and its execution is built from the Organization Safe on its own " +
    "lane (payments.executions rpcs), and the proposal stores its SafeOp hash at no nonce (`scheduled_payment`); on v4 the " +
    "Payment is born on the company's top budget (read through Permissions' `readCompanyBudgets` and `Budgets.leftOf`), " +
    "`budgetAllowanceAdmits` refuses a shortfall, and the proposal calls `Budgets.schedule` at the next nonce " +
    "(`budget_schedule`). Those payments rpcs are booked by Payments. Nothing is signed or sent.",
  was: [
    `${CONVEX}:16`,
    `${OPS}/pay.ts:30`,
    `${OPS}/pay.ts:35`,
    `${OPS}/pay.ts:38`,
    `${OPS}/pay.ts:45`,
    `${OPS}/pay.ts:47`,
    `${OPS}/pay.ts:48`,
    `${OPS}/pay.ts:53`,
    `${OPS}/pay.ts:67`,
    `${OPS}/pay.ts:84`,
    `${OPS}/pay-scheduled.ts:41`,
    `${OPS}/pay-scheduled.ts:49`,
    `${OPS}/pay-scheduled.ts:53`,
    `${OPS}/pay-scheduled.ts:70`,
    `${OPS}/pay-scheduled.ts:84`,
    `${OPS}/pay-scheduled.ts:91`,
    `${OPS}/pay-scheduled.ts:98`,
    `${OPS}/pay-scheduled.ts:128`,
    `${ROWS}:67`,
    `${SCHEMA}:149`,
    `${SRC}/rules/owner-payments.ts:85`,
    `${SRC}/external/balances.ts:12`,
    `${SRC}/external/top-budgets.ts:16`,
    `${BACKEND}/src/payments/commands/external/owners.ts:19`,
    `${BACKEND}/src/payments/commands/writes/transactions.ts:67`,
    `${BACKEND}/src/payments/commands/external/funding.ts:157`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    /** `RecipientLocatorSchema`: a handle, Party id, email or address. */
    recipient: Schema.Unknown,
    amount: Schema.Struct({ asset: Schema.String, value: Schema.String }),
    note: Schema.optionalKey(Schema.String),
    at: Schema.optionalKey(Schema.Number),
  }),
  output: SafeProposal,
  errors: [...OWNER_PAYMENT_ROW_ERRORS, error_PAYER_BALANCE_TOO_LOW],
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: [...RECORD.drives, ...PROPOSALS_SETTLE.drives],
  invokes: [
    ...DIRECTOR_WRITE.invokes,
    procedure_parties_resolve_recipient_in_tx,
  ],
  emits: PROPOSALS_SETTLE.emits,
  calls: [...PROPOSALS_REFRESH.calls, integration_chain_rpc.c.fetchErc20Balance],
  chain: [
    ...PROPOSALS_REFRESH.chain,
    contract_erc20.f.balanceOf,
    contract_budgets.f.budgetCount,
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
  ],
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_cancel_scheduled = defineRpc({
  id: "organizations.proposals.cancel-scheduled",
  title: "A Director proposes cancelling a payment the Directors scheduled",
  about:
    "Row `organizations.proposals.cancelScheduled`, registered as `organizations/proposals:cancelScheduled`. Signed in. " +
    "Load, the `owner-safe-proposals` gate, refresh, `requireOwner`. On Protocol v4 Payments' internal query " +
    "payments.schedules.loadBoardCancel names the Budgets schedule ids (INVALID_INPUT when it has none) and the proposal " +
    "calls `Budgets.cancel` for each at the next nonce (`budget_cancel`); a cancel already waiting for the command is " +
    "returned in its place. Before v4, Payments' internal mutation payments.lifecycles.prepareOwnersVoid plans the void and " +
    "its execution is built from the Organization Safe on the payment's lane; the proposal stores its SafeOp hash at no " +
    "nonce. Those payments rpcs are booked by Payments. Nothing is signed or sent.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/cancel-scheduled.ts:34`,
    `${OPS}/cancel-scheduled.ts:40`,
    `${OPS}/cancel-scheduled.ts:48`,
    `${OPS}/cancel-scheduled.ts:51`,
    `${OPS}/cancel-scheduled.ts:58`,
    `${OPS}/cancel-scheduled.ts:73`,
    `${OPS}/cancel-scheduled.ts:77`,
    `${OPS}/pay-scheduled.ts:128`,
    `${ROWS}:77`,
    `${SCHEMA}:161`,
    `${BACKEND}/src/payments/commands/external/owners.ts:41`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
    ...RECORD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: Schema.String, paymentId: Schema.String }),
  output: SafeProposal,
  errors: OWNER_PAYMENT_ROW_ERRORS,
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: [...RECORD.drives, ...PROPOSALS_SETTLE.drives],
  invokes: DIRECTOR_WRITE.invokes,
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

export const rpc_organizations_proposals_safe = defineRpc({
  id: "organizations.proposals.safe",
  title: "A v4 company Safe: owners, signer status, threshold, nonce, waiting count",
  about:
    "Row `organizations.proposals.safe`, registered as `organizations/proposals:safe`. Signed in; any current participant. " +
    "Load; a pre-v4 Organization or a broken install is refused (WRONG_STATE `not_v4_company`, or a broken stored row); " +
    "the Safe's guard slot must hold the installed Gate (latest block, then eth_getStorageAt; WRONG_STATE " +
    "`signer_gate_mismatch`); refresh; the live Gate must be the installed one. organizations.proposals.owner-labels names " +
    "each owner (Parties' display name, email or @handle). Answers each owner with whether it is the caller and whether the " +
    "Gate still counts it, and how many proposals wait.",
  was: [
    `${CONVEX}:23`,
    `${OPS}/safe.ts:13`,
    `${OPS}/safe.ts:17`,
    `${OPS}/safe.ts:18`,
    `${OPS}/safe.ts:20`,
    `${OPS}/safe.ts:21`,
    `${ROWS}:127`,
    `${SCHEMA}:179`,
    `${SRC}/guards.ts:32`,
    `${SRC}/guards.ts:45`,
    `${SRC}/guards.ts:67`,
    `${SRC}/reads.ts:168`,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of a v4 company.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: Schema.Struct({
    orgId: Schema.String,
    chainId: Schema.Number,
    safeAddress: Schema.String,
    threshold: Schema.Number,
    nonce: Schema.Number,
    owners: Schema.Array(
      Schema.Struct({ address: Schema.String, label: Schema.NullOr(Schema.String), isCaller: Schema.Boolean, signer: Schema.Boolean }),
    ),
    waiting: Schema.Number,
  }),
  errors: [...READ_ROW_ERRORS, error_WRONG_STATE],
  reads: DIRECTOR_WRITE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: [...PROPOSALS_LOAD.invokes, ...PROPOSALS_SETTLE.invokes, procedure_parties_party_by_safe_address],
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
});

// ── internal: the send ─────────────────────────────────────────────────────────────────────

export const rpc_organizations_proposals_send_signed = defineRpc({
  id: "organizations.proposals.send-signed",
  title: "Send a Director's signed approval or execution",
  about:
    "Registered as the internal action `organizations/proposals:sendSigned`. Accounts' accounts.approvals.sendApproved runs " +
    "it (`runAction`) for an approved `safe_proposal` approval. It decodes the stored unsigned operation, loads and " +
    "refreshes again, checks the `owner-safe-proposals` gate, `requireOwner`, and `requireStep`: the step must be the one " +
    "signed (WRONG_STATE `staleApproval`), so an `approveHash` that would now reach the threshold is refused rather than sent. " +
    "A department change is gated by `payment-departments`. `admitApproval`: Base Sepolia only, the exact calls from the " +
    "caller's personal Safe, no factory, a signature that recovers to the caller's signer (INVALID_INPUT otherwise). " +
    "organizations.proposals.record-submission notes the hash before the send; then eth_sendUserOperation, which must " +
    "acknowledge that hash. An approval is waited for and the Safe refreshed when it lands, else organizations.proposals." +
    "follow-approval is scheduled in 30 s. An execution is left to the next read's settlement." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [
    `${CONVEX}:24`,
    `${OPS}/send-signed.ts:38`,
    `${OPS}/send-signed.ts:55`,
    `${OPS}/send-signed.ts:56`,
    `${OPS}/send-signed.ts:58`,
    `${OPS}/send-signed.ts:61`,
    `${OPS}/send-signed.ts:68`,
    `${OPS}/send-signed.ts:70`,
    `${OPS}/send-signed.ts:72`,
    `${OPS}/send-signed.ts:77`,
    `${OPS}/send-signed.ts:84`,
    `${OPS}/send-signed.ts:88`,
    `${OPS}/send-signed.ts:93`,
    `${SRC}/external.ts:235`,
    `${SRC}/external.ts:268`,
    `${SRC}/external/approvals-in-flight.ts:56`,
    `${SRC}/writes/submissions.ts:74`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:81`,
    ...OWNER_WAS,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the Director's approval is recorded.",
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.String,
    proposalId: Schema.String,
    step: Schema.Literals(["approve", "execute"]),
    unsignedUserOpJson: Schema.String,
    signature: Schema.String,
  }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: [
    error_ROLE_PERMISSION_DENIED,
    error_SMART_ACCOUNT_MISSING,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_FEATURE_NOT_AVAILABLE,
    error_PROVIDER_ERROR,
    error_ENV_MISSING,
    ...DEFECT,
  ],
  reads: DIRECTOR_WRITE.reads,
  writes: DIRECTOR_WRITE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: [
    ...DIRECTOR_WRITE.invokes,
    procedure_permissions_record_proposed_permission_execution_in_tx,
    procedure_permissions_record_proposed_configuration_execution_in_tx,
  ],
  emits: PROPOSALS_SETTLE.emits,
  calls: [...PROPOSALS_REFRESH.calls, integration_chain_rpc.c.sendUserOperation, integration_chain_rpc.c.waitForUserOperationReceipt],
  chain: [...PROPOSALS_REFRESH.chain, ...APPROVAL_SENT],
  spans: [...PROPOSALS_REFRESH.spans, "chain.read eth_sendUserOperation"],
});

// ── internal: reads ────────────────────────────────────────────────────────────────────────

export const rpc_organizations_proposals_load = defineRpc({
  id: "organizations.proposals.load",
  title: "The proposals actions' context: participant, personal Safe, stored proposals",
  about:
    "Registered as the internal query `organizations/proposals:load`; every proposals action, and the equity, rounds and " +
    "share-sale actions through `requireSafeOwner`, run it through `readContext`. `proposalContextInTx`: the participant " +
    "check (a missing Organization and a non-member alike ROLE_PERMISSION_DENIED), the Organization (a vanished row is " +
    "UNKNOWN), the caller's claimed and deployed personal Safe and signer, the stored proposals window, the asked-for " +
    "proposal when older, the v4 company install (`orgLifecycles.companyInstall`) and the Safe's signers as last stored. " +
    "Marks the Organization verified on the wide event.",
  was: [`${CONVEX}:11`, `${OPS}/load.ts:11`, `${OPS}/load.ts:16`, ...PROPOSALS_LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the proposals, equity, rounds and share-sale actions for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String, proposalId: Schema.optionalKey(Schema.String) }),
  output: ProposalContext,
  errors: [error_ROLE_PERMISSION_DENIED, ...DEFECT],
  reads: PROPOSALS_LOAD.reads,
  writes: [],
  drives: [],
  invokes: PROPOSALS_LOAD.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_owner_labels = defineRpc({
  id: "organizations.proposals.owner-labels",
  title: "Each Safe signer's name, email or @handle",
  about:
    "Registered as the internal query `organizations/proposals:ownerLabels`, run by organizations.proposals.safe. It " +
    "repeats the load's participant check, then names each owner by its Party at that Safe: display name, else email, else " +
    "`@handle`, else null for a Safe Capxul does not know.",
  was: [`${CONVEX}:15`, `${OPS}/owner-labels.ts:13`, `${OPS}/owner-labels.ts:21`, `${OPS}/owner-labels.ts:23`, `${SRC}/reads.ts:145`, ...PROPOSALS_LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.proposals.safe for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String, owners: Schema.Array(Schema.String) }),
  output: Schema.Array(Schema.NullOr(Schema.String)),
  errors: [error_ROLE_PERMISSION_DENIED, ...DEFECT],
  reads: PROPOSALS_LOAD.reads,
  writes: [],
  drives: [],
  invokes: [...PROPOSALS_LOAD.invokes, procedure_parties_party_by_safe_address],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_owner_candidates = defineRpc({
  id: "organizations.proposals.owner-candidates",
  title: "The membership each email of a Director change names",
  about:
    "Registered as the internal query `organizations/proposals:ownerCandidates`, run by organizations.proposals.change-owners. " +
    "Repeats the load's participant check, then per lowercased email the Organization's memberships (`by_org_email`): " +
    "the active one with a Safe first, then any with a Safe, then any not revoked or expired; no entry otherwise.",
  was: [`${CONVEX}:14`, `${OPS}/owner-candidates.ts:13`, `${OPS}/owner-candidates.ts:21`, `${OPS}/owner-candidates.ts:23`, `${SRC}/reads.ts:181`, ...PROPOSALS_LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.proposals.change-owners for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String, emails: Schema.Array(Schema.String) }),
  output: Schema.Record(
    Schema.String,
    Schema.Struct({ email: Schema.String, name: Schema.NullOr(Schema.String), safe: Schema.NullOr(Schema.String), status: Schema.String }),
  ),
  errors: [error_ROLE_PERMISSION_DENIED, ...DEFECT],
  reads: PROPOSALS_LOAD.reads,
  writes: [],
  drives: [],
  invokes: PROPOSALS_LOAD.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_payment_recipient = defineRpc({
  id: "organizations.proposals.payment-recipient",
  title: "The Safe a Director payment's recipient names",
  about:
    "Registered as the internal query `organizations/proposals:paymentRecipient`, run by organizations.proposals.pay. " +
    "Repeats the load's participant check, then Parties' `resolveRecipientInTx`, as the money path resolves a recipient; " +
    "an unresolvable locator is INVALID_INPUT.",
  was: [`${CONVEX}:17`, `${OPS}/payment-recipient.ts:14`, `${OPS}/payment-recipient.ts:22`, `${OPS}/payment-recipient.ts:24`, `${SRC}/reads.ts:227`, ...PROPOSALS_LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.proposals.pay for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String, recipient: Schema.Unknown }),
  /** `RecipientResolution`: too deep to transcribe. */
  output: Schema.Unknown,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...DEFECT],
  reads: PROPOSALS_LOAD.reads,
  writes: [],
  drives: [],
  invokes: [...PROPOSALS_LOAD.invokes, procedure_parties_resolve_recipient_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_notice_facts = defineRpc({
  id: "organizations.proposals.notice-facts",
  title: "What one proposal's notices are built from",
  about:
    "Registered as the internal query `organizations/proposals:noticeFacts`, run by the notify workflow. The proposal (null " +
    "when gone or another Organization's), the Organization's name and its Party's handle, and per address the Party's " +
    "email and display name and whether the person at that personal Safe is an AI: it queries Accounts' `smartAccounts` " +
    "table directly (`by_smart_account_address`) and asks Profiles. No participant check: there is no caller.",
  was: [
    `${CONVEX}:12`,
    `${OPS}/notice-facts.ts:12`,
    `${OPS}/notice-facts.ts:20`,
    `${SRC}/reads/notices.ts:16`,
    `${SRC}/reads/notices.ts:30`,
    `${SRC}/reads/notices.ts:38`,
  ],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the organizations.proposals.notify workflow.",
  input: Schema.Struct({ orgId: Schema.String, proposalId: Schema.String, addresses: Schema.Array(Schema.String) }),
  output: Schema.NullOr(
    Schema.Struct({
      row: ProposalRow,
      organization: Schema.Struct({ name: Schema.String, handle: Schema.String }),
      people: Schema.Record(Schema.String, Schema.Struct({ email: Schema.NullOr(Schema.String), name: Schema.NullOr(Schema.String), ai: Schema.Boolean })),
    }),
  ),
  errors: DEFECT,
  reads: [table_org_safe_proposals, table_orgs, table_smart_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_id, procedure_parties_party_by_safe_address, procedure_profiles_read_profile_is_ai_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: writes ───────────────────────────────────────────────────────────────────────

export const rpc_organizations_proposals_record = defineRpc({
  id: "organizations.proposals.record",
  title: "Store one proposal at its nonce, or a scheduled payment's at none",
  about:
    "Registered as the internal mutation `organizations/proposals:record`, run by propose, changeOwners, reject, pay and " +
    "cancelScheduled through `storeProposal` / `storeRejection`. A scheduled payment's SafeOp hash is stored at no nonce " +
    "(`scheduled_payment`, subject and Payment). A waiting Board cancel of the same command answers in place. Otherwise " +
    "the next free nonce at or above the chain's is assigned in this transaction, so two Directors never share one; a " +
    "rejection takes its target's nonce (an unknown target INVALID_INPUT, a rejection of a rejection or a scheduled payment, " +
    "or of a settled one, WRONG_STATE; a waiting rejection answers with `created` false). A new transaction is refused " +
    "while 50 wait, or while another Director change waits. The Safe transaction hash is computed here. Every row is born " +
    "`awaiting_approvals` with no approvals. Answers the row and whether this call stored it.",
  was: [`${CONVEX}:19`, `${OPS}/record.ts:18`, `${OPS}/record.ts:54`, `${SRC}/writes.ts:72`, `${SRC}/writes.ts:209`, ...RECORD_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by the proposals actions that store a proposal.",
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    safeAddress: Schema.String,
    chainNonce: Schema.Number,
    threshold: Schema.Number,
    proposer: Schema.String,
    to: Schema.String,
    value: Schema.String,
    data: Schema.String,
    operation: Schema.Literals([0, 1]),
    calls: Schema.Array(Call),
    note: Schema.optionalKey(Schema.String),
    rejects: Schema.optionalKey(Schema.String),
    scheduled: Schema.optionalKey(
      Schema.Struct({ operationHash: Schema.String, commandId: Schema.String, paymentId: Schema.String, sendsAt: Schema.Number }),
    ),
    budgetSchedule: Schema.optionalKey(Schema.Struct({ commandId: Schema.String, paymentId: Schema.String, sendsAt: Schema.Number })),
    budgetCancel: Schema.optionalKey(Schema.Struct({ commandId: Schema.String, paymentId: Schema.String, sendsAt: Schema.Number })),
  }),
  output: Schema.Struct({ row: ProposalRow, created: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  reads: RECORD.reads,
  writes: RECORD.writes,
  drives: RECORD.drives,
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_record_submission = defineRpc({
  id: "organizations.proposals.record-submission",
  title: "Note an approval or execution a Director sent",
  about:
    "Registered as the internal mutation `organizations/proposals:recordSubmission`, run by send-signed before its send. " +
    "A proposal not this Organization's is INVALID_INPUT; a hash already noted returns the row. Appends the submission. " +
    "The proposer's own approval schedules the `proposed` notices; an execution of a Permission or invitation " +
    "configuration subject records the execution with Permissions (other subjects are followed elsewhere).",
  was: [
    `${CONVEX}:20`,
    `${OPS}/record-submission.ts:9`,
    `${SRC}/writes/submissions.ts:41`,
    `${SRC}/writes/submissions.ts:44`,
    `${SRC}/writes/submissions.ts:46`,
    `${SRC}/writes/submissions.ts:59`,
    `${SRC}/writes/subjects.ts:62`,
    `${SRC}/writes/subjects.ts:70`,
    `${SRC}/writes/subjects.ts:71`,
    `${SRC}/writes/notices.ts:21`,
  ],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.proposals.send-signed.",
  input: Schema.Struct({
    orgId: Schema.String,
    proposalId: Schema.String,
    owner: Schema.String,
    step: Schema.Literals(["approve", "execute"]),
    userOpHash: Schema.String,
  }),
  output: ProposalRow,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_org_safe_proposals],
  writes: [table_org_safe_proposals],
  drives: [],
  invokes: [
    procedure_permissions_record_proposed_permission_execution_in_tx,
    procedure_permissions_record_proposed_configuration_execution_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_proposals_settle = defineRpc({
  id: "organizations.proposals.settle",
  title: "Store what the chain settled, and the Safe's signers",
  about:
    "Registered as the internal mutation `organizations/proposals:settle`, run by `refreshProposals` from every action that " +
    "reads the Safe, only when a status, approval set, threshold or the signers changed. Each settlement applies only to a " +
    "row of this Organization still `awaiting_approvals`. An executed row schedules organizations.proposals.notify " +
    "(`executed`), applies a Seat permission change (granting or deleting the Seat permission, which schedules its notice) " +
    "or a share sale's Board approval, schedules Payroll's payroll.agreements.sweep for the Organization, and for a dated " +
    "payment schedules Payments' payments.schedules.storeApproved, storeBoardScheduled or cancelBoardScheduled. Rejected or " +
    "replaced ends its subject: a Seat permission change ended, a Permission command abandoned, an invitation still " +
    "authorizing retired, a Board-scheduled payment's end scheduled (payments.schedules.endBoardScheduled). Equity and " +
    "round writes that landed are noted once each (`installedAt`, `issuedAt`, `grantedAt`, `openedAt`, round numbers in " +
    "nonce order) and their events scheduled. It writes Payroll's, Payments' and Permissions' work only by scheduling or " +
    "invoking it, and writes the Organization row's `safeSigners` itself.",
  was: [`${CONVEX}:25`, `${OPS}/settle.ts:11`, `${SRC}/writes/settlements.ts:118`, ...PROPOSALS_SETTLE_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by `refreshProposals` in the proposals, equity, rounds and share-sale actions.",
  input: Schema.Struct({
    orgId: Schema.String,
    settlements: Schema.Array(
      Schema.Struct({
        proposalId: Schema.String,
        status: Schema.Literals(["awaiting_approvals", "executed", "rejected", "replaced"]),
        threshold: Schema.Number,
        approvedBy: Schema.Array(Schema.String),
        executionUserOpHash: Schema.optionalKey(Schema.String),
      }),
    ),
    signers: Schema.optionalKey(Schema.Struct({ owners: Schema.Array(Schema.String), threshold: Schema.Number, blockNumber: Schema.Number })),
  }),
  output: Schema.Null,
  errors: DEFECT,
  reads: PROPOSALS_SETTLE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: PROPOSALS_SETTLE.invokes,
  emits: PROPOSALS_SETTLE.emits,
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_proposals_follow_approval = defineWorkflow({
  id: "organizations.proposals.follow-approval",
  title: "Follow a Director's sent approval until the chain shows it",
  about:
    "Registered as the internal action `organizations/proposals:followApproval`, recorded as the system job " +
    "`proposal_approval_follow_up`. organizations.proposals.send-signed schedules it 30 s after an `approveHash` whose " +
    "receipt did not come while it waited. Each run waits once for the receipt; while none came and the send is under ten " +
    "minutes old it schedules itself again in 30 s, else it loads and refreshes the proposals (as the sending Director) " +
    "so a landed approval is stored with no one reading the proposal. A refresh can write the settle mutation's work. " +
    "Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:8`,
    `${OPS}/follow-approval.ts:24`,
    `${OPS}/follow-approval.ts:38`,
    `${OPS}/follow-approval.ts:40`,
    `${OPS}/follow-approval.ts:41`,
    `${OPS}/follow-approval.ts:43`,
    `${SRC}/external/approvals-in-flight.ts:34`,
    `${SRC}/external/approvals-in-flight.ts:56`,
    `${SRC}/rules.ts:59`,
    ...PROPOSALS_LOAD_WAS,
    ...PROPOSALS_REFRESH_WAS,
  ],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_proposals_send_signed },
  instance: { per: table_org_safe_proposals },
  waits: [{ name: "receipt", for: "chain", about: "`waitForUserOperationReceipt` on the sent approval's hash, a failed wait read as none." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `proposal_approval_follow_up` and annotates the hash." },
    { name: "wait", about: "Waits once for the approval's receipt." },
    { name: "again", about: "No receipt and sent under 10 minutes ago: schedules itself in 30 s with the same input." },
    { name: "refresh", about: "Otherwise runs organizations.proposals.load and refreshes, storing what the chain settled." },
  ],
  reads: DIRECTOR_WRITE.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: [...PROPOSALS_LOAD.invokes, ...PROPOSALS_SETTLE.invokes],
  emits: PROPOSALS_SETTLE.emits,
  calls: [integration_chain_rpc.c.waitForUserOperationReceipt, ...PROPOSALS_REFRESH.calls],
  chain: PROPOSALS_REFRESH.chain,
  idempotency: "A run that reads the approval landed only refreshes; a refresh writes only rows still awaiting approvals.",
  timeoutMs: 600_000,
  retries: { max: 0, backoff: "fixed" },
});

export const workflow_organizations_proposals_notify = defineWorkflow({
  id: "organizations.proposals.notify",
  title: "Email the Directors about a proposal, and the people an executed one names",
  about:
    "Registered as the internal action `organizations/proposals:notify` (G5); the entry loads Resend. Recorded as the " +
    "system job `proposal_notices`. organizations.proposals.record-submission schedules it (`proposed`) when the proposer's " +
    "own approval is noted, and organizations.proposals.settle schedules it (`executed`) when a proposal settles executed; " +
    "both with `runAfter(0)` and attempt 0. A Permission subject (or a v4 allowance once executed) reads Permissions' " +
    "internal query permissions.commands.notice. It reads the Safe's owners and threshold; for `proposed` it counts each " +
    "owner's `approvedHashes` mark and, while the proposer's own approval is not on chain, schedules itself every 5 s up to " +
    "120 times. Then organizations.proposals.notice-facts names the people, and the planned emails (approval requests to " +
    "the other Directors; new Directors and an allowance's member once executed) go to the mail owner. Recipients the " +
    "provider did not take are retried by scheduling itself again (1 min, then 4 min) for those only. Returns sent and " +
    "failed counts. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:4`,
    `${CONVEX}:13`,
    `${OPS}/notify.ts:27`,
    `${OPS}/notify.ts:44`,
    `${OPS}/notify.ts:47`,
    `${OPS}/notify.ts:55`,
    `${OPS}/notify.ts:60`,
    `${OPS}/notify.ts:67`,
    `${OPS}/notify.ts:71`,
    `${OPS}/notify.ts:80`,
    `${SRC}/external/notices.ts:25`,
    `${SRC}/external/notices.ts:51`,
    `${SRC}/external/notices.ts:85`,
    `${SRC}/external/notices.ts:101`,
    `${SRC}/reads/notices.ts:77`,
    `${SRC}/reads/notices.ts:96`,
    `${SRC}/rules/notices.ts:1`,
    `${SRC}/writes/notices.ts:21`,
    `${SRC}/writes/submissions.ts:44`,
    `${SRC}/writes/settlements.ts:56`,
    `${BACKEND}/src/integrations/mail/notices.ts:17`,
    `${BACKEND}/src/integrations/mail/notices.ts:20`,
  ],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_proposals_record_submission },
  instance: { per: table_org_safe_proposals },
  waits: [{ name: "proposer-signature", for: "timer", timeoutMs: 600_000, about: "Reschedules itself every 5 s, at most 120 times, until the proposer's approval is on chain." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `proposal_notices` and the Organization as verified." },
    { name: "facts", about: "Runs organizations.proposals.notice-facts; a missing proposal ends the run with nothing sent." },
    { name: "permission", about: "For a Permission or executed allowance subject, runs Permissions' permissions.commands.notice." },
    { name: "safe", about: "Reads the Safe's owners and threshold; for `proposed`, each owner's approvedHashes mark." },
    { name: "proposer", about: "`proposed` without the proposer's approval on chain: waits by scheduling itself again." },
    { name: "plan", about: "`proposedNotices` or `executedNotices` from the facts with each address's person." },
    { name: "deliver", about: "`deliverNotices`; recipients not taken are retried by scheduling itself (1 min, then 4 min)." },
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.fetchSafeOwners, integration_chain_rpc.c.fetchEthCall, integration_mail.c.deliverNotices],
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_safe.f.approvedHashes],
  idempotency: "None stops a resend: a `proposed` run for a proposal no longer waiting sends nothing, and a retry sends only to `only`.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "exponential" },
});
