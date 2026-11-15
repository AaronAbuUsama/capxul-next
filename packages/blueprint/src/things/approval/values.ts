// The concept "approvals": giving a signature that an operation asked for. Every signature in a world is made with
// a key by its signer and handed over here; nothing signs in a browser. This is how a held payment is paid, how a
// company's setup is authorised and how a Director approves a proposal.
//
// The answers of `approval sign` the starting points hand on.
import * as Schema from "effect/Schema";
import { ApprovalId, Hash, PersonId } from "../../common/values.ts";
import { Subject } from "../../generated/subjects.ts";

/** The signature is kept; the subject needs more signatures before anything is sent. */
export class Collected extends Schema.TaggedClass<Collected, { readonly brand: unique symbol }>()("Collected", {
  approval: ApprovalId,
  signer: PersonId,
  subject: Subject,
  signatures: Schema.Int,
  threshold: Schema.Int,
}) {}

/** This signature completed the subject: its transaction was sent and is in the chain. */
export class Sent extends Schema.TaggedClass<Sent, { readonly brand: unique symbol }>()("Sent", {
  approval: ApprovalId,
  signer: PersonId,
  subject: Subject,
  transaction: Hash,
  block: Schema.Int,
}) {}
