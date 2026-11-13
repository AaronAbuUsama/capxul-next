// doc.submit, claim 4: a payment from the Safe of more than the Safe holds is refused before anything is held. The
// company Safe (the `founded` fact's) holds the 1,000 USDC of dana's capital.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given, scenario } from "../scenario.ts";
import { refusal, same, sameAddress, sameAmount } from "../support/expect.ts";
import { create, safeAccount, submit } from "../support/site.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const docSubmit4 = scenario(
  { operation: "doc.submit", claim: 4 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.officeHolder);
    const org = facts.founded.org;
    const sam = { as: "sam" };
    const supplier = yield* create(org, Site.DOCTYPES.supplier, Site.supplierFields("Harbour Paper Co"), sam);
    const account = yield* safeAccount(org, sam);
    const fields = Site.paymentFields(supplier.name, account, 5000, null);
    const payment = yield* create(org, Site.DOCTYPES.paymentEntry, fields, sam);
    const before = yield* head;
    const refused = yield* refusal(
      `doc.submit of ${payment.name}`,
      "InsufficientBalance",
      submit(org, Site.DOCTYPES.paymentEntry, payment.name, sam),
    );
    yield* sameAddress("InsufficientBalance's Safe", refused.safe, facts.founded.safe);
    yield* same("InsufficientBalance's asset", refused.asset, "USDC");
    yield* sameAmount("InsufficientBalance's balance", refused.balance, 1000);
    yield* sameAmount("InsufficientBalance's amount", refused.amount, 5000);
    yield* unchangedRecord("the refused payment", before);
  }),
);
