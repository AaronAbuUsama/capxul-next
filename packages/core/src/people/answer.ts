// invite.list, invite.accept and invite.decline: the person who signs in with an invitation's email lists it and
// answers it. Accepting makes them a member at once (src/people/roster.ts); declining closes it. What an answer does
// from the state the invitation is in is its machine's (the blueprint's people/machines.ts): each answer is a move
// made through `step`, which moves it, leaves it unchanged (accepting one already accepted answers the same), or names
// the refusal and the state it refuses from.
import { Errors, machines, People } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cast } from "../cast/Cast.ts";
import { caller } from "../organizations/caller.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import * as Store from "./store.ts";

type Answering = typeof People.inviteAccept.rpc.payloadSchema.Type;
type Closed = typeof Invitation.RefusedState.Type;

const Invitation = machines.invitation;

/** The refusal the invitation's machine names, from the state it names. */
const refused = (
  invitation: string,
  stepped: { readonly refusal: Errors.InvitationClosed["_tag"]; readonly state: Closed },
) => Errors.refusals[stepped.refusal].make({ invitation, state: stepped.state });

/** The caller's name and the email they sign in with; none for the world's owner or a name the cast does not hold. */
const callerEmail = Effect.gen(function* () {
  const who = yield* caller;
  if (!who.person) return { name: who.name, email: Option.none<string>() };
  const cast = yield* Cast;
  const listed = yield* cast.find(who.name);
  return { name: who.name, email: Option.map(listed, (each) => each.email) };
});

/** The invitation asked, held for the transaction, once it is known to be the caller's own. */
const theirs = Effect.fn("invite.theirs")(function* (id: string) {
  const who = yield* callerEmail;
  const found = yield* Store.invitationHeld(id);
  if (Option.isNone(found)) return yield* Errors.InvitationNotFound.make({ invitation: id });
  if (!Option.contains(who.email, found.value.email))
    return yield* Errors.NotYourInvitation.make({ invitation: id, person: who.name });
  return { invitation: found.value, person: who.name };
});

export const inviteList = Effect.gen(function* () {
  const who = yield* callerEmail;
  const invitations = Option.isSome(who.email) ? yield* Store.invitationsTo(who.email.value) : [];
  return { invitations };
}).pipe(Effect.withSpan("invite.list.read"));

export const inviteAccept = Effect.fn("invite.accept.answer")(function* (asked: Answering) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const { invitation, person } = yield* theirs(asked.invitation);
      const member = { person, email: invitation.email, role: "member" as const };
      const stepped = Invitation.step(invitation.state, "accept");
      if (stepped._tag === "Unchanged") return People.AlreadyAccepted.make({ invitation, member });
      if (stepped._tag === "Refused") return yield* refused(invitation.id, stepped);
      const now = yield* worldNow;
      yield* Store.answer(invitation.id, { from: invitation.state, to: stepped.to }, now.timestampMs);
      yield* Store.join({ org: invitation.org, person, invitation: invitation.id, joinedMs: now.timestampMs });
      const accepted = People.Accepted.make({ invitation: { ...invitation, state: stepped.to }, member });
      yield* emitDeclared(Invitation.moves.accept.by, asked, accepted);
      return accepted;
    }),
  );
});

export const inviteDecline = Effect.fn("invite.decline.answer")(function* (asked: Answering) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const { invitation } = yield* theirs(asked.invitation);
      const stepped = Invitation.step(invitation.state, "decline");
      if (stepped._tag === "Refused") return yield* refused(invitation.id, stepped);
      const now = yield* worldNow;
      yield* Store.answer(invitation.id, { from: invitation.state, to: stepped.to }, now.timestampMs);
      const declined: Store.Invitation = { ...invitation, state: stepped.to };
      yield* emitDeclared(Invitation.moves.decline.by, asked, declined);
      return declined;
    }),
  );
});
