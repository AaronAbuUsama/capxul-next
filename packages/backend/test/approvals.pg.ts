import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { signingTransportControls } from "./approvals-http.ts";
import { open, withdraw, prepare, get, submitted, settleSitePayment, migrateApprovals, signingGet, signingSign, signingDecline, carry, wakeChain, readApproval,
  type ApprovalContext, type Open, type SigningContext, type CarrierServices } from "../src/approvals/door.ts";

const url = process.env.APPROVALS_TEST_DATABASE;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || new URL(url).pathname !== "/approvals_requests_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("dedicated loopback approvals_requests_test required");
const roleUrl = (role: string) => { const u = new URL(url!); u.username = role; return u.href; };
const account = privateKeyToAccount(`0x${"17".repeat(32)}`);
const sender = `0x${"21".repeat(20)}`, recipient = `0x${"43".repeat(20)}`;
const now = new Date("2026-11-12T11:00:00Z");
const ctx: ApprovalContext = { person_id: "principal-approvals", sender, site_url: "https://core.test", now };
const terms: Open = { org_id: "approval-org", opener: "payments", subject_kind: "payment", subject_id: "payment-1", chain_id: 84532,
  calls: [{ to: recipient, value: "0", data: "0x1234" }], deadline: new Date(now.getTime() + 600_000).toISOString(),
  summary: { title: "Supplier", from: { label: "Signer", address: sender }, to: { label: "Supplier" }, amount: { asset: "USDC", value: "12.34" }, recipients: [], warnings: [] } };

test("real PG approvals migration, atomic birth, signer isolation and durable no-resend", { timeout: 30_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
  const tenant = <T>(fn: (sql: pg.PoolClient) => Promise<T>, person = ctx.person_id) => db.transaction("approval-org", async (sql) => {
    await sql.query(`select set_config('app.person_id',$1,true),set_config('app.owner_kind','person',true),
      set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true)`, [person, sender]);
    return fn(sql as pg.PoolClient);
  });
  const legacy = { org: "approval-org", request_id: "legacy-request", site: "approval.test", doctype: "Purchase Invoice", name: "PINV-1",
    document_hash: `0x${"65".repeat(32)}`, requested_by: "signer@test", to_party: "supplier", to_address: recipient, amount: "12.34", asset: "USDC" };
  try {
    await admin.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='capxul_core') then create role capxul_core login nosuperuser nobypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='capxul_worker') then create role capxul_worker login nosuperuser nobypassrls; end if;
      end $$;
      grant usage on schema app to capxul_core,capxul_worker;
      grant select,insert,update on all tables in schema app to capxul_core,capxul_worker;
      grant usage on all sequences in schema app to capxul_core,capxul_worker`);
    await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values ('approval-org','Approvals','safe-approvals','approval.test','signer@test','token-approvals')");
    await admin.query("insert into app.people(org_id,address,email,name) values ('approval-org',$1,'signer@test','Signer')", [account.address.toLowerCase()]);
    await admin.query("insert into app.approvals(org_id,id,request_id,request,trace) values ('approval-org','apr_preserved','legacy-request',$1,'legacy-trace')", [legacy]);
    await admin.query(`alter table app.approvals enable row level security; alter table app.approvals force row level security;
      create policy tenant on app.approvals to capxul_core,capxul_worker
      using (org_id=current_setting('app.org_id',true) or current_user='capxul_worker')
      with check (org_id=current_setting('app.org_id',true) or current_user='capxul_worker')`);
    await admin.query("BEGIN"); await migrateApprovals(admin); await migrateOutbox(admin); await admin.query("COMMIT");
    await migrateApprovals(admin);

    await t.test("rename preserves committed prepare/get/submitted/settlement identity", async () => {
      const prepared = await tenant((sql) => prepare(sql, legacy, "ignored-replay-trace"));
      assert.equal(prepared.id, "apr_preserved"); assert.equal(prepared.trace, "legacy-trace");
      await assert.rejects(db.transaction("different-org", (sql) => get(sql, legacy.org, prepared.id)), /NOT_FOUND/);
      await assert.rejects(tenant((sql) => prepare(sql, { ...legacy, amount: "12.35" }, "changed")), /IDEMPOTENCY_CONFLICT/);
      const hash = `0x${"87".repeat(32)}`;
      assert.equal((await tenant((sql) => submitted(sql, legacy.org, prepared.id, hash, "signer@test"))).status, "submitted");
      assert.deepEqual(await tenant((sql) => settleSitePayment(sql, { org: legacy.org, document_hash: legacy.document_hash, recipient, amount_raw: "12340001", tx_hash: hash })), { matched: false });
      assert.deepEqual(await tenant((sql) => settleSitePayment(sql, { org: legacy.org, document_hash: legacy.document_hash, recipient: sender, amount_raw: "12340000", tx_hash: hash })), { matched: false });
      await assert.rejects(tenant(async (sql) => { await settleSitePayment(sql, { org: legacy.org, document_hash: legacy.document_hash, recipient, amount_raw: "12340000", tx_hash: hash }); throw new Error("abort settlement"); }), /abort settlement/);
      assert.equal((await tenant((sql) => get(sql, legacy.org, prepared.id))).status, "submitted");
      const settled = await tenant((sql) => settleSitePayment(sql, { org: legacy.org, document_hash: legacy.document_hash, recipient, amount_raw: "12340000", tx_hash: hash }));
      assert.deepEqual(settled, { matched: true, approval_id: "apr_preserved", trace: "legacy-trace", status: "settled" });
    });
    await t.test("opener rollback removes row, event and wake; repeat returns one live carrier", async () => {
      await assert.rejects(tenant(async (sql) => { await open(sql, ctx, terms, "atomic-trace"); throw new Error("abort opener"); }), /abort opener/);
      for (const table of ["approvals", "approval_carriers", "transition_outbox"]) assert.equal((await admin.query(`select count(*)::int as n from app.${table}`)).rows[0].n, 0);
      const first = await tenant((sql) => open(sql, ctx, terms, "atomic-trace"));
      assert.equal(first.opened, true);
      assert.deepEqual(await tenant((sql) => open(sql, ctx, terms, "atomic-trace")), { ...first, opened: false });
      assert.equal((await admin.query("select count(*)::int as n from app.transition_outbox")).rows[0].n, 1);
      await assert.rejects(tenant((sql) => withdraw(sql, { ...ctx, person_id: "other-person" }, { approval_id: first.approval_id, reason: "wrong" }), "other-person"), /INVALID_INPUT/);
      await assert.rejects(tenant(async (sql) => { await withdraw(sql, ctx, { approval_id: first.approval_id, reason: "rollback" }); throw new Error("abort withdrawal"); }), /abort withdrawal/);
      assert.equal((await admin.query("select state from app.approvals where approval_id=$1", [first.approval_id])).rows[0].state, "sponsoring");
      assert.equal((await admin.query("select count(*)::int as n from app.transition_outbox")).rows[0].n, 1);
      assert.equal((await tenant((sql) => withdraw(sql, ctx, { approval_id: first.approval_id, reason: "ended intent" }))).state, "withdrawn");
      assert.equal((await tenant((sql) => withdraw(sql, ctx, { approval_id: first.approval_id, reason: "repeat" }))).state, "withdrawn");
      // Stored command replay keeps its terminal approval even when the current budget wearer changed.
      const replay = await db.transaction("approval-org", async (sql) => {
        await sql.query("select set_config('app.person_id','new-budget-wearer',true)");
        return readApproval(sql, first.approval_id);
      }, true);
      assert.deepEqual(replay, { approval_id: first.approval_id, deadline: new Date(terms.deadline),
        state: "withdrawn", person_id: ctx.person_id, sender });
      assert.equal(await tenant((sql) => readApproval(sql, first.approval_id)), null);
      assert.equal(await tenant((sql) => readApproval(sql, first.approval_id), "new-budget-wearer"), null);
      assert.equal(await db.transaction("", (sql) => readApproval(sql, "missing-approval"), true), null);
      assert.equal((await admin.query("select count(*)::int as n from app.approvals")).rows[0].n, 1);
    });
    await t.test("committed sending resumes by hash, never resends after lost answer", async () => {
      let clock = now, sends = 0, held = false, terminal = 0;
      let nonce = "";
      const digest = `0x${"ab".repeat(32)}` as const, opHash = `0x${"cd".repeat(32)}`;
      const services: CarrierServices = {
        now: async () => clock,
        sponsor: async (row) => {
          nonce = ((BigInt(row.nonce_key) << 64n) + 731n).toString();
          // A gateway answer may carry keys of its own; none may become a column name.
          return Object.assign({ nonce, signer_address: account.address.toLowerCase(), digest, user_op_hash: opHash, valid_after: null, valid_until: new Date(terms.deadline),
            user_operation: { sender, nonce, callData: "0x1234", callGasLimit: "80000", verificationGasLimit: "90000", preVerificationGas: "40000", maxFeePerGas: "2", maxPriorityFeePerGas: "1", paymaster: recipient, paymasterVerificationGasLimit: "10000", paymasterPostOpGasLimit: "10000", paymasterData: "0x" } },
          { "state='landed',ended_at": "now()" });
        },
        send: async () => { sends++; held = true; throw new Error("lost gateway answer"); }, lookup: async () => ({ held }),
        nonce: async () => nonce, needsAndGate: async () => true,
        // Like the indexed reader, a lookup without a held decimal nonce is invalid input.
        fact: async (_sql, row) => { if (!/^\d+$/.test(String(row.nonce))) throw new Error("INVALID_INPUT: indexed carrier identity"); return null; },
        terminal: async (sql) => { await sql.query("select 1"); terminal++; },
      };
      await carry(db, services); // finishes the withdrawn carrier before opening another
      assert.equal(terminal, 1);
      const next = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "payment-2" }, "resume-trace"));
      await carry(db, services);
      const signing: SigningContext = { ...ctx, network: { name: "Test", explorerUrl: "https://explorer.test" }, requireFeature: async () => {} };
      await assert.rejects(tenant((sql) => signingGet(sql, { ...signing, person_id: "other-person" }, { approvalId: next.approval_id }), "other-person"), /INVALID_INPUT/);
      const signature = await account.sign({ hash: digest });
      await tenant((sql) => signingSign(sql, signing, { approvalId: next.approval_id, signature }));
      await carry(db, services);
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: next.approval_id }))).state, "sending");
      assert.equal(sends, 1);
      clock = new Date(now.getTime() + 1000);
      await carry(db, services);
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: next.approval_id }))).state, "sent");
      await carry(db, services); assert.equal(sends, 1);
      await tenant((sql) => signingSign(sql, signing, { approvalId: next.approval_id, signature }));
      assert.equal(sends, 1);
      const before = (await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].wake_at;
      await db.transaction("", (sql) => wakeChain(sql, { chain_id: 84532, sender, nonce: (BigInt(nonce) + 1n).toString() }, clock), true);
      assert.deepEqual((await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].wake_at, before);
      await db.transaction("", (sql) => wakeChain(sql, { chain_id: 84532, sender, nonce }, clock), true);
      assert.deepEqual((await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].wake_at, clock);
      // A real second PG connection commits a finality fixture and wake after the first read missed it.
      // This tests scheduling concurrency, not Ponder's production finality adapter.
      await admin.query("create table app.test_approval_facts (approval_id text primary key,fact jsonb not null); grant select,insert on app.test_approval_facts to capxul_worker");
      const finalFact = { chain_id: 84532, sender, nonce, user_op_hash: opHash, success: true,
        transaction_hash: `0x${"ef".repeat(32)}`, block_number: 41 };
      services.fact = async (reader, approval) => {
        const fact = (await reader.query("select fact from app.test_approval_facts where approval_id=$1", [approval.approval_id])).rows[0]?.fact ?? null;
        if (!fact && approval.approval_id === next.approval_id) await db.transaction("", async (writer) => {
          const readerPid = (await reader.query("select pg_backend_pid() as pid")).rows[0].pid;
          assert.notEqual((await writer.query("select pg_backend_pid() as pid")).rows[0].pid, readerPid);
          await writer.query("insert into app.test_approval_facts values ($1,$2)", [approval.approval_id, finalFact]);
          await wakeChain(writer, { chain_id: 84532, sender, nonce }, clock);
        }, true);
        return fact;
      };
      await carry(db, services);
      assert.deepEqual((await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].wake_at, clock,
        "a committed chain wake must not be replaced by the later window timer");
      services.terminal = async () => { throw new Error("opener effect failed"); };
      await carry(db, services);
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: next.approval_id }))).state, "sent");
      assert.deepEqual((await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].wake_at,
        new Date(clock.getTime() + 30_000), "a failed callback rolls back and backs off only its own approval");
      clock = new Date(clock.getTime() + 30_000);
      services.terminal = async (sql, event) => {
        assert.equal(event.outcome, "landed"); assert.equal(event.observedAt, clock.toISOString()); assert.equal(event.refusal, null);
        assert.equal(event.trace_id, "resume-trace");
        assert.equal((await sql.query("select state from app.approvals where approval_id=$1", [event.approval_id])).rows[0].state, "landed");
        terminal++;
      };
      await carry(db, services); await carry(db, services);
      assert.equal(terminal, 2); assert.equal(sends, 1);
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: next.approval_id }))).state, "landed");
      await assert.rejects(tenant((sql) => signingDecline(sql, signing, { approvalId: next.approval_id })), /WRONG_STATE/);
      const later = await tenant((sql) => open(sql, { ...ctx, now: clock }, { ...terms, subject_id: "payment-2" }, "later-step"));
      assert.equal(later.opened, true); assert.notEqual(later.approval_id, next.approval_id);
      assert.deepEqual(await tenant((sql) => open(sql, { ...ctx, now: clock }, { ...terms, subject_id: "payment-2" })), { ...later, opened: false });
      services.sponsor = async () => { throw new Error("sponsor unavailable"); };
      services.terminal = async (_sql, event) => {
        assert.equal(event.outcome, "refused"); assert.equal(event.refusal?.code, "PROVIDER_ERROR"); terminal++;
      };
      const base = clock.getTime();
      for (const elapsed of [0, 2000, 6000]) {
        clock = new Date(base + elapsed);
        await carry(db, services);
      }
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: later.approval_id }))).state, "refused");
      assert.equal(terminal, 3); assert.equal(sends, 1);
    });
    await t.test("unsigned decline callback is atomic and not repeated by the carrier", async () => {
      let completed = 0;
      const signing: SigningContext = { ...ctx, network: { name: "Test", explorerUrl: "https://explorer.test" }, requireFeature: async () => {},
        terminal: async () => { completed++; } };
      const next = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "decline-atomic" }, "decline-trace"));
      await assert.rejects(tenant((sql) => signingDecline(sql, { ...signing, terminal: async () => { throw new Error("callback failed"); } }, { approvalId: next.approval_id })), /callback failed/);
      assert.equal((await tenant((sql) => signingGet(sql, signing, { approvalId: next.approval_id }))).state, "sponsoring");
      await tenant((sql) => signingDecline(sql, signing, { approvalId: next.approval_id }));
      await tenant((sql) => signingDecline(sql, signing, { approvalId: next.approval_id }));
      assert.equal(completed, 1);
      assert.equal((await admin.query("select count(*)::int as n from app.approval_carriers where approval_id=$1", [next.approval_id])).rows[0].n, 0);
    });
    await t.test("overdue unsponsored replacement ends only on indexed finality with an atomic callback", async () => {
      const original = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "late-original", send_after: new Date(now.getTime() + 60_000).toISOString() }));
      const lane = (await admin.query("select nonce_key from app.approvals where approval_id=$1", [original.approval_id])).rows[0].nonce_key;
      const nonce = ((BigInt(lane) << 64n) + 29n).toString();
      const hash = `0x${"ad".repeat(32)}`, transaction = `0x${"be".repeat(32)}`;
      await admin.query("update app.approvals set state='signed',nonce=$2,user_op_hash=$3 where approval_id=$1", [original.approval_id, nonce, hash]);
      const replacement = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "late-replacement", replaces: original.approval_id }));
      let clock = new Date(new Date(terms.deadline).getTime() + 120_001), failCallback = true, callbacks = 0, outsideCalls = 0;
      const unexpected = async (): Promise<never> => { outsideCalls++; throw new Error("unsigned replacement must not sponsor or send"); };
      const services: CarrierServices = {
        now: async () => clock, sponsor: unexpected, send: unexpected, lookup: unexpected, needsAndGate: unexpected,
        nonce: async () => (BigInt(nonce) + 1n).toString(),
        // A committed finality fixture exercises the carrier contract, not Ponder adapter conformance.
        fact: async (sql, row) => (await sql.query("select fact from app.test_approval_facts where approval_id=$1", [row.approval_id])).rows[0]?.fact ?? null,
        terminal: async (sql, event) => {
          if (event.approval_id !== replacement.approval_id) return;
          assert.equal(event.outcome, "displaced"); assert.equal(event.nonce, nonce);
          assert.equal(event.transaction_hash, transaction); assert.equal(event.block_number, 73);
          assert.equal((await sql.query("select state from app.approvals where approval_id=$1", [replacement.approval_id])).rows[0].state, "displaced");
          if (failCallback) throw new Error("late replacement opener failed");
          callbacks++;
        },
      };
      await carry(db, services);
      assert.equal((await admin.query("select state from app.approvals where approval_id=$1", [replacement.approval_id])).rows[0].state, "sponsoring",
        "a moved nonce without indexed finality is not terminal proof");
      assert.equal(callbacks, 0); assert.equal(outsideCalls, 0);
      const fact = { chain_id: terms.chain_id, sender, nonce, user_op_hash: hash, success: true, transaction_hash: transaction, block_number: 73 };
      await admin.query("insert into app.test_approval_facts values ($1,$3),($2,$3)", [original.approval_id, replacement.approval_id, fact]);
      await db.transaction("", (sql) => wakeChain(sql, { chain_id: terms.chain_id, sender, nonce }, clock), true);
      const carrierOf = async (id: string) => (await admin.query("select wake_at from app.approval_carriers where approval_id=$1", [id])).rows[0];
      const stateOf = async (id: string) => (await admin.query("select state from app.approvals where approval_id=$1", [id])).rows[0].state;
      assert.deepEqual((await carrierOf(replacement.approval_id)).wake_at, clock, "chain wake reaches an unsponsored replacement with a persisted nonce");
      // The failing replacement heads the batch; the original holding the same nonce is due behind it.
      await admin.query("update app.approval_carriers set wake_at=wake_at-interval '1 second' where approval_id=$1", [replacement.approval_id]);
      clock = new Date(clock.getTime() + 1000);
      await carry(db, services);
      assert.equal(await stateOf(replacement.approval_id), "sponsoring");
      assert.deepEqual((await carrierOf(replacement.approval_id)).wake_at, new Date(clock.getTime() + 30_000), "only the failing approval backs off");
      assert.equal(await stateOf(original.approval_id), "landed", "a failing opener callback must not stop the rest of the batch");
      failCallback = false;
      clock = new Date(clock.getTime() + 30_000);
      await carry(db, services); await carry(db, services);
      const ended = (await admin.query("select state,displaced_by,ended_at from app.approvals where approval_id=$1", [replacement.approval_id])).rows[0];
      assert.equal(ended.state, "displaced"); assert.equal(ended.displaced_by, hash); assert.deepEqual(ended.ended_at, clock);
      assert.equal(callbacks, 1); assert.equal(outsideCalls, 0);
      assert.equal((await admin.query("select count(*)::int as n from app.approval_carriers where approval_id=$1", [replacement.approval_id])).rows[0].n, 0);
    });
    await t.test("signing intent does not inherit a builder's changed replacement nonce or expiry", async () => {
      const signing: SigningContext = { ...ctx, network: { name: "Test", explorerUrl: "https://explorer.test" }, requireFeature: async () => {} };
      const original = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "intent-original", send_after: new Date(now.getTime() + 60_000).toISOString() }));
      const first = await tenant((sql) => signingGet(sql, signing, { approvalId: original.approval_id }));
      assert.equal(first.deadline, terms.deadline); assert.equal(first.replacement, null);
      const fixedNonce = ((BigInt(first.nonceKey) << 64n) + 17n).toString();
      await admin.query("update app.approvals set state='signed',nonce=$2 where approval_id=$1", [original.approval_id, fixedNonce]);
      const replacing = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "intent-replacement", replaces: original.approval_id }));
      const shorterExpiry = new Date(now.getTime() + 120_000);
      await admin.query("update app.approvals set nonce=$2,valid_until=$3 where approval_id=$1", [replacing.approval_id, (BigInt(fixedNonce) + 1n).toString(), shorterExpiry]);
      const result = await tenant((sql) => signingGet(sql, signing, { approvalId: replacing.approval_id }));
      assert.equal(result.nonceKey, first.nonceKey);
      assert.equal(result.deadline, terms.deadline); assert.equal(result.expiresAt, shorterExpiry.toISOString());
      assert.deepEqual(result.replacement, { approvalId: original.approval_id, nonce: fixedNonce });
    });
    await t.test("public signing HTTP/SDK auth, atomic replay and live revocation controls", async () => {
      await signingTransportControls(db, admin, ctx, terms);
    });
    await t.test("sponsorship expiry is never a refusal: it waits for the lapse, counts no attempt and ends expired", async () => {
      // A later deadline than every earlier approval, so they all lapse here and only this one is ever sponsored.
      const deadline = new Date(now.getTime() + 3_600_000);
      const mine = await tenant((sql) => open(sql, ctx, { ...terms, subject_id: "expiry-boundary", deadline: deadline.toISOString() }, "expiry-trace"));
      let clock = new Date(deadline.getTime() - 1000), calls = 0;
      const ends: string[] = [];
      const services: CarrierServices = {
        now: async () => clock,
        sponsor: async (row) => { assert.equal(row.approval_id, mine.approval_id); calls++; return { expired: true }; },
        send: async () => { throw new Error("nothing is sent"); }, lookup: async () => ({ held: false }),
        nonce: async (row) => row.nonce!, needsAndGate: async () => false, fact: async () => null,
        terminal: async (_sql, event) => { if (event.approval_id === mine.approval_id) ends.push(`${event.outcome}:${event.refusal}`); },
      };
      const carrierOf = async () => (await admin.query("select wake_at,attempts from app.approval_carriers where approval_id=$1", [mine.approval_id])).rows[0];
      const lapseAt = new Date(deadline.getTime() + 120_000);
      // One whole second left: the sponsor is asked, and its expired answer waits for the lapse without an attempt.
      await carry(db, services);
      assert.equal(calls, 1);
      assert.deepEqual(await carrierOf(), { wake_at: lapseAt, attempts: 0 });
      // Less than a whole second left: the carrier does not ask at all.
      await admin.query("update app.approval_carriers set wake_at=$2 where approval_id=$1", [mine.approval_id, clock]);
      clock = new Date(deadline.getTime() - 500);
      await carry(db, services);
      assert.equal(calls, 1);
      assert.deepEqual(await carrierOf(), { wake_at: lapseAt, attempts: 0 });
      assert.equal((await admin.query("select state from app.approvals where approval_id=$1", [mine.approval_id])).rows[0].state, "sponsoring");
      clock = lapseAt;
      await carry(db, services);
      assert.deepEqual(ends, ["expired:null"]);
      assert.equal((await admin.query("select state from app.approvals where approval_id=$1", [mine.approval_id])).rows[0].state, "expired");
    });
  } finally { await db.close(); await admin.end(); }
});
