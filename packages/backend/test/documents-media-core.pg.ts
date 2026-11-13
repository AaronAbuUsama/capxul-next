import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { request } from "node:http";
import pg from "pg";
import { accessRoutes } from "../src/access/mount.ts";
import { documentsRoutes } from "../src/documents/mount.ts";
import { mediaRoutes } from "../src/media/mount.ts";
import { createCore } from "../src/server.ts";

// Real Core HTTP server on a disposable migrated database: documents/media mounted on Access's shared bearer dispatch,
// migrated by the real migrate.ts chain, and media expiry run by Core's worker loop on the world clock.
const url = process.env.MEDIA_TEST_ADMIN_URL;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || !new URL(url).pathname.startsWith("/media_") ||
    !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("MEDIA_TEST_ADMIN_URL must name a disposable loopback /media_* database");

test("real Core: documents/media mounts, Access bearer, and held-file expiry in the worker loop", async () => {
  const role = (name: string) => { const u = new URL(url); u.username = name; u.password = randomBytes(12).toString("hex"); return u.href; };
  const env = { ...process.env, PG_ADMIN_URL: url, DATABASE_URL: role("capxul_core"), WORKER_DATABASE_URL: role("capxul_worker"),
    PONDER_DATABASE_URL: role("capxul_ponder"), CAPXUL_WORLD: "mount-proof" };
  const migrated = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("../src/migrate.ts", import.meta.url).pathname], { env, encoding: "utf8" });
  assert.equal(migrated.status, 0, migrated.stderr);
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const now = 1_791_555_000_000;
  await admin.query("update app.world set clock=$1", [{ nowMs: now, clockMode: "stopped", rate: 1 }]);
  const record = JSON.parse(readFileSync(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const deploymentFile = join(mkdtempSync(join(tmpdir(), "mount-proof-")), "deployment.json");
  writeFileSync(deploymentFile, JSON.stringify({ companiesHouse: record.companiesHouse, agentOwner: record.contracts.AgentOwner.address }));
  const secret = randomBytes(16).toString("hex"); let code = "";
  const mail = { async send(m: { text?: string }) { code = m.text!.match(/\b\d{6}\b/)![0]; return { id: "x" }; } };
  const core = createCore({ database: env.DATABASE_URL, workerDatabase: env.WORKER_DATABASE_URL, secret, port: 0, host: "127.0.0.1",
    url: "http://127.0.0.1", frappe: "http://127.0.0.1:1", ponder: "http://127.0.0.1:1", rpc: "http://127.0.0.1:1", chainId: 84532,
    socket: "http://127.0.0.1:1", startPaused: false, finality: 0, world: "mount-proof" }, undefined,
  () => [...accessRoutes({ mail, secret, coreUrl: "http://127.0.0.1", rpc: "http://127.0.0.1:1", deploymentFile, namespace: "capxul:devnet:email:v1" }), ...documentsRoutes(), ...mediaRoutes()]);
  const address = await core.start();
  const base = `http://127.0.0.1:${(address as { port: number }).port}`;
  const post = async (path: string, body: unknown, bearer?: string) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  try {
    const email = `mount-${randomBytes(3).toString("hex")}@example.test`;
    assert.equal((await post("/access/sign-in/send-code", { email })).status, 200);
    const token = (await post("/access/sign-in/verify-code", { email, code, client: "mount" })).body.token as string;
    const png = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(13, 8); png.write("IHDR", 12); png.writeUInt32BE(17, 16); png.writeUInt32BE(31, 20);
    const image = await post("/media/files/upload", { purpose: "image", content_type: "image/png", bytesBase64: png.toString("base64") }, token);
    assert.equal(image.status, 200, JSON.stringify(image.body));
    const held = await post("/media/files/upload", { purpose: "document", content_type: "application/pdf", bytesBase64: Buffer.from("%PDF-1.7\nx").toString("base64") }, token);
    assert.equal(held.status, 200);
    assert.equal((await post("/media/files/upload", { purpose: "image", content_type: "image/png", bytesBase64: png.toString("base64") })).status, 401);
    const big = "A".repeat(2 * 1024 * 1024);
    // An early answer may close the socket mid-upload; read the status as soon as the response arrives.
    const early = (path: string, body: string) => new Promise<number>((resolve, reject) => {
      const req = request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" } }, (res) => { resolve(res.statusCode!); res.resume(); });
      req.on("error", (e) => (e as NodeJS.ErrnoException).code === "ECONNRESET" || (e as NodeJS.ErrnoException).code === "EPIPE" ? undefined : reject(e));
      req.end(body);
    });
    assert.equal(await early("/media/files/upload", JSON.stringify({ purpose: "document", content_type: "application/pdf", bytesBase64: big })), 401);
    assert.equal(await early("/media/files/get", JSON.stringify({ file_id: big })), 413);
    // A signed-in caller at an unknown path under /media/files/ does not inherit upload's 32 MB limit.
    const near = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/media/files/uploadX`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` } }, (res) => { resolve(res.statusCode!); res.resume(); });
      req.on("error", (e) => (e as NodeJS.ErrnoException).code === "ECONNRESET" || (e as NodeJS.ErrnoException).code === "EPIPE" ? undefined : reject(e));
      req.end(JSON.stringify({ purpose: "document", content_type: "application/pdf", bytesBase64: big }));
    });
    assert.equal(near, 413);
    assert.deepEqual((await post("/media/files/get", { file_id: image.body.file_id })).body.bytesBase64, png.toString("base64"));
    assert.deepEqual(await post("/media/files/get", { file_id: held.body.file_id }), { status: 200, body: null });
    const pair = { documentHash: `0x${"1".repeat(64)}`, contentHash: `0x${"2".repeat(64)}` };
    assert.equal((await post("/documents/reading/verify", pair)).status, 401);
    assert.equal((await post("/documents/reading/verify", pair, token)).status, 400);
    // Expiry runs in Core's worker loop on the world clock: nothing before the deadline, expired at it.
    await admin.query("update app.world set clock=$1", [{ nowMs: now + 1_799_999, clockMode: "stopped", rate: 1 }]);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await admin.query("select state from app.files where file_id=$1", [held.body.file_id])).rows[0].state, "held");
    await admin.query("update app.world set clock=$1", [{ nowMs: now + 1_800_000, clockMode: "stopped", rate: 1 }]);
    let state = "held";
    for (let i = 0; i < 30 && state === "held"; i++) { await new Promise((r) => setTimeout(r, 200)); state = (await admin.query("select state from app.files where file_id=$1", [held.body.file_id])).rows[0].state; }
    assert.equal(state, "expired");
    const event = (await admin.query("select event from app.transition_outbox where id=$1", [`media:${held.body.file_id}:expire`])).rows[0]?.event;
    assert.equal(event?.at, now + 1_800_000);
  } finally { await core.stop(); await admin.end(); }
});
