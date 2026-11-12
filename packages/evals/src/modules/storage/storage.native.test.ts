import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { migrateMedia } from "../../../../backend/src/media/door.ts";

test("native storage runner refuses another incarnation of the same world", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the disposable component database is accepted");
  const admin = new Database(url.href, url.href);
  const tenant = new URL(url); tenant.username = "capxul_core"; tenant.password = "proof";
  const directory = await mkdtemp(join(tmpdir(), "storage-epoch-regression-"));
  const world = (await admin.tenant.query("select world_id,epoch from app.world")).rows[0];
  // This HTTP/receipt fixture is a runner regression, never selected-stack or acceptance evidence.
  const server = createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ world: world.world_id, storage: "postgres", indexer: "ponder" }));
  });
  try {
    const sql = await admin.tenant.connect();
    try { await migrateMedia(sql); } finally { sql.release(); }
    await admin.tenant.query("update app.world set epoch=7");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const run = { id: "runner-regression-not-acceptance", at: "2026-11-12T00:00:00Z", commit: "regression-fixture" };
    await writeFile(join(directory, "receipt.json"), JSON.stringify({
      version: 1, ...run, state: "running", requested: [], evals: [], screens: [],
      environment: { world: "slice-zero", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: {} },
      scripts: [{ script: "packages/evals/src/modules/media/run.sh", exitCode: null, signal: null }],
    }));
    const execute = async (epoch: unknown) => {
      await writeFile(join(directory, "preparation.json"), JSON.stringify({ run, world: { id: world.world_id, epoch } }));
      return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn("bash", [fileURLToPath(new URL("../media/run.sh", import.meta.url))], {
          env: { ...process.env, CAPXUL_EVAL_RUN_DIR: directory, CAPXUL_STORAGE_EVAL_DATABASE: tenant.href,
            CAPXUL_CORE_URL: `http://127.0.0.1:${address.port}` }, stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (data) => { output += data; });
        child.stderr.on("data", (data) => { output += data; });
        child.on("error", reject); child.on("close", (code) => resolve({ code, output }));
      });
    };
    const current = await execute(7);
    assert.equal(current.code, 0, current.output);
    assert.match(current.output, /MEDIA\.schema\tpass/);
    for (const epoch of [8, undefined, "7", 0, 7.5]) {
      const stale = await execute(epoch);
      assert.equal(stale.code, 1, `epoch ${String(epoch)}: ${stale.output}`);
      assert.match(stale.output, /MEDIA\.schema\tfail/);
      assert.doesNotMatch(stale.output, /\tpass\t/);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await admin.tenant.query("update app.world set epoch=$1", [world.epoch]);
    await admin.close(); await rm(directory, { recursive: true, force: true });
  }
});
