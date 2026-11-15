// Reading who belongs to a company and the invitations sent: looks that the people operations' checks and the journey
// "invite olga to Northwind" share. A look at a company's people goes as the world's owner, who sees every company;
// a person's invitations are read as that person, since they are found by the email the person signs in with.
import type { People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { same } from "./expect.ts";
import { entriesAfter, objectOf, whereOf, type Json, type View, type Who } from "./world.ts";

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

/** The chain's head, when the world's clock is frozen (a running clock may mine blocks of its own); else null. */
export const frozenHead = (world: View, who: Who) =>
  Effect.gen(function* () {
    if (world.clock.mode !== "frozen") return null;
    const capxul = yield* Capxul;
    return (yield* capxul.chain.head({}, whereOf(who))).number;
  });

/** Nothing was written to the chain since `before` was read, when the clock was frozen then. */
export const chainUntouched = (world: View, who: Who, before: number | null) =>
  Effect.gen(function* () {
    if (before === null) return;
    const now = yield* frozenHead(world, who);
    yield* expect(now === before, `the chain's head is block ${now}; it was ${before}, with the clock frozen`);
  });

/** The record gained exactly one entry since `head`, the event `event` carrying exactly `carried`. */
export const recordedOnly = (event: string, carried: Readonly<Record<string, Json>>, head: number, who: Who) =>
  Effect.gen(function* () {
    const added = yield* entriesAfter(head, who);
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
