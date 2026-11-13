import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import pg from "pg";
import { Effect } from "effect";
import { annotationHandler } from "../src/books/save.ts";
import { recordMoneyFact } from "../src/books/door.ts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { migrateSpans, spanCollector, readSpans } from "../src/platform/spans.ts";
import { createFrappeSite } from "../src/plugs/door.ts";
import { digest } from "../src/access/door.ts";

// Disposable exact-peer composition control, not public onboarding/native ERPNext/full-gate proof.
const url = process.env.BOOKS_TEST_ADMIN_URL;
assert(url && new URL(url).pathname === "/books_public_test" && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "dedicated loopback books_public_test PG required");
const admin = new pg.Client({ connectionString: url });
await admin.connect();
const origin = new URL(url);
const roleUrl = (role: string, password: string) => {
  const target = new URL(origin); target.username = role; target.password = password; return target.href;
};
const db = new Database(roleUrl("capxul_core", "books-core-local"), roleUrl("capxul_worker", "books-worker-local"));
const at = 1_700_111_222_333;
const suffix = randomUUID(), org = `north-${suffix}`;
const address = () => `0x${randomBytes(20).toString("hex")}`;
const actors = ["alice", "bob", "agent"].map((name) => ({ id: `${name}-${suffix}`, safe: address(),
  bearer: randomBytes(32).toString("base64url"), kind: name === "agent" ? "agent" : "person" }));
const [alice, bob, agent] = actors as [typeof actors[number], typeof actors[number], typeof actors[number]];
let revokeDuringValidation = false;
const native = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (revokeDuringValidation) {
    revokeDuringValidation = false;
    await admin.query("update app.org_members set status='removed' where org_id=$1 and principal_id=$2", [org, alice.id]);
  }
  const message = req.url?.endsWith("read_site") ? { version: "1", apps: ["erpnext", "capxul"], company: "North Works",
    features: {}, map_version: "1", sign_in: { mode: "assertion", configured: true, oauth: false } }
    : { ok: true, data: { doctype: "Account", name: "6127 - Workshop - NW", docstatus: 0,
      fields: { account_name: "Workshop", account_number: "6127", company: "North Works", disabled: 0, is_group: 0, account_type: "Expense Account" } } };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ message }));
});
await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
const provider = createFrappeSite({ baseUrl: `http://127.0.0.1:${(native.address() as any).port}`, secret: "local-wire-fixture" });
const run = async <A, E>(build: (context: { traceId: string; callId: string }) => Effect.Effect<A, E>) => {
  const callId = randomUUID();
  const collector = spanCollector(db.worker, { runId: suffix, worldId: "books-public-component", codeVersion: "exact-peer-isolated",
    callId, capxul_env: "devnet", producer: "books-component", org_id: null, actor: null },
  ["NOT_AUTHENTICATED", "INVALID_INPUT", "ROLE_PERMISSION_DENIED", "FEATURE_NOT_AVAILABLE", "PROVIDER_ERROR", "PROVIDER_RESPONSE_INVALID"]);
  try {
    return await Effect.runPromise(Effect.gen(function*() {
      const parent = yield* Effect.currentSpan;
      return yield* build({ traceId: parent.traceId, callId });
    }).pipe(Effect.withSpan("http.books.annotations"), Effect.withTracer(collector.tracer)));
  } finally { await collector.flush(); }
};
const handler = annotationHandler(db, provider, run);
const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
const reference = { kind: "payment" as const, id: `p-${suffix}` };
const state = () => db.ownerTransaction({ kind: "organization", id: org }, async (sql) => ({
  annotations: (await sql.query("select * from app.book_annotations order by reference_id")).rows,
  facts: (await sql.query("select * from app.book_facts order by seq")).rows,
  feed: (await sql.query("select * from app.book_feeds")).rows,
  events: (await sql.query("select event from app.transition_outbox order by id")).rows,
}));
try {
  for (const [role, password] of [["capxul_core", "books-core-local"], ["capxul_worker", "books-worker-local"]]) {
    if (!(await admin.query("select 1 from pg_roles where rolname=$1", [role])).rowCount)
      await admin.query(`create role ${role} login nosuperuser nobypassrls noinherit`);
    await admin.query(`alter role ${role} password '${password}'`);
  }
  await admin.query("begin");
  await admin.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
  await admin.query("grant usage on schema app to capxul_core,capxul_worker");
  await admin.query("grant select on app.world,app.organizations to capxul_core,capxul_worker");
  for (const name of ["parties", "access", "organizations", "books"])
    await admin.query(readFileSync(new URL(`../src/${name}/schema.sql`, import.meta.url), "utf8"));
  await migrateOutbox(admin); await migrateSpans(admin);
  await admin.query("insert into app.world(world_id,clock) values('books-public-component',$1)", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);
  await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,$1,$2,'north.local','owner@example.test',$3)", [org, address(), address()]);
  for (const actor of actors) {
    await admin.query("insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at) values($1,$2,$3,$4,$5,$6)",
      [actor.id, actor.kind, actor.kind === "person" ? `${actor.id}@example.test` : null, actor.safe, actor.kind === "agent" ? address() : null, new Date(at)]);
    await admin.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
      values($1,$1,$2,'code','active','component',$3,$4)`, [actor.id, digest(actor.bearer), new Date(at), new Date(at + 3600000)]);
    await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values($1,$2,'active',$3,'person',$4,$5,$5)`, [`party-${actor.id}`, actor.kind, actor.safe, actor.id, at]);
    if (actor !== bob) await admin.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
      values($1,$2,$3,$4,$5,$6,'seat','active',$7,$7)`, [org, actor.id, `party-${actor.id}`, actor.kind === "person" ? actor.id : null,
      actor.kind === "person" ? "human" : "agent", actor.safe, at]);
  }
  await admin.query("insert into app.feature_flags(key,active,target,rules,checked_at) values('books',true,'organization',$1,$2)",
    [JSON.stringify([{ ids: [org], rollout: 100 }]), new Date(at)]);
  await admin.query("commit");
  await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [{ org_id: org, kind: "payment_settled", direction: "out",
    money_key: suffix, reference, source: { kind: "payment", id: reference.id }, asset_id: "asset-local", symbol: "TEST", decimals: 6,
    amount_raw: "23000000", priced: false, counterparty: address(), party_id: null, chain_id: 84532, block_number: 4,
    block_time: at - 5000, tx_hash: `0x${"12".repeat(32)}`, log_index: 1, safe_address: address(), actor: { kind: "system", id: null } }] },
  { at, traceId: "component-fact" }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (actor: typeof alice | null, input: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/books/annotations/save`, {
      method: "POST", headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${actor.bearer}` } : {}) }, body: JSON.stringify(input),
    });
    return { status: res.status, trace: res.headers.get("x-capxul-trace"), body: await res.json() as any };
  };
  const personal = { actor: { kind: "person" }, reference: { kind: "movement", id: "not-an-ownership-claim" } };
  for (const [account, from, to, transition] of [["6100", null, "decided", "assign"], ["6200", "decided", "decided", "recategorize"],
    ["6999", "decided", "waiting", "requeue"]] as const) {
    const result = await request(alice, { ...personal, account, memo: "private" });
    assert.equal(result.status, 200); assert.equal(result.body.annotation.actor.id, alice.id);
    await db.ownerTransaction({ kind: "person", id: alice.id }, async (sql) => {
      const events = (await sql.query("select event from app.transition_outbox where event->>'trace_id'=$1", [result.trace])).rows;
      assert.equal(events.length, 1); assert.deepEqual(events[0].event.props, { from, to, transition, owner_kind: "person", owner_id: alice.id,
        reference_kind: "movement", reference_id: personal.reference.id, account: `personal_${account}` });
      assert.equal((await sql.query("select count(*)::int as n from app.book_facts")).rows[0].n, 0);
    });
  }
  const queued = await request(bob, { ...personal, memo: "own scope only" });
  assert.equal(queued.status, 200);
  assert.equal(queued.body.annotation.actor.id, bob.id);
  const organization = { actor: { kind: "organization", orgId: org }, reference, account: "6127" };
  const saved = await request(alice, organization);
  assert.equal(saved.status, 200); assert.equal(saved.body.annotation.account.name, "Workshop");
  const spans = await readSpans(db.worker, { runId: suffix, worldId: "books-public-component", traceId: saved.trace! });
  const rpc = spans.find((span) => span.name === "rpc.books.annotations.save")!;
  assert(rpc && rpc.outcome === "success");
  assert(spans.some((span) => span.spanId === rpc.parentSpanId && span.name === "http.books.annotations"));
  assert(spans.some((span) => span.parentSpanId === rpc.spanId && span.name === "FrappeSite.request"));
  const before = await state();
  for (const [actor, value, code] of [[null, personal, "NOT_AUTHENTICATED"], [alice, { ...personal, category: "old" }, "INVALID_INPUT"],
    [bob, organization, "ROLE_PERMISSION_DENIED"], [alice, { ...organization, reference: { kind: "payment", id: "absent" } }, "INVALID_INPUT"],
    [alice, { ...organization, account: undefined, memo: "requires unavailable Books authority" }, "FEATURE_NOT_AVAILABLE"],
    [agent, organization, "FEATURE_NOT_AVAILABLE"]] as const) {
    const result = await request(actor, value); assert.equal(result.body.error?.code, code);
    assert.deepEqual(await state(), before, "refused public saves must not change org data/feed/outbox");
    assert(result.trace, "RPC refusals must retain the actual request trace too");
    const failures = await readSpans(db.worker, { runId: suffix, worldId: "books-public-component", traceId: result.trace });
    assert(failures.some((span) => span.name === "rpc.books.annotations.save" && span.outcome === "error" && span.errorCode === code));
  }
  revokeDuringValidation = true;
  const removed = await request(alice, organization);
  assert.equal(removed.body.error?.code, "ROLE_PERMISSION_DENIED");
  assert.deepEqual(await state(), before, "revoked Seat must not save after the provider read");
  console.log("public Books exact-peer PG control: pass; personal isolation/transitions, ordinary Seat save, explicit unavailable paths, rollback and actual Effect parentage; native provider is a wire fixture, no selected credit");
} finally {
  await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), new Promise<void>((resolve) => native.close(() => resolve()))]);
  await db.close(); await admin.end();
}
