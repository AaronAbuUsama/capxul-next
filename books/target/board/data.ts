// The board concept's tables, state machines and each machine's one event (P7).
//
// The Board is the company Safe acting at its Signer Gate's threshold. Board owns four tables:
//
// - `board-proposals`: one company Safe transaction each (a Board proposal), born by `board.propose`
//   inside the transaction of the concept whose intent it carries, or by board's own rpcs (an
//   officer hat grant or revoke, a rejection). One durable process per proposal settles it from the
//   chain (processes.ts). Its machine `proposal` sends `proposal_transitioned`, which every opener
//   follows through the outbox.
// - `proposal-approvals`: each Director's approval Capxul opened for a proposal (an `approveHash`, or
//   the execution itself), so a read can say whose approvals are still on their way. The approval
//   itself, its signature and its chain proof are approvals'.
// - `board-changes`: the Board changes a person makes from their own Safe, never as a proposal (the
//   Signer Gate refuses every owner change the company Safe makes): the founder's seat, removal,
//   threshold and handover through the Shareholders' top hat, an elected Director's claim, and
//   anyone's refresh of lapsed signers. One durable process per change follows its approval.
// - `officer-changes`: a grant or revoke of an officer hat (Books, Invoicing, People) carried by a
//   Board proposal, applied when the proposal's execution holds its hat mint or burn.
//
// Who is a Director, who signs, the threshold, the Safe's nonce and every approval on chain are
// chain facts, read from indexing's views (hat-wearers, safe-owners, safe-approvals,
// safe-executions) and never copied here. Ids: `sp_<ulid>`, `dc_<ulid>`, `spc_<ulid>`. Times are
// epoch milliseconds. Addresses, hashes and hat ids are lowercase hex strings. Every table is the
// Organization's (tenancy organization, `org_id` first in the key and every index but the few
// marked crossTenant).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import { Call } from "../approvals/data.ts";

const OLD = "packages/backend/src/organizations";
const T = `${OLD}/tables`;
const AS_IS = "docs/as-is/archive/organizations/data.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

const KEPT = "Kept for the life of the Organization: it is the record of what the Board decided and how.";

// ── shared shapes ───────────────────────────────────────────────────────────────────────────

/** The concepts that open Board proposals: board itself, and every concept above it that needs the Board. */
export const ProposalOpener = Schema.Literals(["board", "agents", "budgets", "payments", "payroll", "equity"]);

/** A proposal's kind, as the frozen reads name it. */
export const ProposalKind = Schema.Literals(["transaction", "rejection", "scheduled_payment"]);

/** How many Directors must sign: `needed` of `of`. */
export const Threshold = Schema.Struct({ needed: Int, of: Int });

/** A person a Board change names: their Party, name and email where Capxul knows them, and their Safe. */
export const ChangePerson = Schema.Struct({ party_id: NullOr(S), name: NullOr(S), email: NullOr(S), safe: S });

/** Why a Board change failed: an error code of the shared vocabulary and its reason. */
export const Outcome = Schema.Struct({ code: S, reason: S });

/** The officer permissions and the hat each is (CAP-1101). */
export const Permission = Schema.Literals(["manage-books", "issue-invoices", "manage-people"]);

// ── board proposals ─────────────────────────────────────────────────────────────────────────

export const table_board_proposals = defineTable({
  id: "board-proposals",
  title: "Board proposals: one company Safe transaction each",
  about:
    "One company Safe transaction the Directors approve under the Gate's threshold, at one Safe nonce. Born " +
    "`awaiting_approvals` by `board.propose` in the transaction of the concept whose intent it carries (`opener`, " +
    "`subject_kind`, `subject_id`: a budget change, a Board payment, an agent change, an equity matter), or by board's own " +
    "grant, revoke and rejection. Its calls, transaction and hash never change once written: one call is a plain call, " +
    "several are one `MultiSendCallOnly.multiSend` delegatecall. A rejection is a zero-value read of Payments at the " +
    "nonce of the proposal it rejects (`rejects`). A dated Board payment is an ordinary proposal carrying one " +
    "`Budgets.schedule` (kind `scheduled_payment`, with `payment`): every proposal has a nonce. Its process settles it " +
    "from the indexed execution at its nonce; `approved_by` and `threshold` are kept as they stood when it settled, " +
    "while a waiting proposal reads both from the chain. Replaces old `orgSafeProposals`, less its submissions (now " +
    "`proposal-approvals`), its nonce-less scheduled lane and its settle-on-read.",
  was: [`${T}/proposals.ts:15`, `${AS_IS}:616`, `${OLD}/proposals/writes.ts:100`, `${OLD}/proposals/rules.ts:100`],
  concept: concept_board,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    proposal_id: S,
    chain_id: Int,
    safe_address: S,
    nonce: Int,
    safe_tx_hash: S,
    kind: ProposalKind,
    /** The proposal a rejection uses up the nonce of; null otherwise. */
    rejects: NullOr(S),
    to: S,
    /** Wei, as a decimal string. */
    value: S,
    data: S,
    operation: Schema.Literals(["call", "delegatecall"]),
    calls: Schema.Array(Call),
    note: NullOr(S),
    opener: ProposalOpener,
    subject_kind: S,
    subject_id: S,
    /** A dated Board payment's Payment and the day it is sent; null otherwise. */
    payment: NullOr(Schema.Struct({ payment_id: S, sends_at: N })),
    proposer_principal_id: S,
    proposer_safe: S,
    status: Schema.Literals(["awaiting_approvals", "executed", "failed", "rejected", "replaced"]),
    /** The Directors' Safes whose approvals counted, and the threshold, as they stood at settlement. */
    approved_by: Schema.Array(S),
    threshold: NullOr(Int),
    /** The Safe transaction that used its nonce, its UserOperation and block; null while waiting. */
    settled_by_safe_tx_hash: NullOr(S),
    execution_user_op_hash: NullOr(S),
    execution_tx_hash: NullOr(S),
    settled_block: NullOr(Int),
    created_at: N,
    settled_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id", "proposal_id"],
  indexes: [
    {
      name: "by-id",
      fields: ["proposal_id"],
      unique: true,
      crossTenant: true,
      for: "One proposal by its id alone: its process, and an approval page or opener's workflow holding only the id (row-level security still scopes a caller's read).",
    },
    {
      name: "by-org-nonce",
      fields: ["org_id", "nonce", "created_at"],
      for: "The Safe's next free nonce (past every waiting proposal), the proposals at one nonce when it is used, and `org proposal list` newest nonce first.",
    },
    {
      name: "by-org-status-nonce",
      fields: ["org_id", "status", "nonce"],
      for: "`org proposal list --status`, and how many proposals wait (`org director list`'s `waiting`).",
    },
    {
      name: "by-org-subject",
      fields: ["org_id", "opener", "subject_kind", "subject_id"],
      unique: true,
      for: "The proposal that carries one opener's subject: `board.propose` asked twice answers the same proposal.",
    },
    {
      name: "by-org-safe-tx",
      fields: ["org_id", "safe_tx_hash"],
      unique: true,
      for: "The proposal an indexed execution or ApproveHash names by its Safe transaction hash.",
    },
    {
      name: "by-org-rejects",
      fields: ["org_id", "rejects"],
      for: "The rejection already waiting for a proposal: `org proposal reject` asked twice answers it.",
    },
  ],
  retention: KEPT,
});

// ── proposal approvals ──────────────────────────────────────────────────────────────────────

export const table_proposal_approvals = defineTable({
  id: "proposal-approvals",
  title: "Proposal approvals: each Director's approval Capxul opened",
  about:
    "One row per approval Capxul opened for a Director of a proposal (`approvals.open`, subject the proposal): the " +
    "proposer's first one, born with the proposal, and each `org proposal approve`. `step` is what it sends from the " +
    "Director's own Safe: `approve` (`Safe.approveHash`) or `execute` (the lapsed signers' `removeSigner`, then " +
    "`Safe.execTransaction` with every approval as a v = 1 signature), chosen when it opens. Its state, signature, send " +
    "and chain proof are the approval's, read from approvals by id; an approval already on chain is indexing's " +
    "`safe-approvals`. Together they answer which Directors approved and whose approvals are still on their way. " +
    "Replaces the old proposal's `submissions`, which were written after each send.",
  was: [`${T}/proposals.ts:15`, `${OLD}/proposals/writes/submissions.ts:1`, `${OLD}/proposals/rules.ts:120`],
  concept: concept_board,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    proposal_id: S,
    approval_id: S,
    director_principal_id: S,
    director_safe: S,
    step: Schema.Literals(["approve", "execute"]),
    created_at: N,
  }),
  key: ["org_id", "proposal_id", "approval_id"],
  indexes: [
    {
      name: "by-org-proposal-director",
      fields: ["org_id", "proposal_id", "director_principal_id", "created_at"],
      for: "A Director's approvals of one proposal, newest first: asking twice answers the same approval, and each Director's approval shows in a read.",
    },
  ],
  retention: KEPT,
});

// ── board changes ───────────────────────────────────────────────────────────────────────────

export const table_board_changes = defineTable({
  id: "board-changes",
  title: "Board changes made from a person's own Safe",
  about:
    "One Board change a person signs from their own Safe, never a Board proposal: seat a Director, remove one, set the " +
    "Gate's threshold or hand the Board to the Governor (the founder, through the Shareholders' top hat), claim a seat " +
    "(an elected Director) or drop the signers whose Director hat lapsed (anyone in the Organization). Born " +
    "`awaiting_approval` with the actor's approval (`approvals.open`, the change as its subject), planned from the chain " +
    "as it is now: the person it names, the signers a refresh drops, the Directors and the threshold before and after. " +
    "Only one Board change is under way in an Organization at a time, because each is planned from the Board as it " +
    "stands. Its process ends it on its approval's chain proof and the indexed facts of its transaction. The calls are " +
    "the approval's, never copied here. Replaces old `orgDirectorChanges`, less its send bookkeeping (approvals').",
  was: [`${T}/directors.ts:12`, `${AS_IS}:680`, `${OLD}/directors/writes.ts:267`, `${OLD}/directors/rules.ts:60`],
  concept: concept_board,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    change_id: S,
    action: Schema.Literals(["seat", "remove", "threshold", "handover", "refresh", "claim"]),
    actor_principal_id: S,
    actor_safe: S,
    /** The member a seat, a removal or a claim names; null for a threshold, a handover or a refresh. */
    person: NullOr(ChangePerson),
    /** The signers a refresh drops because their Director hat lapsed. */
    removed: Schema.Array(ChangePerson),
    /** The seat group a claim names; null until Board elections define seat groups. */
    seat: NullOr(S),
    directors_before: Int,
    directors_after: Int,
    threshold_before: Threshold,
    threshold_after: Threshold,
    approval_id: S,
    status: Schema.Literals(["awaiting_approval", "seated", "removed", "set", "handed_over", "failed"]),
    /** True while the change is under way: unique per Organization, so one change waits at a time. */
    open: NullOr(Schema.Literal(true)),
    outcome: NullOr(Outcome),
    tx_hash: NullOr(S),
    block_number: NullOr(Int),
    created_at: N,
    settled_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id", "change_id"],
  indexes: [
    {
      name: "by-id",
      fields: ["change_id"],
      unique: true,
      crossTenant: true,
      for: "One change by its id: its process resuming on its approval's `approval_transitioned` (which names it as the subject).",
    },
    {
      name: "by-org-open",
      fields: ["org_id", "open"],
      unique: true,
      for: "The one Board change under way in an Organization (`open` is null once it ends), refused to a second and named in the refusal.",
    },
    {
      name: "by-org-created",
      fields: ["org_id", "created_at", "change_id"],
      for: "An Organization's Board changes, newest first: `org(orgId).board.directors.get` and the read back after a change.",
    },
  ],
  retention: KEPT,
});

// ── officer changes ─────────────────────────────────────────────────────────────────────────

export const table_officer_changes = defineTable({
  id: "officer-changes",
  title: "Officer hat changes carried by Board proposals",
  about:
    "One grant or revoke of an officer hat (Books for `manage-books`, Invoicing for `issue-invoices`, People for " +
    "`manage-people`) to one member's Safe, born `proposed` with the Board proposal that carries it (`org member grant`, " +
    "`org member revoke`). The proposal's process applies it when the execution's indexed facts hold the hat minted to, " +
    "or burned from, the member's Safe, and ends it when the proposal is rejected, replaced or fails. One change waits " +
    "per member and permission. Who wears an officer hat is never stored: every concept reads it from indexing's " +
    "hat-wearers, so this row is the record of the decision, not of the permission. Replaces old `seatPermissionChanges`; " +
    "old `seatPermissions` goes (P9: a permission is a hat).",
  was: [`${T}/members.ts:62`, `${AS_IS}:480`, `${OLD}/members/writes/permissions.ts:133`],
  concept: concept_board,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    change_id: S,
    member_id: S,
    party_id: S,
    principal_id: S,
    member_safe: S,
    email: NullOr(S),
    name: NullOr(S),
    change: Schema.Literals(["grant", "revoke"]),
    permission: Permission,
    hat_id: S,
    proposal_id: S,
    /** The Director's `--note`, or the change in words. */
    note: S,
    state: Schema.Literals(["proposed", "applied", "ended"]),
    /** True while proposed: unique per member and permission, so one change waits for each. */
    waiting: NullOr(Schema.Literal(true)),
    created_at: N,
    settled_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id", "change_id"],
  indexes: [
    {
      name: "by-org-member-permission",
      fields: ["org_id", "member_id", "permission", "waiting"],
      unique: true,
      for: "The one waiting change of a member's permission, refused to a second.",
    },
    {
      name: "by-org-proposal",
      fields: ["org_id", "proposal_id"],
      unique: true,
      for: "The change a settling proposal carries, applied or ended in the same transaction.",
    },
    {
      name: "by-org-hat-waiting",
      fields: ["org_id", "hat_id", "waiting"],
      for: "The grants of one hat still waiting, so a grant's plan counts the seats they will take.",
    },
  ],
  retention: KEPT,
});

// ── state machines and their events (P7: one event per machine, defined just above it) ────

const ProposalStatus = table_board_proposals.fields.fields.status;

export const event_proposal_transitioned = defineEvent({
  id: "proposal_transitioned",
  about:
    "A Board proposal changed state. Every opener's workflow follows it by its subject (the opener, kind and id are on " +
    "it), notices tells the Directors a proposal waits for them, and the funnel reads it; `from` is null at birth. The " +
    "runtime writes it to the outbox in the transition's transaction.",
  props: Schema.Struct({
    from: NullOr(ProposalStatus),
    to: ProposalStatus,
    transition: Schema.Literals(["propose", "execute", "fail", "reject", "replace"]),
    proposal_id: S,
    org_id: S,
    kind: ProposalKind,
    nonce: Int,
    opener: ProposalOpener,
    subject_kind: S,
    subject_id: S,
  }),
  was: [`${OLD}/proposals/events.ts:44`, `${OLD}/proposals/events.ts:88`],
});

const P = [event_proposal_transitioned];

export const machine_proposal = defineMachine({
  id: "proposal",
  title: "Board proposal: from birth to the transaction at its nonce",
  about:
    "board-proposals.status, decided by the chain. Born `awaiting_approvals`. A Safe nonce is used once, so exactly one " +
    "transaction ends every proposal at that nonce: its own execution (executed, or failed when the Safe reports " +
    "ExecutionFailure), the rejection that names it (rejected), or any other (replaced, Capxul's or not). Each is " +
    "decided by the proposal's process from the indexed ExecutionSuccess or ExecutionFailure at its nonce, at the " +
    "deployment's finality depth. Every write to `status` is one of these transitions, and each sends `proposal_transitioned`.",
  was: [`${T}/proposals.ts:34`, `${OLD}/proposals/rules.ts:180`, `${OLD}/proposals/writes/settlements.ts:47`],
  table: table_board_proposals,
  field: "status",
  initial: "awaiting_approvals",
  states: [
    { id: "awaiting_approvals", about: "Its nonce is unused; Directors approve its hash, and the approval that reaches the threshold executes it." },
    { id: "executed", about: "Its own transaction ran at its nonce and succeeded: what it carried happened.", terminal: true },
    { id: "failed", about: "Its own transaction ran at its nonce and the Safe reported ExecutionFailure: the nonce is used, nothing it carried happened.", terminal: true },
    { id: "rejected", about: "The rejection that names it executed at its nonce: it can never run.", terminal: true },
    { id: "replaced", about: "Another transaction used its nonce: it can never run.", terminal: true },
  ],
  transitions: {
    propose: {
      from: [],
      to: "awaiting_approvals",
      about: "`board.propose`, inside the opener's transaction (board's own grant, revoke and rejection invoke it too).",
      guard: "The proposer is a Director; at least one call, none to the company Safe itself; the nonce is the next free one, or the rejected proposal's.",
      emits: P,
    },
    execute: {
      from: ["awaiting_approvals"],
      to: "executed",
      about: "The indexed ExecutionSuccess at its Safe names its own hash.",
      emits: P,
    },
    fail: {
      from: ["awaiting_approvals"],
      to: "failed",
      about: "The indexed ExecutionFailure at its Safe names its own hash.",
      emits: P,
    },
    reject: {
      from: ["awaiting_approvals"],
      to: "rejected",
      about: "The execution at its nonce names the hash of a Capxul rejection that rejects it.",
      emits: P,
    },
    replace: {
      from: ["awaiting_approvals"],
      to: "replaced",
      about: "The execution at its nonce names any other hash.",
      emits: P,
    },
  },
});

const ChangeStatus = table_board_changes.fields.fields.status;

export const event_board_change_transitioned = defineEvent({
  id: "board_change_transitioned",
  about:
    "A Board change changed state: born, landed as its action (a seat, a claim, a removal, a lapsed refresh, a " +
    "threshold, a handover) or failed. It carries the counts, never an email or a Safe. It replaces the old " +
    "`board_seat_transitioned` and `board_threshold_transitioned` (P7). Notices emails a seated member from it.",
  props: Schema.Struct({
    from: NullOr(ChangeStatus),
    to: ChangeStatus,
    transition: Schema.Literals(["open", "seat", "claim", "remove", "lapse", "set_threshold", "hand_over", "fail"]),
    change_id: S,
    org_id: S,
    action: table_board_changes.fields.fields.action,
    directors_after: Int,
    threshold_needed: Int,
    /** For a refresh, how many lapsed signers it dropped; 0 otherwise. */
    removed_count: Int,
  }),
  was: [`${OLD}/directors/events.ts:1`, `${AS_IS}:1423`],
});

const C = [event_board_change_transitioned];

export const machine_board_change = defineMachine({
  id: "board-change",
  title: "Board change: from the actor's approval to the chain",
  about:
    "board-changes.status. Born `awaiting_approval` with its approval. Its process ends it once: on the approval's " +
    "landing, when the indexed facts of its transaction hold its effect (the Director hat minted and the Safe added as " +
    "an owner, an owner removed, ChangedThreshold, the Governor wearing the top hat), as the action's end state; " +
    "otherwise failed, with the code: the approval declined, refused, expired, displaced or reverted, or a landing " +
    "without its effect. Every write to `status` is one of these transitions, and each sends `board_change_transitioned`.",
  was: [`${T}/directors.ts:47`, `${OLD}/directors/writes.ts:119`, `${AS_IS}:1423`],
  table: table_board_changes,
  field: "status",
  initial: "awaiting_approval",
  states: [
    { id: "awaiting_approval", about: "The actor's approval is open, signed or on its way; nothing has changed on chain." },
    { id: "seated", about: "The member's Safe signs the company Safe: seated by the founder, or claimed by an elected Director.", terminal: true },
    { id: "removed", about: "The Gate dropped the Director's Safe, or every lapsed signer a refresh named.", terminal: true },
    { id: "set", about: "The Gate requires the new threshold.", terminal: true },
    { id: "handed_over", about: "The Governor is the Director hat's eligibility and toggle, and wears the Shareholders' top hat.", terminal: true },
    { id: "failed", about: "Its approval ended without landing, or landed without its effect; `outcome` says why.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "awaiting_approval",
      about: "A board.directors rpc, with the actor's approval (`approvals.open`) in the same transaction.",
      guard: "No other Board change is under way in the Organization.",
      emits: C,
    },
    seat: { from: ["awaiting_approval"], to: "seated", about: "A seat's approval landed and the member's Safe is an owner.", emits: C },
    claim: { from: ["awaiting_approval"], to: "seated", about: "A claim's approval landed and the claimer's Safe is an owner.", emits: C },
    remove: { from: ["awaiting_approval"], to: "removed", about: "A removal's approval landed and the Director's Safe is no longer an owner.", emits: C },
    lapse: { from: ["awaiting_approval"], to: "removed", about: "A refresh's approval landed and every lapsed signer it named is no longer an owner.", emits: C },
    set_threshold: { from: ["awaiting_approval"], to: "set", about: "A threshold's approval landed and the Safe's threshold is the new one.", emits: C },
    hand_over: { from: ["awaiting_approval"], to: "handed_over", about: "A handover's approval landed and the Governor wears the top hat.", emits: C },
    fail: {
      from: ["awaiting_approval"],
      to: "failed",
      about: "Its approval was declined, refused, expired, displaced or reverted, or landed without the change's effect.",
      emits: C,
    },
  },
});

const OfficerState = table_officer_changes.fields.fields.state;

export const event_officer_change_transitioned = defineEvent({
  id: "officer_change_transitioned",
  about:
    "An officer hat change changed state: proposed, applied or ended. It names the permission and the proposal, never " +
    "the member or the note; the proposing Director is the envelope's actor. Notices tells the member from it.",
  props: Schema.Struct({
    from: NullOr(OfficerState),
    to: OfficerState,
    transition: Schema.Literals(["propose", "apply", "end"]),
    change_id: S,
    org_id: S,
    change: table_officer_changes.fields.fields.change,
    permission: Permission,
    proposal_id: S,
  }),
  was: [`${OLD}/members/events.ts:1`, `${AS_IS}:1200`],
});

const O = [event_officer_change_transitioned];

export const machine_officer_change = defineMachine({
  id: "officer-change",
  title: "Officer hat change: proposed, then applied or ended",
  about:
    "officer-changes.state. Born `proposed` with its Board proposal. The proposal's process moves it in the transaction " +
    "that settles the proposal: applied when the execution's indexed facts hold the hat minted to, or burned from, the " +
    "member's Safe; ended when the proposal was rejected, replaced or failed, or executed without that effect.",
  was: [`${T}/members.ts:69`, `${OLD}/members/writes/permissions.ts:232`],
  table: table_officer_changes,
  field: "state",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Waiting for its proposal to reach the threshold and execute." },
    { id: "applied", about: "Its proposal executed and the hat was minted or burned.", terminal: true },
    { id: "ended", about: "Its proposal can never run, or ran without the hat change.", terminal: true },
  ],
  transitions: {
    propose: {
      from: [],
      to: "proposed",
      about: "`board.officers.grant` or `.revoke`, with the proposal that carries it (`board.propose`).",
      guard: "No other change of the member's permission waits.",
      emits: O,
    },
    apply: { from: ["proposed"], to: "applied", about: "Its proposal executed with the hat change.", emits: O },
    end: { from: ["proposed"], to: "ended", about: "Its proposal was rejected, replaced or failed, or executed without the hat change.", emits: O },
  },
});
