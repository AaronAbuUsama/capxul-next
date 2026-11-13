// doc.submit, claim 1: a Payment Entry from the Safe is held, not posted, and the signer is named. Brightside's
// payment address was set when the starting world was made and no operation reads a Supplier back, so the payee's
// address is checked only to be an address the cast does not hold.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { expect, scenario } from "../scenario.ts";
import { answers, same, sameAddress, sameAmount, show } from "../support/expect.ts";
import { ledger, linesOf, submit } from "../support/books.ts";
import { paymentDocuments } from "../support/documents.ts";
import { castMember } from "../support/world.ts";

export const docSubmit1 = scenario(
  { operation: "doc.submit", claim: 1 },
  Effect.gen(function* () {
    const { world, org, supplier, payment } = yield* paymentDocuments;
    const held = yield* answers(`doc.submit of ${payment}`, "Held", submit(org, "Payment Entry", payment, "sam"));
    yield* same("the held document", [held.doctype, held.name, held.docstatus], ["Payment Entry", payment, 0]);
    yield* same("the held amount's asset", held.payment.amount.asset, "USDC");
    yield* sameAmount("the held amount", held.payment.amount.amount, "125.50");
    yield* same("the payee", held.payment.payee, supplier);
    const castAddresses = Arr.flatMap(world.cast, (each) => [each.signer, ...(each.safe === null ? [] : [each.safe])]);
    yield* expect(
      !Arr.some(castAddresses, (address) => Str.toLowerCase(address) === Str.toLowerCase(held.payment.payeeAddress)),
      `the payee's address ${held.payment.payeeAddress} belongs to the cast`,
    );
    yield* same("the approval's signer", held.approval.signer, "sam");
    const sam = yield* castMember(world, "sam");
    yield* sameAddress("the approval's signer address", held.approval.signerAddress, sam.signer);
    const lines = linesOf(yield* ledger(org, {}, "sam"), payment);
    yield* expect(lines.length === 0, `the General Ledger shows the held payment: ${show(lines)}`);
  }),
);
