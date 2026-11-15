// What a document announces, and what each event carries.
import { event } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { ApprovalId, Money, OrgId, PaymentRequestId } from "../../common/values.ts";

export class DocCreated extends event<DocCreated, { readonly brand: unique symbol }>()("doc_created", {
  org: OrgId,
  doctype: Schema.String,
  name: Schema.String,
}) {}

/** A document was submitted and posted to the company's books. */
export class DocSubmitted extends event<DocSubmitted, { readonly brand: unique symbol }>()("doc_submitted", {
  org: OrgId,
  doctype: Schema.String,
  name: Schema.String,
}) {}

/** A payment from the company Safe was held for its signer. The document stays a draft until it is sent. */
export class PaymentHeld extends event<PaymentHeld, { readonly brand: unique symbol }>()("payment_held", {
  org: OrgId,
  doctype: Schema.String,
  name: Schema.String,
  request: PaymentRequestId,
  approval: ApprovalId,
  amount: Money,
}) {}
