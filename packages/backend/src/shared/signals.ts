// Shared signals in Core (signals.wide-rows, signals.world-rows): one rpc span and one operation_row per request,
// one process_row per process run that did work or failed, process_queue_age samples, and the two server-wide operator
// alerts (signals.operator-watch) evaluated from those rows in the world's own time.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { Effect, Tracer } from "effect";
import { worldNow } from "../devnet/door.ts";
import type { Database, Sql } from "../platform/db.ts";
import { spanCollector, type SpanContext } from "../platform/spans.ts";

export async function migrateSignals(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./signals.sql", import.meta.url), "utf8"));
}

type Failure = { code: string; mode: string; retryable: boolean } | null;
type Surface = "cli" | "sdk" | "react" | "mcp" | "http" | "site";
const SURFACES: readonly Surface[] = ["cli", "sdk", "react", "mcp", "http", "site"];
const ID = /^[a-zA-Z0-9_.:+-]{1,200}$/;
/** Codes an operation answers on purpose: a refusal, never a defect (signals.operator-watch counts only defects). */
const REFUSED = new Set(["INVALID_INPUT", "IDEMPOTENCY_CONFLICT", "IDENTITY_CONFLICT", "NOT_FOUND", "FORBIDDEN", "WRONG_STATE",
  "ROLE_PERMISSION_DENIED", "SNAPSHOT_PAUSED", "UNAUTHENTICATED"]);

/** The error vocabulary a span may name; any other failure is kept as INTERNAL_ERROR. */
const ERROR_CODES = [...REFUSED, "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID", "TRANSACTION_FAILED", "WRONG_ENVIRONMENT", "WORK_DIED"];

/** The world a Core serves, and whether it is paused for a snapshot: a paused world writes nothing, so a snapshot's
 * cut stays its cut. The rest of the envelope (signals.envelope) comes from CAPXUL_CODE_VERSION and CAPXUL_ENV; an
 * unset value is the loud defect marker "unknown", never a guess. */
export type SignalsConfig = { world: string; paused: () => boolean };
const ENVS: readonly SpanContext["capxul_env"][] = ["devnet", "shared-world", "development", "staging", "production"];

type Call = { tracer: Tracer.Tracer; span: Tracer.AnySpan; dbMs: number; chainCalls: number };
const current = new AsyncLocalStorage<Call>();

/** Database time spent inside one request, measured as real elapsed time (allowed by time.no-direct-reads). */
export function noteDb(ms: number): void { const c = current.getStore(); if (c) c.dbMs += ms; }
/** One chain read or send made on behalf of the current request. */
export function noteChainCall(): void { const c = current.getStore(); if (c) c.chainCalls++; }
/** Run work as a child span of the current request's span; outside a request it runs unchanged. */
export function childSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  const c = current.getStore();
  if (!c) return run();
  return Effect.runPromise(Effect.tryPromise({ try: run, catch: (e) => e })
    .pipe(Effect.withSpan(name, { parent: c.span }), Effect.withTracer(c.tracer)));
}

/** The caller's trace: W3C traceparent first, then the blueprint's x-capxul-trace, else a new one. */
export function traceOf(headers: IncomingMessage["headers"]): { traceId: string; parentSpanId: string | null } {
  const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(String(headers["traceparent"] ?? ""));
  if (parent && !/^0+$/.test(parent[1]!) && !/^0+$/.test(parent[2]!)) return { traceId: parent[1]!, parentSpanId: parent[2]! };
  const own = String(headers["x-capxul-trace"] ?? "");
  return { traceId: /^[0-9a-f]{32}$/.test(own) ? own : randomBytes(16).toString("hex"), parentSpanId: null };
}

/** A path's rpc id: /organizations/setups/begin is organizations.setups.begin; its first segment is the concept. */
export function rpcOf(pathname: string): { rpc: string; concept: string } {
  const parts = pathname.split("/").filter(Boolean).map((p) => p.replace(/[^a-zA-Z0-9_-]/g, ""));
  const rpc = parts.join(".").slice(0, 120) || "root";
  return { rpc, concept: parts[0] || "core" };
}

const failureOf = (status: number, code: string | null): { outcome: "ok" | "refused" | "failed"; failure: Failure } =>
  status < 400 ? { outcome: "ok", failure: null }
  : status < 500 || (code && REFUSED.has(code)) ? { outcome: "refused", failure: { code: code ?? `HTTP_${status}`, mode: "refusal", retryable: false } }
  : { outcome: "failed", failure: { code: code ?? "INTERNAL_ERROR", mode: "defect", retryable: true } };

async function insertRow(db: Database, body: "operation_row" | "process_row" | "process_queue_age", trace: string | null, org: string | null, attributes: unknown) {
  const at = await worldNow(db.worker);
  await db.worker.query("insert into app.signal_rows (body,at,trace_id,org_id,attributes) values ($1,$2,$3,$4,$5::jsonb)",
    [body, at, trace, org, JSON.stringify(attributes)]);
}

export function createSignals(db: Database, config: SignalsConfig) {
  // Every transaction a request opens counts toward its db_ms.
  const transaction = db.transaction.bind(db);
  db.transaction = async <T>(...args: Parameters<typeof transaction<T>>): Promise<T> => {
    const started = performance.now();
    try { return await transaction(...args); } finally { noteDb(performance.now() - started); }
  };
  const codeVersion = process.env["CAPXUL_CODE_VERSION"] || "unknown";
  const env = ENVS.find((e) => e === process.env["CAPXUL_ENV"]) ?? "unknown";
  const spanSql: Sql = { query: ((...args: Parameters<Sql["query"]>) => config.paused() ? Promise.resolve({ rows: [] }) : (db.worker.query as any)(...args)) as Sql["query"] };
  /** Wrap one HTTP request: its rpc span (child of the caller's trace), then its operation_row. Never alters the answer. */
  async function request(req: IncomingMessage, res: ServerResponse, handle: () => Promise<void>): Promise<void> {
    if (config.paused()) return handle();
    const url = new URL(req.url ?? "/", "http://core");
    const { rpc, concept } = rpcOf(url.pathname);
    const trace = traceOf(req.headers);
    // Every event the request enqueues carries this trace, including one the caller did not name.
    req.headers["x-capxul-trace"] = trace.traceId;
    const run = String(req.headers["x-capxul-run"] ?? "");
    const surfaceHeader = String(req.headers["x-capxul-surface"] ?? "") as Surface;
    const surface = SURFACES.includes(surfaceHeader) ? surfaceHeader : "http";
    let code: string | null = null;
    const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
    res.end = ((...args: unknown[]) => {
      // Only the leading error code is kept; messages and results never enter a span or a row.
      if (res.statusCode >= 400 && (typeof args[0] === "string" || Buffer.isBuffer(args[0])))
        code = /"error":"([A-Z][A-Z0-9_]{1,60})(?:[:"])/.exec(String(args[0]))?.[1] ?? null;
      return end(...args);
    }) as typeof res.end;
    const collector = spanCollector(spanSql, { runId: ID.test(run) ? run : "core", worldId: config.world, codeVersion,
      callId: randomBytes(8).toString("hex"), capxul_env: env, producer: "backend", org_id: null, actor: null }, ERROR_CODES);
    // A caller that names only a trace id gets a root span in that trace (an all-zero parent id is no parent).
    const parent = Tracer.externalSpan({ traceId: trace.traceId, spanId: trace.parentSpanId ?? "0".repeat(16) });
    const started = performance.now();
    let call: Call | undefined;
    await Effect.runPromiseExit(Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      call = { tracer: collector.tracer, span, dbMs: 0, chainCalls: 0 };
      yield* Effect.promise(() => current.run(call!, handle));
      if (res.statusCode >= 400) yield* Effect.fail({ code: failureOf(res.statusCode, code).failure!.code });
    }).pipe(Effect.withSpan(`rpc.${rpc}`, { parent }), Effect.withTracer(collector.tracer)));
    const duration = performance.now() - started;
    const { outcome, failure } = failureOf(res.statusCode, code);
    if (config.paused()) return;
    try {
      await collector.flush();
      await insertRow(db, "operation_row", trace.traceId, null, { rpc, concept, surface, outcome, failure,
        duration_ms: Math.round(duration), db_ms: Math.round(call?.dbMs ?? 0), chain_calls: call?.chainCalls ?? 0, session_id: null });
    } catch (error) { console.error(`Core signals ${rpc}: ${(error as Error).message}`); }
  }

  /** One durable process run. A run returns true when it did work; an idle poll writes no row, a throw is a failed run. */
  async function processRun(run: { workflow: string; concept: string; trigger: "transition" | "chain-event" | "timer" | "cron" | "signal"; key: string; org?: string },
    work: () => Promise<boolean | void>): Promise<void> {
    const started = performance.now();
    let outcome: "done" | "failed" = "done", failure: Failure = null, did = false;
    try { did = (await work()) === true; }
    catch (error) {
      outcome = "failed";
      failure = { code: /^([A-Z][A-Z0-9_]{1,60})(?::|$)/.exec(String((error as Error)?.message))?.[1] ?? "INTERNAL_ERROR", mode: "defect", retryable: true };
      throw error;
    } finally {
      if ((did || outcome === "failed") && !config.paused())
        await insertRow(db, "process_row", null, run.org ?? null, { workflow: run.workflow, concept: run.concept, trigger: run.trigger,
          idempotency_key: run.key, outcome, failure, queue_wait_ms: null, duration_ms: Math.round(performance.now() - started), resumes: 0 })
          .catch((error) => console.error(`Core signals ${run.workflow}: ${error.message}`));
    }
  }

  /** Where each process's due runs are read: the oldest due instant (world ms) and how many are due at world time now. */
  type QueueSource = { workflow: string; read: (sql: Sql, now: number) => Promise<{ oldestDue: number | null; dueRuns: number }> };
  const sources: QueueSource[] = [];
  async function queueAges() {
    const now = await worldNow(db.worker);
    return Promise.all(sources.map(async (s) => {
      const { oldestDue, dueRuns } = await s.read(db.worker, now);
      return { workflow: s.workflow, due_runs: dueRuns, age_ms: oldestDue === null ? 0 : Math.max(0, now - oldestDue) };
    }));
  }
  /** Sampled every minute: one process_queue_age row per process, then rows past a fixed bound are dropped. */
  async function sampleQueues(): Promise<void> {
    if (config.paused()) return;
    for (const q of await queueAges()) await insertRow(db, "process_queue_age", null, null, { workflow: q.workflow, due_runs: q.due_runs, value: q.age_ms });
    await db.worker.query("delete from app.signal_rows where id < (select max(id) - 200000 from app.signal_rows)");
  }

  /** rpc_failing and process_stuck, from the rows, over the world's own time windows. */
  async function operatorAlerts() {
    const now = await worldNow(db.worker);
    const rpcs = (await db.worker.query(`select attributes->>'rpc' as rpc, count(*)::int as calls,
        count(*) filter (where attributes->>'outcome'='failed')::int as failures
      from app.signal_rows where body='operation_row' and at >= $1 group by 1 order by 3 desc, 1`, [now - 15 * 60_000])).rows;
    const failing = rpcs.filter((r) => r.calls >= 5 && r.failures / r.calls >= 0.2);
    const failed = (await db.worker.query(`select attributes->>'workflow' as workflow, count(*)::int as failures,
        min(attributes->'failure'->>'code') as code
      from app.signal_rows where body='process_row' and attributes->>'outcome'='failed' and at >= $1 group by 1 order by 1`, [now - 60 * 60_000])).rows;
    const late = (await queueAges()).filter((q) => q.due_runs > 0 && q.age_ms > 5 * 60_000);
    const processes = [...new Set([...failed.map((f) => f.workflow), ...late.map((l) => l.workflow)])].sort().map((workflow) => ({
      workflow, failures: failed.find((f) => f.workflow === workflow)?.failures ?? 0, oldest_due_ms: late.find((l) => l.workflow === workflow)?.age_ms ?? 0,
    }));
    return { observedAt: new Date().toISOString(), worldAt: now, alerts: [
      { id: "rpc_failing", severity: "notify", route: ["operator"], active: failing.length > 0,
        reason: failing.length ? `${failing.map((r) => r.rpc).join(", ")} failing over 15 minutes` : "", rpcs: failing },
      { id: "process_stuck", severity: "page", route: ["operator"], active: processes.length > 0,
        reason: processes.length ? `${processes.map((p) => p.workflow).join(", ")} failed in the last hour or late to start` : "", processes },
    ] };
  }

  return { request, processRun, sampleQueues, operatorAlerts, addQueue: (s: QueueSource) => void sources.push(s) };
}
export type Signals = ReturnType<typeof createSignals>;
