// The officer hat a grant's execution minted: read from the transaction eli's signature sent.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Capxul } from "../client.ts";
import { mintedTo } from "./chain.ts";
import { castMember, type View } from "./world.ts";
import { expect } from "../scenario.ts";
import { present, same } from "./expect.ts";

/** The transaction `transaction` and the one hat it minted to sam's Safe. */
export const mintedToSam = (world: View, transaction: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const sam = yield* castMember(world, "sam");
    const safe = yield* present("sam's Safe", sam.safe);
    const sent = yield* capxul.chain.transaction({ transaction });
    const minted = mintedTo(world, sent.logs, safe);
    yield* same(`the hats ${transaction} minted to sam's Safe`, minted.length, 1);
    const hat = yield* present("the hat minted to sam's Safe", Option.getOrNull(Arr.head(minted)));
    return { sent, hat: hat.id, safe };
  });

/** sam's Safe wears the hat a grant of `permission` minted it, and the hat's details name that permission. */
export const samWears = (world: View, transaction: string, permission: typeof Values.Permission.Type) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const minted = yield* mintedToSam(world, transaction);
    const hat = yield* capxul.chain.hat({ hats: world.contracts.hats, hat: minted.hat, block: null });
    yield* same("the minted hat's details", hat.details, Values.OFFICER_HAT_DETAILS[permission]);
    const wears = yield* capxul.chain.wears({
      hats: world.contracts.hats,
      hat: minted.hat,
      wearer: minted.safe,
      block: null,
    });
    yield* expect(wears, `sam's Safe does not wear the hat ${minted.hat}`);
    return minted;
  });
