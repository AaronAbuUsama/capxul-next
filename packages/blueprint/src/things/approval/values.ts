// The concept "approvals": giving a signature that an operation asked for. Every signature in a world is made with
// a key by its signer and handed over here; nothing signs in a browser. This is how a held payment is paid, how a
// company's setup is authorised and how a Director approves a proposal.
//
// One verb signs everything, in place of `payment.send` on the thin line, which stays with its own journey. No
// operation waits for a person: one that needs signatures answers with approvals, each naming its signer, the address
// the signature must recover and the digest to sign, so every digest is known before anyone signs. How each subject
// reaches the chain (13 November 2026): every subject lands as one UserOperation through the world's bundler,
// sponsored by its test paymaster. A company's setup and a held payment are UserOperations of the signer's own Safe
// (the founder's; the member's, whose Books hat pays through `Budgets.spend`), prepared when the approval is opened,
// so their digest is the Safe4337Module's operation hash. An officer change is a company Safe transaction its
// Directors approve with their own Safes (EIP-1271: each Director's digest is their Safe's `SafeMessage` hash of the
// transaction's hash), carried by a relayer Safe of Core's service key, whose signature authorises nothing in the
// company: a transaction several Directors approve cannot be any one signer's own UserOperation. Each prepared
// operation has a nonce key of its own, so two approvals of one Safe never wait on each other.
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
