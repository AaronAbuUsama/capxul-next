// The concept "documents": a company's documents on its Frappe site, reached through the world's door and run as
// the caller's own site user. Submitting a payment from the company Safe holds it for its signer instead of posting.
//
// A document's values: the answers the starting points hand on, and what approvals of a payment authorise.
import * as Schema from "effect/Schema";
import { Address, Approval, Fields, Hash, Money, PaymentRequestId } from "../../common/values.ts";

/** What an approval of a document authorises (`Subject`): a held payment by its request id (`doc.submit`'s Held). */
export const subjects = [Schema.Struct({ kind: Schema.Literal("payment"), id: PaymentRequestId })] as const;

/**
 * @internal Shared by the document's verbs and values; not exported from the package.
 */
export const Doctype = Schema.String.check(Schema.isBetweenLength(1, 140));

/**
 * What `doc.create` answers: the document as the site stored it.
 *
 * @internal Shared with the starting points; not exported from the package.
 */
export const Created = Schema.Struct({
  doctype: Doctype,
  name: Schema.String,
  docstatus: Schema.Literal(0),
  fields: Fields,
  /** The keccak-256 hash of the document as the site stored it. A payment of this document carries it. */
  hash: Hash,
});

/** The document is submitted and posted. */
export class Posted extends Schema.TaggedClass<Posted, { readonly brand: unique symbol }>()("Posted", {
  doctype: Doctype,
  name: Schema.String,
  docstatus: Schema.Literal(1),
}) {}

/** A payment from the company Safe: held for its signer, not posted. It posts once the payment is sent. */
export class Held extends Schema.TaggedClass<Held, { readonly brand: unique symbol }>()("Held", {
  doctype: Doctype,
  name: Schema.String,
  docstatus: Schema.Literal(0),
  payment: Schema.Struct({
    request: PaymentRequestId,
    amount: Money,
    /** The party the document pays, and the address it is paid to. */
    payee: Schema.String,
    payeeAddress: Address,
    /** The hash `doc.create` gave the document. */
    documentHash: Hash,
    /** The payment's id on the chain: the `paymentId` the Payments contract's `PaymentSent` carries when it is sent. */
    paymentId: Hash,
  }),
  /** The signature the payment waits for. Its signer is the member whose permission may pay it. */
  approval: Approval,
}) {}
