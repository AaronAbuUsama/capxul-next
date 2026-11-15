// Reading a company's Board: looks the board operations' checks and the journey "seat sam on Northwind's Board"
// share. The Board is the company Safe's owners and threshold, read from the chain through the door, and the Director
// hat its Directors' Safes wear. The company Safe is known from the founding the journey's world holds (`founded`).
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { given, holds } from "../expectation.ts";
import { isAddress, logsOf, mintedTo } from "./chain.ts";
import { present, same } from "./expect.ts";
import { castMember, whereOf, type View, type Who } from "./world.ts";

/** A company the journey's world founded: its Safe and its founder. */
export interface Founding {
  readonly safe: string;
  readonly founder: string;
}

/** The company Safe and founder of `org`, when the journey's world holds its founding; none otherwise. */
export const foundingOf = (org: string) =>
  Effect.gen(function* () {
    if (!(yield* holds(startingWorlds.founded))) return Option.none<Founding>();
    const { founded } = yield* given(startingWorlds.founded);
    return founded.org === org
      ? Option.some<Founding>({ safe: founded.safe, founder: founded.founder })
      : Option.none<Founding>();
  });

/** A company Safe's owners, in lower case and sorted, and its threshold, as the chain holds them now. */
export interface OnChain {
  readonly owners: ReadonlyArray<string>;
  readonly threshold: number;
}

/** Sorts addresses in lower case, so two lists of one set of addresses are the same. */
export const sorted = (addresses: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.sort(Arr.map(addresses, Str.toLowerCase), Str.Order);

/** The company Safe `safe`'s owners and threshold, at the latest block. */
export const onChain = (safe: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const read = yield* capxul.chain.safe({ safe, block: null }, whereOf(who));
    return { owners: sorted(read.owners), threshold: read.threshold } satisfies OnChain;
  });

/** The Board of `org` on the chain when its company Safe is known; none otherwise. */
export const boardOf = (org: string, who: Who = {}) =>
  Effect.gen(function* () {
    const founding = yield* foundingOf(org);
    if (Option.isNone(founding)) return Option.none<OnChain>();
    return Option.some(yield* onChain(founding.value.safe, who));
  });

/** The personal Safes of `people`, from the world's cast, sorted as `sorted` sorts them. */
export const safesOf = (world: View, people: ReadonlyArray<string>) =>
  Effect.map(
    Effect.forEach(people, (person) =>
      Effect.flatMap(castMember(world, person), (member) => present(`${person}'s Safe`, member.safe)),
    ),
    sorted,
  );

/**
 * The Director hat the transaction `transaction` minted to `person`'s Safe: its details are Director, and when every
 * seat was worn the Hats protocol took one more seat in the same transaction, before the mint. Answers the hat.
 */
export const seatedBy = (world: View, transaction: string, person: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const member = yield* castMember(world, person);
    const safe = yield* present(`${person}'s Safe`, member.safe);
    const sent = yield* capxul.chain.transaction({ transaction }, whereOf(who));
    const minted = mintedTo(world, sent.logs, safe);
    yield* same(`the hats ${transaction} minted to ${person}'s Safe`, minted.length, 1);
    const hat = yield* present(`the hat minted to ${person}'s Safe`, Option.getOrNull(Arr.head(minted)));
    const read = yield* capxul.chain.hat({ hats: world.contracts.hats, hat: hat.id, block: null }, whereOf(who));
    yield* same("the minted hat's details", read.details, "Director");
    const seats = Arr.filter(
      logsOf(sent.logs, "HatMaxSupplyChanged"),
      (log) => isAddress(log.address, world.contracts.hats) && log.hatId === hat.id,
    );
    const before = yield* capxul.chain.hat(
      { hats: world.contracts.hats, hat: hat.id, block: sent.block - 1 },
      whereOf(who),
    );
    if (before.supply < before.maxSupply)
      yield* same("the seats the Director hat took, with a seat free", seats.length, 0);
    else {
      yield* same(
        "the seats the Director hat took, every seat worn",
        Arr.map(seats, (each) => each.newMaxSupply),
        [before.maxSupply + 1],
      );
      const order = Arr.filter(sent.logs, (log) => log === seats[0] || log === hat);
      yield* same("the Director hat's new seat comes before its mint", order[0], seats[0]);
    }
    return { hat: hat.id, safe, sent };
  });
