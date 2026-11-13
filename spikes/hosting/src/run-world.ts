// Entry: runs the world lifecycle three ways, to show that a world is destroyed whether its run passes, fails or
// times out, and that each run leaves a record behind. Usage: ./run.sh is not used here; see README ("Lifecycle").
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Alchemist from "alchemy/Alchemist";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { runInWorld, type World, type WorldSpec } from "./world.ts";

/** One SQL statement on the world's database, over Neon's HTTPS endpoint. Fails when the database refuses it. */
const sql = (world: World, query: string) =>
  Effect.gen(function* () {
    const uri = Redacted.value(world.database);
    const request = HttpClientRequest.post(`https://${new URL(uri).hostname}/sql`).pipe(
      HttpClientRequest.setHeader("Neon-Connection-String", uri),
      HttpClientRequest.bodyJsonUnsafe({ query, params: [] }),
    );
    const response = yield* HttpClient.execute(request);
    const body = (yield* response.json) as { rows?: unknown; message?: string };
    if (response.status !== 200) return yield* Effect.fail(new Error(`database refused: ${body.message ?? response.status}`));
    return body.rows;
  }).pipe(Effect.withSpan("sql"));

const spec = (name: string, more: Partial<WorldSpec> = {}): WorldSpec => ({
  name,
  owner: "spike",
  lifetime: "20 minutes",
  timeouts: { create: "2 minutes", use: "1 minute", destroy: "2 minutes" },
  ...more,
});

const passes = runInWorld(spec("lc-pass"), "records", (world) =>
  Effect.gen(function* () {
    yield* sql(world, "create schema app");
    yield* sql(world, "create table app.records(id int primary key, note text)");
    yield* sql(world, "insert into app.records values (1, 'a passing run')");
    return yield* sql(world, "select note from app.records");
  }),
);

const fails = runInWorld(spec("lc-fail"), "records", (world) => sql(world, "select * from app.no_such_table"));

const timesOut = runInWorld(spec("lc-slow", { timeouts: { create: "2 minutes", use: "3 seconds", destroy: "2 minutes" } }), "records", () =>
  Effect.sleep("30 seconds"),
);

const program = Effect.gen(function* () {
  for (const [label, run] of [["pass", passes], ["fail", fails], ["timeout", timesOut]] as const) {
    const [, exit] = yield* run;
    yield* Effect.log(`${label}: the use step ${exit._tag === "Success" ? "passed" : "did not pass"}`);
  }
});

program.pipe(
  Effect.provide(Layer.mergeAll(Alchemist.layer(), BunFileSystem.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
