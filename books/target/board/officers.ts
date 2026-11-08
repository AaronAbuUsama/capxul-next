// The officers area: granting and revoking an officer hat (Books, Invoicing, People) by Board proposal.
//
// Every officer permission is a hat under the Board's top hat, with the company Safe as its eligibility
// and toggle (CAP-1101), so only a Board batch changes who wears it, and Capxul reads the permission
// only from Hats (indexing's hat-wearers). A write births the officer change and the Board proposal
// that carries it (`board.propose`, opener board) in one transaction; the proposal's process applies
// or ends the change when it settles (processes.ts). The grants an invitation offers are budgets'
// proposal, not these (operations.member-invite-in-budgets).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_board } from "../shared/foundation.ts";
import { contract_hats, integration_chain_rpc } from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_CONFLICT,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags, table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_chain_budgets, table_chain_hats, table_hat_wearers, table_safe_approvals, table_safe_owners } from "../indexing/data.ts";
import { procedure_board_propose } from "./procedures.ts";
import { Permission, machine_officer_change, table_board_proposals, table_officer_changes } from "./data.ts";

const OLD = "packages/backend/src/organizations/members";
const S = Schema.String;
const NullOr = Schema.NullOr;

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

export const OfficerInput = Schema.Struct({ orgId: S, email: S, permission: Permission, note: NullOr(S) });
export const OfficerChangeInput = Schema.Struct({ orgId: S, changeId: S });

/** What `org member grant` and `revoke` answer: the change, and the proposal that carries it. */
export const OfficerChangeView = Schema.Struct({
  change: Schema.Struct({
    changeId: S,
    change: table_officer_changes.fields.fields.change,
    permission: Permission,
    email: NullOr(S),
    name: NullOr(S),
    state: table_officer_changes.fields.fields.state,
  }),
  proposal: Schema.Struct({
    proposalId: S,
    nonce: Schema.Int,
    status: table_board_proposals.fields.fields.status,
    threshold: Schema.Int,
    approvals: Schema.Array(S),
    note: S,
    approvalId: S,
    url: S,
  }),
});

// ── shared rules ────────────────────────────────────────────────────────────────────────────

const RULES =
  "The caller must be a Director (`board.propose` refuses anyone else ROLE_PERMISSION_DENIED). The " +
  "`owner-safe-proposals` gate must be on for the Organization, and for `manage-books` the `books` gate too " +
  "(FEATURE_NOT_AVAILABLE). The email must name a current member (INVALID_INPUT) whose personal Safe is claimed " +
  "(WRONG_STATE: there is nothing to give the hat to). The permission is its officer hat from the Organization's " +
  "deployment: Books for `manage-books`, Invoicing for `issue-invoices`, People for `manage-people`. A change of the " +
  "same member's permission still waiting is WRONG_STATE.";

const BIRTH =
  "Then, in one transaction, the change is born `proposed` (officer-change.propose) with the proposal that carries it " +
  "(`board.propose`, opener board, the change as subject, the Director's `--note` or the change in words) and the " +
  "Director's first approval. The change applies once the proposal executes.";

const READS = [
  table_organizations,
  table_org_deployments,
  table_org_members,
  table_principals,
  table_parties,
  table_feature_flags,
  table_safe_owners,
  table_hat_wearers,
  table_officer_changes,
] as const;

const ERRORS = [
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_FEATURE_NOT_AVAILABLE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
] as const;

// ── writes ──────────────────────────────────────────────────────────────────────────────────

export const rpc_board_officers_grant = defineRpc({
  id: "board.officers.grant",
  title: "Propose giving a member an officer hat",
  about:
    RULES + " A member whose Safe already wears the hat, read live (`Hats.isWearerOfHat`), is WRONG_STATE. For " +
    "`manage-people`, a member whose Safe wears a department's or team's office hat is ROLE_CONFLICT, naming them " +
    "(decision board.people-hat-role-conflict): from indexing, a hat it wears that is a budget's hat where the budget " +
    "is a top budget or its hat sits under its parent budget's hat; an allowance's hat (under the Board's top hat, " +
    "with a parent budget) is no conflict. The batch: " +
    "`Hats.changeHatMaxSupply(hat, supply + waiting + 1)` first when every seat of the hat is worn or taken by grants " +
    "still waiting (indexing's chain-hats and this concept's waiting grants), then `Hats.mintHat(hat, memberSafe)`. " + BIRTH,
  was: [`${OLD}/operations/grant.ts:158`, `${OLD}/writes/permissions.ts:133`, "books/as-is/organizations/members.ts:1"],
  concept: concept_board,
  kind: "action",
  who: "A Director of the Organization.",
  input: OfficerInput,
  output: OfficerChangeView,
  errors: [...ERRORS, error_ROLE_CONFLICT],
  reads: [...READS, table_chain_hats, table_chain_budgets],
  writes: [table_officer_changes],
  drives: [machine_officer_change.t.propose],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_hats.f.isWearerOfHat, contract_hats.f.changeHatMaxSupply, contract_hats.f.mintHat],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_board_officers_revoke = defineRpc({
  id: "board.officers.revoke",
  title: "Propose taking an officer hat back from a member",
  about:
    RULES + " A member whose Safe does not wear the hat, read live (`Hats.isWearerOfHat`), is WRONG_STATE. The batch: " +
    "`Hats.setHatWearerStatus(hat, memberSafe, false, true)`, which burns the hat and keeps the member in good standing " +
    "(Hats refuses to mint to a wearer in bad standing, so `false, false` would block every later grant). The member " +
    "stays a member. " + BIRTH,
  was: [`${OLD}/operations/revoke.ts:14`, `${OLD}/writes/permissions.ts:133`],
  concept: concept_board,
  kind: "action",
  who: "A Director of the Organization.",
  input: OfficerInput,
  output: OfficerChangeView,
  errors: [...ERRORS],
  reads: [...READS],
  writes: [table_officer_changes],
  drives: [machine_officer_change.t.propose],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_hats.f.isWearerOfHat, contract_hats.f.setHatWearerStatus],
  spans: [],
  budget: budget("chain-read"),
});

// ── read back ───────────────────────────────────────────────────────────────────────────────

export const rpc_board_officers_get = defineRpc({
  id: "board.officers.get",
  title: "One officer hat change and its proposal, as they stand",
  about:
    "Any current member reads one officer change by its `spc_` id with the proposal that carries it: its state " +
    "(proposed, applied or ended, as the proposal's process settled it), the proposal's nonce, status, threshold and " +
    "the Directors whose approvals the chain holds. An id the Organization does not hold is INVALID_INPUT. The grant " +
    "and revoke flows read it back after the signature.",
  was: [`${OLD}/operations/grant.ts:158`],
  concept: concept_board,
  kind: "query",
  who: "Any current member of the Organization.",
  input: OfficerChangeInput,
  output: OfficerChangeView,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_principals, table_officer_changes, table_board_proposals, table_safe_owners, table_safe_approvals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
