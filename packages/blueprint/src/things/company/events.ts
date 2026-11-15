// What a company announces, and what each event carries.
import { event } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Address, ApprovalId, OrgHandle, OrgId, PersonId, ProposalId } from "../../common/values.ts";

/** A company was founded and its setup waits for its founding Directors' signatures. */
export class OrgFounded extends event<OrgFounded, { readonly brand: unique symbol }>()("org_founded", {
  org: OrgId,
  handle: OrgHandle,
  safe: Address,
  founder: PersonId,
  approvals: Schema.Array(ApprovalId),
}) {}

/** A Directors' proposal was opened at the company Safe's next nonce. */
export class ProposalOpened extends event<ProposalOpened, { readonly brand: unique symbol }>()("proposal_opened", {
  proposal: ProposalId,
  org: OrgId,
  nonce: Schema.Int,
  threshold: Schema.Int,
  approvals: Schema.Array(ApprovalId),
}) {}
