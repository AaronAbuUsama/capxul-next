import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { authenticate, migrateAccess, revoke, sendCode, verifyCode } from "../access/door.ts";
import { migrateAgents } from "../agents/door.ts";
import { migrateMedia, upload, get as getFile } from "../media/door.ts";
import { migrate as migrateSeats } from "../organizations/door.ts";
import { register, resolveRecipient } from "../parties/door.ts";
import { migrateOutbox } from "../platform/outbox.ts";
import { get as getDocument, migrateDocuments, store, type StoreInput } from "./door.ts";
import { documentsRoutes } from "./mount.ts";

// Component proof with Access's real sign-in/authenticate and Seat's real caller_safes/current_member.
// Seat and agent rows are superuser fixtures: no Seat or agent writer exists yet. Not selected-stack acceptance.
test("native sessions: tenants and admissions on documents, files and agents follow Access and Seat, never labels", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the explicitly disposable component database is accepted");
  const sql = new pg.Client({ connectionString: url.href }); await sql.connect();
  const config = { companiesHouse: "0x1000000000000000000000000000000000000001" as const, namespace: "sessions-native" };
  const now = Date.UTC(2026, 10, 13, 12);
  // Each step runs on one role in a savepoint; labels exist only if Access.authenticate (or the test) set them.
  const step = async <T>(role: string, bearer: string | null, fn: () => Promise<T>) => {
    await sql.query("savepoint step; set local role none");
    await sql.query("select set_config('app.person_id','',true),set_config('app.owner_kind','',true),set_config('app.owner_id','',true),set_config('app.org_id','',true)");
    await sql.query(`set local role ${role}`);
    try {
      if (bearer) await authenticate(sql, bearer, now);
      const result = await fn(); await sql.query("release savepoint step"); return result;
    } catch (error) { await sql.query("rollback to savepoint step"); throw error; }
  };
  const as = <T>(bearer: string | null, fn: () => Promise<T>) => step("capxul_core", bearer, fn);
  const worker = <T>(fn: () => Promise<T>) => step("capxul_worker", null, fn);
  const ids = async (query: string) => (await sql.query(query)).rows.map((r) => Object.values(r)[0] as string).sort();
  const labelled = (kind: string, id: string) => sql.query(
    "select set_config('app.owner_kind',$1,true),set_config('app.owner_id',$2,true),set_config('app.org_id',$2,true)", [kind, id]);
  try {
    await sql.query("begin");
    await migrateOutbox(sql);
    await migrateAccess(sql);
    await migrateSeats(sql);
    await migrateDocuments(sql); await migrateMedia(sql); await migrateAgents(sql);

    const signIn = async (email: string) => {
      let text = "";
      await worker(() => sendCode(sql, { email }, { send: async (m: { text: string }) => { text = m.text; } } as never, now));
      const out = await worker(() => verifyCode(sql, { email, code: /(\d{6})/.exec(text)![1]!, client: "native" }, config, now));
      assert(out.ok); return out.value;
    };
    const ann = await signIn("ann@sessions.test"), bob = await signIn("bob@sessions.test"), cy = await signIn("cy@sessions.test");
    for (const p of [ann, bob]) await worker(() => resolveRecipient(sql, { _tag: "mailbox", mailbox: p.email }, config, now, "sessions-native"));

    // Documents: Ann owns two, one names Bob's Safe; the company owns one naming its own Safe.
    const doc = (id: string, safes: string[]): StoreInput => ({
      owner_kind: "person", owner_id: ann.personId, subject: { kind: "payment", id }, chain_id: 84532, issued_at: now,
      participants: safes.map((safe, i) => ({ safe, party_id: null, role: i ? "payee" : "payer" })),
      content: { kind: "receipt", media_type: "application/json", bytes: Buffer.from(`{"id":"${id}"}`), filename: null },
    });
    const shared = await as(ann.token, () => store(sql, doc("shared", [ann.safe, bob.safe]), async () => now));
    const own = await as(ann.token, () => store(sql, doc("own", [ann.safe]), async () => now));
    const org = { id: "org_sessions", safe: `0x${"c".repeat(40)}` };
    await sql.query("set local role none");
    await sql.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,'Sessions',$2,'sessions.site','a@sessions.test','t')", [org.id, org.safe]);
    await worker(() => register(sql, { kind: "organization", handle: "sessions-co", display_name: "Sessions", safe_address: org.safe, owner_kind: "organization", owner_id: org.id }, now, "sessions-native"));
    await sql.query("set local role none");
    const bobParty = (await sql.query("select party_id from app.parties where safe_address=$1", [bob.safe])).rows[0].party_id;
    await sql.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
      values($1,'mem_bob',$2,$3,'human',$4,'seat','active',$5,$5)`, [org.id, bobParty, bob.personId, bob.safe, now]);
    await worker(async () => {
      await labelled("organization", org.id);
      return store(sql, { ...doc("company", [org.safe]), owner_kind: "organization", owner_id: org.id }, async () => now);
    });
    // A Core store needs the owner's authority, not labels: a session without the Seat is refused.
    await assert.rejects(as(cy.token, async () => {
      await labelled("organization", org.id);
      return store(sql, { ...doc("forged", [org.safe]), owner_kind: "organization", owner_id: org.id }, async () => now);
    }), /FORBIDDEN: document owner/);
    const docs = () => ids("select subject_id from app.documents");
    assert.deepEqual(await as(ann.token, docs), ["own", "shared"]);
    assert.deepEqual(await as(bob.token, docs), ["company", "shared"], "Seat holder reads the company tenant; participant reads the shared row");
    assert.deepEqual(await as(cy.token, docs), []);
    assert.deepEqual(await as(null, docs), []);
    assert.deepEqual(await as(null, async () => { await labelled("person", ann.personId); return docs(); }), []);
    assert.deepEqual(await as(cy.token, async () => { await labelled("organization", org.id); return docs(); }), [], "org selector is not a Seat");
    assert.equal((await as(bob.token, () => getDocument(sql, { documentHash: shared.document_hash, contentHash: shared.content_hash }))).ref.documentHash, shared.document_hash);
    await assert.rejects(as(bob.token, () => getDocument(sql, { documentHash: own.document_hash, contentHash: own.content_hash })), /not found/);
    // Core's dispatch entry: the bearer is the only authority; its renderer maps refusals.
    const [mount] = documentsRoutes();
    const pair = { documentHash: shared.document_hash, contentHash: shared.content_hash };
    assert.equal((await as(null, () => mount!.route(sql, "/documents/reading/verify", pair, bob.token, now)))?.status, 200);
    const refusal = await as(null, () => mount!.route(sql, "/documents/reading/verify", pair, cy.token, now)).catch((e) => mount!.render(e));
    assert.equal(refusal?.status, 400);
    const anonymous = await as(null, () => mount!.route(sql, "/documents/reading/verify", pair, "", now)).catch((e) => mount!.render(e));
    assert.equal(anonymous?.status, 401);
    for (const token of [ann.token, bob.token]) for (const query of ["update app.documents set subject_id='x'", "delete from app.documents"])
      await assert.rejects(as(token, () => sql.query(query)), /permission denied/);
    await sql.query("set local role none");
    await sql.query("update app.org_members set status='removed' where member_id='mem_bob'");
    assert.deepEqual(await as(bob.token, docs), ["shared"], "a removed Seat no longer reads the company tenant");

    // Files: Ann's kept image is anyone's; her held document is hers alone.
    const png = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(13, 8); png.write("IHDR", 12); png.writeUInt32BE(17, 16); png.writeUInt32BE(31, 20);
    const runtime = { now: async () => now, transitioned: async () => {} };
    const image = await as(ann.token, () => upload(sql, { purpose: "image", content_type: "image/png", bytes: png }, runtime));
    const held = await as(ann.token, () => upload(sql, { purpose: "document", content_type: "application/pdf", bytes: Buffer.from("%PDF-1.7\nann") }, runtime));
    await assert.rejects(as(null, () => upload(sql, { purpose: "image", content_type: "image/png", bytes: png }, runtime)), /NOT_AUTHENTICATED/);
    const files = () => ids("select file_id from app.files");
    assert.deepEqual(await as(ann.token, files), [image.file_id, held.file_id].sort());
    for (const token of [bob.token, cy.token, null]) assert.deepEqual(await as(token, files), [image.file_id]);
    assert.deepEqual(await as(null, async () => { await labelled("person", ann.personId); return files(); }), [image.file_id]);
    assert.equal(await as(bob.token, () => getFile(sql, held.file_id)), null);
    for (const token of [ann.token, bob.token]) for (const query of ["update app.files set state='kept'", "delete from app.files"])
      await assert.rejects(as(token, () => sql.query(query)), /permission denied/);

    // Agents: Ann's agent row is Ann's only.
    await sql.query("set local role none");
    await sql.query(`insert into app.agents values($1,'person','agent_sessions','party_agent_sessions',$2,$3,'file','creating',$1,now(),null,null,now())`,
      [ann.personId, `0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`]);
    const agents = () => ids("select agent_id from app.agents");
    assert.deepEqual(await as(ann.token, agents), ["agent_sessions"]);
    assert.deepEqual(await as(bob.token, agents), []);
    assert.deepEqual(await as(null, async () => { await labelled("person", ann.personId); return agents(); }), []);

    // A revoked bearer fails closed.
    await worker(() => revoke(sql, ann.token, now));
    await assert.rejects(as(ann.token, docs), /NOT_AUTHENTICATED/);
  } finally { await sql.query("rollback"); await sql.end(); }
});
