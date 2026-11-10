// The target budgets concept's tables, state machines and each machine's one event (P7).
//
// Money authority inside an Organization is v4 Budgets: one tree of budgets per company Safe, each
// budget in one token and period and naming an office hat. A top budget, a department, a team and a
// spending allowance are all budgets. What the chain holds (amounts, what was spent, committed and
// given to children, closed or open, who wears a hat, the payout ceiling) is never copied here: it is
// read from indexing's views and, where a read must be live, from the chain itself. Budgets keeps
// only what the chain cannot name: a budget's Capxul id, key, name and kind, the office hat it
// planned before the chain had the budget, and each change Capxul proposed, with what it carries.
//
// Two tables replace four old ones: budgets replaces old permissions' permission-allowances and
// old payroll's payroll-departments; budget-changes replaces permission-allowance-commands and
// payroll-department-changes (decision budgets.two-tables). The pre-v4 permission, assignment,
// command, receipt and granter tables are dropped (P9, decision concepts.permissions-dissolved).
//
// Ids: `dep_<ulid>` for a department or team, `allowance_<ulid>` for an allowance, `bch_<ulid>` for
// a change. Times are epoch milliseconds. Addresses and hat ids are lowercase hex strings; chain
// budget ids and token amounts are decimal strings in the token's smallest unit.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";

const PERM = "packages/backend/src/permissions";
const PAY = "packages/backend/src/payroll";
const AS_PERM = "docs/as-is/archive/permissions/data.ts";
const AS_PAY = "docs/as-is/archive/payroll/data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

const KEPT = "Kept for the life of the Organization: it is the record of which budgets Capxul made and what it proposed.";

// ── shared shapes ───────────────────────────────────────────────────────────────────────────

/** A v4 budget's period (Budgets' calendar): a week is refused. */
export const Period = Schema.Literals(["month", "quarter", "year"]);

/** What a budget is to the product: a department or team (`org department`), or a spending allowance (`org allowance`). */
export const BudgetKind = Schema.Literals(["department", "allowance"]);

/** Every change Capxul proposes on a budget or a token's payout ceiling. */
export const ChangeKind = Schema.Literals([
  "create",
  "set_amount",
  "close",
  "reopen",
  "add_holder",
  "remove_holder",
  "set_ceiling",
  "freeze_ceiling",
  "unfreeze_ceiling",
]);

/** Who signs a change: the Board (a Board proposal) or the office holder above the budget (their own approval). */
export const Signer = Schema.Literals(["board", "office"]);

/** Why a change ended without applying: what became of the Board proposal or the approval that carried it. */
export const ChangeOutcome = Schema.Literals(["rejected", "replaced", "failed", "declined", "expired"]);

/** A token's payout ceiling as the Roles allowance holds it, kept by a freeze so the unfreeze can restore it. */
export const CeilingState = Schema.Struct({
  refill: S,
  max_refill: S,
  period_seconds: S,
  balance: S,
  timestamp: S,
});

/** What a change carries beyond its kind: only the fields its kind uses are set. */
export const ChangeTerms = Schema.Struct({
  /** create, set_amount: the budget's amount per its period. */
  amount: NullOr(S),
  /** create: the holders minted the new office hat; add_holder, remove_holder: the one holder. */
  holders: Schema.Array(Schema.Struct({ member_id: S, safe_address: S })),
  /** set_ceiling, and a create or set_amount of a top budget: the ceiling the proposal leaves. */
  ceiling: NullOr(S),
  /** freeze_ceiling: what the frozen ceiling keeps. */
  leave: NullOr(S),
  /** freeze_ceiling: the ceiling before the freeze, which the unfreeze restores less all of `leave`. */
  restore: NullOr(CeilingState),
  /** The note shown on the proposal or the approval page. */
  note: NullOr(S),
});

// ── budgets ─────────────────────────────────────────────────────────────────────────────────

export const table_budgets = defineTable({
  id: "budgets",
  title: "Budgets: what the chain cannot name about each one",
  about:
    "One row per budget Capxul proposed in an Organization: a department or team (`dep_` id) or a spending allowance " +
    "(`allowance_` id), its key (from its name: `engineering`, `office-costs`), its name, its token and period, its " +
    "parent's chain id (null for a top budget), and the office hat it was planned with and the hat that hat sits under " +
    "(`admin_hat_id`: the Board's top hat, or a team's parent office hat). Budgets ids are one counter across every " +
    "company, so none can be held ahead: `budget_id` is null while the create is proposed and is bound from the indexed " +
    "BudgetCreated once it executes. Amounts, spends, commitments, closed or open and the hat's wearers are chain facts, " +
    "read from indexing and the chain, never stored. A budget made outside Capxul has no row and reads by its chain id. " +
    "`key_claim` is the key while the budget is proposed or active and null once abandoned, so an abandoned create frees " +
    "its key.",
  was: [`${PERM}/tables/allowances.ts:9`, `${PAY}/tables.ts:220`, `${AS_PERM}:400`, `${AS_PAY}:170`],
  concept: concept_budgets,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    budget_ref: S,
    kind: BudgetKind,
    key: S,
    key_claim: NullOr(S),
    name: S,
    parent_budget_id: NullOr(S),
    token: S,
    period: Period,
    budget_id: NullOr(S),
    hat_id: S,
    admin_hat_id: S,
    status: Schema.Literals(["proposed", "active", "abandoned"]),
    created_change_id: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "budget_ref"],
  indexes: [
    {
      name: "by_org_key_claim",
      fields: ["org_id", "key_claim"],
      unique: true,
      for: "A budget by its key (`engineering`), as every command takes it; and a create's refusal when the key is taken or proposed.",
    },
    {
      name: "by_org_budget_id",
      fields: ["org_id", "budget_id"],
      unique: true,
      for: "A chain budget's Capxul name, key and kind: the tree and list reads join indexing's budgets to it by chain id.",
    },
    {
      name: "by_org_kind_ref",
      fields: ["org_id", "kind", "budget_ref"],
      for: "An Organization's departments, or its allowances, in id order: the list reads, and `--after` paging by allowance id.",
    },
  ],
  retention: KEPT,
});

// ── changes ─────────────────────────────────────────────────────────────────────────────────

export const table_budget_changes = defineTable({
  id: "budget-changes",
  title: "Budget changes: one Board proposal or approval each",
  about:
    "One change Capxul proposed: a budget's create, amount, close or reopen, one holder of its office added or removed, " +
    "or a token's payout ceiling set, frozen or unfrozen. It is born in the transaction that opens what carries it: a " +
    "Board proposal (`board.propose`) when the Board signs, or the office holder's own approval (`approvals.open`) when " +
    "the office above the budget does; `approval_id` is the proposer's own approval either way. One durable process per " +
    "change follows the carrier and applies or abandons it. `request_key` makes a repeat answer the same change. " +
    "`ceiling_token` is the token whose payout ceiling it writes (a ceiling change, and a top budget's create or amount), " +
    "and `admin_hat_id` the hat a create's new office hat is planned under: one waiting change per budget, per ceiling and " +
    "per admin hat, because each plans from the chain as it is now and a second would undo the first or take its hat id. " +
    "A freeze keeps the ceiling it replaced in `terms.restore`, so only a Capxul freeze can be unfrozen.",
  was: [`${PERM}/tables/allowances.ts:34`, `${PAY}/tables.ts:261`, `${AS_PERM}:451`, `${AS_PAY}:216`],
  concept: concept_budgets,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    change_id: S,
    request_key: S,
    kind: ChangeKind,
    /** The budget it changes or creates; null for a ceiling change. */
    budget_ref: NullOr(S),
    ceiling_token: NullOr(S),
    admin_hat_id: NullOr(S),
    signer: Signer,
    /** The Board proposal that carries it, when the Board signs. */
    proposal_id: NullOr(S),
    approval_id: S,
    proposer_principal_id: S,
    terms: ChangeTerms,
    state: Schema.Literals(["proposed", "applied", "abandoned"]),
    outcome: NullOr(ChangeOutcome),
    created_at: N,
    settled_at: NullOr(N),
  }),
  key: ["org_id", "change_id"],
  indexes: [
    {
      name: "by_org_request",
      fields: ["org_id", "request_key"],
      unique: true,
      for: "A repeat of a request: the same key answers the same change, and a key used for another change is refused.",
    },
    {
      name: "by_org_budget_state",
      fields: ["org_id", "budget_ref", "state"],
      for: "The change still waiting on a budget, which refuses another change of it and is named in the refusal.",
    },
    {
      name: "by_org_ceiling_state",
      fields: ["org_id", "ceiling_token", "state", "settled_at"],
      for: "The payout ceiling write still waiting in a token, which refuses another; and the last applied freeze an unfreeze restores.",
    },
    {
      name: "by_org_admin_hat_state",
      fields: ["org_id", "admin_hat_id", "state"],
      for: "A create still waiting under the same admin hat, whose planned hat id a second create would take.",
    },
  ],
  retention: KEPT,
});

// ── state machines and their events (P7: one event per machine, defined just above it) ────

const From = NullOr(S);

export const event_budget_transitioned = defineEvent({
  id: "budget_transitioned",
  about:
    "A budget Capxul proposed was born proposed, became active once the chain had it, or was abandoned because its create " +
    "can never run. Replaces the old allowance and department status writes, which sent nothing.",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    budget_ref: S,
    kind: S,
    budget_id: NullOr(S),
  }),
  was: [`${PERM}/allowances/writes.ts:118`, `${PAY}/departments/writes.ts:175`],
});

export const machine_budget = defineMachine({
  id: "budget",
  title: "Budget",
  about:
    "budgets.status, driven by the change that creates the budget. Born proposed with its create change; active once " +
    "the create's carrier executed and the indexed BudgetCreated names the planned hat, which binds `budget_id`; " +
    "abandoned when the create can never run, which frees its key. Closed and open are not states here: they are the " +
    "chain's (BudgetClosed, BudgetReopened), read from indexing, so a close made outside Capxul reads the same.",
  was: [`${AS_PERM}:739`, `${AS_PAY}:500`],
  table: table_budgets,
  field: "status",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Its create waits on a Board proposal or an office holder's approval; it has no chain id yet." },
    { id: "active", about: "The chain has the budget: `budget_id` is bound and every read and spend uses it." },
    { id: "abandoned", about: "Its create was rejected, replaced, failed, declined or expired; reads leave it out.", terminal: true },
  ],
  transitions: {
    propose: {
      from: [],
      to: "proposed",
      about: "Birth, in a create's transaction with its change and the proposal or approval that carries it.",
      emits: [event_budget_transitioned],
    },
    activate: {
      from: ["proposed"],
      to: "active",
      about: "The create's carrier executed and indexing shows BudgetCreated for the company Safe with the planned hat.",
      guard: "The created budget's hat, token, period and parent are the planned ones.",
      emits: [event_budget_transitioned],
    },
    abandon: {
      from: ["proposed"],
      to: "abandoned",
      about: "The create's carrier can never run, or ran without making the planned budget; `key_claim` is cleared.",
      emits: [event_budget_transitioned],
    },
  },
});

export const event_budget_change_transitioned = defineEvent({
  id: "budget_change_transitioned",
  about:
    "A budget change was proposed, applied once its carrier executed, or abandoned with why. Replaces " +
    "payroll_department_change_proposed and permission_command_proposed, which old operations sent themselves.",
  props: Schema.Struct({
    from: From,
    to: S,
    transition: S,
    org_id: S,
    change_id: S,
    kind: S,
    budget_ref: NullOr(S),
    signer: S,
    outcome: NullOr(S),
  }),
  was: [`${PAY}/departments/operations/emit-change-proposed.ts:1`, `${PERM}/events.ts:1`],
});

export const machine_budget_change = defineMachine({
  id: "budget-change",
  title: "Budget change",
  about:
    "budget-changes.state, owned by the change's one durable process. Born proposed with its Board proposal or approval; " +
    "applied when that carrier executed on chain; abandoned when it can never run (a rejection or another transaction " +
    "took its nonce, it ran and failed, or the approval was declined or expired). A proposed change blocks another on the " +
    "same budget, ceiling or admin hat until it settles.",
  was: [`${AS_PERM}:770`, `${AS_PAY}:540`],
  table: table_budget_changes,
  field: "state",
  initial: "proposed",
  states: [
    { id: "proposed", about: "Its Board proposal waits for the Directors, or its approval for the office holder and the chain." },
    { id: "applied", about: "Its carrier executed: the chain holds what it proposed.", terminal: true },
    { id: "abandoned", about: "Its carrier can never run; `outcome` says why, and nothing it proposed happened.", terminal: true },
  ],
  transitions: {
    propose: {
      from: [],
      to: "proposed",
      about: "Birth, in the preparing rpc's transaction with `board.propose` or `approvals.open`.",
      emits: [event_budget_change_transitioned],
    },
    apply: {
      from: ["proposed"],
      to: "applied",
      about: "The carrier executed successfully (proposal_transitioned or approval_transitioned) and, for a create, the budget is bound.",
      emits: [event_budget_change_transitioned],
    },
    abandon: {
      from: ["proposed"],
      to: "abandoned",
      about: "The carrier ended without running, or ran and failed; `outcome` is set.",
      emits: [event_budget_change_transitioned],
    },
  },
});
