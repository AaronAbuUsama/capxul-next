// doc.create, claim 4: the answer carries the document's hash, and a payment held for the document names the same
// hash. The starting world's Payment Entry was created before the scenario began, so its doc.create answer is not
// the scenario's to read; the scenario creates a second Payment Entry against the same invoice and holds that.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { holdPayment } from "../support/books.ts";
import { paymentDocuments } from "../support/documents.ts";

export const docCreate4 = scenario(
  { operation: "doc.create", claim: 4 },
  Effect.gen(function* () {
    const { org, supplier, invoice } = yield* paymentDocuments;
    const { created, held } = yield* holdPayment(org, { supplier, invoice, amount: 125.5 }, "sam");
    yield* same("the held payment's document hash", held.payment.documentHash, created.hash);
    yield* same("the held document", held.name, created.name);
  }),
);
