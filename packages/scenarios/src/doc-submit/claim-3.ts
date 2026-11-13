// doc.submit, claim 3: a document that is not a draft is refused, and nothing changes.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { submit } from "../support/site.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const docSubmit3 = scenario(
  { operation: "doc.submit", claim: 3 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paymentHeld);
    const invoice = facts.invoice.name;
    const before = yield* head;
    const refused = yield* refusal(
      `doc.submit of the posted ${invoice}`,
      "NotADraft",
      submit(facts.founded.org, Site.DOCTYPES.purchaseInvoice, invoice, { as: "sam" }),
    );
    yield* same(
      "NotADraft",
      { doctype: refused.doctype, name: refused.name, docstatus: refused.docstatus },
      { doctype: Site.DOCTYPES.purchaseInvoice, name: invoice, docstatus: 1 },
    );
    yield* unchangedRecord("the refused submit", before);
  }),
);
