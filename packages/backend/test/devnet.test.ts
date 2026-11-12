import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Database, exportAbandonedBranch, readSnapshotCut, rewriteRestoredWorld, worldNow } from "../src/devnet/door.ts";
import { signature } from "../src/plugs/door.ts";
import { createCore } from "../src/server.ts";

const dir = process.env.CORE_PROOF_DIR;
if (!dir || process.env.CAPXUL_DISPOSABLE !== "true" || process.env.CAPXUL_WORLD === "main") throw new Error("CORE_PROOF_DIR and named disposable migrated Postgres/Ponder/v4 world required");
const fixture = JSON.parse(await readFile(`${dir}/fixture.json`, "utf8"));

test("business time follows frozen and restored database authority, never the host or an unanchored running clock", async () => {
  const database = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const client = await database.worker.connect();
  try {
    await client.query("BEGIN");
    for (const nowMs of [1772442000123, 1772443800123, 1772442000123]) {
      await client.query("update app.world set clock=$1", [{ nowMs, clockMode: "stopped", rate: 7 }]);
      assert.equal(await worldNow(client), nowMs, "explicit advancement and recovery must be visible in this transaction");
      await client.query("select pg_sleep(0.02)");
      assert.equal(await worldNow(client), nowMs, "a frozen instant cannot advance with real time");
    }
    await client.query("update app.world set clock=$1", [{ nowMs: 1772442000123, clockMode: "running", rate: 7 }]);
    await assert.rejects(worldNow(client), /UNSUPPORTED_CLOCK/);
    for (const clock of [{}, { nowMs: "1772442000123", clockMode: "stopped", rate: 1 },
      { nowMs: 1772442000123, clockMode: "stopped", rate: 61 }]) {
      await client.query("update app.world set clock=$1", [clock]);
      await assert.rejects(worldNow(client), /INVALID_CLOCK/);
    }
  } finally {
    await client.query("ROLLBACK"); client.release(); await database.close();
  }
});

test("public snapshot pause returns the numeric world epoch from real Postgres", { timeout: 10_000 }, async () => {
  const database = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const world = (await database.worker.query("select world_id,epoch,clock,lineage from app.world")).rows[0]!;
  const secret = "snapshot-epoch-regression";
  const core = createCore({
    database: process.env.DATABASE_URL!, workerDatabase: process.env.WORKER_DATABASE_URL!,
    secret, port: 0, host: "127.0.0.1", url: "http://127.0.0.1", frappe: "http://127.0.0.1:8000",
    ponder: process.env.PONDER_URL!, rpc: process.env.RPC_URL!, chainId: 84532,
    socket: "http://127.0.0.1:9000", startPaused: true, finality: 0, world: world.world_id,
  });
  try {
    await database.worker.query("update app.world set epoch=17");
    assert.equal((await database.worker.query("select epoch from app.world")).rows[0]!.epoch, "17", "pg bigint decoding must actually be exercised");
    const address = await core.start();
    assert(address && typeof address === "object");
    const raw = "{}";
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/snapshot/pause`, {
      method: "POST", body: raw, headers: { "x-capxul-signature": signature(raw, secret) }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const cut: any = await response.json();
    assert.equal(cut.epoch, 17, "pause must satisfy the strict numeric supervisor/recovery identity contract");
    assert.equal((await readSnapshotCut(database)).epoch, 17, "normalize at the exported storage door, not just the HTTP serializer");
    assert.equal(cut.world_id, world.world_id);
    assert.deepEqual(cut.clock, world.clock); assert.deepEqual(cut.lineage, world.lineage);
    assert.equal(cut.paused, true); assert.equal(cut.activeRequests, 0); assert.equal(cut.activeDeliveries, 0);
    console.log(JSON.stringify({ proof: "public-pause-numeric-epoch", storedType: "bigint/string", epoch: cut.epoch, paused: cut.paused }));
  } finally {
    await core.stop();
    await database.worker.query("update app.world set epoch=$1", [world.epoch]);
    await database.close();
  }
});

test("explicit restore rebases only mapped answer origins without changing approval identity or financial records", async () => {
  const database = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const run = Date.now(), org = `restore-${run}`, other = `unmapped-${run}`;
  const url = "https://old.core.test:8443/approve/original?return=%2Fbooks#sign";
  const answer = { org, request_id: "restore-answer", approval_id: "original", approval_url: url, requested_by: "payer@core.test" };
  const request = { site: "original.core.test", amount: "12.34", document_hash: fixture.documentHash };
  const before = await exportAbandonedBranch(database), world = before.world[0]!;
  try {
    for (const [i, slug] of [org, other].entries()) {
      await database.worker.query(`insert into app.organizations (org_id,name,safe,site,admin_email,token,request_cursor,last_ack)
        values ($1,$1,$2,$3,'payer@core.test',$4,7,11)`, [slug, `0x${String(run + i).padStart(40, "0")}`, `${slug}.core.test`, fixture.token]);
      await database.worker.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,'restore-answer',$2,$3)", [slug, request, { ...answer, org: slug }]);
    }
    await database.worker.query(`insert into app.approvals (org_id,id,request_id,request,status,trace,tx_hash)
      values ($1,'original','restore-answer',$2,'settled','restore-trace','0xsettled')`, [org, request]);
    await database.worker.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,'refused',$2,$3)", [org, request, { error: { code: "FORBIDDEN" }, approval_url: "" }]);
    const input = { worldId: `cloned-${run}`, epoch: 2, clock: { nowMs: 1000, clockMode: "stopped", rate: 1 },
      lineage: { snapshot: "fixture-cut", parentWorld: world.world_id, recordSeq: 0, recordHead: "fixture-head" }, sites: { [org]: "restored.core.test" } };
    const readAnswers = async () => (await database.worker.query("select org_id,request_id,request,answer from app.site_request_answers where org_id=any($1::text[]) order by org_id,request_id", [[org, other]])).rows;
    await rewriteRestoredWorld(database, input);
    const unchanged = await readAnswers();
    assert.equal(unchanged.find((r) => r.org_id === org && r.request_id === "restore-answer")!.answer.approval_url, url);
    await rewriteRestoredWorld(database, { ...input, coreUrl: "" });
    assert.deepEqual(await readAnswers(), unchanged);
    await assert.rejects(rewriteRestoredWorld(database, { ...input, coreUrl: "file:///not-a-gateway" }), /INVALID_CORE_URL/);
    await rewriteRestoredWorld(database, { ...input, coreUrl: "http://restored.core.test:19090/ignored?ignored#ignored" });
    const rows = await readAnswers();
    assert.deepEqual(rows.find((r) => r.org_id === org && r.request_id === "restore-answer"), {
      org_id: org, request_id: "restore-answer", request: { ...request, site: "restored.core.test" },
      answer: { ...answer, approval_url: "http://restored.core.test:19090/approve/original?return=%2Fbooks#sign" },
    });
    assert.deepEqual(rows.find((r) => r.org_id === other), { org_id: other, request_id: "restore-answer", request, answer: { ...answer, org: other } });
    assert.deepEqual(rows.find((r) => r.request_id === "refused")!.answer, { error: { code: "FORBIDDEN" }, approval_url: "" });
    const approval = (await database.worker.query("select id,status,trace,tx_hash,request from app.approvals where org_id=$1", [org])).rows[0];
    assert.deepEqual(approval, { id: "original", status: "settled", trace: "restore-trace", tx_hash: "0xsettled", request: { ...request, site: "restored.core.test" } });
    assert.deepEqual((await database.worker.query("select request_cursor,last_ack from app.organizations where org_id=$1", [org])).rows[0], { request_cursor: "7", last_ack: "11" });
    assert.deepEqual((await exportAbandonedBranch(database)).records, before.records);
    console.log(JSON.stringify({ proof: "explicit-restore-answer-origin", preserved: ["path", "query", "fragment", "identity", "status", "trace", "cursors", "hashed-records"], unmappedUnchanged: true, emptyUnchanged: true }));
  } finally {
    await database.worker.query("update app.world set world_id=$1,epoch=$2,clock=$3,lineage=$4", [world.world_id, world.epoch, world.clock, world.lineage]);
    await database.close();
  }
});
