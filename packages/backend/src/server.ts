import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { get, prepare, submitted } from "./approvals/door.ts";
import { readSnapshotCut } from "./devnet/door.ts";
import { info, register, release } from "./organizations/door.ts";
import { consume } from "./payments/door.ts";
import { deferDelivery, deliver, RequestCollector, resend, retryParked, signature, status } from "./plugs/door.ts";
import { settings } from "./platform/config.ts";
import { Database } from "./platform/db.ts";
import { alerts, indexerState } from "./platform/diagnostics.ts";
import { createSignals, settleQueue, type Signals } from "./shared/door.ts";

type Config = ReturnType<typeof settings>;

/** One organization's turn of the worker. It never throws: one failing organization must not stall those sorted after it. */
export async function serveOrganization(db: Database, config: Pick<Config, "chainId" | "finality" | "frappe" | "secret">, org: string, indexed: boolean,
  run: Signals["processRun"] = async (_unit, work) => { await work(); }) {
  try {
    if (indexed) await run({ workflow: "plugs.payments.settle", concept: "plugs", trigger: "chain-event", key: org, org },
      () => db.transaction(org, (sql) => consume(sql, org, config.chainId, config.finality), true));
  } catch (error) { console.error(`Core consume ${org}: ${(error as Error).message}`); }
  try { await run({ workflow: "plugs.events.deliver", concept: "plugs", trigger: "transition", key: org, org }, () => deliver(db, org, config.frappe, config.secret)); }
  catch (error) {
    console.error(`Core delivery ${org}: ${(error as Error).message}`);
    await deferDelivery(db, org, error).catch((e) => console.error(`Core delivery backoff ${org}: ${e.message}`));
  }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
/** A raw route handler (Sites' provisioning). It calls `admit` once it has authenticated its caller (signals.world-rows). */
type RawRoute = (req: IncomingMessage, res: ServerResponse, admit: () => void) => Promise<boolean>;
export function createCore(config: Config, provision?: RawRoute) {
  if (!Number.isSafeInteger(config.finality) || config.finality < 0) throw new Error("FINALITY_DEPTH must be a nonnegative integer");
  const db = new Database(config.database, config.workerDatabase);
  let paused = config.startPaused, closing = false, activeRequests = 0, activeDeliveries = 0;
  let activeLoop: Promise<void> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let pauseWork: Promise<Awaited<ReturnType<typeof readSnapshotCut>>> | undefined;
  // Shared signals: a span and an operation_row per request, a process_row per run, and the operator alerts.
  const signals = createSignals(db, { world: config.world, paused: () => paused || closing });
  signals.addQueue(settleQueue(config.chainId, config.finality));
  let sampler: ReturnType<typeof setInterval> | undefined;
  const collector = new RequestCollector(db, { ...config, running: () => !paused && !closing });
  const drained: (() => void)[] = [];
  function notifyDrain() { if (!activeRequests && !activeDeliveries) for (const done of drained.splice(0)) done(); }
  const waitForDrain = () => activeRequests || activeDeliveries ? new Promise<void>((done) => drained.push(done)) : Promise.resolve();
  async function ready() {
    if (!(await db.tenant.query("select version from app.schema_version where version=1")).rowCount) throw new Error("SCHEMA_VERSION: Core schema v1 required");
    const index = await indexerState(db, config.ponder, config.chainId, config.rpc);
    return { ok: !paused && index.ready, paused, storage: "postgres", indexer: "ponder", databaseSchemaVersion: "1", world: config.world, ...index };
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = URL.parse(req.url ?? "/", "http://core");
    if (!url) return json(res, 400, { error: "INVALID_INPUT: request target is not a URL" });
    if (req.method === "GET" && url.pathname === "/health") {
      await db.tenant.query("select 1");
      return json(res, 200, { ok: true, storage: "postgres", indexer: "ponder", standIn: false });
    }
    if (req.method === "GET" && url.pathname === "/ready") { const r = await ready(); return json(res, r.ok ? 200 : 503, r); }
    if (provision && url.pathname === "/org/site/provision") {
      if (paused) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
      activeRequests++;
      try { if (await provision(req, res, () => signals.admit(req))) return; }
      finally { activeRequests--; notifyDrain(); }
    }
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1_048_576) return json(res, 413, { error: "request too large" }); chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString("utf8");
    const expected = Buffer.from(signature(raw, config.secret));
    const actual = Buffer.from(String(req.headers["x-capxul-signature"] ?? ""));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return json(res, 401, { error: "bad signature" });
    signals.admit(req);
    let b: any;
    try { b = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: "INVALID_INPUT: body is not JSON" }); }
    const trace = String(req.headers["x-capxul-trace"] ?? "");
    const org = String(b.org ?? b.slug ?? "");
    if (url.pathname === "/admin/snapshot/pause") {
      paused = true;
      pauseWork ??= (async () => { await collector.pause(); await activeLoop; await waitForDrain(); return readSnapshotCut(db); })();
      return json(res, 200, { ...await pauseWork, paused: true, activeRequests: 0, activeDeliveries: 0 });
    }
    if (url.pathname === "/admin/snapshot/resume") { await pauseWork; pauseWork = undefined; paused = false; return json(res, 200, { paused: false }); }
    const reads = ["/admin/org-info", "/admin/status", "/admin/alerts", "/admin/operator-alerts", "/approvals/get", "/admin/record"];
    if (paused && !reads.includes(url.pathname)) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
    activeRequests++;
    try {
      const answer = await db.transaction(org, async (sql) => {
        switch (url.pathname) {
          case "/admin/org": return register(sql, b, trace);
          case "/admin/org-info": return info(sql, org);
          case "/admin/release": return release(sql, org);
          case "/admin/status": return status(sql, org);
          case "/admin/resend": return resend(sql, org, Number(b.from ?? 1));
          case "/admin/retry-parked": return retryParked(sql, org, b.event_key, config.frappe, config.secret);
          case "/prepare": {
            const a = await prepare(sql, b, trace);
            return { approval_id: a.id, approval_url: `${config.url}/approve/${a.id}`, requested_by: a.requested_by };
          }
          case "/approvals/get": return get(sql, org, b.id);
          case "/approvals/submitted": return submitted(sql, org, b.id, b.txHash, b.signer);
          case "/admin/record": return (await sql.query("select * from app.records where org_id=$1 order by id", [org])).rows;
          case "/admin/alerts": return alerts(db, sql, org, config.ponder, config.chainId, config.rpc);
          case "/admin/operator-alerts": return signals.operatorAlerts();
          default: throw new Error("NOT_FOUND: unknown route");
        }
      });
      json(res, 200, answer);
    } finally { activeRequests--; notifyDrain(); }
  }
  const server = createServer((req, res) => {
    // The row a request writes after its answer is part of the request, so a snapshot pause drains it too; the pause and
    // resume calls themselves are not counted, or the pause would wait for itself.
    // Judged on the parsed path, as route matches it: /./admin/snapshot/pause or an absolute form must not count itself.
    const counted = !(URL.parse(req.url ?? "/", "http://core")?.pathname ?? "/").startsWith("/admin/snapshot/");
    if (counted) activeRequests++;
    void signals.request(req, res, () => Effect.runPromise(Effect.tryPromise(() => route(req, res))).catch((error) => {
      const message = String(error.cause?.message ?? error.message);
      const code = message.split(":")[0];
      json(res, code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : ["INVALID_INPUT", "IDEMPOTENCY_CONFLICT", "IDENTITY_CONFLICT"].includes(code!) ? 400 : 500, { error: message });
    })).catch((error) => {
      console.error(`Core request: ${(error as Error)?.name ?? "Error"}`);
      if (!res.headersSent) json(res, 500, { error: "INTERNAL_ERROR" });
    }).finally(() => { if (counted) { activeRequests--; notifyDrain(); } });
  });
  async function tick() {
    if (paused || closing) return;
    activeDeliveries++;
    try {
      const index = await indexerState(db, config.ponder, config.chainId, config.rpc, true);
      const orgs = (await db.worker.query("select org_id,site,released from app.organizations order by org_id")).rows;
      for (const company of orgs) {
        const { org_id } = company;
        if (paused || closing) break;
        if (company.released) collector.connect(company);
        await serveOrganization(db, config, org_id, index.ready, signals.processRun);
      }
    } finally { activeDeliveries--; notifyDrain(); }
  }
  function loop() {
    activeLoop = tick().catch((error) => console.error(`Core worker: ${error.message}`));
    void activeLoop.finally(() => { if (!closing) timer = setTimeout(loop, 200); });
  }
  return {
    db,
    async start() {
      for (const [pool, role] of [[db.tenant, "capxul_core"], [db.worker, "capxul_worker"]] as const) {
        const row = (await pool.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
        if (row.name !== role || row.rolsuper || row.rolbypassrls) throw new Error(`Core requires restricted role ${role}`);
      }
      const identity = (await db.worker.query("select world_id from app.world")).rows[0];
      if (identity?.world_id !== config.world) throw new Error("WORLD_IDENTITY: restored database identity must match CAPXUL_WORLD before startup");
      await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(config.port, config.host, done); });
      loop();
      // A sample writes rows, so a snapshot pause drains it like a delivery tick.
      sampler = setInterval(() => {
        if (paused || closing) return;
        activeDeliveries++;
        void signals.sampleQueues().catch((error) => console.error(`Core queue sample: ${error.message}`))
          .finally(() => { activeDeliveries--; notifyDrain(); });
      }, 60_000);
      return server.address();
    },
    async stop() {
      closing = true; paused = true; clearTimeout(timer); clearInterval(sampler);
      await collector.pause();
      await new Promise<void>((done) => server.close(() => done()));
      await activeLoop; await waitForDrain(); await db.close();
    },
  };
}
