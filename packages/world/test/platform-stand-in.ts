// What the platform's inventory reaches, stood in for: an in-memory shared state holding the platform, a hub and each
// world's record, and an HTTP client that answers as Neon's API (the project's branches, a branch's connection
// string, a branch deleted), the registry's SQL endpoint (its worlds and the platform's snapshots), each world's
// database (its facts and its record) and the hub's door (a snapshot's chain state forgotten). It answers only what
// the platform sends for these operations; anything else answers 599, a failure the test sees.
import { CurrentCall, CurrentOperator } from "@capxul/blueprint";
import { type CreatedResourceState, InMemoryService } from "alchemy/State";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { CHAIN_ID } from "../src/parts/chain/Anvil.ts";
import { CONTRACTS } from "../src/parts/chain/contracts.ts";
import { OPERATOR_TOKEN_ID } from "../src/parts/api/Api.ts";
import { ADMIN_TOKEN_ID, HUB_STACK } from "../src/things/cluster/values.ts";
import type { SnapshotRow } from "../src/account/store.ts";
import { SharedState } from "../src/stack/engine.ts";
import { beforeSaveAnswer, saveAnswer, type Saving } from "./save-stand-in.ts";
import { PLATFORM, STACK } from "../src/stack/names.ts";

export const FAR = "2099-01-01T00:00:00.000Z";
/** The world's clock, frozen at this instant. */
export const WORLD_MS = 1_800_000_000_000;

/** A world's database: its record's head, what was appended to it, and how its `world_created` says it was made. */
export interface Database {
  head: number;
  readonly appended: Array<{ readonly event: string; readonly carried: Record<string, unknown> }>;
  readonly born: { readonly grade: string; readonly parent: unknown } | null;
  /** Its companies, as `app.companies` holds them; none when left out. */
  readonly companies?: ReadonlyArray<{
    readonly org: string;
    readonly handle: string;
    readonly name: string;
    readonly site_state: string;
    readonly site_url: string | null;
  }>;
}

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly parent_id?: string;
}

/** What the stand-ins hold and saw. */
export interface Outside extends Saving {
  readonly claims: Array<{ readonly name: string; readonly owner: string }>;
  snapshots: Array<SnapshotRow>;
  branches: Array<Branch>;
  readonly databases: Record<string, Database>;
  /** Every snapshot whose chain state the hub's door was asked to forget. */
  readonly forgotten: Array<string>;
  /** A hub deployed before its door could forget a snapshot's chain state. */
  oldHub: boolean;
  /** Every request the local bench's site door was sent, by method and path. */
  readonly bench: Array<string>;
}

/** A world in the shared state: its record, as a world's stage records it. */
export const recordOf = (stage: string, owner: string, branch: string, status?: string, bench = "none") => ({
  world: stage,
  owner,
  expiresAt: FAR,
  forkedFrom: "nothing",
  coreUrl: `https://core-${stage}.test`,
  doorUrl: "http://hub.test",
  branch,
  bench,
  hub: "fleet",
  registeredUntil: FAR,
  ...(status === undefined ? {} : { status }),
});

const resource = (fqn: string, attr: Record<string, unknown>): CreatedResourceState => ({
  resourceType: "Test.Resource",
  namespace: undefined,
  fqn,
  logicalId: fqn,
  instanceId: fqn,
  providerVersion: 0,
  status: "created",
  downstream: [],
  bindings: [],
  props: {},
  attr,
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

const claimRow = (claim: Outside["claims"][number]) => ({ ...claim, expires_at: FAR, holder: "held" });

/** The registry's answer to one statement. */
const registry = (
  outside: Outside,
  query: string,
  params: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> | undefined => {
  const [first, second] = params;
  if (
    Str.startsWith("create")(query) ||
    Str.startsWith("alter table platform.")(query) ||
    Str.startsWith("insert into platform.calls")(query)
  )
    return [];
  if (Str.includes("from worlds where owner = $1")(query))
    return Arr.map(
      Arr.filter(outside.claims, (claim) => claim.owner === first),
      claimRow,
    );
  if (Str.includes("as snapshots from platform.snapshots")(query)) {
    const stages = Arr.isArray(first) ? first : [];
    return Arr.flatMap(Arr.dedupe(Arr.map(outside.snapshots, (row) => row.stage)), (stage) =>
      Arr.contains(stages, stage)
        ? [{ stage, snapshots: Arr.filter(outside.snapshots, (row) => row.stage === stage).length }]
        : [],
    );
  }
  if (Str.startsWith("delete from platform.snapshots where stage = $1 and snapshot = $2")(query)) {
    outside.snapshots = Arr.filter(outside.snapshots, (row) => !(row.stage === first && row.snapshot === second));
    return [];
  }
  if (Str.startsWith("insert into platform.snapshots")(query)) {
    outside.saving?.push(`kept ${String(second)}`);
    return [];
  }
  if (Str.includes("from platform.snapshots where stage = $1 and snapshot = $2")(query))
    return Arr.filter(outside.snapshots, (row) => row.stage === first && row.snapshot === second);
  if (Str.includes("from platform.snapshots where stage = $1 order by saved_at, snapshot")(query))
    return Arr.sort(
      Arr.filter(outside.snapshots, (row) => row.stage === first),
      Order.mapInput(Order.String, (row: SnapshotRow) => `${row.saved_at} ${row.snapshot}`),
    );
  return undefined;
};

/** A world's database's answer to one statement. An event's carried fields are its parameters, a name and a value. */
const world = (
  database: Database,
  query: string,
  params: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> | undefined => {
  if (Str.startsWith("select w.chain_id")(query))
    return [
      {
        chain_id: CHAIN_ID,
        contracts: CONTRACTS,
        mode: "frozen",
        frozen_at_ms: WORLD_MS,
        offset_ms: 0,
        head: database.head,
        migrations: "0004_documents",
        born: database.born,
      },
    ];
  if (Str.startsWith("select person")(query)) return [];
  if (Str.startsWith("select org")(query)) return database.companies ?? [];
  if (Str.startsWith("insert into app.events")(query)) {
    const pairs = Arr.chunksOf(params.slice(3, -1), 2);
    database.head += 1;
    database.appended.push({
      event: String(params[2]),
      carried: Rec.fromEntries(Arr.map(pairs, ([key, value]) => [String(key), value] as const)),
    });
    return [];
  }
  return undefined;
};

interface Statement {
  readonly query: string;
  readonly params: ReadonlyArray<unknown>;
}

const statementOf = (statement: unknown): Statement =>
  typeof statement === "object" && statement !== null && "query" in statement && "params" in statement
    ? { query: String(statement.query), params: Arr.isArray(statement.params) ? statement.params : [] }
    : { query: "", params: [] };

/** The answer to one statement, or to several as one transaction; one the stand-in does not know answers 599. */
const sql = (body: unknown, answer: (statement: Statement) => ReadonlyArray<unknown> | undefined) => {
  const queries =
    typeof body === "object" && body !== null && "queries" in body && Arr.isArray(body.queries) ? body.queries : null;
  const statements = queries === null ? [statementOf(body)] : Arr.map(queries, statementOf);
  const results = Arr.map(statements, (statement) => ({ statement, rows: answer(statement) }));
  const unknown = Arr.findFirst(results, (result) => result.rows === undefined);
  if (unknown._tag === "Some") return json({ message: `not stood in for: ${unknown.value.statement.query}` }, 599);
  const rows = Arr.map(results, (result) => ({ rows: result.rows ?? [] }));
  return queries === null ? json(rows[0]) : json({ results: rows });
};

const NEON = "/api/v2/projects/project";

const answer = (outside: Outside, request: Request, body: unknown): Response => {
  const url = new URL(request.url);
  const saved = saveAnswer(outside, url, request, body);
  if (saved !== undefined) return saved;
  if (url.hostname === "registry.db.test") return sql(body, (one) => registry(outside, one.query, one.params));
  if (Str.endsWith(".db.test")(url.hostname)) {
    const database = outside.databases[Str.slice(0, -".db.test".length)(url.hostname)];
    if (database === undefined) return json({ message: `no database ${url.hostname}` }, 404);
    return sql(body, (one) => world(database, one.query, one.params));
  }
  if (url.hostname === "console.neon.tech") {
    if (url.pathname === `${NEON}/connection_uri`)
      return json({ uri: `postgresql://owner:secret@${url.searchParams.get("branch_id")}.db.test/neondb` });
    if (url.pathname === `${NEON}/branches` && request.method === "GET") return json({ branches: outside.branches });
    const id = Str.slice(`${NEON}/branches/`.length)(url.pathname);
    if (request.method === "DELETE" && Arr.some(outside.branches, (branch) => branch.parent_id === id))
      return json({ message: "cannot delete branch that has children" }, 422);
    if (request.method === "DELETE") {
      outside.branches = Arr.filter(outside.branches, (branch) => branch.id !== id);
      return json({ branch: { id }, operations: [] });
    }
  }
  const forgotten = /^\/w-[a-z0-9-]+\.[0-9a-f]+\/chain\/snapshot\/([a-z0-9-]+)$/.exec(url.pathname);
  if (url.hostname === "hub.test" && request.method === "DELETE" && forgotten !== null) {
    if (outside.oldHub) return json({ error: "no such route" }, 404);
    outside.forgotten.push(forgotten[1] ?? "");
    return json({ forgot: forgotten[1] });
  }
  if (url.hostname === "bench.test" && request.method === "DELETE") {
    outside.bench.push(`DELETE ${url.pathname}`);
    // The point of a snapshot saved before points were kept is not there: the door says so.
    return Str.startsWith("/world/points/")(url.pathname)
      ? json({ refused: "point-not-found" }, 404)
      : json({ removed: true });
  }
  return json({ message: `not stood in for: ${request.method} ${request.url}` }, 599);
};

const client = (outside: Outside) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const web = yield* HttpClientRequest.toWeb(request);
      // A POST with no body (the hub's index stop and resume) is read as none.
      const body: unknown =
        web.method === "POST"
          ? yield* Effect.tryPromise(() => web.json()).pipe(Effect.orElseSucceed(() => null))
          : null;
      yield* beforeSaveAnswer(outside, web, body);
      return HttpClientResponse.fromWeb(request, answer(outside, web, body));
    }).pipe(Effect.orDie),
  );

/** What the platform's handlers need of their caller and their surroundings. */
export type Needs = SharedState | CurrentOperator | CurrentCall | HttpClient.HttpClient;

const config = ConfigProvider.fromEnvRecord({
  NEON_API_KEY: "neon",
  WORLD_BENCH_DOOR: "http://bench.test",
  WORLD_BENCH_KEY: "a-bench-key-for-the-test-only",
});

/**
 * Runs `program` as `operator` against the stand-ins, with `worlds` (stage: record) in the shared state beside the
 * platform and the hub `fleet`.
 */
export const runAs = <A, E>(
  outside: Outside,
  worlds: Record<string, unknown>,
  operator: string,
  program: Effect.Effect<A, E, Needs>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* InMemoryService(
        {
          [STACK]: {
            [PLATFORM]: { registry: resource("registry", { connectionUri: "postgresql://o:s@registry.db.test/db" }) },
            ...Rec.map(worlds, () => ({ [OPERATOR_TOKEN_ID]: resource(OPERATOR_TOKEN_ID, { text: "operator" }) })),
          },
          [HUB_STACK]: { fleet: { [ADMIN_TOKEN_ID]: resource(ADMIN_TOKEN_ID, { text: "admin" }) } },
        },
        {
          [STACK]: { [PLATFORM]: { projectId: "project" }, ...worlds },
          [HUB_STACK]: { fleet: { hub: "fleet", owner: "ops", expiresAt: FAR, doorUrl: "http://hub.test" } },
        },
      );
      return yield* program.pipe(
        Effect.provideService(SharedState, { store }),
        Effect.provideService(CurrentOperator, { operator }),
        Effect.provideService(CurrentCall, { traceId: Str.repeat(32)("a"), operation: "test" }),
        Effect.provideService(HttpClient.HttpClient, client(outside)),
        Effect.provideService(ConfigProvider.ConfigProvider, config),
      );
    }),
  );
