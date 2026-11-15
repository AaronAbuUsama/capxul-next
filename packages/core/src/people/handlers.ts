// The handlers of the world group's people operations, as src/domains/people.ts names them. Each answers with its
// outcome or one of its declared refusals; a fault of the database travels as a defect
// (packages/blueprint, src/common/refusals.ts), which the runner records as a failed call. They need the database,
// the world's cast, its clock and its record, which every world's Core has; nothing here reaches the chain or a
// company's site.
import type { People } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { invitationAccept, invitationDecline, invitationList } from "./answer.ts";
import { invitationSend, memberList } from "./invite.ts";

type Payload<Op extends { readonly rpc: { readonly payloadSchema: { readonly Type: unknown } } }> =
  Op["rpc"]["payloadSchema"]["Type"];

/** A fault of the database is not a refusal of the contract: it dies. */
const faults = { SqlError: Effect.die } as const;

/** Its five handlers, by operation: the people domain's share of the world group. */
export const peopleHandlers = {
  "invitation.send": (payload: Payload<typeof People.invitationSend>) =>
    invitationSend(payload).pipe(Effect.catchTags(faults)),
  // invitation.list takes nothing: its handler is the one Effect, run for each call.
  "invitation.list": () => invitationList.pipe(Effect.catchTags(faults)),
  "invitation.accept": (payload: Payload<typeof People.invitationAccept>) =>
    invitationAccept(payload).pipe(Effect.catchTags(faults)),
  "invitation.decline": (payload: Payload<typeof People.invitationDecline>) =>
    invitationDecline(payload).pipe(Effect.catchTags(faults)),
  "member.list": (payload: Payload<typeof People.memberList>) => memberList(payload).pipe(Effect.catchTags(faults)),
};
