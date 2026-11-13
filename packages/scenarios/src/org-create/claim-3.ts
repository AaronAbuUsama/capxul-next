// org.create, claim 3: once enough founding Directors have signed, the setup completes: the board and the capital
// are on the chain and the company's site becomes ready.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { answers, findIn, present, same, sameAmount } from "../support/expect.ts";
import { usdc } from "../support/chain.ts";
import { found } from "../support/founding.ts";
import { approve } from "../support/signing.ts";
import { eventually } from "../support/wait.ts";
import { castMember, NORTHWIND, thisView } from "../support/world.ts";

const lower = (addresses: ReadonlyArray<string>) => Arr.sort(Arr.map(addresses, Str.toLowerCase), Order.String);

export const orgCreate3 = scenario(
  { operation: "org.create", claim: 3 },
  Effect.gen(function* () {
    const founded = yield* found();
    const of = (signer: string) =>
      findIn(`${signer}'s setup approval`, founded.approvals, (each) => each.signer === signer);
    const byDana = yield* answers("dana's setup signature", "Collected", approve(yield* of("dana")));
    yield* same("the setup's signatures after dana", [byDana.signatures, byDana.threshold], [1, 2]);
    yield* same("the subject dana signed", byDana.subject, { kind: "org_setup", id: founded.org });
    const byEli = yield* answers("eli's setup signature", "Sent", approve(yield* of("eli")));
    yield* same("the subject eli's signature sent", byEli.subject, byDana.subject);
    const capxul = yield* Capxul;
    const world = yield* thisView;
    const company = yield* capxul.chain.safe({ safe: founded.safe, block: null });
    const directors = yield* Effect.forEach(["dana", "eli"], (person) =>
      Effect.flatMap(castMember(world, person), (member) => present(`${person}'s Safe`, member.safe)),
    );
    yield* same("the company Safe's owners", lower(company.owners), lower(directors));
    yield* same("the company Safe's threshold", company.threshold, 2);
    yield* sameAmount("the company Safe's USDC", yield* usdc(world, founded.safe), 1000);
    yield* sameAmount("dana's Safe's USDC", yield* usdc(world, founded.founderSafe), 9000);
    const shown = yield* eventually("northwind's site to be ready", thisView, (now) =>
      Arr.some(now.companies, (each) => each.handle === NORTHWIND && each.site.state === "ready"),
    );
    yield* same(
      "the companies world.show lists",
      Arr.map(shown.companies, (each) => each.org),
      [founded.org],
    );
  }),
);
