// The registry of world names: one row per world, in a table on the platform's own Neon branch. Postgres makes the
// insert of a name atomic, which the shared state store cannot: it has no lock, and two deploys of one stage at
// once would each create resources while the store kept only one set. A world is created only by whoever holds
// its row, so of two creates of one name at once, one wins and the other fails before it has created anything.
//
// The refusals are the contract's (WorldExists, WorldQuotaReached), so a caller sees here what world.create answers.
//
// The same insert is a world's admission to its fleet hub: a row names its hub, and a name is taken only while the
// hub's rows are fewer than the worlds it admits (its recorded capacity, src/hub/names.ts). The count and the insert
// run under a lock on the hub, so two creates on one hub at once, from two processes, cannot both take its last
// place. A world holds its place from its claim until its name is released, when everything of it is gone: an
// expired world or one whose take-down failed keeps its place until the sweeper takes it down. A create on a full hub
// fails with HubFull, which `admit` waits out, within the declared `admit` timeout. The quota is checked before the
// hub, so an owner at the limit is refused at once, full hub or not.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { REGISTRY_ID } from "../database/Db.ts";
import { query, transaction } from "../database/sql.ts";
import { type DatabaseRefused, HubFull, PlatformMissing } from "../failures.ts";
import { secretOf } from "../stack/engine.ts";
import { nameOf, PLATFORM } from "../stack/names.ts";

export const Claim = Schema.Struct({
  name: Schema.String,
  owner: Schema.String,
  expires_at: Schema.String,
  holder: Schema.String,
});
export type Claim = typeof Claim.Type;
const Claims = Schema.Array(Claim);
const Live = Schema.Array(Schema.Struct({ live: Schema.Int }));

const COLUMNS = `name, owner, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at, holder`;

/** The registry's connection, read from the platform stage's state. Fails typed when the platform is not deployed. */
export const registry = secretOf(PLATFORM, REGISTRY_ID, "connectionUri").pipe(
  Effect.catchTag("StateUnreadable", (error) =>
    Effect.fail(
      PlatformMissing.make({
        message: `the platform stage is not deployed (${error.message}); run the platform up command once`,
      }),
    ),
  ),
);

/**
 * Creates the registry's table, and the column that names each world's hub, with its index. Run when the platform is
 * brought up, and by a claim that finds the column missing (a registry made before hubs had capacity); safe to run
 * again. One transaction under a lock of its own: two claims that find the column missing at once would otherwise
 * both create the index, and one would fail (seen in records/admission).
 */
export const prepareRegistry = (database: Redacted.Redacted) =>
  transaction(
    database,
    Arr.map(
      [
        "select pg_advisory_xact_lock(hashtext('capxul-registry'))",
        "create table if not exists worlds (name text primary key, owner text not null, expires_at timestamptz not null, holder text not null, claimed_at timestamptz not null default now())",
        "alter table worlds add column if not exists hub text",
        "create index if not exists worlds_hub on worlds (hub)",
      ],
      (statement) => ({ query: statement, params: [] }),
    ),
  ).pipe(Effect.asVoid);

/** Every name that is taken. */
export const claims = (database: Redacted.Redacted) =>
  query(database, `select ${COLUMNS} from worlds order by name`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Claims)),
  );

const claimOf = (database: Redacted.Redacted, world: string) =>
  query(database, `select ${COLUMNS} from worlds where name = $1`, [world]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Claims)),
    Effect.map(Arr.head),
  );

const Held = Schema.Array(Schema.Struct({ held: Schema.Int }));

/** How many worlds hold a place on `hub`. */
export const heldOn = (database: Redacted.Redacted, hub: string) =>
  query(database, "select count(*)::int as held from worlds where hub = $1", [hub]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Held)),
    Effect.map((rows) =>
      Option.getOrElse(
        Option.map(Arr.head(rows), (row) => row.held),
        () => 0,
      ),
    ),
  );

const liveOf = (database: Redacted.Redacted, owner: string) =>
  query(database, "select count(*)::int as live from worlds where owner = $1 and expires_at > now()", [owner]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Live)),
    Effect.map((rows) =>
      Option.getOrElse(
        Option.map(Arr.head(rows), (row) => row.live),
        () => 0,
      ),
    ),
  );

/** The hub a world is admitted to, and how many worlds it admits at once. */
export interface HubRoom {
  readonly stage: string;
  readonly capacity: number;
}

/** The lock every create on one hub takes: two keys, a space apart from the owner's lock of one. */
const HUB_LOCK = "select pg_advisory_xact_lock(hashtext('capxul-hub'), hashtext($1))";

/** The insert: the name, unless taken; only under the owner's quota; and, with a hub, only while it has room. */
const INSERT =
  "insert into worlds (name, owner, expires_at, holder, hub) select $1, $2, $3, $4, $6 where (select count(*) from worlds where owner = $2 and expires_at > now()) < $5 and ($6::text is null or (select count(*) from worlds where hub = $6) < $7) on conflict (name) do nothing returning name";

/** Whether the registry was made before rows named their hub. */
const hubColumnMissing = (error: DatabaseRefused) =>
  Str.includes('column "hub"')(error.message) && Str.includes("does not exist")(error.message);

/**
 * Takes the name for `owner` until `expiresAt`, and a place on `hub` when one is given, or fails with who holds the
 * name, with the owner's count when the owner already has `mostPerOwner` live worlds, or with HubFull when the hub
 * holds as many worlds as it admits. The counts and the insert are one transaction under a lock on the owner and one
 * on the hub, so two creates at once cannot both slip under a limit. Returns the holder's token.
 */
export const claim = Effect.fn("world.claim")(function* (
  database: Redacted.Redacted,
  world: string,
  owner: string,
  expiresAt: string,
  mostPerOwner: number,
  hub?: HubRoom,
) {
  const holder = `${yield* Random.nextIntBetween(0, 2 ** 31 - 1)}-${yield* Random.nextIntBetween(0, 2 ** 31 - 1)}`;
  const statements = [
    { query: "select pg_advisory_xact_lock(hashtext($1))", params: [owner] },
    ...(hub === undefined ? [] : [{ query: HUB_LOCK, params: [hub.stage] }]),
    {
      query: INSERT,
      params: [world, owner, expiresAt, holder, mostPerOwner, hub?.stage ?? null, hub?.capacity ?? 0],
    },
  ];
  const results = yield* transaction(database, statements).pipe(
    Effect.catchIf(
      (error) => error._tag === "DatabaseRefused" && hubColumnMissing(error),
      () => Effect.andThen(prepareRegistry(database), transaction(database, statements)),
    ),
  );
  const inserted = Option.getOrElse(Arr.last(results), () => []);
  if (Arr.length(inserted) === 1) return holder;
  const held = yield* claimOf(database, world);
  if (Option.isSome(held)) {
    return yield* Errors.WorldExists.make({
      world: nameOf(world),
      owner: held.value.owner,
      expiresAt: held.value.expires_at,
    });
  }
  const live = yield* liveOf(database, owner);
  if (hub === undefined || live >= mostPerOwner)
    return yield* Errors.WorldQuotaReached.make({ owner, live, limit: mostPerOwner });
  const onHub = yield* heldOn(database, hub.stage);
  return yield* HubFull.make({
    hub: hub.stage,
    held: onHub,
    capacity: hub.capacity,
    message: `hub ${hub.stage} holds ${onHub} worlds and admits ${hub.capacity}`,
  });
});

/**
 * Claims the name and a place on `hub`, as `claim` does, and while the hub is full asks again every `every`: the
 * caller's step timeout bounds the wait (the `admit` step, src/lifecycle/spec.ts). Each try is uninterruptible with
 * `onHeld`, so whoever runs this knows whether the name is held; the waits between tries are not.
 */
export const admit = (
  database: Redacted.Redacted,
  world: string,
  owner: string,
  expiresAt: string,
  mostPerOwner: number,
  hub: HubRoom,
  every: Duration.Duration,
  onHeld: (holder: string) => Effect.Effect<void>,
) =>
  claim(database, world, owner, expiresAt, mostPerOwner, hub).pipe(
    Effect.tap(onHeld),
    Effect.uninterruptible,
    Effect.tapError((error) =>
      error._tag === "HubFull" ? Effect.logInfo(`world ${world}: waiting for room: ${error.message}`) : Effect.void,
    ),
    Effect.retry({ while: (error) => error._tag === "HubFull", schedule: Schedule.spaced(every) }),
    Effect.withSpan("world.admit.claim"),
  );

/** Gives the name back. With a holder, only that holder's row is removed. */
export const release = (database: Redacted.Redacted, world: string, holder: Option.Option<string> = Option.none()) =>
  Option.match(holder, {
    onNone: () => query(database, "delete from worlds where name = $1", [world]),
    onSome: (token) => query(database, "delete from worlds where name = $1 and holder = $2", [world, token]),
  }).pipe(Effect.asVoid, Effect.withSpan("world.release"));

/** Moves a held name's expiry, so the owner's count of live worlds reads the world's renewed expiry. */
export const extendClaim = (database: Redacted.Redacted, world: string, expiresAt: string) =>
  query(database, "update worlds set expires_at = $2 where name = $1 returning name", [world, expiresAt]).pipe(
    Effect.map((rows) => rows.length === 1),
    Effect.withSpan("world.extendClaim"),
  );
