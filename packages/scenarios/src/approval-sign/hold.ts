// The held payment the approval.sign scenarios sign. `payment-held` holds one for sam, but its approval's digest and
// expiry were answered to whoever made the starting world, and no operation reads an approval back: the record's
// payment_held carries the approval's id only. So each scenario holds a second Payment Entry for the same invoice,
// whose approval it then has in full.
import * as Effect from "effect/Effect";
import { holdPayment } from "../support/books.ts";
import { paymentDocuments } from "../support/documents.ts";

export const freshHold = Effect.gen(function* () {
  const documents = yield* paymentDocuments;
  const { created, held } = yield* holdPayment(
    documents.org,
    { supplier: documents.supplier, invoice: documents.invoice, amount: 125.5 },
    "sam",
  );
  return { ...documents, created, held };
});
