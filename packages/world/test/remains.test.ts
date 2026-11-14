// A take-down whose sites cannot be removed, or whose destroy fails half-way, keeps the world's record, so `world list`
// and the sweeper still see it and the next sweep finishes the job (src/lifecycle/world.ts, `keepRemains`).
//
// It runs the real take-down, list and sweep against an in-memory state store, with Alchemy's real destroy of the
// stage (which deletes the stage's record, the cause of the bug this covers), and a stand-in for everything reached
// over HTTP: the local bench's site door, which can be made to answer as Cloudflare does while the bench's tunnel is
// down (530, error 1033), Neon's API, the registry's SQL endpoint and Cloudflare's image registry.
import * as assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Interaction from "alchemy/Interaction";
import { type CreatedResourceState, InMemoryService } from "alchemy/State";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { list } from "../src/lifecycle/operations.ts";
import { Timeouts } from "../src/lifecycle/spec.ts";
import { makeStopwatch } from "../src/lifecycle/steps.ts";
import { sweep } from "../src/lifecycle/sweep.ts";
import { takeDown } from "../src/lifecycle/world.ts";
import { recordedOutput, SharedState } from "../src/stack/engine.ts";
import { PLATFORM, STACK } from "../src/stack/names.ts";

const WORLD = "w-gone";
const DOOR = "http://bench.test";
const DATABASE = "postgresql://owner:secret@registry.db.test/neondb";

/** What the stand-ins hold and saw. */
interface Outside {
  benchUp: boolean;
  neonUp: boolean;
  sites: Array<string>;
  /** Every site the door removed. */
  removed: Array<string>;
  /** Every statement sent to the registry's database. */
  statements: Array<{ readonly query: string; readonly params: ReadonlyArray<unknown> }>;
}

let outside: Outside;
let outputs: Record<string, Record<string, unknown>>;
let resources: Parameters<typeof InMemoryService>[0];

beforeEach(() => {
  outside = { benchUp: true, neonUp: true, sites: ["northwind-gone"], removed: [], statements: [] };
  // A world made on the local bench, live for hours yet, as the runner's template world is when its run ends.
  outputs = {
    [STACK]: {
      [PLATFORM]: { projectId: "project" },
      [WORLD]: {
        world: WORLD,
        owner: "ci",
        expiresAt: "2099-01-01T00:00:00.000Z",
        forkedFrom: "nothing",
        bench: "local",
        branch: "br-gone",
      },
    },
  };
  const registry: CreatedResourceState = {
    resourceType: "Neon.Branch",
    namespace: undefined,
    fqn: "registry",
    logicalId: "registry",
    instanceId: "registry",
    providerVersion: 0,
    status: "created",
    downstream: [],
    bindings: [],
    props: {},
    attr: { connectionUri: DATABASE },
  };
  resources = { [STACK]: { [PLATFORM]: { registry } } };
});

const Statement = Schema.Struct({ query: Schema.String, params: Schema.Array(Schema.Unknown) });
/** What the registry's SQL endpoint is sent: one statement, or several as one transaction (src/database/sql.ts). */
const SqlBody = Schema.Union([Statement, Schema.Struct({ queries: Schema.Array(Statement) })]);

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** The answer of whatever the request is for; anything not stood in for is a failure the test sees. */
const answer = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.origin === DOOR) {
    if (!outside.benchUp) return new Response("error code: 1033", { status: 530 });
    if (request.method === "DELETE" && url.pathname === "/world") {
      const removed = Arr.map(outside.sites, (site) => ({ site, ms: 5 }));
      outside.removed.push(...outside.sites);
      outside.sites = [];
      return json({ removed });
    }
    if (request.method === "GET" && url.pathname === "/world")
      return json({
        world: "gone",
        sites: Arr.map(outside.sites, (site) => ({
          site,
          world: "gone",
          company: null,
          state: "ready",
          ms: null,
          steps: [],
          error: null,
        })),
      });
  }
  if (url.hostname === "registry.db.test" && url.pathname === "/sql") {
    const body: unknown = await request.json();
    if (!Schema.is(SqlBody)(body)) return json({ message: "not a statement" }, 400);
    if ("queries" in body) {
      outside.statements.push(...body.queries);
      return json({ results: Arr.map(body.queries, () => ({ rows: [] })) });
    }
    outside.statements.push(body);
    return json({ rows: [] });
  }
  if (url.hostname === "console.neon.tech" && url.pathname === "/api/v2/projects/project/branches")
    // Neon's refusal comes after the stack's destroy has ended, as it does for real: a destroy takes seconds.
    return outside.neonUp
      ? json({ branches: [] })
      : new Promise((done) => setTimeout(() => done(json({ message: "Neon is down" }, 500)), 300));
  if (url.hostname === "api.cloudflare.com" && Str.endsWith("/credentials")(url.pathname))
    return json({ result: { password: "registry" } });
  if (url.hostname === "registry.cloudflare.com" && url.pathname === "/v2/_catalog") return json({ repositories: [] });
  return json({ message: `not stood in for: ${request.method} ${request.url}` }, 599);
};

const standIn = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.flatMap((web) => Effect.promise(() => answer(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  ),
);

const config = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({
    WORLD_BENCH_DOOR: DOOR,
    WORLD_BENCH_KEY: "a-bench-key-for-the-test-only",
    NEON_API_KEY: "neon",
    NEON_ORG_ID: "org",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "cloudflare",
  }),
);

/** Runs `program` against the stand-ins and an in-memory state store that holds `outputs` and `resources`. */
const run = <A, E>(program: Effect.Effect<A, E, SharedState | Layer.Success<typeof services>>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inner = yield* InMemoryService(resources, outputs);
      // The shared store lists a stage that holds only a record, as one recorded before its deploy; the in-memory
      // store lists only stages that hold resources, so this one lists both.
      const store = {
        ...inner,
        listStages: (stack: string) =>
          Effect.map(inner.listStages(stack), (stages) => [...new Set([...stages, ...Rec.keys(outputs[stack] ?? {})])]),
      };
      return yield* program.pipe(Effect.provideService(SharedState, { store }));
    }).pipe(Effect.provide(services)),
  );

const services = Layer.mergeAll(
  Alchemist.layer(),
  Interaction.layerNonInteractive({ stdout: process.stderr }),
  standIn,
  config,
).pipe(Layer.provideMerge(NodeServices.layer));

const takeDownOnce = Effect.gen(function* () {
  const watch = yield* makeStopwatch(yield* Timeouts);
  return yield* Effect.exit(takeDown(WORLD, watch));
});

const released = () =>
  Arr.some(
    outside.statements,
    (statement) => Str.startsWith("delete from worlds")(statement.query) && statement.params[0] === WORLD,
  );

describe("a take-down that does not finish", () => {
  test("a take-down that goes through leaves no record and gives the name back", () =>
    run(
      Effect.gen(function* () {
        assert.ok(yield* takeDownOnce.pipe(Effect.map(Exit.isSuccess)));
        assert.equal(yield* recordedOutput(WORLD), undefined);
        assert.deepEqual(outside.removed, ["northwind-gone"]);
        assert.ok(released());
      }),
    ));

  test("its sites not removed: the world stays listed and due, and the next sweep removes them", () =>
    run(
      Effect.gen(function* () {
        outside.benchUp = false;
        const gone = yield* takeDownOnce;
        assert.ok(gone.pipe(Exit.isFailure));
        // The record Alchemy's destroy deleted is written again, due at once, its bench and owner kept.
        const kept = yield* recordedOutput(WORLD);
        assert.ok(kept !== undefined);
        assert.partialDeepStrictEqual(kept, { world: WORLD, owner: "ci", bench: "local", status: "unsite failed" });
        assert.ok(!released(), "the name is kept until the sites are gone");

        const listed = yield* list;
        assert.deepEqual(
          Arr.map(listed, (world) => [world.world, world.state, world.status]),
          [[WORLD, "expired", "unsite failed"]],
        );
        const looked = yield* sweep({ dryRun: true });
        assert.deepEqual(
          Arr.map(looked.worlds, (world) => [world.world, world.verdict]),
          [[WORLD, "expired, would be destroyed"]],
        );

        // While the bench is still down, a sweep fails and the record stays for the one after.
        const failed = yield* sweep();
        assert.deepEqual(
          Arr.map(failed.worlds, (world) => [world.world, world.verdict]),
          [[WORLD, "destroy failed"]],
        );
        assert.match(failed.worlds[0]?.detail ?? "", /HTTP 530/);
        assert.ok((yield* recordedOutput(WORLD)) !== undefined);

        outside.benchUp = true;
        const swept = yield* sweep();
        assert.deepEqual(
          Arr.map(swept.worlds, (world) => [world.world, world.verdict]),
          [[WORLD, "destroyed"]],
        );
        assert.deepEqual(outside.removed, ["northwind-gone"]);
        assert.deepEqual(outside.sites, []);
        assert.equal(yield* recordedOutput(WORLD), undefined);
        assert.ok(released());
        assert.deepEqual(yield* list, []);
      }),
    ));

  test("its destroy failed after Alchemy deleted the stage's record: the world stays listed and due", () =>
    run(
      Effect.gen(function* () {
        outside.neonUp = false;
        assert.ok(yield* takeDownOnce.pipe(Effect.map(Exit.isFailure)));
        assert.partialDeepStrictEqual(yield* recordedOutput(WORLD), {
          world: WORLD,
          owner: "ci",
          status: "destroy failed",
        });
        assert.ok(!released());
        assert.deepEqual(
          Arr.map(yield* list, (world) => [world.world, world.state, world.status]),
          [[WORLD, "expired", "destroy failed"]],
        );

        outside.neonUp = true;
        const swept = yield* sweep();
        assert.deepEqual(
          Arr.map(swept.worlds, (world) => [world.world, world.verdict]),
          [[WORLD, "destroyed"]],
        );
        assert.equal(yield* recordedOutput(WORLD), undefined);
        assert.ok(released());
      }),
    ));
});
