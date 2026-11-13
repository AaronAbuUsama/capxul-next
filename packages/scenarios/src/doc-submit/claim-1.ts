// doc.submit, claim 1: a Payment Entry from the Safe is held, not posted, and the signer is named.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { expect, given, scenario } from "../scenario.ts";
import { answers, same, sameAddress, sameAmount, show } from "../support/expect.ts";
import { ledger, linesOf, submit } from "../support/site.ts";
import { castMember, textOf } from "../support/world.ts";

export const docSubmit1 = scenario(
  { operation: "doc.submit", claim: 1 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paymentDrafted);
    const org = facts.founded.org;
    const payment = facts.payment.name;
    const held = yield* answers(
      `doc.submit of ${payment}`,
      "Held",
      submit(org, Site.DOCTYPES.paymentEntry, payment, { as: "sam" }),
    );
    yield* same(
      "the held document",
      [held.doctype, held.name, held.docstatus],
      [Site.DOCTYPES.paymentEntry, payment, 0],
    );
    yield* same("the held amount's asset", held.payment.amount.asset, "USDC");
    yield* sameAmount("the held amount", held.payment.amount.amount, Site.INVOICE_AMOUNT);
    yield* same("the payee", held.payment.payee, facts.supplier.name);
    const address = textOf(facts.supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress);
    yield* expect(
      address !== "",
      `the supplier fact holds no ${Site.SUPPLIER_FIELDS.paymentAddress}: ${show(facts.supplier.fields)}`,
    );
    yield* sameAddress("the payee's address", held.payment.payeeAddress, address);
    yield* expect(held.payment.paymentId !== "", "the held payment has no paymentId");
    yield* same("the approval's signer", held.approval.signer, "sam");
    const sam = yield* castMember(facts.world, "sam");
    yield* sameAddress("the approval's signer address", held.approval.signerAddress, sam.signer);
    const lines = linesOf(yield* ledger(org, {}, { as: "sam" }), payment);
    yield* expect(lines.length === 0, `the General Ledger shows the held payment: ${show(lines)}`);
  }),
);
