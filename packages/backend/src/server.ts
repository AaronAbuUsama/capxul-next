import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { carry, get, prepare, submitted, type CarrierServices } from "./approvals/door.ts";
import { readSnapshotCut, worldNow } from "./devnet/door.ts";
import { readChainFact } from "./indexing/door.ts";
import { info, register, release } from "./organizations/door.ts";
import { approvalTerminal, consume, readPayment } from "./payments/door.ts";
import { onPaymentTransition } from "./requests/door.ts";
import { deferDelivery, deliver, RequestCollector, resend, retryParked, signature, status } from "./plugs/door.ts";
import { note } from "./activity/door.ts";
import { settings } from "./platform/config.ts";
import { Database } from "./platform/db.ts";
import { relay } from "./platform/outbox.ts";
import { alerts, indexerState } from "./platform/diagnostics.ts";

type Config = ReturnType<typeof settings>;
/**
 * Builds the approval carrier's chain-facing half (sponsorship, the bundler's send and lookup, the Safe nonce, needs and
 * gate) against the world's authority clock, never host time. PR84's SponsorConfig.now is synchronous, so read `now`
 * once per call: `sponsor: async (a) => { const at = await now(); return approvalSponsor({ ...config, now: () => at })(a); }`.
 */
export type CarrierChain = (now: () => Promise<Date>) => Pick<CarrierServices, "sponsor" | "send" | "lookup" | "nonce" | "needsAndGate">;

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
export function createCore(config: Config, provision?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>, chain?: CarrierChain) {
  if (!Number.isSafeInteger(config.finality) || config.finality < 0) throw new Error("FINALITY_DEPTH must be a nonnegative integer");
  const db = new Database(config.database, config.workerDatabase);
  // Composed here: the world's authority clock, Core's final indexed fact at the approval's nonce, and each opener's
  // follower, which runs inside the terminal transition's transaction. Without a chain half the carrier does not run.
  const now = async () => new Date(await worldNow(db.worker));
  const carrier: CarrierServices | undefined = chain && {
    ...chain(now),
    now,
    fact: (sql, approval) => readChainFact(sql, { chainId: approval.chain_id, sender: approval.sender, nonce: approval.nonce!, finality: config.finality }),
    terminal: async (sql, event) => {
      await approvalTerminal(sql, event, { at: Date.parse(event.observedAt), traceId: event.trace_id });
      // Other openers' followers append here (Budgets: budgets.changes.follow).
    },
  };
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
      // Activity's change log follows committed transitions; its failure must not stall per-organization work, nor theirs it.
      await relay(db, "activity.changes", ["payment_transitioned", "movement_transitioned"], note)
        .catch((error) => console.error(`Activity relay: ${error.message}`));
      // Requests follow committed payment transitions. No escrow ending anchor is composed yet, so a request
      // that needs one is held unacknowledged (WRONG_STATE verification_unavailable) rather than guessed.
      await relay(db, "requests.lifecycle.payment-followers", ["payment_transitioned"], (sql, event) => onPaymentTransition(sql, event, readPayment))
        .catch((error) => console.error(`Requests relay: ${error.message}`));
      if (carrier) await carry(db, carrier).catch((error) => console.error(`Approval carrier: ${error.message}`));
      // Later relays append here (Notices: noticesWorker).
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
