// The invitations area: the grants an Organization invitation offers (officer hats, existing
// spending allowances, a new spending allowance) and taking them back. `org member invite` is
// budgets' flow (decision operations.member-invite-in-budgets): organizations' invite rpc writes the
// invitation, then this area's propose rpc plans every grant and opens one Board proposal of them
// (`board.propose`), bound to the invitation in the same transaction
// (`organizations.bind-invitation-grants`). Only budgets can plan a new allowance (its parent, its hat,
// its budgets row), which is why the flow is here. The plan rpc is the flow's read before it writes
// (`--preview`). Taking the hats back when an offer ends with them on chain is budgets' workflow in
// processes.ts.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_budgets } from "../shared/foundation.ts";
import { contract_budgets, contract_hats, integration_chain_rpc, integration_indexer } from "../shared/external.ts";
import {
  error_CHILDREN_EXCEED_PARENT,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { Call } from "../approvals/data.ts";
import {
  Offer,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_organizations,
} from "../organizations/data.ts";
import { InvitationView } from "../organizations/invitations.ts";
import { procedure_organizations_bind_invitation_grants } from "../organizations/procedures.ts";
import { table_chain_budgets, table_chain_hats, table_hat_wearers } from "../indexing/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_budget, machine_budget_change, table_budget_changes, table_budgets } from "./data.ts";

const OLD = "packages/backend/src/organizations/invitations";
const PERM = "packages/backend/src/permissions";
const AS_IS = "books/as-is/organizations/invitations.ts";

const S = Schema.String;
const NullOr = Schema.NullOr;
const Arr = Schema.Array;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** Who the invitation is for, as `org member invite` names them: an email, an agent's `@handle`, or `--account-id`. */
export const Grantee = Schema.Union([
  Schema.Struct({ type: Schema.Literal("email"), email: S }),
  Schema.Struct({ type: Schema.Literal("handle"), handle: S }),
  Schema.Struct({ type: Schema.Literal("account"), accountId: S }),
]);

/** What `org member invite` asks for: the grantee, `--agent`, the offers, `--preview` and the request key. */
export const InviteInput = Schema.Struct({
  orgId: S,
  to: Grantee,
  agent: Schema.Boolean,
  /** At most 16, none twice: an officer hat, an existing allowance by id or key, or one new allowance. */
  offers: Arr(Offer),
  preview: Schema.Boolean,
  requestKey: S,
});

/** One offer as it stands now: its label and policy, and the calls the Board batch makes for it. */
export const OfferLine = Schema.Struct({
  offer: Offer,
  label: S,
  /** `office-costs · 2,000.00 USDC a month`, or the officer hat's name. */
  policy: S,
  /** The hat the grantee's Safe is minted; for a new allowance, the hat planned under the Board's top hat. */
  hat: S,
  calls: Arr(Call),
});

/** What the plan answers, and what `--preview` prints: every offer, and whether the Board must sign. */
export const InvitePlan = Schema.Struct({
  grantee: Schema.Struct({ partyId: NullOr(S), kind: Schema.Literals(["human", "agent"]), handle: NullOr(S), safe: NullOr(S) }),
  offers: Arr(OfferLine),
  /** False for a Seat-only offer, which needs no approval. */
  needsBoard: Schema.Boolean,
});

/** What the propose rpc answers: the Board proposal of the invitation's grants and the inviter's first approval. */
export const GrantsProposed = Schema.Struct({
  invitationId: S,
  proposalId: S,
  nonce: Schema.Int,
  safeTxHash: S,
  approvalId: S,
  approvalUrl: S,
  /** `execute` on a 1-of-N Board at the Safe's current nonce: the inviter's approval executes it. */
  step: Schema.Literals(["approve", "execute"]),
  offers: Arr(OfferLine),
  /** False when a repeat found the proposal this invitation already had. */
  opened: Schema.Boolean,
});

/** What `org member invite` prints with `--json`: the invitation, its grants by id and the proposal that sets them up. */
export const InviteResult = Schema.Struct({
  ...InvitationView.fields,
  /** The officer hats and allowances offered, by id: `books`, `allowance_…`. */
  grants: Arr(S),
  /** The Board proposal that sets up its grants (the old configure command); null for a Seat-only offer. */
  commandId: NullOr(S),
});

// ── what both rpcs read and check ───────────────────────────────────────────────────────────

const READS = [
  table_organizations,
  table_org_members,
  table_org_deployments,
  table_principals,
  table_parties,
  table_budgets,
  table_budget_changes,
  table_chain_budgets,
  table_chain_hats,
  table_hat_wearers,
] as const;

const ERRORS = [
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_TOKEN_NOT_SUPPORTED,
  error_CHILDREN_EXCEED_PARENT,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
] as const;

const PLAN =
  "The inviter's Seat must wear the People hat, and any grant needs them to wear the Director hat too (indexing's " +
  "hat-wearers; ROLE_PERMISSION_DENIED otherwise, with nothing written). At most 16 offers, none twice. An officer hat " +
  "(Books, Invoicing, People) is `Hats.mintHat` of the deployment's hat id. An existing allowance, by `allowance_` id or " +
  "key, must be this Organization's, active and open (INVALID_INPUT, WRONG_STATE): `Hats.mintHat` of its hat, after " +
  "`Hats.changeHatMaxSupply` when the hat is full (indexing's hats). A new allowance (`--new-allowance-name`, `--asset`, " +
  "`--limit`) is a budget under the one open top budget in that asset (none or several is INVALID_INPUT; an asset the " +
  "deployment does not admit is TOKEN_NOT_SUPPORTED), in that budget's period, for `limit` per period, which must be " +
  "above 0 and within what the parent has left to give (`Budgets.budgetOf`, `leftOf`: CHILDREN_EXCEED_PARENT, naming " +
  "what is left); its key is taken from its name and must be free; no other create may wait under the Board's top hat " +
  "(WRONG_STATE); its hat id is planned from indexing's hats with Ponder at the chain head. Its calls are " +
  "`Hats.createHat(boardTopHat, details, 1, safe, safe, true, image)`, `Budgets.createChildBudget(parent, limit, hat)` " +
  "and `Hats.mintHat(hat, granteeSafe)`. Every mint goes to the personal Safe the grantee's email names, or the agent's Safe.";

// ── rpcs ────────────────────────────────────────────────────────────────────────────────────

export const rpc_budgets_invitations_plan = defineRpc({
  id: "budgets.invitations.plan",
  title: "Plan an invitation's grants without writing anything",
  about:
    "The flow's read before it writes, and all of `--preview`. " + PLAN + " The grantee is read, not resolved: an " +
    "email names its Party or the Safe it would be given, an `@handle` must name an agent's Party, an Account a person " +
    "principal with a mailbox (INVALID_INPUT otherwise). It answers each offer with its label and policy as they stand " +
    "now, the calls the Board batch would make, and whether the Board must sign (not for a Seat alone). Nothing is written.",
  was: [`${OLD}/operations/preview.ts:1`, `${OLD}/reads/grantees.ts:72`, `${PERM}/configurations/reads/budgets.ts:1`, `${AS_IS}:241`],
  concept: concept_budgets,
  kind: "action",
  who: "A member whose Safe wears the Organization's People hat; with any grant, also a Director.",
  input: InviteInput,
  output: InvitePlan,
  errors: [...ERRORS],
  reads: [...READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_indexer.c.head],
  chain: [contract_budgets.f.budgetOf, contract_budgets.f.leftOf],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_budgets_invitations_propose = defineRpc({
  id: "budgets.invitations.propose",
  title: "Propose an authorizing invitation's grants as one Board batch",
  about:
    "The flow's step after organizations' invite rpc, for an invitation with grants. The invitation must be this " +
    "Organization's and the inviter's (INVALID_INPUT) and still `authorizing`: one already pending, active or ended " +
    "(its proposal rejected or replaced cancels it) is WRONG_STATE, and the CLI prints the invitation instead. It plans the offers the " +
    "invitation holds again, by `budgets.invitations.plan`'s rules, from the chain as it is now (the hats, the grant's " +
    "Director, a new allowance's parent, room and planned hat). Then, in one transaction: a new allowance's " +
    "budgets row is born proposed (budget.propose) with its create change (budget-change.propose, signer board, holders " +
    "none: the mint is the invitation's), so its chain id is bound when the batch executes; the Board proposal of every " +
    "grant, in offer order, at the Safe's next nonce (`board.propose`, opener budgets, subject " +
    "`invitation-grants:<invitationId>`, with the inviter's first approval); and the binding of that Safe transaction's " +
    "hash and nonce to the invitation (`organizations.bind-invitation-grants`), so the invitation opens only when the " +
    "chain shows it executed. A repeat while that proposal waits finds it (`opened: false`), and binding it again is a no-op. Two " +
    "procedures of two other concepts; board.propose opens the approval inside it.",
  was: [
    `${OLD}/operations/invite.ts:14`,
    `${OLD}/writes/phases.ts:55`,
    `${PERM}/configurations/operations/propose-intent.ts:1`,
    `${PERM}/configurations/writes/proposals.ts:1`,
    `${AS_IS}:241`,
  ],
  concept: concept_budgets,
  kind: "action",
  who: "The invitation's inviter, whose Seat wears the People hat and the Director hat.",
  input: Schema.Struct({ orgId: S, invitationId: S }),
  output: GrantsProposed,
  errors: [...ERRORS, error_FEATURE_NOT_AVAILABLE],
  reads: [...READS, table_org_invitations],
  writes: [table_budgets, table_budget_changes],
  drives: [machine_budget.t.propose, machine_budget_change.t.propose],
  invokes: [procedure_board_propose, procedure_organizations_bind_invitation_grants],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_indexer.c.head],
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_hats.f.createHat,
    contract_budgets.f.createChildBudget,
    contract_hats.f.changeHatMaxSupply,
    contract_hats.f.mintHat,
  ],
  spans: [],
  budget: budget("chain-read"),
});
