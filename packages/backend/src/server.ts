import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { createPublicClient, http, type PublicClient } from "viem";
import { devnetMail } from "../../devnet/src/devnet/door.ts";
import { get, prepare, submitted } from "./approvals/door.ts";
import { readSnapshotCut, worldNow } from "./devnet/door.ts";
import { sourceDoors } from "./notices/adapters.ts";
import { noticesWorker } from "./notices/door.ts";
import { info, register, release } from "./organizations/door.ts";
import { consume } from "./payments/door.ts";
import { deliver, RequestCollector, resend, retryParked, signature, status } from "./plugs/door.ts";
import { settings } from "./platform/config.ts";
import { Database } from "./platform/db.ts";
import { alerts, indexerState } from "./platform/diagnostics.ts";

type Config = ReturnType<typeof settings>;
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
export function createCore(config: Config, provision?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>) {
  if (!Number.isSafeInteger(config.finality) || config.finality < 0) throw new Error("FINALITY_DEPTH must be a nonnegative integer");
  const db = new Database(config.database, config.workerDatabase);
  let paused = config.startPaused, closing = false, activeRequests = 0, activeDeliveries = 0;
  let activeLoop: Promise<void> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let pauseWork: Promise<Awaited<ReturnType<typeof readSnapshotCut>>> | undefined;
  const collector = new RequestCollector(db, { ...config, running: () => !paused && !closing });
  const drained: (() => void)[] = [];
  function notifyDrain() { if (!activeRequests && !activeDeliveries) for (const done of drained.splice(0)) done(); }
  // Only a fresh local world has the durable devnet sink; anywhere else Notices delivery stays off rather than guessing a provider.
  const notices = config.mailSink === "devnet" ? noticesWorker(db, devnetMail(async (text) => {
    const client = await db.worker.connect();
    try {
      const results = await client.query(text) as unknown as { rows: { jsonb_build_object: Record<string, unknown> }[] } | { rows: { jsonb_build_object: Record<string, unknown> }[] }[];
      return (Array.isArray(results) ? results : [results]).flatMap((r) => r.rows.map((row) => row.jsonb_build_object));
    } finally { client.release(); }
  }, () => worldNow(db.worker)), sourceDoors(createPublicClient({ transport: http(config.rpc) }) as PublicClient), {
    quickstart: `${config.url}/start`, chat: `${config.url}/chat`, support: `${config.url}/support`, signup: `${config.url}/signup`,
    approval: (id) => `${config.url}/approve/${id}`, explorer: (address) => `${config.url}/address/${address}`,
  }) : undefined;
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
    if (provision && url.pathname === "/org/site/provision") {
      if (paused) return json(res, 503, { error: "SNAPSHOT_PAUSED" });
      activeRequests++;
      try { if (await provision(req, res)) return; }
      finally { activeRequests--; notifyDrain(); }
    }
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1_048_576) return json(res, 413, { error: "request too large" }); chunks.push(chunk); }
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
      // Notices drains its whole tick inside the delivery count, so a snapshot pause waits for any provider attempt.
      if (notices) await notices().catch((error) => console.error(`Notices worker: ${error.message}`));
      const index = await indexerState(db, config.ponder, config.chainId, config.rpc, true);
      const orgs = (await db.worker.query("select org_id,site,released from app.organizations order by org_id")).rows;
      for (const company of orgs) {
        const { org_id } = company;
        if (paused || closing) break;
        if (company.released) collector.connect(company);
        if (index.ready) await db.transaction(org_id, (sql) => consume(sql, org_id, config.chainId, config.finality), true);
        await deliver(db, org_id, config.frappe, config.secret);
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
