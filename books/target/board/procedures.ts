// The board concept's door: the one procedure other concepts invoke inside their own transaction.
//
// `board.propose` is named by the architecture (rules.procedures): a Board proposal and the intent it
// carries are one fact. Budgets, payments, payroll, agents and equity build the calls of their own
// intent and open the proposal that carries them here; board never builds another concept's calls
// (dependencies.board-below-proposers). They follow `proposal_transitioned` through the outbox. Board's
// own grant, revoke and rejection rpcs invoke it too, so a proposal is born in one place.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags, table_principals } from "../access/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_hat_wearers, table_safe_approvals, table_safe_owners } from "../indexing/data.ts";
import { Call, Summary } from "../approvals/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { ProposalKind, ProposalOpener, machine_proposal, table_board_proposals, table_proposal_approvals } from "./data.ts";

const OLD = "packages/backend/src/organizations/proposals";
const S = Schema.String;
const NullOr = Schema.NullOr;

/** What `board.propose` answers: the proposal, and the proposer's first approval of it. */
export const Proposed = Schema.Struct({
  proposal_id: S,
  nonce: Schema.Int,
  safe_tx_hash: S,
  approval_id: S,
  url: S,
  step: Schema.Literals(["approve", "execute"]),
  /** False when the subject already had its proposal: asking twice answers the same one. */
  opened: Schema.Boolean,
});

export const procedure_board_propose = defineProcedure({
  id: "board.propose",
  title: "Open the Board proposal that carries an opener's intent",
  about:
    "Money fact: a Board proposal and the intent it carries are one fact. The opener births its intent (a budget " +
    "change, a Board payment, an agent change, an equity matter, an officer hat change) and the company Safe " +
    "transaction that carries it in the same transaction, so the Directors never approve calls Capxul has no intent " +
    "for, and no intent waits on a proposal that does not exist. It takes the Organization, the proposing principal, " +
    "the opener's subject, the calls in order (at least one, none to the company Safe itself, which the Signer Gate " +
    "refuses: INVALID_INPUT), a note, the approval page's summary, and for a dated Board payment its Payment and day. " +
    "The proposer must hold a current Seat whose Safe is an owner of the company Safe and wears the Director hat " +
    "(indexing's safe-owners and hat-wearers; ROLE_PERMISSION_DENIED otherwise, `director_hat_lapsed` when only the hat " +
    "lapsed), the Organization must have its deployment (WRONG_STATE), and the `owner-safe-proposals` gate must be on " +
    "for it (FEATURE_NOT_AVAILABLE). The proposal takes the Safe's next free nonce: past the indexed nonce and every " +
    "waiting proposal; a rejection takes the nonce of the proposal it rejects. One call is a plain call, several one " +
    "`multiSend` delegatecall; the Safe transaction hash is the EIP-712 hash of those terms at that nonce, computed " +
    "here. The opener's subject already carried by a proposal answers that proposal (`opened: false`). It births the " +
    "row `awaiting_approvals` (proposal.propose, whose event starts its process) and the proposer's first approval " +
    "(`approvals.open`, opener board, the proposal as subject, naming the gate): `approveHash` from their own Safe, or, " +
    "when the Board needs one signature and the nonce is the Safe's current one, the execution itself.",
  was: [
    `${OLD}/writes.ts:100`,
    `${OLD}/writes.ts:244`,
    `${OLD}/rules.ts:81`,
    `${OLD}/rules.ts:128`,
    "books/as-is/organizations/proposals.ts:1124",
  ],
  concept: concept_board,
  input: Schema.Struct({
    org_id: S,
    proposer_principal_id: S,
    opener: ProposalOpener,
    subject_kind: S,
    subject_id: S,
    kind: ProposalKind,
    /** Only board's `org proposal reject`: the proposal whose nonce the rejection uses up. */
    rejects: NullOr(S),
    calls: Schema.Array(Call),
    note: NullOr(S),
    summary: Summary,
    payment: NullOr(Schema.Struct({ payment_id: S, sends_at: Schema.Number })),
  }),
  output: Proposed,
  errors: [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: [
    table_organizations,
    table_org_deployments,
    table_org_members,
    table_principals,
    table_feature_flags,
    table_safe_owners,
    table_safe_approvals,
    table_hat_wearers,
    table_board_proposals,
  ],
  writes: [table_board_proposals, table_proposal_approvals],
  drives: [machine_proposal.t.propose],
  invokes: [procedure_approvals_open],
  emits: [],
});
