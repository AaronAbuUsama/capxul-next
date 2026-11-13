// What Core keeps of a company it founded and of each officer change (migrations/0004_organizations.sql), and the
// world's list of companies it adds to (`app.companies`, the world's migration). Every write is made inside the
// caller's transaction.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PgClient from "@effect/sql-pg/PgClient";

/** What deployMoney made for one company, by the names Core reads it with. Hat ids are decimal text. */
export const Deployment = Schema.Struct({
  boardTopHat: Schema.String,
  directorHat: Schema.String,
  officerHats: Schema.Struct({
    "manage-books": Schema.String,
    "issue-invoices": Schema.String,
    "manage-people": Schema.String,
  }),
  gate: Schema.String,
  roles: Schema.String,
});
export type Deployment = typeof Deployment.Type;

const People = Schema.Array(Values.PersonId);

export interface Organization {
  readonly org: string;
  readonly handle: string;
  readonly founder: string;
  readonly founderSafe: string;
  readonly safe: string;
  readonly founding: unknown;
  readonly directors: ReadonlyArray<string>;
  readonly threshold: number;
  readonly members: ReadonlyArray<string>;
  readonly setup: "awaiting_signatures" | "ready";
  readonly deployment: Deployment;
  readonly budget: string | null;
  readonly site: string | null;
}

interface Row {
  readonly org: string;
  readonly handle: string;
  readonly founder: string;
  readonly founder_safe: string;
  readonly safe: string;
  readonly founding: unknown;
  readonly directors: unknown;
  readonly threshold: number;
  readonly members: unknown;
  readonly setup: string;
  readonly deployment: unknown;
  readonly budget: string | null;
  readonly site: string | null;
}

const decode = (row: Row) =>
  Effect.gen(function* () {
    return {
      org: row.org,
      handle: row.handle,
      founder: row.founder,
      founderSafe: row.founder_safe,
      safe: row.safe,
      founding: row.founding,
      directors: yield* Schema.decodeUnknownEffect(People)(row.directors),
      threshold: row.threshold,
      members: yield* Schema.decodeUnknownEffect(People)(row.members),
      setup: row.setup === "ready" ? "ready" : "awaiting_signatures",
      deployment: yield* Schema.decodeUnknownEffect(Deployment)(row.deployment),
      budget: row.budget,
      site: row.site,
    } satisfies Organization;
  }).pipe(Effect.orDie);

const one = (rows: ReadonlyArray<Row>) =>
  Option.match(Arr.head(rows), {
    onNone: () => Effect.succeed(Option.none<Organization>()),
    onSome: (row) => Effect.asSome(decode(row)),
  });

export const byHandle = Effect.fn("organizations.byHandle")(function* (handle: string) {
  const sql = yield* PgClient.PgClient;
  return yield* one(yield* sql<Row>`select * from app.organizations where handle = ${handle}`);
});

export const byOrg = Effect.fn("organizations.byOrg")(function* (org: string) {
  const sql = yield* PgClient.PgClient;
  return yield* one(yield* sql<Row>`select * from app.organizations where org = ${org}`);
});

/** The founder's other founding whose setup is not finished, if any. */
export const unfinishedOf = Effect.fn("organizations.unfinished")(function* (founder: string) {
  const sql = yield* PgClient.PgClient;
  return yield* one(
    yield* sql<Row>`select * from app.organizations where founder = ${founder} and setup <> 'ready' order by founded_ms limit 1`,
  );
});

/** Adds a founded company: its own row and its line in the world's companies. */
export const insert = Effect.fn("organizations.insert")(function* (
  organization: Organization & { readonly name: string; readonly foundedMs: number },
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.organizations ${sql.insert({
    org: organization.org,
    handle: organization.handle,
    founder: organization.founder,
    founder_safe: organization.founderSafe,
    safe: organization.safe,
    founding: sql.json(organization.founding),
    directors: sql.json(organization.directors),
    threshold: organization.threshold,
    members: sql.json(organization.members),
    setup: organization.setup,
    deployment: sql.json(organization.deployment),
    founded_ms: organization.foundedMs,
  })}`;
  yield* sql`insert into app.companies ${sql.insert({
    org: organization.org,
    handle: organization.handle,
    name: organization.name,
    site_state: "creating",
    site_url: null,
  })}`;
});

export const markReady = Effect.fn("organizations.ready")(function* (org: string, budget: string | null) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.organizations set setup = 'ready', budget = ${budget} where org = ${org}`;
});

export const setSite = Effect.fn("organizations.site")(function* (
  org: string,
  site: string | null,
  state: "creating" | "ready" | "stopped",
) {
  const sql = yield* PgClient.PgClient;
  if (site !== null) yield* sql`update app.organizations set site = ${site} where org = ${org}`;
  yield* sql`update app.companies set site_state = ${state}, site_url = ${
    state === "ready" && site !== null ? `https://${site}` : null
  } where org = ${org}`;
});

/** A change to a member's officers, proposed to the Directors. */
export interface Change {
  readonly change: string;
  readonly org: string;
  readonly member: string;
  readonly permission: typeof Values.Permission.Type;
  readonly note: string | null;
  readonly proposal: string;
  readonly nonce: number;
}

export const insertChange = Effect.fn("organizations.change")(function* (change: Change) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.officer_changes ${sql.insert({ ...change, state: "proposed" })}`;
});

/** The change waiting for this member's Directors, if any. */
export const waitingFor = Effect.fn("organizations.waiting")(function* (org: string, member: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly change: string }>`
    select change from app.officer_changes where org = ${org} and member = ${member} and state = 'proposed' limit 1`;
  return Option.map(Arr.head(rows), (row) => row.change);
});

/** The next nonce of the company Safe a new proposal takes: after every proposal still waiting. */
export const nextNonce = Effect.fn("organizations.nonce")(function* (org: string, onChain: number) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ readonly top: number | null }>`
    select max(nonce) as top from app.officer_changes where org = ${org} and state = 'proposed'`;
  return row?.top === null || row?.top === undefined ? onChain : Math.max(onChain, row.top + 1);
});

export const changeOf = Effect.fn("organizations.changeOf")(function* (change: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<
    Change & { readonly state: string }
  >`select * from app.officer_changes where change = ${change}`;
  return Arr.head(rows);
});

export const markExecuted = Effect.fn("organizations.executed")(function* (change: string) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.officer_changes set state = 'executed' where change = ${change}`;
});
