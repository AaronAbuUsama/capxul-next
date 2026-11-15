// `capxul document submit` (today `doc.submit`): posting a document, or holding a payment for its signer.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declareOutcomes, outcome, claim, kept } from "@capxul/blueprint-tools";
import {
  InsufficientBalance,
  NoSiteUser,
  NotImplemented,
  OrgNotFound,
  SiteRefused,
  SiteUnavailable,
} from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { DocSubmitted, PaymentHeld } from "../events.ts";
import { heldPayment, postedInvoice } from "../examples.ts";
import { NotADraft } from "../refusals.ts";
import { Doctype, Held, Posted } from "../values.ts";

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
      success: postedInvoice,
    },
    {
      payload: { org: "org_northwind1", doctype: "Payment Entry", name: "ACC-PAY-2026-00001" },
      success: heldPayment,
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `doc.submit` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: submit,
  claims: [
    claim(
      "A Payment Entry from the Safe is held, not posted, and the signer is named.",
      w.paymentDrafted,
      "doc.submit as sam of the Payment Entry answers Held with docstatus 0, the amount 125.50 USDC, Brightside's address (the payment address the `supplier` fact's fields hold) and an approval whose signer is sam at his signer address. report.run's General Ledger shows no line for it yet.",
      { origin: kept("doc.submit/c-df3c0c51cdf3899b"), thinLine: true },
    ),
    claim(
      "An ordinary document posts to the ledger when submitted.",
      w.officeHolder,
      "doc.submit as sam of a draft Purchase Invoice answers Posted with docstatus 1; report.run's General Ledger shows its lines.",
      { origin: kept("doc.submit/c-74a45893884b5bef") },
    ),
    claim(
      "A document that is not a draft is refused, and nothing changes.",
      w.paymentHeld,
      "doc.submit of the posted Purchase Invoice is refused with NotADraft naming docstatus 1; record.export shows no new entry.",
      { refusals: [NotADraft] },
    ),
    claim(
      "A payment from the Safe of more than the Safe holds is refused before anything is held.",
      w.officeHolder,
      "doc.submit of a Payment Entry of 5,000 USDC from the Capxul Safe account is refused with InsufficientBalance naming the company Safe (the `founded` fact's Safe), its balance and the amount; no approval is opened and record.export shows no new entry.",
      { refusals: [InsufficientBalance] },
    ),
  ],
  dropped: [],
};
