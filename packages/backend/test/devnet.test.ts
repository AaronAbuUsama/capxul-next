import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Database, exportAbandonedBranch, rewriteRestoredWorld } from "../src/devnet/door.ts";

const dir = process.env.CORE_PROOF_DIR;
if (!dir || process.env.CAPXUL_DISPOSABLE !== "true" || process.env.CAPXUL_WORLD === "main") throw new Error("CORE_PROOF_DIR and named disposable migrated Postgres/Ponder/v4 world required");
const fixture = JSON.parse(await readFile(`${dir}/fixture.json`, "utf8"));

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
