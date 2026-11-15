// A member's values: how a person belongs to a company, and the proposal `member grant` answers.
import * as Schema from "effect/Schema";
import { Approval, ChangeId, Permission, PersonId, ProposalId } from "../../common/values.ts";

/** How a person belongs to a company: a Director (a signer of its Safe) or a member (a Seat). */
export const MemberRole = Schema.Literals(["director", "member"]);

/** One person of a company: a Director or a member, with the email they sign in with. */
export const Member = Schema.Struct({
  person: PersonId,
  email: Schema.String,
  role: MemberRole,
});

/**
 * What `org.member.grant` answers: the change, its Directors' proposal and their approvals.
 *
 * @internal Shared with the starting points; not exported from the package.
 */
export const GrantProposed = Schema.Struct({
  change: Schema.Struct({
    id: ChangeId,
    member: PersonId,
    permission: Permission,
    state: Schema.Literal("proposed"),
  }),
  proposal: Schema.Struct({ id: ProposalId, nonce: Schema.Int, threshold: Schema.Int }),
  /** One approval per Director. The change is applied once `threshold` of them are signed and it executes. */
  approvals: Schema.Array(Approval),
});
