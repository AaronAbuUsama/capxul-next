// What an approval announces, and what each event carries.
import * as Schema from "effect/Schema";
import { ApprovalId, Hash, PersonId } from "../../common/values.ts";
import { Subject } from "../../generated/subjects.ts";

export class ApprovalSigned extends Schema.TaggedClass<ApprovalSigned, { readonly brand: unique symbol }>()(
  "approval_signed",
  {
    approval: ApprovalId,
    signer: PersonId,
  },
) {}

/** The transaction the approvals authorised was included in the world's chain and did not revert. */
export class ApprovalLanded extends Schema.TaggedClass<ApprovalLanded, { readonly brand: unique symbol }>()(
  "approval_landed",
  {
    approval: ApprovalId,
    transaction: Hash,
    subject: Subject,
  },
) {}
