import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { Database, type Sql } from "../src/platform/db.ts";
import { emit, migrateOutbox, relay, type TransitionEvent } from "../src/platform/outbox.ts";
import { followPayment, getRequest, migrateRequests, onPaymentTransition, type ReadPayment } from "../src/requests/door.ts";

const url = process.env.APPROVALS_TEST_DATABASE;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || new URL(url).pathname !== "/approvals_requests_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("dedicated loopback approvals_requests_test required");
const roleUrl = (role: string) => { const u = new URL(url!); u.username = role; return u.href; };
const issuer = `0x${"31".repeat(20)}`, payer = `0x${"42".repeat(20)}`;
const owner = { owner_kind: "person" as const, owner_id: "issuer-principal" };
const at = 1_794_480_000_000;

test("requests PG admission and committed payment followers", async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
  const worker = <T>(fn: (sql: Sql) => Promise<T>) => db.transaction("", fn, true);
  const session = <T>(id: string, safe: string, fn: (sql: Sql) => Promise<T>) => db.transaction("", async (sql) => {
    await sql.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true),set_config('app.person_id',$1,true)", [id, safe]);
    return fn(sql);
  });
  const seed = (id: string, status = "paying", extra: Record<string, unknown> = {}) => {
    const fields = { ...owner, request_id: id, request_key: `key-${id}`, kind: "invoice", status, issuer_party_id: "issuer-party", issuer_safe: issuer,
      payer_kind: "capxul", payer_safe: payer, asset_id: "USDC", token_address: `0x${"53".repeat(20)}`, decimals: 6,
      amount_raw: "12700001", reference: id, payment_id: `pay-${id}`, chain_payment_id: `chain-${id}`, pay_key: `attempt-${id}`,
      created_at: at, updated_at: at, ...extra };
    return admin.query(`insert into app.requests (${Object.keys(fields).join(",")}) values (${Object.keys(fields).map((_, i) => `$${i + 1}`).join(",")})`, Object.values(fields));
  };
  const read = async (_sql: Sql, scope: Parameters<ReadPayment>[1], id: string) => ({ id, owner_kind: scope.kind, owner_id: scope.id, chain_payment_id: `chain-${id.slice(4)}`, status: "settled" });
  const source = async (id: string, transition: string, suffix = transition) => {
    const event: TransitionEvent = { id: `source:${id}:${suffix}`, name: "payment_transitioned", machine: "payment", entity_id: `pay-${id}`,
      owner_kind: "person", owner_id: "payer-principal", actor: null, trace_id: `trace-${id}`, at: at + 33,
      props: { from: transition === "unsettle" ? "settled" : "pending", to: transition === "settle" ? "settled" : transition === "cancel" ? "cancelled" : "pending",
        transition, payment_id: `pay-${id}`, owner_kind: "person", owner_id: "payer-principal", route: "personal", outcome: null, command_id: null } };
    await worker((sql) => emit(sql, event)); return event.id;
  };
  const state = (id: string) => worker((sql) => getRequest(sql, { ...owner, request_id: id }));
  try {
    await admin.query(`create schema if not exists app;
      do $$ begin
      if not exists(select 1 from pg_roles where rolname='capxul_core') then create role capxul_core login nosuperuser nobypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='capxul_worker') then create role capxul_worker login nosuperuser nobypassrls; end if;
      end $$; grant usage on schema app to capxul_core,capxul_worker`);
    await migrateRequests(admin); await migrateOutbox(admin);
    await t.test("owner writes, addressed Safe reads only, strangers see nothing", async () => {
      await seed("admission", "open");
      const key = { ...owner, request_id: "admission" };
      assert.equal((await session(owner.owner_id, issuer, (sql) => getRequest(sql, key))).request_id, "admission");
      assert.equal((await session(owner.owner_id, issuer, (sql) => sql.query("update app.requests set note='owner edit' where request_id='admission'"))).rowCount, 1);
      assert.equal((await session("payer-principal", payer, (sql) => getRequest(sql, key))).request_id, "admission");
      await assert.rejects(session("stranger", `0x${"64".repeat(20)}`, (sql) => getRequest(sql, key)), /INVALID_INPUT/);
      assert.equal((await session("payer-principal", payer, (sql) => sql.query("update app.requests set status='cancelled' where request_id='admission'"))).rowCount, 0);
      assert.equal((await session("stranger", "", (sql) => sql.query("update app.requests set status='cancelled' where request_id='admission'"))).rowCount, 0);
      await assert.rejects(session("stranger", "", (sql) => sql.query(`insert into app.requests
        (owner_kind,owner_id,request_id,request_key,kind,status,issuer_party_id,issuer_safe,payer_kind,asset_id,token_address,decimals,amount_raw,reference,created_at,updated_at)
        values ('person','issuer-principal','forged','forged','request','open','issuer-party',$1,'none','USDC',$2,6,'1','forged',$3,$3)`, [issuer, payer, at])), /row-level/);
      assert.equal((await state("admission")).status, "open");
    });
    await t.test("source consumer rollback leaves neither effect nor ACK; replay emits once", async () => {
      await seed("settlement"); const id = await source("settlement", "settle");
      await assert.rejects(worker(async (sql) => { await followPayment(sql, id, read); throw new Error("crash before commit"); }), /crash before commit/);
      assert.equal((await state("settlement")).status, "paying");
      assert.equal((await admin.query("select count(*)::int as n from app.transition_acks where event_id=$1", [id])).rows[0].n, 0);
      assert.equal(await worker((sql) => followPayment(sql, id, read)), true);
      assert.equal(await worker((sql) => followPayment(sql, id, read)), false);
      assert.equal((await state("settlement")).status, "paid");
      const events = (await admin.query("select event from app.transition_outbox where event->>'entity_id'='settlement' order by seq")).rows;
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].event.props, { from: "paying", to: "paid", transition: "settle", request_id: "settlement", ...owner, kind: "invoice", payer_kind: "capxul" });
      assert.equal(events[0].event.at, at + 33);
      const unsettle = await source("settlement", "unsettle");
      await worker((sql) => followPayment(sql, unsettle, async (...args) => ({ ...await read(...args)!, status: "pending" })));
      assert.equal((await state("settlement")).status, "paying");
      const cancel = await source("settlement", "cancel");
      await worker((sql) => followPayment(sql, cancel, async (...args) => ({ ...await read(...args)!, status: "cancelled" })));
      const reopened = await state("settlement");
      assert.deepEqual([reopened.status, reopened.payment_id, reopened.chain_payment_id, reopened.pay_key], ["open", null, null, null]);
    });
    await t.test("current attempt, deposit, lapsed and escrow ending guards", async () => {
      await seed("superseded", "paying", { payment_id: "other-payment" });
      const cancelled = await source("superseded", "cancel");
      await worker((sql) => followPayment(sql, cancelled, async (...args) => ({ ...await read(...args)!, status: "cancelled" })));
      assert.equal((await state("superseded")).status, "paying");
      await seed("deposit", "paid", { deposit_id: "bank-credit" });
      const reversed = await source("deposit", "unsettle");
      await worker((sql) => followPayment(sql, reversed, async (...args) => ({ ...await read(...args)!, status: "pending" })));
      assert.equal((await state("deposit")).status, "paid");
      await seed("lapsed");
      const lapsed = await source("lapsed", "lapse");
      await worker((sql) => followPayment(sql, lapsed, read));
      assert.equal((await state("lapsed")).status, "paying");
      for (const [name, received, checked, heldAtEnd, expected] of [["funded", "12700001", at - 1, "12700001", "paid"], ["short", "12700000", at - 1, "12700000", "cancelled"], ["late", "12700001", at + 1, "0", "cancelled"], ["stale", "12700001", at - 1, "0", "cancelled"], ["historical", "0", at + 1, "12700001", "paid"]] as const) {
        await seed(name, "cancelled", { payment_id: null, escrow_address: payer, escrow_received_raw: received, escrow_checked_at: checked, decided_at: at });
        const id = await source(name, "settle");
        await assert.rejects(worker((sql) => followPayment(sql, id, read)), /verification_unavailable/);
        assert.equal((await admin.query("select count(*)::int as n from app.transition_acks where event_id=$1", [id])).rows[0].n, 0);
        await worker((sql) => followPayment(sql, id, read, async () => heldAtEnd));
        assert.equal((await state(name)).status, expected);
      }
    });
    await t.test("explicit shared relay owns the single effect and ACK boundary", async () => {
      await seed("relay"); await source("relay", "settle");
      const effect = (sql: Sql, event: TransitionEvent) => onPaymentTransition(sql, event, read);
      assert.equal(await relay(db, "requests.lifecycle.payment-followers", ["payment_transitioned"], effect), 1);
      assert.equal(await relay(db, "requests.lifecycle.payment-followers", ["payment_transitioned"], effect), 0);
      assert.equal((await state("relay")).status, "paid");
    });
  } finally { await db.close(); await admin.end(); }
});
