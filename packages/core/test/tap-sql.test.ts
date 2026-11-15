// The tap against a real Postgres with its migration applied (migrations/0010_core_telemetry_otlp.sql): what one request
// exports is written in one statement after the flush, a row per trace id and signal, traces and logs only, the body
// as jsonb holding the call's operation span and its log. Runs only with CAPXUL_TEST_DATABASE (a throwaway Postgres);
// CI has none, so it skips.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as SQL from "@alchemy.run/sql/Postgres";
import * as PgClient from "@effect/sql-pg/PgClient";
import { WorldRpcs } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as Tracer from "effect/Tracer";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as Rpc from "effect/rpc/Rpc";
import { SpanSink } from "../src/telemetry/sink.ts";
import type { KeptSpan } from "../src/telemetry/spans.ts";

/** Core's migrations, where the package keeps them. */
const migrations = new URL("../migrations/", import.meta.url);
import { apiTelemetry, type Held, transport, writeTap } from "../src/telemetry/export.ts";
import { CallTracer, measured } from "../src/telemetry/spans.ts";

const url = process.env["CAPXUL_TEST_DATABASE"];

/** A tap row as this test reads it: its signal and how many spans and log records its body holds. */
const Rows = Schema.Array(Schema.Struct({ signal: Schema.String, spans: Schema.Int, logs: Schema.Int }));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a declared Rpc names its middlewares by their own types, which the general `AnyWithProps` a middleware is handed cannot follow
const rpc = Option.getOrThrow(Arr.head([...WorldRpcs.requests.values()])) as unknown as Rpc.AnyWithProps;

test(
  "one request's traces and logs land in telemetry.otlp in one write, by trace id",
  { skip: url === undefined },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sql = Context.get(
          yield* Layer.build(SQL.PostgresLayer({ url: Effect.succeed(Redacted.make(url ?? "")), prepare: false })),
          PgClient.PgClient,
        );
        yield* sql.unsafe("drop schema if exists telemetry cascade");
        const text = readFileSync(`${fileURLToPath(migrations.href)}0010_core_telemetry_otlp.sql`, "utf8");
        const lines = Arr.filter(Str.split(text, "\n"), (line) => !Str.startsWith("--")(Str.trimStart(line)));
        for (const statement of Arr.filter(Arr.map(Str.split(Arr.join(lines, "\n"), ";"), Str.trim), Str.isNonEmpty))
          yield* sql.unsafe(statement);
        const held: Array<Held> = [];
        const kept: Array<KeptSpan> = [];
        const client = transport(
          Option.none(),
          Option.some((each: Held) => void held.push(each)),
        );
        const scope = yield* Scope.make();
        const built = yield* Layer.buildWithScope(
          apiTelemetry({ baseUrl: "https://collector", revision: "abc123" }).pipe(
            Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
          ),
          scope,
        );
        const sink = SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) });
        yield* measured(
          sink,
          { colo: Option.none() },
          { rpc, headers: Headers.empty },
          Effect.logInfo("refused: x"),
        ).pipe(
          Effect.provideService(CallTracer, Option.some(Context.get(built, Tracer.Tracer))),
          Effect.provide(Context.omit(Tracer.Tracer)(built)),
        );
        yield* Scope.close(scope, Exit.void);
        yield* writeTap(sql, held);
        const traceId = kept[0]?.traceId ?? "";
        const rows = yield* sql`
          select signal,
            jsonb_array_length(coalesce(jsonb_path_query_array(body, '$.resourceSpans[*].scopeSpans[*].spans[*]'), '[]')) as spans,
            jsonb_array_length(coalesce(jsonb_path_query_array(body, '$.resourceLogs[*].scopeLogs[*].logRecords[*]'), '[]')) as logs
          from telemetry.otlp where trace_id = ${traceId} order by signal`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
        );
        assert.deepEqual(
          Arr.map(rows, (row) => row.signal),
          ["logs", "traces"],
        );
        assert.equal(rows[1]?.spans, kept.length);
        assert.ok((rows[0]?.logs ?? 0) >= 1, "the call's log was not kept");
        const metrics = yield* sql`select count(*)::int as n from telemetry.otlp where signal = 'metrics'`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ n: Schema.Int })))),
        );
        assert.equal(metrics[0]?.n, 0);
      }).pipe(Effect.scoped),
    ),
);
