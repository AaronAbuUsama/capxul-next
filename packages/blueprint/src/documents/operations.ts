// The concept "documents": a company's documents on its Frappe site, reached through the world's door and run as
// the caller's own site user. Submitting a payment from the company Safe holds it for its signer instead of posting.
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  InsufficientBalance,
  NoSiteUser,
  NotADraft,
  OrgNotFound,
  SiteRefused,
  SiteUnavailable,
  NotImplemented,
} from "../errors.ts";
import { declare, declareOutcomes, outcome } from "../operation.ts";
import { Address, Approval, ApprovalId, Fields, Hash, Money, OrgId, PaymentRequestId } from "../values.ts";
import { exampleAddress as address } from "../world/example.ts";

export class DocCreated extends Schema.TaggedClass<DocCreated, { readonly brand: unique symbol }>()("doc_created", {
  org: OrgId,
  doctype: Schema.String,
  name: Schema.String,
}) {}

/** A document was submitted and posted to the company's books. */
export class DocSubmitted extends Schema.TaggedClass<DocSubmitted, { readonly brand: unique symbol }>()(
  "doc_submitted",
  {
    org: OrgId,
    doctype: Schema.String,
    name: Schema.String,
  },
) {}

/** A payment from the company Safe was held for its signer. The document stays a draft until it is sent. */
export class PaymentHeld extends Schema.TaggedClass<PaymentHeld, { readonly brand: unique symbol }>()("payment_held", {
  org: OrgId,
  doctype: Schema.String,
  name: Schema.String,
  request: PaymentRequestId,
  approval: ApprovalId,
  amount: Money,
}) {}

const Doctype = Schema.String.check(Schema.isBetweenLength(1, 140));

export const create = declare({
  rpc: Rpc.make("doc.create", {
    payload: {
      org: OrgId,
      doctype: Doctype,
      /** Field values as typed JSON values, never JSON text. */ fields: Fields,
    },
    success: Schema.Struct({
      doctype: Doctype,
      name: Schema.String,
      docstatus: Schema.Literal(0),
      fields: Fields,
      /** The keccak-256 hash of the document as the site stored it. A payment of this document carries it. */
      hash: Hash,
    }),
    error: Schema.Union([OrgNotFound, NoSiteUser, SiteRefused, SiteUnavailable, NotImplemented]),
  }),
  emits: [
    {
      event: DocCreated,
      carries: ({ payload, success }) => ({ org: payload.org, doctype: success.doctype, name: success.name }),
    },
  ],
  budget: {
    ms: 1_500,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "one call to the company's site on the world's bench; the bench is not measured yet",
  },
  examples: [
    {
      payload: { org: "org_northwind1", doctype: "Supplier", fields: { supplier_name: "Brightside Cleaning Ltd" } },
      success: {
        doctype: "Supplier",
        name: "Brightside Cleaning Ltd",
        docstatus: 0,
        fields: { supplier_name: "Brightside Cleaning Ltd" },
        hash: `0x${Str.repeat(32)("cd")}`,
      },
    },
  ],
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

const submitRpc = Rpc.make("doc.submit", {
  payload: { org: OrgId, doctype: Doctype, name: Schema.String },
  success: Schema.Union([Posted, Held]),
  error: Schema.Union([
    OrgNotFound,
    NoSiteUser,
    SiteRefused,
    SiteUnavailable,
    NotADraft,
    InsufficientBalance,
    NotImplemented,
  ]),
});

export const submit = declareOutcomes({
  rpc: submitRpc,
  outcomes: {
    Posted: outcome(submitRpc, "Posted", [
      {
        event: DocSubmitted,
        carries: ({ payload, success }) => ({ org: payload.org, doctype: success.doctype, name: success.name }),
      },
    ]),
    Held: outcome(submitRpc, "Held", [
      {
        event: PaymentHeld,
        carries: ({ payload, success }) => ({
          org: payload.org,
          doctype: success.doctype,
          name: success.name,
          request: success.payment.request,
          approval: success.approval.id,
          amount: success.payment.amount,
        }),
      },
    ]),
  },
  budget: {
    ms: 3_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "one call to the site; a held payment also reads the index and opens a sponsored approval on the world's chain",
  },
  examples: [
    {
      payload: { org: "org_northwind1", doctype: "Purchase Invoice", name: "ACC-PINV-2026-00001" },
      success: Posted.make({ doctype: "Purchase Invoice", name: "ACC-PINV-2026-00001", docstatus: 1 }),
    },
    {
      payload: { org: "org_northwind1", doctype: "Payment Entry", name: "ACC-PAY-2026-00001" },
      success: Held.make({
        doctype: "Payment Entry",
        name: "ACC-PAY-2026-00001",
        docstatus: 0,
        payment: {
          request: "req_pay00001",
          amount: { asset: "USDC", amount: "125.50" },
          payee: "Brightside Cleaning Ltd",
          payeeAddress: address(31),
          documentHash: `0x${Str.repeat(32)("ef")}`,
          paymentId: `0x${Str.repeat(32)("9a")}`,
        },
        approval: {
          id: "apr_pay00001",
          signer: "sam",
          signerAddress: address(3),
          digest: `0x${Str.repeat(32)("12")}`,
          expiresAt: "2026-11-14T09:00:00Z",
        },
      }),
    },
  ],
});
