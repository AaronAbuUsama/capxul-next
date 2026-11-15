// invite.list, invite.accept and invite.decline: the person who signs in with an invitation's email lists it and
// answers it. Accepting makes them a member at once (src/people/roster.ts); declining closes it. Only a pending
// invitation is answered; accepting one already accepted answers the same and changes nothing.
import { Errors, People } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cast } from "../cast/Cast.ts";
import { caller } from "../organizations/caller.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import * as Store from "./store.ts";

type Answering = typeof People.inviteAccept.rpc.payloadSchema.Type;

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
      if (invitation.state === "accepted") return People.AlreadyAccepted.make({ invitation, member });
      if (invitation.state !== "pending")
        return yield* Errors.InvitationClosed.make({ invitation: invitation.id, state: invitation.state });
      const now = yield* worldNow;
      yield* Store.answer(invitation.id, "accepted", now.timestampMs);
      yield* Store.join({ org: invitation.org, person, invitation: invitation.id, joinedMs: now.timestampMs });
      const accepted = People.Accepted.make({ invitation: { ...invitation, state: "accepted" }, member });
      yield* emitDeclared("invite.accept", asked, accepted);
      return accepted;
    }),
  );
});

export const inviteDecline = Effect.fn("invite.decline.answer")(function* (asked: Answering) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const { invitation } = yield* theirs(asked.invitation);
      if (invitation.state !== "pending")
        return yield* Errors.InvitationClosed.make({ invitation: invitation.id, state: invitation.state });
      const now = yield* worldNow;
      yield* Store.answer(invitation.id, "declined", now.timestampMs);
      const declined: Store.Invitation = { ...invitation, state: "declined" };
      yield* emitDeclared("invite.decline", asked, declined);
      return declined;
    }),
  );
});
