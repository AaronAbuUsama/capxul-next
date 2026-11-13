// doc.create, claim 4: the answer carries the document's hash, and a payment held for the document names the same
// hash: the hash doc.create answered for the Payment Entry is the `payment` fact's.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given, scenario } from "../scenario.ts";
import { answers, same } from "../support/expect.ts";
import { submit } from "../support/site.ts";

export const docCreate4 = scenario(
  { operation: "doc.create", claim: 4 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paymentDrafted);
    const held = yield* answers(
      `doc.submit of ${facts.payment.name}`,
      "Held",
      submit(facts.founded.org, Site.DOCTYPES.paymentEntry, facts.payment.name, { as: "sam" }),
    );
    yield* same("the held document", held.name, facts.payment.name);
    yield* same("the held payment's document hash", held.payment.documentHash, facts.payment.hash);
  }),
);
