// The organizations concept's door: the procedures other concepts invoke inside their own
// transaction (P4). One only. Everything else a concept above needs from organizations it reads
// (the Organization, its deployment, its Seats, its invitations) or learns from this concept's
// transitions through the outbox (org_setup_transitioned, org_member_transitioned,
// org_invite_transitioned).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { table_org_invitations } from "./data.ts";

const S = Schema.String;

export const procedure_organizations_bind_invitation_grants = defineProcedure({
  id: "organizations.bind-invitation-grants",
  title: "Bind an invitation's grants to the Board proposal that carries them",
  about:
    "Money fact: an invitation's offered grants (officer hats and allowances, which carry authority over the company's " +
    "money) and the company Safe transaction that carries them on chain are one fact. Board invokes it in the " +
    "transaction that opens the proposal of an authorizing invitation's grants (`board.propose`), as the second step of " +
    "its `org member invite` flow. It records the Safe transaction's hash and nonce on the invitation, so the " +
    "invitation's process opens the offer only when the chain shows that transaction executed, and cancels it when " +
    "the nonce went to another transaction. If the two disagreed at a commit, an invitee could be offered authority no " +
    "proposal grants, or hold hats no invitation accounts for. Binding the same transaction again is a no-op; another " +
    "transaction, or an invitation that is not authorizing, is WRONG_STATE. It makes no outside call.",
  was: [
    "packages/backend/src/organizations/invitations/writes/phases.ts:55",
    "books/as-is/organizations/procedures.ts:1007",
    "books/as-is/organizations/procedures.ts:1042",
  ],
  concept: concept_organizations,
  input: Schema.Struct({ org_id: S, invitation_id: S, safe_tx_hash: S, safe_nonce: S }),
  output: Schema.Struct({ invitation_id: S, bound: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_invitations],
  writes: [table_org_invitations],
  drives: [],
  invokes: [],
  emits: [],
});
