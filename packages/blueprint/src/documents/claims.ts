// The acceptance claims of the documents operations. Rendered into claims.md.
import { claim, kept, type ClaimsOf } from "../claims/claim.ts";
import { InsufficientBalance, NoSiteUser, NotADraft, SiteRefused } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Documents from "./operations.ts";

export const create: ClaimsOf = {
  operation: Documents.create,
  claims: [
    claim(
      "A document is created as a draft and Frappe's validations apply.",
      w.officeHolder,
      "doc.create as sam of a Supplier named Brightside Cleaning Ltd answers its name and docstatus 0. A Supplier with no name is refused with SiteRefused for validation, and report.run of the Supplier list (Site.REPORTS.supplierList, the Supplier doctype's list) shows only Brightside.",
      { refusals: [SiteRefused], origin: kept("doc.create/c-4a88a94b435451b9"), thinLine: true },
    ),
    claim(
      "A caller with no user on the company's site is refused, and nothing is made.",
      w.officeHolder,
      "doc.create as pat is refused with NoSiteUser; record.export shows no new entry.",
      { refusals: [NoSiteUser] },
    ),
    claim(
      "A member whose roles do not allow the document is refused by the site, and nothing is made.",
      w.officeHolder,
      "doc.create as sam of an Employee is refused with SiteRefused for permission; record.export shows no new entry.",
      { refusals: [SiteRefused] },
    ),
    claim(
      "The answer carries the document's hash, and a payment held for the document names the same hash.",
      w.paymentDrafted,
      "The hash doc.create answered for the Payment Entry (the `payment` fact) equals `payment.documentHash` in doc.submit's Held answer for it.",
    ),
  ],
  dropped: [],
};

export const submit: ClaimsOf = {
  operation: Documents.submit,
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
