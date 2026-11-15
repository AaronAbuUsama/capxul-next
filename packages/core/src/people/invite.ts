// org.member.invite and org.member.list: a company's Directors invite a person by email to be a member, and its
// people (and the world's owner) list who belongs. An invitation is pending at once: a Seat is off the chain and off
// the site, so nothing is signed and nothing but Core's database and the world's record is written.
import { Errors, type People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cast } from "../cast/Cast.ts";
import { caller, instant } from "../organizations/caller.ts";
import { newId } from "../organizations/ids.ts";
import * as Organizations from "../organizations/store.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import { belongs, rosterOf } from "./roster.ts";
import * as Store from "./store.ts";

type Invite = typeof People.memberInvite.rpc.payloadSchema.Type;
type Listing = typeof People.memberList.rpc.payloadSchema.Type;

/** The company, or `OrgNotFound`. */
const company = (org: string) =>
  Effect.flatMap(Organizations.byOrg(org), (found) =>
    Effect.fromOption(found).pipe(Effect.mapError(() => Errors.OrgNotFound.make({ org }))),
  );

export const memberInvite = Effect.fn("org.member.invite.send")(function* (invite: Invite) {
  const sql = yield* PgClient.PgClient;
  const cast = yield* Cast;
  const who = yield* caller;
  const organization = yield* company(invite.org);
  // Only a Director may invite in P1; whether the Manage-people hat may too is open.
  if (!who.person || !Arr.contains(organization.directors, who.name))
    return yield* Errors.CannotManagePeople.make({ org: invite.org, person: who.name });
  const invitee = yield* cast.withEmail(invite.email);
  if (Option.isSome(invitee) && (yield* belongs(organization, invitee.value.person)))
    return yield* Errors.AlreadyAMember.make({ org: invite.org, person: invitee.value.person });
  const pending = yield* Store.pendingTo(invite.org, invite.email);
  if (Option.isSome(pending))
    return yield* Errors.AlreadyInvited.make({ org: invite.org, email: invite.email, invitation: pending.value });

  const now = yield* worldNow;
  const sent: Store.Invitation = {
    id: yield* newId("inv"),
    org: invite.org,
    handle: organization.handle,
    email: invite.email,
    role: invite.role,
    invitedBy: who.name,
    state: "pending",
    invitedAt: instant(now.timestampMs),
  };
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* Store.insertInvitation(sent, now.timestampMs);
      yield* emitDeclared("org.member.invite", invite, sent);
    }),
  );
  return sent;
});

export const memberList = Effect.fn("org.member.list.read")(function* (listing: Listing) {
  const cast = yield* Cast;
  const who = yield* caller;
  const organization = yield* company(listing.org);
  const roster = yield* rosterOf(organization);
  // The world's owner sees the whole world; a person sees only a company they belong to.
  if (who.person && !Arr.some(roster, (each) => each.person === who.name))
    return yield* Errors.NotAMember.make({ org: listing.org, person: who.name });
  const members = yield* Effect.forEach(roster, (each) =>
    Effect.flatMap(cast.find(each.person), (listed) =>
      Option.match(listed, {
        onNone: () => Effect.die(`${each.person} of ${listing.org} is no person of the world's cast`),
        onSome: (person) => Effect.succeed({ person: each.person, email: person.email, role: each.role }),
      }),
    ),
  );
  return { org: listing.org, members };
});
