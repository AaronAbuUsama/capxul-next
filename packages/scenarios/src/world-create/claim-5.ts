// world.create, claim 5: a world is born with its cast: each person can call through the door and signs with a
// known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC. Not checked: a call through
// the new world's door by each person (the client is made for one world's door, and `nothing` has none) and each
// Safe's balance through the door's chain RPC (Capxul offers no chain read).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
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
      if (person === "pat") yield* same("pat's Safe", member.safe, null);
      else yield* expect(member.safe !== null, `${person} has no personal Safe`);
    }
  }),
);
