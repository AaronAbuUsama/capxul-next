// Shared signals in Core (signals.wide-rows, signals.world-rows): one rpc span and one operation_row per request,
// one process_row per process run that did work or failed, process_queue_age samples, and the two server-wide operator
// alerts (signals.operator-watch) evaluated from those rows in the world's own time.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { realNowIso, realNowMs, stopwatch } from "@capxul/runtime/time";
import { Effect, Tracer } from "effect";
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

/** The caller's trace: W3C traceparent first, then the blueprint's x-capxul-trace, else a new one. One format everywhere:
 * 32 lowercase hex, never all zeros; anything else (a tr_ id, upper case) is replaced, never passed on. */
export function traceOf(headers: IncomingMessage["headers"]): { traceId: string; parentSpanId: string | null } {
  const parent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(String(headers["traceparent"] ?? ""));
  if (parent && !/^0+$/.test(parent[1]!) && !/^0+$/.test(parent[2]!)) return { traceId: parent[1]!, parentSpanId: parent[2]! };
  const own = String(headers["x-capxul-trace"] ?? "");
  return { traceId: /^[0-9a-f]{32}$/.test(own) && !/^0+$/.test(own) ? own : randomBytes(16).toString("hex"), parentSpanId: null };
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

/**
 * The instant a row is stamped with and a window is measured in (signals.world-rows): a world's stopped authority clock
 * where it has one (a devnet), and a malformed one refuses like worldNow. A world with no authority clock (staging,
 * production) has the host's time as its own, so there, and only by that decision, RealTime is the world's instant. A
 * running devnet clock is read the same way until Runtime's world-time door replaces this reader.
 */
export async function signalNow(sql: Sql): Promise<number> {
  const clock = (await sql.query("select clock from app.world")).rows[0]?.clock;
  if (clock?.clockMode !== "stopped") return realNowMs();
  if (!Number.isSafeInteger(clock.nowMs) || clock.nowMs < 0) throw new Error("INVALID_CLOCK: a stopped authority clock needs a valid nowMs");
  return clock.nowMs;
}
/** The longest window each body is read over; older rows are pruned. */
const WINDOWS = { operation_row: 15 * 60_000, process_row: 60 * 60_000, process_queue_age: 5 * 60_000 } as const;
/**
 * Requests that passed a door: Core's HMAC check, or a raw route's own authentication when its handler marks it. Only
 * these write spans and rows (signals.world-rows), decided by admission, not by status, so an anonymous caller (a bad
 * signature, an aborted body, a request line that is no URL, a probe) can neither fill the tables nor fire rpc_failing.
 */
const admitted = new WeakSet<IncomingMessage>();
/** Mark a request as admitted, right after its caller is authenticated. */
export function admit(req: IncomingMessage): void { admitted.add(req); }
/**
 * Core's HMAC door: admit a signed request unless it is an /admin/org-info lookup its signer marks `x-capxul-preauth`, made
 * by a raw route before it has authenticated its own caller (Sites checks a provisioning signature's founder). The mark is
 * honoured on that path only; only a holder of Core's secret can send it, and it can only withhold rows, never add them.
 */
export function admitSigned(req: IncomingMessage): void {
  const lookup = URL.parse(req.url ?? "", "http://x")?.pathname === "/admin/org-info";
  if (!lookup || req.headers["x-capxul-preauth"] === undefined) admit(req);
}

async function insertRow(db: Database, body: keyof typeof WINDOWS, trace: string | null, org: string | null, attributes: unknown) {
  const at = await signalNow(db.worker);
  await db.worker.query("insert into app.signal_rows (body,at,trace_id,org_id,attributes) values ($1,$2,$3,$4,$5::jsonb)",
    [body, at, trace, org, JSON.stringify(attributes)]);
}

/**
 * plugs.payments.settle's due runs: indexed PaymentSent facts of a born company, past the finality depth, that Core has not
 * consumed. They are due from their block time, which is the world's time (the devnet pins its chain to the world clock).
 */
export function settleQueue(chainId: number, finality: number) {
  return { workflow: "plugs.payments.settle", async read(sql: Sql) {
    const row = (await sql.query(`select min(p.block_time)::float8 as oldest, count(*)::int as due from app.chain_payments p
      join app.organizations o on o.safe=p.sender and o.token=p.token
      where p.chain_id=$1 and p.block_number <= (select indexed_block - $2 from ponder.indexer_progress where chain_id=$1)
        and exists (select 1 from app.chain_logs l where l.chain_id=$1 and l.event='CompanySafeMinted' and l.args->>'safe'=o.safe)
        and not exists (select 1 from app.consumed_facts c where c.org_id=o.org_id and c.log_id=p.log_id)`, [chainId, finality])).rows[0];
    return { oldestDue: row?.oldest ?? null, dueRuns: row?.due ?? 0 };
  } };
}

export function createSignals(db: Database, config: SignalsConfig) {
  // Every transaction a request opens counts toward its db_ms.
  const transaction = db.transaction.bind(db);
  db.transaction = async <T>(...args: Parameters<typeof transaction<T>>): Promise<T> => {
    const elapsed = stopwatch();
    try { return await transaction(...args); } finally { noteDb(elapsed()); }
  };
  // The run spans are kept under: set by whoever started this world's run (the eval harness), never by a caller.
  const runId = ID.test(process.env["CAPXUL_RUN_ID"] ?? "") ? process.env["CAPXUL_RUN_ID"]! : "core";
  const codeVersion = process.env["CAPXUL_CODE_VERSION"] || "unknown";
  const env = ENVS.find((e) => e === process.env["CAPXUL_ENV"]) ?? "unknown";
  const workerQuery = db.worker.query.bind(db.worker) as (text: string, values?: unknown[]) => Promise<unknown>;
  /** A request's span writer: a span is kept only when its request was admitted and the world is not paused. */
  const spanSqlFor = (req: IncomingMessage): Sql => ({
    query: ((text: string, values?: unknown[]) => admitted.has(req) && !config.paused() ? workerQuery(text, values) : Promise.resolve({ rows: [] })) as Sql["query"],
  });
  /** Wrap one HTTP request: its rpc span (child of the caller's trace), then its operation_row. Never alters the answer. */
  async function request(req: IncomingMessage, res: ServerResponse, handle: () => Promise<void>): Promise<void> {
    if (config.paused()) return handle();
    // A request line that is not a URL still gets an answer from the handler; it is counted under the root rpc.
    const url = URL.parse(req.url ?? "/", "http://core") ?? new URL("/", "http://core");
    const { rpc, concept } = rpcOf(url.pathname);
    const trace = traceOf(req.headers);
    // Every event the request enqueues carries this trace, including one the caller did not name.
    req.headers["x-capxul-trace"] = trace.traceId;
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
    const collector = spanCollector(spanSqlFor(req), { runId, worldId: config.world, codeVersion,
      callId: randomBytes(8).toString("hex"), capxul_env: env, producer: "backend", org_id: null, actor: null }, ERROR_CODES);
    // A caller that names only a trace id gets a root span in that trace (an all-zero parent id is no parent).
    const parent = Tracer.externalSpan({ traceId: trace.traceId, spanId: trace.parentSpanId ?? "0".repeat(16) });
    const elapsed = stopwatch();
    let call: Call | undefined;
    await Effect.runPromiseExit(Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      call = { tracer: collector.tracer, span, dbMs: 0, chainCalls: 0 };
      yield* Effect.tryPromise({ try: () => current.run(call!, handle), catch: (error) => {
        // The handler answers its own errors; one that escapes is a defect, logged by its class only.
        console.error(`Core request ${rpc}: ${(error as Error)?.name ?? "Error"} escaped the handler`);
        return { code: "INTERNAL_ERROR" };
      } });
      if (res.statusCode >= 400) yield* Effect.fail({ code: failureOf(res.statusCode, code).failure!.code });
    }).pipe(Effect.withSpan(`rpc.${rpc}`, { parent }), Effect.withTracer(collector.tracer)));
    const duration = elapsed();
    const { outcome, failure } = failureOf(res.statusCode, code);
    if (config.paused() || !admitted.has(req)) return;
    try {
      await collector.flush();
      await insertRow(db, "operation_row", trace.traceId, null, { rpc, concept, surface, outcome, failure,
        duration_ms: Math.round(duration), db_ms: Math.round(call?.dbMs ?? 0), chain_calls: call?.chainCalls ?? 0, session_id: null });
    } catch (error) { console.error(`Core signals ${rpc}: ${(error as Error).message}`); }
  }

  /** One durable process run. A run returns true when it did work; an idle poll writes no row, a throw is a failed run. */
  async function processRun(run: { workflow: string; concept: string; trigger: "transition" | "chain-event" | "timer" | "cron" | "signal"; key: string; org?: string },
    work: () => Promise<boolean | void>): Promise<void> {
    const elapsed = stopwatch();
    let outcome: "done" | "failed" = "done", failure: Failure = null, did = false;
    try { did = (await work()) === true; }
    catch (error) {
      outcome = "failed";
      failure = { code: /^([A-Z][A-Z0-9_]{1,60})(?::|$)/.exec(String((error as Error)?.message))?.[1] ?? "INTERNAL_ERROR", mode: "defect", retryable: true };
      throw error;
    } finally {
      if ((did || outcome === "failed") && !config.paused())
        await insertRow(db, "process_row", null, run.org ?? null, { workflow: run.workflow, concept: run.concept, trigger: run.trigger,
          idempotency_key: run.key, outcome, failure, queue_wait_ms: null, duration_ms: Math.round(elapsed()), resumes: 0 })
          .catch((error) => console.error(`Core signals ${run.workflow}: ${error.message}`));
    }
  }

  /** Where each process's due runs are read: the oldest due instant (world ms) and how many are due at world time now. */
  type QueueSource = { workflow: string; read: (sql: Sql, now: number) => Promise<{ oldestDue: number | null; dueRuns: number }> };
  const sources: QueueSource[] = [];
  /** Each source on its own: one that cannot be read is reported as its process's error, never the whole route's. */
  async function queueAges() {
    const now = await signalNow(db.worker);
    return Promise.all(sources.map(async (s) => {
      try {
        const { oldestDue, dueRuns } = await s.read(db.worker, now);
        return { workflow: s.workflow, due_runs: dueRuns, age_ms: oldestDue === null ? 0 : Math.max(0, now - oldestDue), error: null };
      } catch (error) {
        console.error(`Core queue ${s.workflow}: ${(error as Error)?.name ?? "Error"}`);
        return { workflow: s.workflow, due_runs: 0, age_ms: 0, error: /^([A-Z][A-Z0-9_]{1,60})(?::|$)/.exec(String((error as Error)?.message))?.[1] ?? "INTERNAL_ERROR" };
      }
    }));
  }
  /** Sampled every minute: one process_queue_age row per process, then each body's rows older than its window are dropped. */
  async function sampleQueues(): Promise<void> {
    if (config.paused()) return;
    for (const q of await queueAges()) if (!q.error) await insertRow(db, "process_queue_age", null, null, { workflow: q.workflow, due_runs: q.due_runs, value: q.age_ms });
    const now = await signalNow(db.worker);
    for (const [body, window] of Object.entries(WINDOWS))
      await db.worker.query("delete from app.signal_rows where body=$1 and at < $2", [body, now - window]);
  }

  /** rpc_failing and process_stuck, from the rows, over the world's own time windows. */
  async function operatorAlerts() {
    const now = await signalNow(db.worker);
    const rpcs = (await db.worker.query(`select attributes->>'rpc' as rpc, count(*)::int as calls,
        count(*) filter (where attributes->>'outcome'='failed')::int as failures
      from app.signal_rows where body='operation_row' and at >= $1 group by 1 order by 3 desc, 1`, [now - 15 * 60_000])).rows;
    const failing = rpcs.filter((r) => r.calls >= 5 && r.failures / r.calls >= 0.2);
    const failed = (await db.worker.query(`select attributes->>'workflow' as workflow, count(*)::int as failures,
        min(attributes->'failure'->>'code') as code
      from app.signal_rows where body='process_row' and attributes->>'outcome'='failed' and at >= $1 group by 1 order by 1`, [now - 60 * 60_000])).rows;
    const late = (await queueAges()).filter((q) => q.error || (q.due_runs > 0 && q.age_ms > 5 * 60_000));
    const processes = [...new Set([...failed.map((f) => f.workflow), ...late.map((l) => l.workflow)])].sort().map((workflow) => {
      const queue = late.find((l) => l.workflow === workflow);
      return { workflow, failures: failed.find((f) => f.workflow === workflow)?.failures ?? 0, oldest_due_ms: queue?.age_ms ?? 0,
        ...(queue?.error ? { queue_error: queue.error } : {}) };
    });
    return { observedAt: realNowIso(), worldAt: now, alerts: [
      { id: "rpc_failing", severity: "notify", route: ["operator"], active: failing.length > 0,
        reason: failing.length ? `${failing.map((r) => r.rpc).join(", ")} failing over 15 minutes` : "", rpcs: failing },
      { id: "process_stuck", severity: "page", route: ["operator"], active: processes.length > 0,
        reason: processes.length ? `${processes.map((p) => p.workflow).join(", ")} failed in the last hour, late to start or unreadable` : "", processes },
    ] };
  }

  return { request, admit, processRun, sampleQueues, operatorAlerts, addQueue: (s: QueueSource) => void sources.push(s) };
}
export type Signals = ReturnType<typeof createSignals>;
