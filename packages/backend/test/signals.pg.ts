import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateSpans, readSpans } from "../src/platform/spans.ts";
import { admitSigned, childSpan, createSignals, migrateSignals, settleQueue, signalNow } from "../src/shared/door.ts";

// Explicit standalone PG control, not part of the Ponder/v4 fixture suite's *.test.ts glob.
const url = process.env.SIGNALS_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/signals_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("SIGNALS_TEST_ADMIN_URL must name a dedicated loopback signals_test database");
}

test("wide rows, rpc spans and the two operator alerts, in the world's own time", { timeout: 60_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const roleUrl = (role: string) => { const u = new URL(url); u.username = role; return u.href; };
  await admin.query(`create role capxul_core login nosuperuser nobypassrls;
    create role capxul_worker login nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker;
    create table app.world (world_id text primary key, clock jsonb not null);
    grant select on app.world to capxul_core,capxul_worker`);
  // The roles sign in with the admin URL's password, so the test also runs on a password-auth (scram) server.
  const password = decodeURIComponent(new URL(url).password);
  if (password) for (const role of ["capxul_core", "capxul_worker"]) await admin.query(`alter role ${role} password '${password.replace(/'/g, "''")}'`);
  await migrateSpans(admin); await migrateSignals(admin);
  const T0 = 1_800_000_000_000;
  const setClock = (nowMs: number) => admin.query("insert into app.world values ('world-a',$1::jsonb) on conflict (world_id) do update set clock=excluded.clock",
    [JSON.stringify({ nowMs, clockMode: "stopped", rate: 1 })]);
  await setClock(T0);
  const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
  let paused = false, broken = true;
  const seen: Record<string, string> = {};
  process.env["CAPXUL_RUN_ID"] = "run-9";
  const signals = createSignals(db, { world: "world-a", paused: () => paused });
  const secret = "private@example.test memo";
  // Like Core's server.ts: the route answers its own errors, and the wrapper's promise is caught.
  const server = createServer((req, res) => void signals.request(req, res, () => route(req, res).catch(() => {
    if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "INTERNAL_ERROR" })); }
  })).catch(() => res.destroy()));
  async function route(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const target = URL.parse(req.url!, "http://x");
    if (!target) return send(400, { error: "INVALID_INPUT: request target is not a URL" });
    const path = target.pathname;
    seen[path] = String(req.headers["x-capxul-trace"]);
    // Like Core's door: /ready, a bad signature, an aborted body and an unsigned call never pass it.
    if (path === "/ready") return send(503, { ready: false });
    if (path === "/admin/org") return send(401, { error: "bad signature" });
    if (path === "/unsigned/fail") return send(500, { error: "INTERNAL_ERROR" });
    if (path === "/books/aborted") { for await (const _ of req) { /* the caller aborts mid-body */ } return send(500, { error: "INTERNAL_ERROR" }); }
    // The stand-in for Core's HMAC check has passed: admitted unless its signer marked it a pre-auth lookup.
    admitSigned(req);
    if (path === "/books/annotations/save") {
      await db.transaction("", async (sql) => sql.query("select pg_sleep(0.02)"), true);
      return send(200, await childSpan("chain.readContract", async () => ({ ok: true })));
    }
    if (path === "/books/annotations/refuse") return send(400, { error: `INVALID_INPUT: ${secret}` });
    if (path === "/books/annotations/list") return broken ? send(500, { error: `permission denied for table records ${secret}` }) : send(200, {});
    if (path === "/escape") throw new Error(`escaped ${secret}`);
    send(404, { error: "NOT_FOUND: unknown route" });
  }
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // A row is written just after its answer is sent; a call returns once its row is kept.
  const kept = async () => Number((await admin.query("select count(*) from app.signal_rows where body='operation_row'")).rows[0].count);
  const call = async (path: string, headers: Record<string, string> = {}) => {
    const before = paused ? 0 : await kept();
    const status = await fetch(base + path, { method: "POST", headers, body: "{}" }).then((r) => r.status);
    for (let i = 0; !paused && await kept() === before; i++) { assert(i < 200, "operation_row was never written"); await new Promise((r) => setTimeout(r, 10)); }
    return status;
  };
  const rows = async (body: string) => (await admin.query("select * from app.signal_rows where body=$1 order by id", [body])).rows;
  const alert = async (id: string) => (await signals.operatorAlerts()).alerts.find((a) => a.id === id)!;
  try {
    await t.test("a request joins the caller's trace; its child span and operation_row follow; no value enters storage", async () => {
      const trace = "4bf92f3577b34da6a3ce929d0e0e4736", parent = "00f067aa0ba902b7";
      assert.equal(await call("/books/annotations/save", { traceparent: `00-${trace}-${parent}-01`, "x-capxul-run": "run-caller", "x-capxul-surface": "cli" }), 200);
      assert.equal(seen["/books/annotations/save"], trace, "the handler (and so every event it enqueues) sees the caller's trace");
      const spans = await readSpans(db.worker, { runId: "run-9", worldId: "world-a", traceId: trace });
      assert.deepEqual(await readSpans(db.worker, { runId: "run-caller", worldId: "world-a", traceId: trace }), [], "a caller cannot name the run");
      const rpc = spans.find((s) => s.name === "rpc.books.annotations.save"), child = spans.find((s) => s.name === "chain.readContract");
      assert(rpc && child, JSON.stringify(spans));
      assert.equal(rpc.parentSpanId, parent); assert.equal(child.parentSpanId, rpc.spanId); assert.equal(rpc.outcome, "success");
      const [row] = await rows("operation_row");
      assert.equal(row.trace_id, trace); assert.equal(Number(row.at), T0, "rows carry the world instant, not the host's");
      assert.equal(row.attributes.rpc, "books.annotations.save"); assert.equal(row.attributes.concept, "books");
      assert.equal(row.attributes.surface, "cli"); assert.equal(row.attributes.outcome, "ok"); assert.equal(row.attributes.failure, null);
      assert(row.attributes.db_ms >= 15, `db_ms ${row.attributes.db_ms} counts the request's transaction time`);
      assert(row.attributes.duration_ms >= row.attributes.db_ms);
    });

    await t.test("a refusal is refused with its code; a defect is failed; a bare trace id is a root; nothing private is kept", async () => {
      const bare = "a".repeat(32);
      assert.equal(await call("/books/annotations/refuse", { "x-capxul-trace": bare }), 400);
      assert.equal(await call("/books/annotations/list"), 500);
      assert.match(seen["/books/annotations/list"]!, /^[0-9a-f]{32}$/, "an untraced call still gets a trace");
      for (const other of ["tr_0123456789abcdef", "A".repeat(32), "0".repeat(32), `00-${"0".repeat(32)}-${"b".repeat(16)}-01`]) {
        await call("/books/annotations/list", other.startsWith("00-") ? { traceparent: other } : { "x-capxul-trace": other });
        const got = seen["/books/annotations/list"]!;
        assert(/^[0-9a-f]{32}$/.test(got) && got !== other.toLowerCase() && !/^0+$/.test(got), `${other} is replaced by a fresh 32-hex trace`);
      }
      const [, refused, failed] = await rows("operation_row");
      assert.deepEqual([refused.attributes.outcome, refused.attributes.failure.code, refused.trace_id], ["refused", "INVALID_INPUT", bare]);
      assert.deepEqual([failed.attributes.outcome, failed.attributes.failure.code], ["failed", "INTERNAL_ERROR"]);
      const [root] = await readSpans(db.worker, { runId: "run-9", worldId: "world-a", traceId: bare });
      assert.equal(root!.parentSpanId, null); assert.equal(root!.errorCode, "INVALID_INPUT");
      const stored = JSON.stringify([...(await admin.query("select * from app.signal_rows")).rows, ...(await admin.query("select * from app.completed_spans")).rows]);
      assert(!stored.includes("private@example") && !stored.includes("memo") && !stored.includes("permission denied"));
    });

    await t.test("rpc_failing: 5 calls and 20% failed over 15 world minutes, on both sides of each bound", async () => {
      await admin.query("delete from app.signal_rows");
      for (let i = 0; i < 4; i++) await call("/books/annotations/list");
      assert.equal((await alert("rpc_failing")).active, false, "4 calls are below the 5-call floor");
      await call("/books/annotations/list");
      const firing = await alert("rpc_failing");
      assert.equal(firing.active, true); assert.deepEqual(firing.route, ["operator"]);
      assert.deepEqual((firing as { rpcs: { rpc: string }[] }).rpcs.map((r) => r.rpc), ["books.annotations.list"]);
      for (let i = 0; i < 5; i++) await call("/books/annotations/refuse");
      assert.equal((await alert("rpc_failing")).active, true, "refusals of another rpc never dilute or count");
      broken = false;
      for (let i = 0; i < 20; i++) await call("/books/annotations/list");
      assert.equal((await alert("rpc_failing")).active, true, "5 of 25 is exactly 20%: still firing");
      await call("/books/annotations/list");
      assert.equal((await alert("rpc_failing")).active, false, "5 of 26 is under 20%: cleared");
      broken = true;
      for (let i = 0; i < 5; i++) await call("/books/annotations/list");
      assert.equal((await alert("rpc_failing")).active, true);
      await setClock(T0 + 15 * 60_000 + 1);
      assert.equal((await alert("rpc_failing")).active, false, "rows older than 15 world minutes leave the window");
      await setClock(T0);
    });

    await t.test("process_stuck: a failed run in the last world hour, or a due run late by over 5 world minutes", async () => {
      await admin.query("delete from app.signal_rows"); broken = false;
      const run = { workflow: "plugs.events.deliver", concept: "plugs", trigger: "transition" as const, key: "org-a", org: "org-a" };
      await signals.processRun(run, async () => {});
      assert.equal((await rows("process_row")).length, 0, "an idle poll is not a run");
      await signals.processRun(run, async () => true);
      assert.equal((await rows("process_row"))[0].attributes.outcome, "done");
      assert.equal((await alert("process_stuck")).active, false);
      await assert.rejects(signals.processRun(run, async () => { throw new Error(`PROVIDER_ERROR: ${secret}`); }), /PROVIDER_ERROR/);
      const failed = (await rows("process_row"))[1];
      assert.deepEqual([failed.attributes.outcome, failed.attributes.failure.code], ["failed", "PROVIDER_ERROR"]);
      assert(!JSON.stringify(failed).includes("private@"));
      const firing = await alert("process_stuck");
      assert.equal(firing.active, true); assert.deepEqual(firing.route, ["operator"]);
      await setClock(T0 + 60 * 60_000);
      assert.equal((await alert("process_stuck")).active, true, "exactly one hour later the failure is still inside the hour");
      await setClock(T0 + 60 * 60_000 + 1);
      assert.equal((await alert("process_stuck")).active, false, "and leaves it after");
      let due = T0 + 60 * 60_000 + 1 - 5 * 60_000;
      signals.addQueue({ workflow: "payments.lifecycle.payment", read: async (_sql, now) => ({ oldestDue: due, dueRuns: due <= now ? 1 : 0 }) });
      assert.equal((await alert("process_stuck")).active, false, "due for exactly 5 minutes is not late");
      due -= 1;
      const late = await alert("process_stuck") as { active: boolean; processes: { workflow: string; oldest_due_ms: number }[] };
      assert.equal(late.active, true); assert.deepEqual(late.processes, [{ workflow: "payments.lifecycle.payment", failures: 0, oldest_due_ms: 5 * 60_000 + 1 }]);
      await signals.sampleQueues();
      assert.deepEqual((await rows("process_queue_age")).map((r) => r.attributes), [{ workflow: "payments.lifecycle.payment", due_runs: 1, value: 5 * 60_000 + 1 }]);
    });

    await t.test("only admitted requests write rows and spans; a bad request line or an escaped error never crashes", async () => {
      const before = (await rows("operation_row")).length;
      const spansBefore = Number((await admin.query("select count(*) from app.completed_spans")).rows[0].count);
      const raw = (path: string) => fetch(base + path, { method: "POST", body: "{}" }).then((r) => r.status);
      for (let i = 0; i < 20; i++) assert.equal(await raw("/admin/org"), 401);
      assert.equal(await raw("/ready"), 503);
      for (let i = 0; i < 5; i++) assert.equal(await raw("/unsigned/fail"), 500);
      // Sites' lookup before it has authenticated a provisioning caller: answered, never counted.
      for (let i = 0; i < 5; i++) assert.equal(await fetch(base + "/admin/org-info", { method: "POST", body: "{}", headers: { "x-capxul-preauth": "1" } }).then((r) => r.status), 404);
      // The mark is honoured on /admin/org-info only: on any other signed rpc it withholds nothing.
      assert.equal(await call("/books/annotations/refuse", { "x-capxul-preauth": "1" }), 400);
      // Aborted uploads to a real rpc's path: the caller hangs up mid-body, before any door.
      for (let i = 0; i < 5; i++) await new Promise<void>((done) => {
        const socket = connect((server.address() as { port: number }).port, "127.0.0.1", () => {
          socket.write("POST /books/aborted HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{\"a\":"); setTimeout(() => { socket.destroy(); done(); }, 30);
        });
      });
      // A request line that is no URL: Node hands it to the handler, which must answer, not crash Core.
      const answered = await new Promise<string>((done) => {
        const socket = connect((server.address() as { port: number }).port, "127.0.0.1", () => socket.write("POST //[ HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{}"));
        let text = ""; socket.on("data", (d) => { text += d; socket.end(); }); socket.on("close", () => done(text));
      });
      assert.match(answered, /^HTTP\/1\.1 \d{3}/, "the server is still up and answered");
      assert.equal(await call("/escape"), 500);
      await new Promise((r) => setTimeout(r, 100));
      const after = await rows("operation_row");
      assert.deepEqual(after.slice(before).map((r) => [r.attributes.rpc, r.attributes.outcome]), [["books.annotations.refuse", "refused"], ["escape", "failed"]],
        "of all these, only the admitted refuse and /escape wrote rows; the pre-auth lookups wrote none");
      const spans = (await admin.query("select event->>'name' as name from app.completed_spans")).rows.slice(spansBefore).map((r) => r.name);
      assert.deepEqual(spans, ["rpc.books.annotations.refuse", "rpc.escape"], "and only their spans; a 401, a probe, a bad request line, an aborted body or an unsigned call writes none");
      assert.equal(((await alert("rpc_failing")) as { rpcs: { rpc: string }[] }).rpcs.some((r) => ["unsigned.fail", "books.aborted", "admin.org", "root"].includes(r.rpc)), false,
        "anonymous failures cannot fire rpc_failing");
      assert(!JSON.stringify(after).includes("private@"));
    });

    await t.test("a malformed stopped clock refuses; one queue source that fails reports its process stuck, and the route answers", async () => {
      await admin.query(`update app.world set clock='{"clockMode":"stopped","rate":1}'::jsonb`);
      await assert.rejects(signalNow(db.worker), /INVALID_CLOCK/, "never a silent fall back to host time");
      await setClock(T0);
      const solo = createSignals(db, { world: "world-a", paused: () => false });
      solo.addQueue({ workflow: "plugs.events.deliver", read: async () => { throw new Error(`PROVIDER_ERROR: ${secret}`); } });
      solo.addQueue({ workflow: "payments.lifecycle.payment", read: async () => ({ oldestDue: null, dueRuns: 0 }) });
      const stuck = (await solo.operatorAlerts()).alerts.find((a) => a.id === "process_stuck") as { active: boolean; processes: unknown[] };
      assert.equal(stuck.active, true);
      assert.deepEqual(stuck.processes, [{ workflow: "plugs.events.deliver", failures: 0, oldest_due_ms: 0, queue_error: "PROVIDER_ERROR" }]);
      const sampled = (await rows("process_queue_age")).length;
      await solo.sampleQueues();
      assert.deepEqual((await rows("process_queue_age")).slice(sampled).map((r) => r.attributes.workflow), ["payments.lifecycle.payment"], "an unreadable source writes no sample");
    });

    await t.test("a world without a stopped clock stamps host time; rows leave by their own window", async () => {
      await admin.query("update app.world set clock='{}'::jsonb");
      const host = Date.now(), at = await signalNow(db.worker);
      assert(Math.abs(at - host) < 5_000, "staging and production read RealTime");
      await admin.query("delete from app.signal_rows");
      await call("/books/annotations/save");
      assert(Math.abs(Number((await rows("operation_row"))[0].at) - host) < 5_000);
      assert.equal((await signals.operatorAlerts()).alerts.length, 2, "the alert route answers on every world");
      await setClock(T0);
      await admin.query("insert into app.signal_rows (body,at,attributes) values ('operation_row',$1,'{}'),('process_row',$1,'{}'),('process_row',$2,'{}')",
        [T0 - 15 * 60_000 - 1, T0 - 60 * 60_000 - 1]);
      await signals.sampleQueues();
      assert.deepEqual((await admin.query("select body,at from app.signal_rows where at < $1 order by body", [T0 - 15 * 60_000 + 1])).rows.map((r) => r.body), ["process_row"],
        "an operation_row past 15 minutes and a process_row past an hour are pruned; one inside its hour stays");
    });

    await t.test("plugs.payments.settle is late once an unconsumed final payment has waited over 5 world minutes", async () => {
      await admin.query(`create schema ponder; create table ponder.indexer_progress (chain_id int primary key, indexed_block bigint);
        create table app.organizations (org_id text primary key, safe text, token text);
        create table app.chain_payments (chain_id int, log_id text, sender text, token text, block_number bigint, block_time bigint);
        create table app.chain_logs (chain_id int, event text, args jsonb);
        create table app.consumed_facts (org_id text, log_id text);
        grant usage on schema ponder to capxul_worker; grant select on all tables in schema ponder to capxul_worker;
        grant select on app.organizations, app.chain_payments, app.chain_logs, app.consumed_facts to capxul_worker;
        insert into ponder.indexer_progress values (84532, 100);
        insert into app.organizations values ('acme','0xsafe','0xusdc'),('unborn','0xother','0xusdc');
        insert into app.chain_logs values (84532,'CompanySafeMinted','{"safe":"0xsafe"}');`);
      await admin.query("insert into app.chain_payments values (84532,'paid',  '0xsafe','0xusdc',90,$1),(84532,'due','0xsafe','0xusdc',95,$2),(84532,'fresh','0xsafe','0xusdc',99,$3),(84532,'unborn','0xother','0xusdc',90,$1)",
        [T0 - 60 * 60_000, T0 - 5 * 60_000 - 1, T0 - 60 * 60_000]);
      await admin.query("insert into app.consumed_facts values ('acme','paid')");
      const queue = settleQueue(84532, 2);
      assert.deepEqual(await queue.read(db.worker), { oldestDue: T0 - 5 * 60_000 - 1, dueRuns: 1 },
        "consumed, not yet final (block 99 > 100-2) and unborn companies' payments are not due");
      const quiet = createSignals(db, { world: "world-a", paused: () => false });
      quiet.addQueue(queue);
      const late = (await quiet.operatorAlerts()).alerts.find((a) => a.id === "process_stuck") as { active: boolean; processes: { workflow: string }[] };
      assert.equal(late.active, true); assert.deepEqual(late.processes.map((p) => p.workflow), ["plugs.payments.settle"]);
      await admin.query("insert into app.consumed_facts values ('acme','due')");
      assert.equal((await quiet.operatorAlerts()).alerts.find((a) => a.id === "process_stuck")!.active, false, "consumed: clears");
    });

    await t.test("a world paused for a snapshot writes no row and no span", async () => {
      const before = (await admin.query("select (select count(*) from app.signal_rows) + (select count(*) from app.completed_spans) as n")).rows[0].n;
      paused = true;
      assert.equal(await call("/books/annotations/save"), 200);
      await signals.processRun({ workflow: "plugs.events.deliver", concept: "plugs", trigger: "transition", key: "org-a" }, async () => true);
      await signals.sampleQueues();
      await new Promise((r) => setTimeout(r, 200)); // a write that should not happen would have landed by now
      const after = (await admin.query("select (select count(*) from app.signal_rows) + (select count(*) from app.completed_spans) as n")).rows[0].n;
      assert.equal(after, before);
      paused = false;
    });
  } finally {
    server.close(); await db.close(); await admin.end();
  }
});
