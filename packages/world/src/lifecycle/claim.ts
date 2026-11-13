// The registry of world names: one row per world, in a table on the platform's own Neon branch. Postgres makes the
// insert of a name atomic, which the shared state store cannot: it has no lock, and two deploys of one stage at
// once would each create resources while the store kept only one set. A world is created only by whoever holds
// its row, so of two creates of one name at once, one wins and the other fails before it has created anything.
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { REGISTRY_ID } from "../database/Db.ts";
import { query, transaction } from "../database/sql.ts";
import { secretOf } from "../stack/engine.ts";
import { PLATFORM } from "../stack/names.ts";
import { TooManyWorlds } from "./spec.ts";

export class PlatformMissing extends Schema.TaggedError<PlatformMissing>()("PlatformMissing", {
  message: Schema.String,
}) {}

export class WorldAlreadyExists extends Schema.TaggedError<WorldAlreadyExists>()("WorldAlreadyExists", {
  world: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  message: Schema.String,
}) {}

export const Claim = Schema.Struct({
  name: Schema.String,
  owner: Schema.String,
  expires_at: Schema.String,
  holder: Schema.String,
});
export type Claim = typeof Claim.Type;
const Claims = Schema.Array(Claim);

const COLUMNS = `name, owner, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at, holder`;

/** The registry's connection, read from the platform stage's state. Fails typed when the platform is not deployed. */
export const registry = secretOf(PLATFORM, REGISTRY_ID, "connectionUri").pipe(
  Effect.catchTag("StateUnreadable", (error) =>
    Effect.fail(
      new PlatformMissing({
        message: `the platform stage is not deployed (${error.message}); run the platform up command once`,
      }),
    ),
  ),
);

/** Creates the registry's table. Run when the platform is brought up; safe to run again. */
export const prepareRegistry = (database: Redacted.Redacted<string>) =>
  query(
    database,
    "create table if not exists worlds (name text primary key, owner text not null, expires_at timestamptz not null, holder text not null, claimed_at timestamptz not null default now())",
  ).pipe(Effect.asVoid);

const Count = Schema.Tuple([Schema.Struct({ live: Schema.Number })]);

/**
 * Takes the name for `owner` until `expiresAt`, or fails with who holds it, or with the owner's count when the
 * owner already has `mostPerOwner` live worlds. The count and the insert are one transaction under a lock on the
 * owner, so two creates by one owner at once cannot both slip under the limit. Returns the holder's token.
 */
export const claim = Effect.fn("world.claim")(function* (
  database: Redacted.Redacted<string>,
  world: string,
  owner: string,
  expiresAt: string,
  mostPerOwner: number,
) {
  const holder = `${yield* Random.nextIntBetween(0, 2 ** 31 - 1)}-${yield* Random.nextIntBetween(0, 2 ** 31 - 1)}`;
  const [, taken] = yield* transaction(database, [
    { query: "select pg_advisory_xact_lock(hashtext($1))", params: [owner] },
    {
      query:
        "insert into worlds (name, owner, expires_at, holder) select $1, $2, $3, $4 where (select count(*) from worlds where owner = $2 and expires_at > now()) < $5 on conflict (name) do nothing returning name",
      params: [world, owner, expiresAt, holder, mostPerOwner],
    },
  ]);
  if (taken?.length === 1) return holder;
  const held = yield* query(database, `select ${COLUMNS} from worlds where name = $1`, [world]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Claims)),
  );
  const other = held[0];
  if (other !== undefined) {
    return yield* new WorldAlreadyExists({
      world,
      owner: other.owner,
      expiresAt: other.expires_at,
      message: `a world called ${world} already exists or is being created (owner ${other.owner}, expires ${other.expires_at})`,
    });
  }
  const [{ live }] = yield* query(
    database,
    "select count(*)::int as live from worlds where owner = $1 and expires_at > now()",
    [owner],
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Count)));
  return yield* new TooManyWorlds({
    owner,
    live,
    most: mostPerOwner,
    message: `${owner} already has ${live} live worlds; the most an owner may have is ${mostPerOwner}`,
  });
});

/** Gives the name back. With a holder, only that holder's row is removed. */
export const release = (database: Redacted.Redacted<string>, world: string, holder?: string) =>
  (holder === undefined
    ? query(database, "delete from worlds where name = $1", [world])
    : query(database, "delete from worlds where name = $1 and holder = $2", [world, holder])
  ).pipe(Effect.asVoid, Effect.withSpan("world.release"));

/** Every name that is taken. */
export const claims = (database: Redacted.Redacted<string>) =>
  query(database, `select ${COLUMNS} from worlds order by name`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Claims)),
  );
