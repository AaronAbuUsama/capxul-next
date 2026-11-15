// What the checks of invite.accept and invite.decline share: what they read before the call (the caller's own
// invitations, and the chain's head while the clock is frozen), and the checks of their three refusals, which leave
// everything as it was.
import type { CallOptions } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Errors } from "@capxul/blueprint";
import { same } from "../support/expect.ts";
import { frozenHead, invitationsOf, type Invitation } from "../support/people.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, type Check } from "./format.ts";

export interface Answering extends Before {
  readonly chain: number | null;
  /** The caller's own invitations before the call; none for the world's owner, who is no person. */
  readonly mine: ReadonlyArray<Invitation>;
}

/** Reads what an answer to an invitation is judged against. */
export const answeringBefore = (options: CallOptions) =>
  Effect.gen(function* () {
    const base = yield* worldBefore(options);
    const mine = options.as === undefined ? [] : yield* invitationsOf(options.as, base.where);
    return { ...base, chain: yield* frozenHead(base.world, base.where), mine } satisfies Answering;
  });

/** The caller's invitation `id` as it stood before the call, if the caller had it. */
export const mineBefore = (before: Answering, id: string) => Arr.findFirst(before.mine, (each) => each.id === id);

/** The checks of a refused answer to invitation `invitation`. */
export const answerRefusals = (what: string) => ({
  NotYourInvitation: (
    asked: { readonly payload: { readonly invitation: string }; readonly options: CallOptions },
    refused: Errors.NotYourInvitation,
    before: Answering,
  ): ReadonlyArray<Check> => [
    check(
      "NotYourInvitation names the invitation asked and the caller",
      same(
        "NotYourInvitation",
        [refused.invitation, refused.person],
        [asked.payload.invitation, callerOf(asked.options)],
      ),
    ),
    check(
      "the caller does not list it among their own",
      same(
        `the caller's invitation ${asked.payload.invitation}`,
        mineBefore(before, asked.payload.invitation),
        Option.none(),
      ),
    ),
    nothingRecorded(what, before),
  ],
  InvitationClosed: (
    asked: { readonly payload: { readonly invitation: string } },
    refused: Errors.InvitationClosed,
    before: Answering,
  ): ReadonlyArray<Check> => [
    check(
      "InvitationClosed names the invitation asked, in the state the caller lists it in",
      same(
        "InvitationClosed",
        [refused.invitation, Option.some(refused.state)],
        [asked.payload.invitation, Option.map(mineBefore(before, asked.payload.invitation), (each) => each.state)],
      ),
    ),
    nothingRecorded(what, before),
  ],
  InvitationNotFound: (
    asked: { readonly payload: { readonly invitation: string } },
    refused: Errors.InvitationNotFound,
    before: Answering,
  ): ReadonlyArray<Check> => [
    check(
      "InvitationNotFound names the invitation asked",
      same("its invitation", refused.invitation, asked.payload.invitation),
    ),
    nothingRecorded(what, before),
  ],
});
