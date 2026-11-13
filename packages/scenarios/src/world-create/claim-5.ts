// world.create, claim 5: a world is born with its cast: each person can call through the door and signs with a
// known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { refusal, same, sameAmount } from "../support/expect.ts";
import { usdc } from "../support/chain.ts";
import { isTestAddress } from "../support/signing.ts";
import { castMember, freshName } from "../support/world.ts";

const CAST = ["dana", "eli", "sam", "pat", "olga"];

export const worldCreate5 = scenario(
  { operation: "world.create", claim: 5 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc5");
    const made = yield* capxul["world.create"]({
      world,
      grade: "private",
      lifetimeMinutes: 60,
      clock: { mode: "frozen", startAt: null },
    });
    const people = Arr.sort(
      Arr.map(made.cast, (each) => each.person),
      Order.String,
    );
    yield* same("the cast", people, Arr.sort(CAST, Order.String));
    const signers = Arr.map(made.cast, (each) => Str.toLowerCase(each.signer));
    yield* same("the cast's signer addresses, deduplicated", Arr.dedupe(signers).length, CAST.length);
    for (const person of CAST) {
      const member = yield* castMember(made, person);
      yield* expect(
        yield* isTestAddress(member.signer),
        `${person}'s signer ${member.signer} is no well-known test key`,
      );
      const refused = yield* refusal(
        `record.export at the new world's door as ${person}`,
        "NotWorldOwner",
        capxul["record.export"]({ from: null, to: null }, { at: made.door, as: person }),
      );
      yield* same(
        `the NotWorldOwner ${person} got`,
        { world: refused.world, owner: refused.owner },
        { world, owner: made.owner },
      );
      if (person === "pat") yield* same("pat's Safe", member.safe, null);
      else if (member.safe === null) yield* expect(false, `${person} has no personal Safe`);
      else yield* sameAmount(`${person}'s Safe's USDC`, yield* usdc(made, member.safe, { at: made.door }), 10_000);
    }
  }),
);
