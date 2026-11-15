// Reading who belongs to a company and the invitations sent: looks that the people operations' checks and the journey
// "invite olga to Northwind" share. A look at a company's people goes as the world's owner, who sees every company;
// a person's invitations are read as that person, since they are found by the email the person signs in with.
import type { Chain, People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { Capxul } from "../client.ts";
import { companySafesOf, isAddress, logsOf } from "./chain.ts";
import { findIn, same } from "./expect.ts";
import {
  entriesOfCall,
  objectOf,
  personalSafes,
  recordOf,
  textOf,
  whereOf,
  type Json,
  type View,
  type Who,
} from "./world.ts";

export type Invitation = typeof People.Invitation.Type;
export type Member = typeof People.Member.Type;

/** The people of company `org`, as `org.member.list` answers its world's owner. */
export const peopleOf = (org: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return (yield* capxul["org.member.list"]({ org }, whereOf(who))).members;
  });

/** Every invitation sent to `person`'s email, as `invite.list` answers them. */
export const invitationsOf = (person: string, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return (yield* capxul["invite.list"]({}, { ...whereOf(who), as: person })).invitations;
  });

/** The founder of company `org`, as its org_founded in the world's record names them. */
export const founderOf = (org: string, who: Who = {}) =>
  Effect.gen(function* () {
    const { entries } = yield* recordOf(who);
    const founded = yield* findIn(
      `${org}'s org_founded in the record`,
      entries,
      (each) => each.event === "org_founded" && textOf(each.carried, "org") === org,
    );
    return textOf(founded.carried, "founder");
  });

/** The person of the world's cast who signs in with `email`, if any. */
export const personWith = (world: View, email: string) =>
  Option.map(
    Arr.findFirst(world.cast, (each) => each.email === email),
    (each) => each.person,
  );

/** The email `person` signs in with, from the world's cast; "" for a caller who is no person of it (the owner). */
export const emailOf = (world: View, person: string): string =>
  Option.getOrElse(
    Option.map(
      Arr.findFirst(world.cast, (each) => each.person === person),
      (each) => each.email,
    ),
    () => "",
  );

/** The chain's latest block, through the door `who` names: where a check of what a call wrote starts reading. */
export const chainBlock = (who: Who) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return (yield* capxul.chain.head({}, whereOf(who))).number;
  });

/**
 * Nothing the call did reached the chain for the world's people or for company `org`: since block `before`, no user
 * operation from a person's Safe or the company's, no company Safe minted for `org`, no budget of its Safe and no hat
 * moved to or from any of those Safes. Other journeys' transactions, from accounts of their own, are not the call's.
 */
export const chainUntouched = (world: View, who: Who, before: number, org: string | null) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const where = whereOf(who);
    const since = (log: Chain.LogName) =>
      Effect.map(capxul.chain.logs({ log, address: null, fromBlock: before, toBlock: null }, where), (logs) =>
        Arr.filter(logs, (each) => each.block > before),
      );
    const minted = org === null ? [] : yield* companySafesOf(org, who);
    const safes = [...personalSafes(world), ...Arr.map(minted, (each) => each.safe)];
    const ours = (address: string) => Arr.some(safes, (safe) => isAddress(safe, address));
    const touched = [
      ...Arr.map(
        Arr.filter(logsOf(yield* since("UserOperationEvent"), "UserOperationEvent"), (each) => ours(each.sender)),
        (each) => `a user operation from ${each.sender} in block ${each.block}`,
      ),
      ...Arr.map(
        Arr.filter(minted, (each) => each.block > before),
        (each) => `${org}'s company Safe minted in block ${each.block}`,
      ),
      ...Arr.map(
        Arr.filter(logsOf(yield* since("BudgetCreated"), "BudgetCreated"), (each) => ours(each.safe)),
        (each) => `budget ${each.id} of ${each.safe} in block ${each.block}`,
      ),
      ...Arr.map(
        Arr.filter(
          logsOf(yield* since("TransferSingle"), "TransferSingle"),
          (each) => ours(each.to) || ours(each.from),
        ),
        (each) => `hat ${each.id} from ${each.from} to ${each.to} in block ${each.block}`,
      ),
    ];
    yield* same(`what reached the chain since block ${before}`, touched, []);
  });

/** The call wrote exactly one entry, the event `event` carrying exactly `carried`. `head` is the head before it. */
export const recordedOnly = (event: string, carried: Readonly<Record<string, Json>>, head: number, who: Who) =>
  Effect.gen(function* () {
    const added = yield* entriesOfCall(head, who);
    yield* same(
      "the events added",
      Arr.map(added, (each) => each.event),
      [event],
    );
    const got = objectOf(added[0]?.carried);
    yield* same(
      `the fields ${event} carries`,
      Arr.sort(Rec.keys<string, Json>(got), Order.String),
      Arr.sort(Rec.keys(carried), Order.String),
    );
    yield* same(`what ${event} carries`, got, carried);
  });
