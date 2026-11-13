import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { get, migrateDocuments, store, type StoreInput } from "./door.ts";

test("native store shares subject rollback, replays immutably and refuses missing participation", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the explicitly disposable component database is accepted");
  const sql = new pg.Client({ connectionString: url.href }); await sql.connect();
  try {
    await sql.query("begin");
    // Closed dependency fixture for this negative read/atomicity test only, never an admission stand-in.
    // Nothing is persisted, and no bearer/Seat/participant/selected-stack claim is made here.
    if (!(await sql.query("select to_regprocedure('app.caller_safes()') as f")).rows[0].f) {
      await sql.query("create function app.caller_safes() returns text[] language sql as $$ select '{}'::text[] $$");
    }
    if (!(await sql.query("select to_regprocedure('app.current_member(text)') as f")).rows[0].f) {
      await sql.query("create function app.current_member(text) returns boolean language sql as $$ select false $$");
    }
    await migrateDocuments(sql);
    await sql.query("set local role capxul_core; select set_config('app.owner_kind','person',true),set_config('app.owner_id','native-owner',true)");
    // Owner labels are not authentication: Access's person_id is what admits a Core store and the owner's own rows.
    await sql.query("savepoint unauthenticated");
    await assert.rejects(store(sql, { owner_kind: "person", owner_id: "native-owner", subject: { kind: "payment", id: "native-labels" }, chain_id: 84532,
      issued_at: 1700000000123, participants: [{ safe: "0x1111111111111111111111111111111111111111", party_id: null, role: "payer" }],
      content: { kind: "receipt", media_type: "application/json", bytes: Buffer.from("{}"), filename: null } }, async () => 1700000000123), /FORBIDDEN: document owner/);
    await sql.query("rollback to savepoint unauthenticated");
    await sql.query("select set_config('app.person_id','native-owner',true)");
    const input: StoreInput = {
      owner_kind: "person", owner_id: "native-owner", subject: { kind: "payment", id: "native-atomic-1" },
      chain_id: 84532, issued_at: 1700000000123,
      participants: [{ safe: "0x1111111111111111111111111111111111111111", party_id: null, role: "payer" }],
      content: { kind: "receipt", media_type: "application/json", bytes: Buffer.from('{ "native": 7 }'), filename: null },
    };
    const count = async () => Number((await sql.query("select count(*) as n from app.documents where owner_id='native-owner'")).rows[0].n);
    const before = await count();
    await sql.query("savepoint subject");
    const first = await store(sql, input, async () => 1700000000123);
    assert.equal(first.replayed, false);
    const second = await store(sql, input, async () => 1700000000124);
    assert.equal(second.replayed, true); assert.equal(first.document_id, second.document_id);
    assert.equal(await count(), before + 1);
    await assert.rejects(get(sql, { documentHash: first.document_hash, contentHash: first.content_hash }), /not found/);
    await sql.query("rollback to savepoint subject");
    assert.equal(await count(), before);
    await store(sql, input, async () => 1700000000123);
    await sql.query("savepoint conflict");
    await assert.rejects(store(sql, { ...input, subject: { kind: "payment", id: "different-subject" } }, async () => 1700000000123), /pair conflict/);
    await sql.query("rollback to savepoint conflict");
    await sql.query("savepoint immutable");
    await assert.rejects(sql.query("update app.documents set bytes='\\x00'::bytea"), /permission denied/);
    await sql.query("rollback to savepoint immutable");
  } finally { await sql.query("rollback"); await sql.end(); }
});
