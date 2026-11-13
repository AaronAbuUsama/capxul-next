// doc.submit, claim 4: a payment from the Safe of more than the Safe holds is refused before anything is held. The
// company Safe holds the 1,000 USDC of dana's capital. Its address is not shown by any operation of a world from
// `office-holder`, so the refusal's Safe is checked to be neither a person's Safe nor a signer.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { expect, scenario } from "../scenario.ts";
import { refusal, same, sameAmount } from "../support/expect.ts";
import { create, paymentFields, safeAccount, submit, supplierFields } from "../support/books.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const docSubmit4 = scenario(
  { operation: "doc.submit", claim: 4 },
  Effect.gen(function* () {
    const { world, org } = yield* northwind;
    const supplier = yield* create(org, "Supplier", supplierFields("Harbour Paper Co"), "sam");
    const account = yield* safeAccount(org, "sam");
    const payment = yield* create(org, "Payment Entry", paymentFields(supplier.name, account, 5000, null), "sam");
    const before = yield* head;
    const refused = yield* refusal(
      `doc.submit of ${payment.name}`,
      "InsufficientBalance",
      submit(org, "Payment Entry", payment.name, "sam"),
    );
    yield* same("InsufficientBalance's asset", refused.asset, "USDC");
    yield* sameAmount("InsufficientBalance's balance", refused.balance, 1000);
    yield* sameAmount("InsufficientBalance's amount", refused.amount, 5000);
    const personal = Arr.flatMap(world.cast, (each) => [each.signer, ...(each.safe === null ? [] : [each.safe])]);
    yield* expect(
      !Arr.some(personal, (address) => Str.toLowerCase(address) === Str.toLowerCase(refused.safe)),
      `InsufficientBalance names ${refused.safe}, which is a person's, not the company Safe`,
    );
    yield* unchangedRecord("the refused payment", before);
  }),
);
