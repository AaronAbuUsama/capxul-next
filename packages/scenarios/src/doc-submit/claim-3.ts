// doc.submit, claim 3: a document that is not a draft is refused, and nothing changes.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { submit } from "../support/books.ts";
import { paymentDocuments } from "../support/documents.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const docSubmit3 = scenario(
  { operation: "doc.submit", claim: 3 },
  Effect.gen(function* () {
    const { org, invoice } = yield* paymentDocuments;
    const before = yield* head;
    const refused = yield* refusal(
      `doc.submit of the posted ${invoice}`,
      "NotADraft",
      submit(org, "Purchase Invoice", invoice, "sam"),
    );
    yield* same(
      "NotADraft",
      { doctype: refused.doctype, name: refused.name, docstatus: refused.docstatus },
      { doctype: "Purchase Invoice", name: invoice, docstatus: 1 },
    );
    yield* unchangedRecord("the refused submit", before);
  }),
);
