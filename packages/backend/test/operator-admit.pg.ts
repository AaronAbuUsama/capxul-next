import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { accessRoutes } from "../src/access/mount.ts";
import { signature } from "../src/plugs/door.ts";
import { createCore } from "../src/server.ts";

// Real Core HTTP server on a disposable migrated database: the operator wave is reachable only with the HMAC operator key.
const url = process.env.OPERATOR_TEST_ADMIN_URL;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || !new URL(url).pathname.startsWith("/access_") ||
    !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("OPERATOR_TEST_ADMIN_URL must name a disposable loopback /access_* database");

test("accounts.admission.admit refuses unsigned, wrongly signed and session-only callers; the operator key admits", async () => {
  const role = (name: string) => { const u = new URL(url); u.username = name; u.password = randomBytes(12).toString("hex"); return u.href; };
  const env = { ...process.env, PG_ADMIN_URL: url, DATABASE_URL: role("capxul_core"), WORKER_DATABASE_URL: role("capxul_worker"),
    PONDER_DATABASE_URL: role("capxul_ponder"), CAPXUL_WORLD: "operator-admit" };
  const migrated = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("../src/migrate.ts", import.meta.url).pathname], { env, encoding: "utf8" });
  assert.equal(migrated.status, 0, migrated.stderr);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const now = 1_791_555_000_000;
  await admin.query("update app.world set clock=$1", [{ nowMs: now, clockMode: "stopped", rate: 1 }]);
  const record = JSON.parse(readFileSync(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const deploymentFile = join(mkdtempSync(join(tmpdir(), "operator-admit-")), "deployment.json");
  writeFileSync(deploymentFile, JSON.stringify({ companiesHouse: record.companiesHouse, agentOwner: record.contracts.AgentOwner.address }));
  const secret = randomBytes(16).toString("hex");
  let code = "";
  const mail = { async send(m: { text?: string }) { code = m.text!.match(/\b\d{6}\b/)![0]; return { id: randomBytes(4).toString("hex") }; } };
  const core = createCore({ database: env.DATABASE_URL, workerDatabase: env.WORKER_DATABASE_URL, secret, port: 0, host: "127.0.0.1",
    url: "http://127.0.0.1", frappe: "http://127.0.0.1:1", ponder: "http://127.0.0.1:1", rpc: "http://127.0.0.1:1", chainId: 84532,
    socket: "http://127.0.0.1:1", startPaused: false, finality: 0, world: "operator-admit" }, undefined,
  () => accessRoutes({ mail, secret, coreUrl: "http://127.0.0.1", rpc: "http://127.0.0.1:1", deploymentFile, namespace: "capxul:devnet:email:v1" }));
  const address = await core.start();
  const base = `http://127.0.0.1:${(address as { port: number }).port}`;
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  try {
    // A real person session from the public route, to show a bearer alone is not operator authority.
    const person = `operator-admit-${randomBytes(3).toString("hex")}@example.test`;
    assert.equal((await post("/access/sign-in/send-code", JSON.stringify({ email: person }))).status, 200);
    const session = await (await post("/access/sign-in/verify-code", JSON.stringify({ email: person, code, client: "operator-admit" }))).json() as { token: string };
    assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
    const target = `wave-${randomBytes(3).toString("hex")}@example.test`;
    const raw = JSON.stringify({ emails: [target], by: "ops" });
    const refused = [
      await post("/admin/accounts/admit", raw),
      await post("/admin/accounts/admit", raw, { authorization: `Bearer ${session.token}` }),
      await post("/admin/accounts/admit", raw, { authorization: `Bearer ${session.token}`, "x-capxul-signature": signature(raw, "not-the-operator-key") }),
      await post("/admin/accounts/admit", raw, { "x-capxul-signature": signature(JSON.stringify({ emails: [target], by: "other" }), secret) }),
    ];
    assert.deepEqual(refused.map((r) => r.status), [401, 401, 401, 401]);
    assert.equal((await admin.query("select 1 from app.admissions where email=$1", [target])).rowCount, 0);
    assert.equal((await admin.query("select 1 from app.transition_outbox where event->>'name'='waitlist_entry_transitioned'")).rowCount, 0);
    const signed = await post("/admin/accounts/admit", raw, { "x-capxul-signature": signature(raw, secret) });
    assert.equal(signed.status, 200);
    assert.deepEqual(await signed.json(), { admitted: [target], already: [], invalid: [] });
    assert.equal((await admin.query("select admitted_by from app.admissions where email=$1", [target])).rows[0].admitted_by, "operator:ops");
  } finally { await core.stop(); await admin.end(); }
});
