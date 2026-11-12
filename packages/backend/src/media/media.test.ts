import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { admit, expire, get, migrateMedia, upload, type MediaRuntime } from "./door.ts";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
test("upload admits purpose-specific byte headers, asymmetric pixel and size boundaries", () => {
  const bytes = png(301, 200);
  assert.deepEqual(admit({ purpose: "id-image", content_type: "image/png", bytes }), bytes);
  assert.throws(() => admit({ purpose: "id-image", content_type: "image/png", bytes: png(199, 301) }), /pixels/);
  assert.throws(() => admit({ purpose: "id-image", content_type: "image/png", bytes: png(301, 199) }), /pixels/);
  assert.throws(() => admit({ purpose: "image", content_type: "image/jpeg", bytes }), /bytes/);
  assert.throws(() => admit({ purpose: "image", content_type: "application/pdf", bytes: Buffer.from("%PDF-1.7") }), /type/);
  const max = Buffer.alloc(5 * 1024 * 1024); bytes.copy(max);
  assert.equal(admit({ purpose: "image", content_type: "image/png", bytes: max }).length, max.length);
  assert.throws(() => admit({ purpose: "image", content_type: "image/png", bytes: Buffer.concat([max, Buffer.from([0])]) }), /size/);
});

test("native files keep public image reads separate from private identity files and denied direct writers", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the explicitly disposable component database is accepted");
  const admin = new pg.Client({ connectionString: url.href }); await admin.connect();
  const coreUrl = new URL(url); coreUrl.username = "capxul_core"; coreUrl.password = "proof";
  const workerUrl = new URL(url); workerUrl.username = "capxul_worker"; workerUrl.password = "proof";
  const core = new pg.Client({ connectionString: coreUrl.href }); await core.connect();
  const worker = new pg.Client({ connectionString: workerUrl.href }); await worker.connect();
  const now = 2_000_000_000_000;
  let current = now;
  const runtime: MediaRuntime = {
    now: async () => current,
    transitioned: async (sql, props, at) => { await sql.query("insert into public.proof_file_events values($1,$2)", [props, at]); },
  };
  const as = async <T>(person: string, fn: () => Promise<T>) => {
    await core.query("begin");
    try {
      // Storage-level control, not a claim that this exercises the separate bearer-authentication door.
      await core.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id',$1,true),set_config('app.person_id',$1,true)", [person]);
      const result = await fn(); await core.query("commit"); return result;
    } catch (e) { await core.query("rollback"); throw e; }
  };
  try {
    await migrateMedia(admin);
    await admin.query("truncate app.files");
    // Transactional sink fixture, not a claim that the shared outbox has been composed.
    await admin.query("create table if not exists public.proof_file_events(props jsonb,at double precision); truncate public.proof_file_events; grant insert on public.proof_file_events to capxul_core,capxul_worker");
    const image = await as("person-a", () => upload(core, { purpose: "image", content_type: "image/png", bytes: png(17, 31) }, runtime));
    const held = await as("person-a", () => upload(core, { purpose: "document", content_type: "application/pdf", bytes: Buffer.from("%PDF-1.7\nprivate A") }, runtime));
    const other = await as("person-b", () => upload(core, { purpose: "id-image", content_type: "image/png", bytes: png(200, 201) }, runtime));
    assert.equal(held.expires_at, now + 1_800_000);
    assert.equal((await get(core, image.file_id))!.bytes.length, 33);
    assert.deepEqual((await core.query("select file_id from app.files order by file_id")).rows, [{ file_id: image.file_id }]);
    assert.deepEqual((await as("person-b", () => core.query("select file_id from app.files order by file_id"))).rows.map((r) => r.file_id).sort(), [image.file_id, other.file_id].sort());
    assert.equal(await as("person-b", () => get(core, held.file_id)), null);
    assert.equal(await get(core, "file_00000000000000000000000000"), null);
    for (const client of [core, worker]) for (const query of [
      "update app.files set bytes=null", "delete from app.files", "insert into app.files select * from app.files",
    ]) await assert.rejects(client.query(query), /permission denied/);
    await assert.rejects(upload(core, { purpose: "image", content_type: "image/png", bytes: png(3, 4) }, runtime), /NOT_AUTHENTICATED/);
    await assert.rejects(worker.query("select * from app.media_upload('file-forbidden','image','image/png',$1,$2)", [png(3, 4), now]), /permission denied/);
    await assert.rejects(as("person-a", () => core.query("select * from app.media_upload('file-small','id-image','image/png',$1,$2)", [png(199, 301), now])), /pixels/);
    await assert.rejects(as("person-a", () => upload(core, { purpose: "image", content_type: "image/png", bytes: png(7, 8) }, { ...runtime, transitioned: async () => { throw new Error("sink failed"); } })), /sink failed/);
    assert.equal((await admin.query("select count(*)::int as n from app.files")).rows[0].n, 3, "sink failure rolls back the birth");
    current = now + 1_799_999;
    assert.deepEqual(await expire(worker, runtime), []);
    await worker.end(); // No in-memory timer survives this boundary.
    const resumed = new pg.Client({ connectionString: workerUrl.href }); await resumed.connect();
    try {
      current = now + 1_800_000;
      await resumed.query("begin");
      assert.equal((await expire(resumed, runtime)).length, 2);
      await resumed.query("commit");
      assert.deepEqual(await expire(resumed, runtime), []);
      const rows = (await admin.query("select file_id,state,bytes from app.files order by file_id")).rows;
      assert.equal(rows.find((r) => r.file_id === image.file_id).state, "kept");
      for (const id of [held.file_id, other.file_id]) assert.deepEqual(rows.find((r) => r.file_id === id), { file_id: id, state: "expired", bytes: null });
      assert.equal((await admin.query("select * from public.proof_file_events")).rowCount, 5, "one event per birth or expiration, no replay events");
    } finally { await resumed.end(); }
  } finally { await core.end(); await worker.end().catch(() => {}); await admin.end(); }
});
