// org.create, claim 2: it answers with the Organization's id and the approvals its founding Directors must sign,
// before anyone has signed.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { findIn, same, sameAddress } from "../support/expect.ts";
import { found, NORTHWIND_FOUNDING } from "../support/founding.ts";
import { castMember, thisView } from "../support/world.ts";

export const orgCreate2 = scenario(
  { operation: "org.create", claim: 2 },
  Effect.gen(function* () {
    const world = yield* thisView;
    const founded = yield* found();
    yield* same("the handle", founded.handle, NORTHWIND_FOUNDING.handle);
    yield* same("the board", founded.board, { directors: ["dana", "eli"], threshold: 2 });
    yield* same("the members", founded.members, NORTHWIND_FOUNDING.members);
    yield* same(
      "the approvals' signers",
      Arr.map(founded.approvals, (each) => each.signer),
      ["dana", "eli"],
    );
    for (const signer of ["dana", "eli"]) {
      const person = yield* castMember(world, signer);
      const approval = yield* findIn(`${signer}'s approval`, founded.approvals, (each) => each.signer === signer);
      yield* sameAddress(`${signer}'s approval's address`, approval.signerAddress, person.signer);
    }
    const shown = yield* thisView;
    yield* same(
      "the companies world.show lists",
      Arr.map(shown.companies, (each) => each.org),
      [founded.org],
    );
  }),
);
