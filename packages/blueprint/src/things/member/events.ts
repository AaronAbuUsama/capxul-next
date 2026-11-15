// What a member's permission change announces.
import * as Schema from "effect/Schema";
import { ChangeId, OrgId, Permission, ProposalId } from "../../common/values.ts";

/** A permission's change was proposed to the Directors. It carries neither the member nor the note. */
export class OfficerChangeProposed extends Schema.TaggedClass<
  OfficerChangeProposed,
  { readonly brand: unique symbol }
>()("officer_change_proposed", {
  change: ChangeId,
  org: OrgId,
  permission: Permission,
  proposal: ProposalId,
}) {}
