// What Core keeps of the domain "people" (migrations/0006_people_invitations.sql): the invitations a company's
// founder sent and the members who joined by accepting one. Every write is made inside the caller's transaction.
import { machines, People } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PgClient from "@effect/sql-pg/PgClient";
import { instant } from "../organizations/caller.ts";

export type Invitation = typeof People.Invitation.Type;
type State = typeof People.InvitationState.Type;

interface Row {
  readonly id: string;
  readonly org: string;
  readonly handle: string;
  readonly email: string;
  readonly role: string;
  readonly invited_by: string;
  readonly state: string;
  readonly invited_ms: number;
}

/** A kept invitation as the blueprint answers it; a row the blueprint would not answer is a defect. */
const decode = (row: Row) =>
  Schema.decodeUnknownEffect(People.Invitation)({
    id: row.id,
    org: row.org,
    handle: row.handle,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    state: row.state,
    invitedAt: instant(row.invited_ms),
  }).pipe(Effect.orDie);

const some = (rows: ReadonlyArray<Row>) =>
  Option.match(Arr.head(rows), {
    onNone: () => Effect.succeed(Option.none<Invitation>()),
    onSome: (row) => Effect.asSome(decode(row)),
  });

/** The invitation by its id, if any, held until the caller's transaction ends. */
export const invitationHeld = Effect.fn("people.invitation")(function* (id: string) {
  const sql = yield* PgClient.PgClient;
  return yield* some(
    yield* sql<Row>`select i.id, i.org, o.handle, i.email, i.role, i.invited_by, i.state, i.invited_ms
      from app.invitations i join app.organizations o on o.org = i.org
      where i.id = ${id} for update of i`,
  );
});

/** Every invitation sent to `email`, whatever its state, oldest first. */
export const invitationsTo = Effect.fn("people.invitationsTo")(function* (email: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<Row>`select i.id, i.org, o.handle, i.email, i.role, i.invited_by, i.state, i.invited_ms
    from app.invitations i join app.organizations o on o.org = i.org
    where i.email = ${email} order by i.invited_ms, i.position`;
  return yield* Effect.forEach(rows, decode);
});

/** The company's invitation to `email` still in its machine's start state (pending), by its id, if any. */
export const pendingTo = Effect.fn("people.pendingTo")(function* (org: string, email: string) {
  const sql = yield* PgClient.PgClient;
  const pending = machines.invitation.start.state;
  const rows = yield* sql<{ readonly id: string }>`
    select id from app.invitations where org = ${org} and email = ${email} and state = ${pending} limit 1`;
  return Option.map(Arr.head(rows), (row) => row.id);
});

export const insertInvitation = Effect.fn("people.invite")(function* (sent: Invitation, invitedMs: number) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.invitations ${sql.insert({
    id: sent.id,
    org: sent.org,
    email: sent.email,
    role: sent.role,
    invited_by: sent.invitedBy,
    state: sent.state,
    invited_ms: invitedMs,
  })}`;
});

/** Moves an invitation its invitee answered, as its machine's `step` moved it, from the state it was read in. */
export const answer = Effect.fn("people.answer")(function* (
  id: string,
  moved: { readonly from: State; readonly to: State },
  answeredMs: number,
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.invitations set state = ${moved.to}, answered_ms = ${answeredMs}
    where id = ${id} and state = ${moved.from}`;
});

/** Adds the person to the company's members, by the invitation they accepted; once only. */
export const join = Effect.fn("people.join")(function* (joined: {
  readonly org: string;
  readonly person: string;
  readonly invitation: string;
  readonly joinedMs: number;
}) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.members (org, person, role, invitation, joined_ms)
    values (${joined.org}, ${joined.person}, 'member', ${joined.invitation}, ${joined.joinedMs})
    on conflict (org, person) do nothing`;
});

/** The people who joined the company by an invitation, in the order they joined. */
export const joinedOf = Effect.fn("people.joined")(function* (org: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly person: string }>`
    select person from app.members where org = ${org} order by position`;
  return Arr.map(rows, (row) => row.person);
});
