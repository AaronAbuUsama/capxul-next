// The officer hat a grant's execution minted: read from the transaction its last signature sent, through the door a
// look at that world goes.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { mintedTo } from "./chain.ts";
import { present, same } from "./expect.ts";
import { castMember, whereOf, type View, type Who } from "./world.ts";

/** The transaction `transaction` and the one hat it minted to `person`'s Safe. */
export const mintedToPerson = (world: View, transaction: string, person: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const member = yield* castMember(world, person);
    const safe = yield* present(`${person}'s Safe`, member.safe);
    const sent = yield* capxul.chain.transaction({ transaction }, whereOf(who));
    const minted = mintedTo(world, sent.logs, safe);
    yield* same(`the hats ${transaction} minted to ${person}'s Safe`, minted.length, 1);
    const hat = yield* present(`the hat minted to ${person}'s Safe`, Option.getOrNull(Arr.head(minted)));
    return { sent, hat: hat.id, safe };
  });

/** Whether `safe` wears `hat`, at the latest block or `block`. */
export const wears = (world: View, hat: string, safe: string, block: number | null, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul.chain.wears({ hats: world.contracts.hats, hat, wearer: safe, block }, whereOf(who));
  });

/**
 * `person`'s Safe wears the hat a grant of `permission` minted it in `transaction`, the hat's details name that
 * permission, and the Safe did not wear it at the block before.
 */
export const nowWears = (
  world: View,
  transaction: string,
  person: string,
  permission: typeof Values.Permission.Type,
  who: Who = {},
) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const minted = yield* mintedToPerson(world, transaction, person, who);
    const hat = yield* capxul.chain.hat({ hats: world.contracts.hats, hat: minted.hat, block: null }, whereOf(who));
    yield* same("the minted hat's details", hat.details, Values.OFFICER_HAT_DETAILS[permission]);
    yield* expect(
      !(yield* wears(world, minted.hat, minted.safe, minted.sent.block - 1, who)),
      `${person}'s Safe wore the hat ${minted.hat} before the transaction that minted it`,
    );
    yield* expect(
      yield* wears(world, minted.hat, minted.safe, null, who),
      `${person}'s Safe does not wear ${minted.hat}`,
    );
    return minted;
  });
