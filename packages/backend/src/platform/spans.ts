import { readFileSync } from "node:fs";
import { Cause, Exit, Option, Schema, Tracer } from "effect";
import type { Sql } from "./db.ts";

export interface SpanContext {
  runId: string;
  worldId: string;
  codeVersion: string;
  callId: string;
  capxul_env: "devnet" | "shared-world" | "development" | "staging" | "production" | "unknown";
  producer: string;
  org_id: string | null;
  actor: string | null;
}

// Deliberately not a free-form attributes bag: RPC arguments, provider errors and results never enter storage.
const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.:+-]{1,200}$/));
const Attributes = Schema.Struct({
  ownerKind: Schema.optionalKey(Schema.Literals(["person", "organization"])),
  ownerId: Schema.optionalKey(Identifier),
  referenceKind: Schema.optionalKey(Schema.Literals(["payment", "movement"])),
  referenceId: Schema.optionalKey(Identifier),
});
const Context = Schema.Struct({
  runId: Identifier, worldId: Identifier, codeVersion: Identifier, callId: Identifier,
  capxul_env: Schema.Literals(["devnet", "shared-world", "development", "staging", "production", "unknown"]),
  producer: Identifier, org_id: Schema.NullOr(Identifier), actor: Schema.NullOr(Identifier),
});

export interface CompletedSpan extends SpanContext {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  startedAt: number;
  endedAt: number;
  outcome: "success" | "error";
  errorCode: string | null;
  attributes: typeof Attributes.Type;
}

export async function migrateSpans(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./spans.sql", import.meta.url), "utf8"));
}

/** One collector per request, using a worker pool outside the business transaction. Install with Effect.withTracer. */
export function spanCollector(sql: Sql, context: SpanContext, errorCodes: readonly string[]) {
  const envelope = Schema.decodeUnknownSync(Context)(context);
  const codes = new Set(errorCodes);
  const pending: Promise<void>[] = [];
  let failed = false;
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (time, exit) => {
        if (span.status._tag === "Ended") return;
        end(time, exit);
        try {
          Schema.decodeUnknownSync(Identifier)(span.name);
          const attributes = Schema.decodeUnknownSync(Attributes)(Object.fromEntries(span.attributes));
          const reason = Exit.isFailure(exit) ? exit.cause.reasons.find((r) => Cause.isFailReason(r) || Cause.isDieReason(r)) : undefined;
          const error = reason && (Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : undefined);
          const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
          const row: CompletedSpan = {
            ...envelope, name: span.name, traceId: span.traceId, spanId: span.spanId,
            // An all-zero external parent carries only the caller's trace id: the span is that trace's root.
            parentSpanId: [Option.getOrUndefined(span.parent)?.spanId].find((id) => id && !/^0+$/.test(id)) ?? null,
            startedAt: Number(options.startTime) / 1_000_000, endedAt: Number(time) / 1_000_000,
            outcome: Exit.isSuccess(exit) ? "success" : "error",
            errorCode: Exit.isSuccess(exit) ? null : typeof code === "string" && codes.has(code) ? code : "INTERNAL_ERROR",
            attributes,
          };
          // Completion is asynchronous; capture failures immediately, report them only through explicit flush.
          pending.push(sql.query("insert into app.completed_spans (run_id,world_id,trace_id,span_id,event) values ($1,$2,$3,$4,$5::jsonb)",
            [envelope.runId, envelope.worldId, span.traceId, span.spanId, JSON.stringify(row)])
            .then(() => undefined, () => { failed = true; }));
        } catch { failed = true; }
      };
      return span;
    },
  });
  return {
    tracer,
    /** Await after the request's Effect has finished, including on failure, before reading proof. Does not commit source SQL. */
    async flush(): Promise<void> {
      await Promise.all(pending.splice(0));
      if (failed) throw new Error("SPAN_RETENTION_FAILED");
    },
  };
}

/** Diagnostic worker read, not a public tenant endpoint or app.records proxy. Exact run/world/trace isolation. */
export async function readSpans(sql: Sql, selection: { runId: string; worldId: string; traceId: string }): Promise<CompletedSpan[]> {
  return (await sql.query("select event from app.completed_spans where run_id=$1 and world_id=$2 and trace_id=$3 order by (event->>'startedAt')::numeric,span_id",
    [selection.runId, selection.worldId, selection.traceId])).rows.map((row) => row.event);
}
