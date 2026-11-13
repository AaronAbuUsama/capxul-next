import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { digest } from "./access/door.ts";
import { admitWave } from "./accounts/door.ts";
import { get, prepare, submitted } from "./approvals/door.ts";
import { readSnapshotCut, worldNow } from "./devnet/door.ts";
import { info, register, release } from "./organizations/door.ts";
import { consume } from "./payments/door.ts";
import { deferDelivery, deliver, RequestCollector, resend, retryParked, signature, status } from "./plugs/door.ts";
import { note } from "./activity/door.ts";
import { settings } from "./platform/config.ts";
import { Database, type Sql } from "./platform/db.ts";
import { relay } from "./platform/outbox.ts";
import { alerts, indexerState } from "./platform/diagnostics.ts";

type Config = ReturnType<typeof settings>;
/** A concept's public bearer router, mounted before diagnostic HMAC ingress. One transaction per call: a returned
 * answer commits (a spent OTP try stays spent); a thrown error rolls back and only then is rendered. */
export type BearerRoute = {
  /** Exact paths, matched with ===, and/or prefixes; a route's body limit applies only to what it matches. */
  paths?: readonly string[];
  prefixes?: readonly string[];
  /** Worker role when the router's writes need it; default is the tenant role, whose RLS policies stay in force. */
  system?: boolean;
  /** Bytes read before parsing; default 1 MiB. */
  bodyLimit?: number;
  /** `trace` is the request's normalized `x-capxul-trace`, or "" when Core has none for it. */
  route: (sql: Sql, path: string, input: Record<string, unknown>, bearer: string, now: number, trace: string) => Promise<{ status: number; body: unknown } | null>;
  render: (error: unknown) => { status: number; body: unknown };
};

/** A public route that reads and answers its own request, mounted before Core reads any body, inside pause and drain.
 * `handle` returns false to pass the request on. */
export type RawRoute = { path: string; handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> };

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
/** Per-organization consume backoff, counted in worker ticks rather than read from a clock (time.no-direct-reads):
 *  after a failure that organization's consume sits out 5, 10, 20 then 40 ticks (about 1, 2, 4 and 8 s at the 200 ms tick). */
export type ConsumeBackoff = Map<string, { failures: number; skip: number }>;

/** One organization's turn of the worker. It never throws: one failing organization must not stall those sorted after it. */
export async function serveOrganization(db: Database, config: Pick<Config, "chainId" | "finality" | "frappe" | "secret">, org: string, indexed: boolean,
  backoff: ConsumeBackoff) {
  const held = backoff.get(org);
  if (held && held.skip > 0) held.skip -= 1;
  else if (indexed) {
    try {
      await db.transaction(org, (sql) => consume(sql, org, config.chainId, config.finality), true);
      backoff.delete(org);
    } catch (error) {
      const failures = (held?.failures ?? 0) + 1;
      backoff.set(org, { failures, skip: 5 * 2 ** Math.min(failures - 1, 3) });
      console.error(`Core consume ${org} (failure ${failures}): ${describe(error)}`);
    }
  }
  try { await deliver(db, org, config.frappe, config.secret); }
  catch (error) {
    console.error(`Core delivery ${org}: ${describe(error)}`);
    await deferDelivery(db, org, error).catch((e) => console.error(`Core delivery backoff ${org}: ${describe(e)}`));
  }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
export function createCore(config: Config, mounts: (db: Database) => readonly RawRoute[] = () => [],
  routes: (db: Database) => readonly BearerRoute[] = () => []) {
  if (!Number.isSafeInteger(config.finality) || config.finality < 0) throw new Error("FINALITY_DEPTH must be a nonnegative integer");
  const db = new Database(config.database, config.workerDatabase);
  const rawRoutes = mounts(db), bearerRoutes = routes(db);
  const consumeBackoff: ConsumeBackoff = new Map();
  let paused = config.startPaused, closing = false, activeRequests = 0, activeDeliveries = 0;
  let activeLoop: Promise<void> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let pauseWork: Promise<Awaited<ReturnType<typeof readSnapshotCut>>> | undefined;
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
    const url = new URL(req.url ?? "/", "http://core");
    if (req.method === "GET" && url.pathname === "/health") {
      await db.tenant.query("select 1");
      return json(res, 200, { ok: true, storage: "postgres", indexer: "ponder", standIn: false });
    }
    if (req.method === "GET" && url.pathname === "/ready") { const r = await ready(); return json(res, r.ok ? 200 : 503, r); }
    const rawRoute = rawRoutes.find((r) => r.path === url.pathname);
    if (rawRoute) {
      if (paused) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
      activeRequests++;
      try { if (await rawRoute.handle(req, res)) return; }
      finally { activeRequests--; notifyDrain(); }
    }
    const bearerRoute = req.method === "POST" ? bearerRoutes.find((r) => r.paths?.includes(url.pathname) || r.prefixes?.some((p) => url.pathname.startsWith(p))) : undefined;
    if (bearerRoute) {
      if (paused) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
      // An absent bearer reaches the router: public sign-in and unauthenticated reads decide for themselves.
      const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
      // Above the default limit, only a live session's bearer may make Core buffer the body;
      // the route still authenticates it on its own transaction.
      const large = (bearerRoute.bodyLimit ?? 1_048_576) > 1_048_576;
      // Answering without reading the body: close the connection so no client reuses a socket with unread bytes.
      const unread = (status: number, body: unknown) => { res.setHeader("connection", "close"); json(res, status, body); };
      if (large && !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return unread(401, { error: "NOT_AUTHENTICATED" });
      activeRequests++;
      try {
        // One digest lookup at world time, on the route's role: an unknown, revoked or expired session buffers nothing.
        if (large && !(await db.transaction("", async (sql) =>
          (await sql.query("select 1 from app.resolve_bearer($1,$2)", [digest(bearer), new Date(await worldNow(sql))])).rowCount, bearerRoute.system ?? false)))
          return unread(401, { error: "NOT_AUTHENTICATED" });
        const parts: Buffer[] = []; let bytes = 0;
        for await (const part of req) { bytes += part.length; if (bytes > (bearerRoute.bodyLimit ?? 1_048_576)) return unread(413, { error: "request too large" }); parts.push(part); }
        let input: unknown;
        try { input = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); } catch { return json(res, 400, { error: "INVALID_INPUT" }); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return json(res, 400, { error: "INVALID_INPUT" });
        let answer: Awaited<ReturnType<BearerRoute["route"]>>;
        try {
          answer = await db.transaction("", async (sql) => bearerRoute.route(sql, url.pathname, input as Record<string, unknown>, bearer, await worldNow(sql),
            String(req.headers["x-capxul-trace"] ?? "")),
            bearerRoute.system ?? false);
        } catch (error) { const rendered = bearerRoute.render(error); return json(res, rendered.status, rendered.body); }
        return answer ? json(res, answer.status, answer.body) : json(res, 404, { error: "NOT_FOUND" });
      } finally { activeRequests--; notifyDrain(); }
    }
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1_048_576) { res.setHeader("connection", "close"); return json(res, 413, { error: "request too large" }); } chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString("utf8");
    const expected = Buffer.from(signature(raw, config.secret));
    const actual = Buffer.from(String(req.headers["x-capxul-signature"] ?? ""));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return json(res, 401, { error: "bad signature" });
    const b = JSON.parse(raw || "{}");
    const trace = String(req.headers["x-capxul-trace"] ?? "");
    const org = String(b.org ?? b.slug ?? "");
    if (url.pathname === "/admin/snapshot/pause") {
      paused = true;
      pauseWork ??= (async () => { await collector.pause(); await activeLoop; await waitForDrain(); return readSnapshotCut(db); })();
      return json(res, 200, { ...await pauseWork, paused: true, activeRequests: 0, activeDeliveries: 0 });
    }
    if (url.pathname === "/admin/snapshot/resume") { await pauseWork; pauseWork = undefined; paused = false; return json(res, 200, { paused: false }); }
    const reads = ["/admin/org-info", "/admin/status", "/admin/alerts", "/approvals/get", "/admin/record"];
    if (paused && !reads.includes(url.pathname)) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
    activeRequests++;
    try {
      // accounts.admission.admit: the HMAC operator key is this deployment's operator authority; admissions are worker writes.
      if (url.pathname === "/admin/accounts/admit")
        return json(res, 200, await db.transaction("", async (sql) => admitWave(sql, b, trace, await worldNow(sql)), true));
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
          default: throw new Error("NOT_FOUND: unknown route");
        }
      });
      json(res, 200, answer);
    } finally { activeRequests--; notifyDrain(); }
  }
  const server = createServer((req, res) => {
    void Effect.runPromise(Effect.tryPromise(() => route(req, res))).catch((error) => {
      const message = String(error.cause?.message ?? error.message);
      const code = message.split(":")[0];
      json(res, code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : ["INVALID_INPUT", "IDEMPOTENCY_CONFLICT", "IDENTITY_CONFLICT"].includes(code!) ? 400 : 500, { error: message });
    });
  });
  async function tick() {
    if (paused || closing) return;
    activeDeliveries++;
    try {
      // Activity's change log follows committed transitions; its failure must not stall per-organization work, nor theirs it.
      await relay(db, "activity.changes", ["payment_transitioned", "movement_transitioned"], note)
        .catch((error) => console.error(`Activity relay: ${error.message}`));
      const index = await indexerState(db, config.ponder, config.chainId, config.rpc, true);
      const orgs = (await db.worker.query("select org_id,site,released from app.organizations order by org_id")).rows;
      for (const company of orgs) {
        const { org_id } = company;
        if (paused || closing) break;
        if (company.released) collector.connect(company);
        await serveOrganization(db, config, org_id, index.ready, consumeBackoff);
      }
    } finally { activeDeliveries--; notifyDrain(); }
  }
  function loop() {
    activeLoop = tick().catch((error) => console.error(`Core worker: ${describe(error)}`));
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
      return server.address();
    },
    async stop() {
      closing = true; paused = true; clearTimeout(timer);
      await collector.pause();
      await new Promise<void>((done) => server.close(() => done()));
      await activeLoop; await waitForDrain(); await db.close();
    },
  };
}
