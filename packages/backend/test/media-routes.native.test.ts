import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { worldNow } from "../src/devnet/door.ts";
import { migrateOutbox, readEvent } from "../src/platform/outbox.ts";
import { routeDocuments } from "../src/documents/door.ts";
import { mediaRuntime, migrateMedia, routeMedia, tickMedia, upload } from "../src/media/door.ts";

test("native media hooks use canonical clock and real transactional outbox; authenticated routes fail closed", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof");
  const sql = new pg.Client({ connectionString: url.href }); await sql.connect();
  const now = 2_100_000_000_123;
  const denied = { now: worldNow, authenticate: async () => { throw new Error("NOT_AUTHENTICATED: closed dependency"); } };
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(17, 16); bytes.writeUInt32BE(31, 20);
  const scope = async () => {
    // Explicit storage-level fixture, never a positive opaque-session/Seat proof or substitute.
    await sql.query("set local role capxul_core; select set_config('app.person_id','route-storage',true),set_config('app.owner_kind','person',true),set_config('app.owner_id','route-storage',true)");
  };
  const clock = async (at: number, mode = "stopped") => {
    await sql.query("reset role");
    await sql.query("update app.world set clock=$1", [{ nowMs: at, clockMode: mode, rate: 1 }]);
  };
  try {
    await sql.query("begin");
    await migrateMedia(sql); await migrateOutbox(sql);
    await sql.query("truncate app.files,app.transition_outbox,app.transition_acks,app.transition_failures");
    await sql.query("create table if not exists app.world(clock jsonb); grant select on app.world to capxul_core,capxul_worker");
    if (!(await sql.query("select 1 from app.world")).rowCount) await sql.query("insert into app.world(clock) values('{}')");
    await clock(now); await scope();
    await assert.rejects(routeMedia(sql, "/media/files/upload", { person_id: "forged", bytesBase64: bytes.toString("base64"), purpose: "image", content_type: "image/png" }, "invalid", denied), /NOT_AUTHENTICATED/);
    for (const path of ["/documents/reading/get", "/documents/reading/verify"])
      await assert.rejects(routeDocuments(sql, path, { safe: "forged" }, "invalid", denied), /NOT_AUTHENTICATED/);
    assert.equal(await routeMedia(sql, "/unknown", {}, "", denied), null);
    assert.equal(await routeDocuments(sql, "/unknown", {}, "", denied), null);
    const image = await upload(sql, { purpose: "image", content_type: "image/png", bytes }, mediaRuntime(worldNow, "native-route"));
    const birth = await readEvent(sql, `media:${image.file_id}:keep`);
    assert.equal(birth?.at, now); assert.equal(birth?.actor, "route-storage");
    assert.equal(birth?.owner_id, "route-storage"); assert.equal(birth?.trace_id, "native-route");
    await sql.query("select set_config('app.person_id','',true),set_config('app.owner_kind','',true),set_config('app.owner_id','',true)");
    assert.deepEqual(await routeMedia(sql, "/media/files/get", { file_id: image.file_id }, "", denied), {
      status: 200, body: { file_id: image.file_id, content_type: "image/png", size: 33, bytesBase64: bytes.toString("base64") },
    });
    await scope();
    const held = await upload(sql, { purpose: "document", content_type: "application/pdf", bytes: Buffer.from("%PDF-1.7\nprivate") }, mediaRuntime(worldNow));
    assert.equal(held.expires_at, now + 1_800_000);
    assert.deepEqual(await routeMedia(sql, "/media/files/get", { file_id: held.file_id }, "", denied), { status: 200, body: null });
    await clock(now + 1_799_999); await sql.query("set local role capxul_worker");
    assert.deepEqual(await tickMedia(sql, worldNow), []);
    await clock(now + 1_800_000); await sql.query("set local role capxul_worker");
    const ended = await tickMedia(sql, worldNow, "expiry"); assert.equal(ended.length, 1);
    assert.equal(ended[0]!.file_id, held.file_id); assert.deepEqual(await tickMedia(sql, worldNow), []);
    const end = await readEvent(sql, `media:${held.file_id}:expire`);
    assert.equal(end?.at, now + 1_800_000); assert.equal(end?.actor, null);
    await sql.query("reset role");
    assert.deepEqual((await sql.query("select state,bytes from app.files where file_id=$1", [held.file_id])).rows, [{ state: "expired", bytes: null }]);
    assert.equal((await sql.query("select count(*)::int n from app.transition_outbox")).rows[0].n, 3);
    await sql.query("savepoint outbox_failure; revoke insert on app.transition_outbox from capxul_core");
    await scope();
    await assert.rejects(upload(sql, { purpose: "image", content_type: "image/png", bytes }, mediaRuntime(worldNow)), /permission denied/);
    await sql.query("rollback to savepoint outbox_failure");
    assert.equal((await sql.query("select count(*)::int n from app.files")).rows[0].n, 2, "real outbox failure rolls back file insertion");
    await clock(now + 2_000_000, "running"); await scope();
    await assert.rejects(routeMedia(sql, "/media/files/upload", {}, "", denied), /UNSUPPORTED_CLOCK/);
    await assert.rejects(routeDocuments(sql, "/documents/reading/get", {}, "", denied), /UNSUPPORTED_CLOCK/);
  } finally { await sql.query("rollback"); await sql.end(); }
});
