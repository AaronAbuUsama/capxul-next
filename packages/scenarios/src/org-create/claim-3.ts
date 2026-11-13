// org.create, claim 3: once enough founding Directors have signed, the setup completes: the board and the capital
// are on the chain and the company's site becomes ready. Not checked: the company Safe's owners, threshold and
// balance, which are read through the door's chain RPC, which Capxul does not offer.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { answers, findIn, same } from "../support/expect.ts";
import { found } from "../support/founding.ts";
import { approve } from "../support/signing.ts";
import { eventually } from "../support/wait.ts";
import { NORTHWIND, thisView } from "../support/world.ts";

export const orgCreate3 = scenario(
  { operation: "org.create", claim: 3 },
  Effect.gen(function* () {
    const founded = yield* found();
    const of = (signer: string) =>
      findIn(`${signer}'s setup approval`, founded.approvals, (each) => each.signer === signer);
    const byDana = yield* answers("dana's setup signature", "Collected", approve(yield* of("dana")));
    yield* same("the setup's signatures after dana", [byDana.signatures, byDana.threshold], [1, 2]);
    yield* same("the subject dana signed", byDana.subject.kind, "org_setup");
    const byEli = yield* answers("eli's setup signature", "Sent", approve(yield* of("eli")));
    yield* same("the subject eli's signature sent", byEli.subject, byDana.subject);
    const shown = yield* eventually("northwind's site to be ready", thisView, (world) =>
      Arr.some(world.companies, (each) => each.handle === NORTHWIND && each.site.state === "ready"),
    );
    yield* same(
      "the companies world.show lists",
      Arr.map(shown.companies, (each) => each.org),
      [founded.org],
    );
  }),
);
