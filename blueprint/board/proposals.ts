// The proposals area: reading Board proposals, a Director's approval of one, and a rejection.
//
// A Board proposal is one company Safe transaction (data.ts). Each Director approves its hash from
// their own Safe (`Safe.approveHash`), and the approval that reaches the threshold at the Safe's
// current nonce executes it instead (the lapsed signers' `removeSigner`, then `Safe.execTransaction`
// with every approval as a v = 1 signature, which the Gate checks). A rejection is a proposal of its
// own at the rejected proposal's nonce that does nothing. Status is never settled on read: the
// proposal's process settles it from the indexed execution at its nonce (processes.ts), and a read
// joins the chain's approvals so far.

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import {
  contract_hats_signer_gate,
  contract_multi_send_call_only,
  contract_payments,
  contract_safe,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags, table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_hat_wearers, table_safe_approvals, table_safe_owners } from "../indexing/data.ts";
import { Call, Summary, UserOperation, table_approvals } from "../approvals/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "./procedures.ts";
import { ProposalKind, table_board_proposals, table_proposal_approvals } from "./data.ts";

const OLD = "packages/backend/src/organizations/proposals";
const AS_IS = "docs/as-is/archive/organizations/proposals.ts";
const S = Schema.String;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

export const ProposalInput = Schema.Struct({ orgId: S, proposalId: S });
export const ListInput = Schema.Struct({ orgId: S, status: NullOr(table_board_proposals.fields.fields.status) });

/** A Board proposal as every proposal read answers it (`org proposal get`, `list`, `wait`). */
export const ProposalView = Schema.Struct({
  proposalId: S,
  orgId: S,
  chainId: Int,
  safeAddress: S,
  nonce: NullOr(Int),
  safeTxHash: S,
  kind: ProposalKind,
  rejects: NullOr(S),
  transaction: Schema.Struct({ to: S, value: S, data: S, operation: Schema.Literals(["call", "delegatecall"]) }),
  calls: Schema.Array(Call),
  note: NullOr(S),
  proposer: S,
  status: table_board_proposals.fields.fields.status,
  threshold: Int,
  approvals: Schema.Array(Schema.Struct({ owner: S, label: NullOr(S), state: Schema.Literals(["approved", "sent"]) })),
  executionUserOpHash: NullOr(S),
  payment: Schema.optionalKey(Schema.Struct({ id: S, sendsAt: Schema.Number })),
  createdAt: Schema.Number,
});

/** What `org proposal approve` answers: the caller's approval of the proposal, in the frozen approval shape. */
export const ApprovalOpened = Schema.Struct({
  proposalId: S,
  step: Schema.Literals(["approve", "execute"]),
  approvalId: S,
  url: S,
  kind: Schema.Literal("safe_proposal"),
  state: Schema.Literals(["pending", "approved", "consumed", "rejected", "expired"]),
  actor: Schema.Struct({ orgId: S, name: S }),
  summary: Summary,
  operation: NullOr(Schema.Struct({ userOperation: UserOperation, digest: S })),
  signer: NullOr(Schema.Struct({ address: S })),
  expiresAt: Schema.Number,
  createdAt: Schema.Number,
  reviewedAt: NullOr(Schema.Number),
  decidedAt: NullOr(Schema.Number),
  consumedAt: NullOr(Schema.Number),
});

// ── shared rules ────────────────────────────────────────────────────────────────────────────

const MEMBER = "The session's principal must hold a current Seat of the Organization (ROLE_PERMISSION_DENIED otherwise).";

const DIRECTOR =
  "The caller must be a Director: a current Seat whose Safe is an owner of the company Safe and still wears the Director " +
  "hat (ROLE_PERMISSION_DENIED; `director_hat_lapsed` when only the hat lapsed, read live with `isValidSigner`).";

const APPROVALS_SO_FAR =
  "Its approvals are the current owners whose ApproveHash of its hash is indexed (`approved`), and each Director " +
  "approval Capxul opened for it that is signed or sent and not indexed yet (`sent`); an owner added on chain counts " +
  "at the next read. A waiting proposal's threshold is the Safe's now (indexing's safe-owners); a settled one keeps the " +
  "threshold and approvals it settled with. Directors are labelled by the name, email or `@handle` Capxul knows.";

const READS = [
  table_org_members,
  table_principals,
  table_parties,
  table_board_proposals,
  table_proposal_approvals,
  table_approvals,
  table_safe_owners,
  table_safe_approvals,
] as const;

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_board_proposals_get = defineRpc({
  id: "board.proposals.get",
  title: "One Board proposal, with its approvals so far",
  about:
    MEMBER + " One proposal of the Organization by its `sp_` id, however old; an id the Organization does not hold is " +
    "INVALID_INPUT. Its status is the one its process settled from the chain: a transaction executed at its nonce " +
    "outside Capxul ends it as replaced. " + APPROVALS_SO_FAR + " Nothing is written and nothing is read live.",
  was: [`${OLD}/operations/get.ts:15`, `${OLD}/views.ts:9`, `${AS_IS}:603`],
  concept: concept_board,
  kind: "query",
  who: "Any current member of the Organization.",
  input: ProposalInput,
  output: ProposalView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.board.proposals.get"],
  budget: budget("read"),
});

export const rpc_board_proposals_list = defineRpc({
  id: "board.proposals.list",
  title: "The Organization's Board proposals, newest nonce first",
  about:
    MEMBER + " Every proposal of the Organization in one list, newest nonce first (the newest created first within a " +
    "nonce), filtered by status when one is given; a rejection names what it rejects. Each reads as " +
    "`board.proposals.get` reads it. " + APPROVALS_SO_FAR,
  was: [`${OLD}/operations/list.ts:14`, `${AS_IS}:576`],
  concept: concept_board,
  kind: "query",
  who: "Any current member of the Organization.",
  input: ListInput,
  output: Schema.Array(ProposalView),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [...READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: ["rpc.board.proposals.list"],
  budget: budget("read"),
});

// ── a Director's approval ───────────────────────────────────────────────────────────────────

export const rpc_board_proposals_approve = defineRpc({
  id: "board.proposals.approve",
  title: "Open a Director's approval of a Board proposal",
  about:
    DIRECTOR + " The `owner-safe-proposals` gate must be on for the Organization (FEATURE_NOT_AVAILABLE). An id the " +
    "Organization does not hold is INVALID_INPUT; a proposal that is no longer waiting is WRONG_STATE. The step is " +
    "decided from the chain now: when the indexed approvals of Directors who still sign, with the caller's, reach the " +
    "Gate's threshold and the proposal's nonce is the Safe's current one, the caller's approval executes it (one " +
    "`HatsSignerGate.removeSigner` per lapsed owner, then `Safe.execTransaction` with each approval as a v = 1 " +
    "signature and the caller as sender); otherwise it is `Safe.approveHash(safeTxHash)`, and a caller whose own " +
    "approval is already on chain is WRONG_STATE (wait for the other Directors). A proposal at a later nonce collects " +
    "approvals but executes only after the ones before it: a Director runs this again then. In one transaction it opens " +
    "the approval from the caller's own Safe (`approvals.open`, opener board, the proposal as subject, naming the gate) " +
    "and records it (proposal-approvals). Asking again while the caller's approval is still live answers the same " +
    "approval. Whether the chain would refuse the execution is the approval's sponsorship, before anyone signs.",
  was: [`${OLD}/operations/request-approval.ts:42`, `${OLD}/rules.ts:128`, `${OLD}/guards.ts:92`, `${AS_IS}:669`],
  concept: concept_board,
  kind: "action",
  who: "A Director of the Organization: a person, never an agent (board.no-agent-directors).",
  input: ProposalInput,
  output: ApprovalOpened,
  errors: [
    error_NOT_AUTHENTICATED,
    error_ROLE_PERMISSION_DENIED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_FEATURE_NOT_AVAILABLE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  reads: [...READS, table_organizations, table_org_deployments, table_hat_wearers, table_feature_flags],
  writes: [table_proposal_approvals],
  drives: [],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [
    contract_hats_signer_gate.f.isValidSigner,
    contract_safe.f.getThreshold,
    contract_safe.f.approveHash,
    contract_hats_signer_gate.f.removeSigner,
    contract_safe.f.execTransaction,
    contract_multi_send_call_only.f.multiSend,
  ],
  spans: ["rpc.board.proposals.approve"],
  budget: budget("chain-read"),
});

// ── a rejection ─────────────────────────────────────────────────────────────────────────────

export const rpc_board_proposals_reject = defineRpc({
  id: "board.proposals.reject",
  title: "Propose the rejection of a waiting Board proposal",
  about:
    DIRECTOR + " An id the Organization does not hold is INVALID_INPUT; a rejection, or a proposal that is no longer " +
    "waiting, is WRONG_STATE. A rejection of that proposal already waiting answers again, unchanged, and reports " +
    "nothing. Otherwise it opens the rejection through `board.propose` (kind rejection, `rejects` the proposal, the " +
    "rejected proposal's nonce): one company Safe call of `Payments.paid(bytes32(0))` with value 0, a read that does " +
    "nothing, because the Gate refuses any call into the Safe itself. Once it executes the nonce is used up and the " +
    "rejected proposal can never run; it needs the threshold like any proposal. The caller's approval of the " +
    "rejection is born with it.",
  was: [`${OLD}/operations/reject.ts:24`, `${OLD}/writes.ts:258`, `${AS_IS}:627`],
  concept: concept_board,
  kind: "mutation",
  who: "A Director of the Organization.",
  input: ProposalInput,
  output: ProposalView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...READS, table_hat_wearers],
  writes: [],
  drives: [],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [],
  chain: [contract_payments.f.paid],
  spans: ["rpc.board.proposals.reject"],
  budget: budget("write"),
});
