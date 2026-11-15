// invitation.send and member.list: a company's founder invites a person by email to be a member, and its
// people (and the world's owner) list who belongs. An invitation is pending at once: a Seat is off the chain and off
// the site, so nothing is signed and nothing but Core's database and the world's record is written.
import { Errors, machines, People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cast } from "../cast/Cast.ts";
import { caller, instant } from "../organizations/caller.ts";
import { newId } from "../organizations/ids.ts";
import * as Organizations from "../organizations/store.ts";
import { emitDeclared, worldNow } from "../record/emit.ts";
import { refuse } from "./refused.ts";
import { belongs, rosterOf } from "./roster.ts";
import * as Store from "./store.ts";

type Invite = typeof People.invitationSend.rpc.payloadSchema.Type;
type Listing = typeof People.memberList.rpc.payloadSchema.Type;

const Send = People.invitationSend;
const List = People.memberList;

/** The company, or `OrgNotFound`. */
const company = (org: string) =>
  Effect.flatMap(Organizations.byOrg(org), (found) =>
    Effect.fromOption(found).pipe(Effect.mapError(() => Errors.OrgNotFound.make({ org }))),
  );

/** What sending reads first: the company, and that the caller may invite this email to it. */
const load = Effect.fn(Send.spans.load.name)(function* (invite: Invite) {
  const cast = yield* Cast;
  const who = yield* caller;
  const organization = yield* company(invite.org).pipe(
    Effect.catchTag("OrgNotFound", (refusal) =>
      refuse(Send.refusals.OrgNotFound, { org: invite.org, rule: "no-such-company" }, refusal),
    ),
  );
  // For now only the founder invites, as the company's row holds it (docs/roadmap.md, "Who may invite"); another
  // Director is refused like anyone else. A role that grants it comes later.
  if (!who.person || who.name !== organization.founder)
    return yield* refuse(
      Send.refusals.CannotManagePeople,
      { org: invite.org, rule: "not-the-founder" },
      Errors.CannotManagePeople.make({ org: invite.org, person: who.name }),
    );
  const invitee = yield* cast.withEmail(invite.email);
  if (Option.isSome(invitee) && (yield* belongs(organization, invitee.value.person)))
    return yield* refuse(
      Send.refusals.AlreadyAMember,
      { org: invite.org, rule: "already-a-member" },
      Errors.AlreadyAMember.make({ org: invite.org, person: invitee.value.person }),
    );
  const pending = yield* Store.pendingTo(invite.org, invite.email);
  if (Option.isSome(pending))
    return yield* refuse(
      Send.refusals.AlreadyInvited,
      { org: invite.org, rule: "already-invited" },
      Errors.AlreadyInvited.make({ org: invite.org, email: invite.email, invitation: pending.value }),
    );
  return { organization, who };
});

/** The invitation and its event, in one transaction. */
const write = Effect.fn(Send.spans.write.name)(function* (invite: Invite, sent: Store.Invitation, at: number) {
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* Store.insertInvitation(sent, at);
      yield* emitDeclared(Send.rpc._tag, invite, sent);
    }),
  );
});

export const invitationSend = (invite: Invite) =>
  Effect.gen(function* () {
    const { organization, who } = yield* load(invite);
    const now = yield* worldNow;
    const sent: Store.Invitation = {
      id: yield* newId("inv"),
      org: invite.org,
      handle: organization.handle,
      email: invite.email,
      role: invite.role,
      invitedBy: who.name,
      state: machines.invitation.start.state,
      invitedAt: instant(now.timestampMs),
    };
    yield* write(invite, sent, now.timestampMs);
    return sent;
  });

export const memberList = Effect.fn(List.spans.read.name)(function* (listing: Listing) {
  const cast = yield* Cast;
  const who = yield* caller;
  const organization = yield* company(listing.org).pipe(
    Effect.catchTag("OrgNotFound", (refusal) =>
      refuse(List.refusals.OrgNotFound, { org: listing.org, rule: "no-such-company" }, refusal),
    ),
  );
  const roster = yield* rosterOf(organization);
  // The world's owner sees the whole world; a person sees only a company they belong to.
  if (who.person && !Arr.some(roster, (each) => each.person === who.name))
    return yield* refuse(
      List.refusals.NotAMember,
      { org: listing.org, rule: "not-a-member" },
      Errors.NotAMember.make({ org: listing.org, person: who.name }),
    );
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
