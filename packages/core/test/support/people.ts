// The harness of the people operations' test (test/people-sql.test.ts): Core's groups served in this process against
// a real Postgres with Core's migrations applied, with the world's cast, a frozen clock and Northwind founded as the
// starting world `founded` keeps it (dana and eli its Directors, sam and pat its members), written straight into the
// database. No chain and no bench: the people operations reach neither.
import { CREDENTIAL_HEADER, PERSON_HEADER, TRACE_HEADER, WorldRpcs } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Cast } from "../../src/cast/Cast.ts";
import { WorldChain } from "../../src/chain/WorldChain.ts";
import { CoreIdentity, Served, SiteDoor, SqlSpanSink } from "../../src/door.ts";
import { millisOf, siteOpsLive } from "../../src/site-ops/door.ts";

export const ORG = "org_northwind1";
export const START = millisOf("2026-11-13T09:00:00.000Z");

/** The cast: olga belongs to no company and has no Safe, so a grant to her stops before the chain. */
const CAST = [
  { person: "dana", safe: "0x00000000000000000000000000000000000000d1" },
  { person: "eli", safe: "0x00000000000000000000000000000000000000e1" },
  { person: "sam", safe: "0x0000000000000000000000000000000000000051" },
  { person: "pat", safe: null },
  { person: "olga", safe: null },
];

/** Core's groups with every service the people operations need, on the database at `url`. */
export const core = (url: string) =>
  Served.pipe(
    Layer.provide(SqlSpanSink),
    Layer.provide(
      Layer.succeed(CoreIdentity, {
        world: "town",
        owner: "ci",
        doorToken: Redacted.make("door-token"),
        platformToken: Redacted.make("platform-token"),
      }),
    ),
    Layer.provideMerge(siteOpsLive({})),
    Layer.provideMerge(
      Layer.mergeAll(
        WorldChain.fromEnv({}),
        SiteDoor.fromEnv({}).pipe(Layer.provide(FetchHttpClient.layer)),
        Cast.fromDatabase,
      ),
    ),
    Layer.provideMerge(PgClient.layer({ url: Redacted.make(url) })),
  );

/**
 * A fresh `app` schema, each migration (its text, in name order) applied as the runner applies it, comment lines
 * dropped and one statement at a time; then the cast, the clock and Northwind.
 */
export const fresh = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql.unsafe("drop schema if exists app cascade");
    for (const text of files) {
      const lines = Arr.filter(Str.split(text, "\n"), (line) => !Str.startsWith("--")(Str.trimStart(line)));
      for (const statement of Arr.filter(Arr.map(Str.split(Arr.join(lines, "\n"), ";"), Str.trim), Str.isNonEmpty))
        yield* sql.unsafe(statement);
    }
    yield* Effect.forEach(
      CAST,
      (each, position) =>
        sql`insert into app.cast ${sql.insert({
          person: each.person,
          position,
          email: `${each.person}@cast.test`,
          signer: `0x${Str.padStart(40, "0")(String(position + 1))}`,
          safe: each.safe,
        })}`,
      { discard: true },
    );
    yield* sql`insert into app.clock (mode, frozen_at_ms, offset_ms) values ('frozen', ${START}, 0)`;
    yield* sql`insert into app.organizations
    (org, handle, founder, founder_safe, safe, founding, directors, threshold, members, setup, deployment, founded_ms)
    values (${ORG}, 'northwind', 'dana', ${CAST[0]?.safe ?? ""}, '0x00000000000000000000000000000000000000c0',
      ${sql.json({})}, ${sql.json(["dana", "eli"])}, 2, ${sql.json(["sam", "pat"])}, 'ready',
      ${sql.json({
        boardTopHat: "1",
        directorHat: "2",
        officerHats: { "manage-books": "3", "issue-invoices": "4", "manage-people": "5" },
        gate: "0x00000000000000000000000000000000000000a1",
        roles: "0x00000000000000000000000000000000000000a2",
      })}, ${START})`;
  });

type Client = RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof WorldRpcs>>;

/** One call through the world's door as `person` (none: the world's owner), under trace `n`: how it ended. */
export const as = <A, E, R>(
  n: number,
  person: string | undefined,
  use: (client: Client, options: { readonly headers: Readonly<Record<string, string>> }) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const trace = Str.padStart(32, "0")(n.toString(16));
      const headers = {
        [CREDENTIAL_HEADER]: "Bearer door-token",
        [TRACE_HEADER]: `00-${trace}-${Str.repeat(16)("1")}-01`,
        ...(person === undefined ? {} : { [PERSON_HEADER]: person }),
      };
      const client = yield* RpcTest.makeClient(WorldRpcs, { flatten: true });
      return { exit: yield* Effect.exit(use(client, { headers })), trace };
    }),
  );

/** What a call answered, or its failure as a defect of the test. */
export const answer = <A, E>(ended: { readonly exit: Exit.Exit<A, E> }) =>
  Exit.isSuccess(ended.exit) ? Effect.succeed(ended.exit.value) : Effect.die(ended.exit.cause.pipe(Cause.pretty));

/** The refusal a call answered, as its tag and fields, or a defect of the test when it did not refuse. */
export const refusal = <A, E>(ended: { readonly exit: Exit.Exit<A, E> }) =>
  Exit.isFailure(ended.exit)
    ? ended.exit.cause.pipe(
        Cause.findErrorOption,
        Effect.fromOption,
        Effect.map((error): Readonly<Record<string, unknown>> => (Predicate.isObject(error) ? { ...error } : {})),
        Effect.orDie,
      )
    : Effect.die("it did not refuse");

/** The events a call recorded, by its trace, each with what it carried. */
export const eventsOf = (trace: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql<{ readonly event: string; readonly payload: unknown }>`
      select event, payload from app.events where trace_id = ${trace} order by id`;
  });

/** How many entries the world's record holds. */
export const recordSize = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ readonly n: string }>`select count(*)::text as n from app.events`;
  return Number(row?.n);
});
