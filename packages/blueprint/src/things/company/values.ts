// The concept "organizations": founding a company and granting its members permissions. Both are served through a
// world's door, as the person named by the call. Neither waits for a signature: each answers with the approvals
// that must be signed, and `approval.sign` takes the signatures.
//
// A company's values: the Founded answer the starting points hand on, and what approvals of a company authorise.
import * as Schema from "effect/Schema";
import { Address, Approval, ChangeId, Money, OrgHandle, OrgId, PersonId } from "../../common/values.ts";

/** What an approval of a company authorises (`Subject`): its setup by its org id (`org.create`), an officer change
 * by its change id (`org.member.grant`). */
export const subjects = [
  Schema.Struct({ kind: Schema.Literal("org_setup"), id: OrgId }),
  Schema.Struct({ kind: Schema.Literal("officer_change"), id: ChangeId }),
] as const;

/**
 * @internal Shared by the company's values and `company create`; not exported from the package.
 */
export const Profile = Schema.Struct({
  name: Schema.Trim.check(Schema.isBetweenLength(1, 140)),
  country: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  bio: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(280))),
  size: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(40))),
});

const Board = Schema.Struct({
  /** Every founding Director, the founder first. */
  directors: Schema.Array(PersonId),
  /** How many Directors must sign a proposal. */
  threshold: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

/** The company is founded: its Safe is minted, and its setup waits for `board.threshold` of `approvals`. */
export class Founded extends Schema.TaggedClass<Founded, { readonly brand: unique symbol }>()("Founded", {
  org: OrgId,
  handle: OrgHandle,
  profile: Profile,
  safe: Address,
  founder: PersonId,
  founderSafe: Address,
  board: Board,
  members: Schema.Array(PersonId),
  capital: Schema.NullOr(Money),
  approvals: Schema.Array(Approval),
}) {}
