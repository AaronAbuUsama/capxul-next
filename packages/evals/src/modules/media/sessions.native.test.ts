import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Database, worldNow } from "../../../../backend/src/devnet/door.ts";
import { migrateMedia, routeMedia } from "../../../../backend/src/media/door.ts";
import { migrateOutbox } from "../../../../backend/src/platform/outbox.ts";

// Access by URL, as in ../storage/actors.ts: evals' stricter compile must not traverse backend internals.
const { authenticate, sendCode, verifyCode } = await import(new URL("../../../../backend/src/access/door.ts", import.meta.url).href) as {
  authenticate(sql: unknown, bearer: string, now: number): Promise<unknown>;
  sendCode(sql: unknown, input: { email: string }, mail: unknown, now: number): Promise<unknown>;
  verifyCode(sql: unknown, input: { email: string; code: string; client: string }, config: unknown, now: number):
    Promise<{ ok: true; value: { personId: string; token: string; safe: string } } | { ok: false }>;
};

// Runner regression with a component HTTP/receipt/actors fixture; never selected-stack or acceptance evidence.
test("native media runner proves files tenancy and kept-image admission through real bearers and the public route", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the disposable component database is accepted");
  const tenant = new URL(url); tenant.username = "capxul_core"; tenant.password = "proof";
  const workerUrl = new URL(url); workerUrl.username = "capxul_worker"; workerUrl.password = "proof";
  const admin = new Database(url.href, url.href);
  const db = new Database(tenant.href, workerUrl.href);
  const directory = await mkdtemp(join(tmpdir(), "media-sessions-regression-"));
  const now = Date.UTC(2026, 10, 13, 12);
  const prior = (await admin.tenant.query("select world_id,epoch,clock from app.world")).rows[0];
  const access = await readFile(new URL("../../../../backend/src/access/schema.sql", import.meta.url), "utf8");
  // Stands in for the composed Core mount: the real router, Access.authenticate and worldNow on one tenant transaction.
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") return response.end(JSON.stringify({ world: prior.world_id, storage: "postgres", indexer: "ponder" }));
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    const bearer = String(request.headers.authorization ?? "").replace(/^Bearer /, "");
    try {
      const out = await db.transaction("", (sql) => routeMedia(sql, request.url!, JSON.parse(Buffer.concat(chunks).toString()), bearer, { authenticate, now: worldNow }));
      response.statusCode = out?.status ?? 404; response.end(JSON.stringify(out?.body ?? null));
    } catch (error) { response.statusCode = /NOT_AUTHENTICATED/.test(String(error)) ? 401 : 400; response.end(JSON.stringify({ error: "refused" })); }
  });
  try {
    await admin.tenant.query("begin");
    await migrateOutbox(admin.tenant as never); await admin.tenant.query(access);
    await admin.tenant.query("commit");
    const sql = await admin.tenant.connect();
    try { await migrateMedia(sql); } finally { sql.release(); }
    await admin.tenant.query("update app.world set epoch=3,clock=$1", [{ nowMs: now, clockMode: "stopped", rate: 1 }]);
    // Fixture for Runtime's post-restore public sign-in: the same Access sendCode/verifyCode, run here.
    const actors: Record<string, unknown> = {};
    for (const role of ["ordinarySeat", "books", "outsider", "person", "agent"]) {
      let text = "";
      const email = `${role.toLowerCase()}-${now}@media-runner.test`;
      await db.transaction("", (s) => sendCode(s, { email }, { send: async (m: { text: string }) => { text = m.text; } } as never, now), true);
      const out = await db.transaction("", (s) => verifyCode(s, { email, code: /(\d{6})/.exec(text)![1]!, client: "runner" },
        { companiesHouse: "0x1000000000000000000000000000000000000001", namespace: "media-runner" }, now), true);
      assert(out.ok);
      actors[role] = { principalId: out.value.personId, bearer: out.value.token, kind: "person", safe: out.value.safe };
    }
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const run = { id: "media-sessions-regression-not-acceptance", at: "2026-11-13T00:00:00Z", commit: "regression-fixture" };
    await writeFile(join(directory, "receipt.json"), JSON.stringify({
      version: 1, ...run, state: "running", requested: [], evals: [], screens: [],
      environment: { world: "slice-zero", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: {} },
      scripts: [{ script: "packages/evals/src/modules/media/run.sh", exitCode: null, signal: null }],
    }));
    await writeFile(join(directory, "preparation.json"), JSON.stringify({ run, world: { id: prior.world_id, epoch: 3 } }));
    const actorsFile = join(directory, "..", `${directory.split("/").pop()}-actors.json`);
    const execute = async (world: { id: string; epoch: number }) => {
      await writeFile(actorsFile, JSON.stringify({ version: 1, run, world, actors })); await chmod(actorsFile, 0o600);
      return new Promise<string>((resolve, reject) => {
        const child = spawn("bash", [fileURLToPath(new URL("./run.sh", import.meta.url))], {
          env: { ...process.env, CAPXUL_EVAL_RUN_DIR: directory, CAPXUL_STORAGE_EVAL_DATABASE: tenant.href,
            CAPXUL_CORE_URL: `http://127.0.0.1:${address.port}`, CAPXUL_ACCESS_ACTORS: actorsFile }, stdio: ["ignore", "pipe", "pipe"],
        });
        let output = ""; child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
        child.on("error", reject); child.on("close", () => resolve(output));
      });
    };
    const good = await execute({ id: prior.world_id, epoch: 3 });
    for (const name of ["schema", "closed-table-writes", "tenancy", "admits"]) assert.match(good, new RegExp(`MEDIA\\.${name}\\tpass`), good);
    const tenancy = JSON.parse(await readFile(join(directory, "media", "tenancy.json"), "utf8"));
    assert.equal(tenancy.unsignedUploadStatus, 401);
    assert.doesNotMatch(await readFile(join(directory, "media", "tenancy.json"), "utf8"), /bearer|token/i);
    // Bearers from another incarnation of the world are not this run's actors.
    const stale = await execute({ id: prior.world_id, epoch: 2 });
    assert.match(stale, /MEDIA\.schema\tpass/); assert.match(stale, /MEDIA\.tenancy\tfail/); assert.match(stale, /MEDIA\.admits\tfail/);
    await rm(actorsFile, { force: true });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await admin.tenant.query("update app.world set epoch=$1,clock=$2", [prior.epoch, prior.clock]);
    await db.close(); await admin.close(); await rm(directory, { recursive: true, force: true });
  }
});
