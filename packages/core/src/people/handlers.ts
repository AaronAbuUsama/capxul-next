// The handlers of the world group's people operations, as src/domains/people.ts names them. Each answers with its
// outcome or one of its declared refusals; a fault of the database travels as a defect
// (packages/blueprint, src/common/refusals.ts), which the runner records as a failed call. They need the database,
// the world's cast, its clock and its record, which every world's Core has; nothing here reaches the chain or a
// company's site.
import type { People } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { inviteAccept, inviteDecline, inviteList } from "./answer.ts";
import { memberInvite, memberList } from "./invite.ts";

type Payload<Op extends { readonly rpc: { readonly payloadSchema: { readonly Type: unknown } } }> =
  Op["rpc"]["payloadSchema"]["Type"];

/** A fault of the database is not a refusal of the contract: it dies. */
const faults = { SqlError: Effect.die } as const;

/** Its five handlers, by operation: the people domain's share of the world group. */
export const peopleHandlers = {
  "org.member.invite": (payload: Payload<typeof People.memberInvite>) =>
    memberInvite(payload).pipe(Effect.catchTags(faults)),
  // invite.list takes nothing: its handler is the one Effect, run for each call.
  "invite.list": () => inviteList.pipe(Effect.catchTags(faults)),
  "invite.accept": (payload: Payload<typeof People.inviteAccept>) =>
    inviteAccept(payload).pipe(Effect.catchTags(faults)),
  "invite.decline": (payload: Payload<typeof People.inviteDecline>) =>
    inviteDecline(payload).pipe(Effect.catchTags(faults)),
  "org.member.list": (payload: Payload<typeof People.memberList>) => memberList(payload).pipe(Effect.catchTags(faults)),
};
