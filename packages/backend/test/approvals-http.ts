import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import type pg from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { Database } from "../src/platform/db.ts";
import { createSigningHandler, open, type ApprovalContext, type Open } from "../src/approvals/door.ts";
import { createApprovalsClient } from "../../sdk/src/approvals/door.ts";

/** Native HTTP/SQL boundary controls; test sessions/operation are not Access or sponsor conformance. */
export async function signingTransportControls(db: Database, admin: pg.Client, ctx: ApprovalContext, terms: Open) {
  const account = privateKeyToAccount(`0x${"17".repeat(32)}`);
  const born = (subject: string) => db.transaction("approval-org", async (sql) => {
    await sql.query("select set_config('app.person_id',$1,true),set_config('app.owner_kind','person',true),set_config('app.owner_id',$1,true)", [ctx.person_id]);
    return open(sql, ctx, { ...terms, subject_id: subject, gate: "signing-test" }, "http-birth");
  });
  await admin.query(`create table app.test_signing_sessions(token text primary key,person text,expires_at bigint);
    create table app.test_signing_gate(enabled boolean); insert into app.test_signing_gate values(true);
    grant select on app.test_signing_sessions,app.test_signing_gate to capxul_core`);
  await admin.query("insert into app.test_signing_sessions values('original-bearer',$1,$2),('other-bearer','other-person',$2)",
    [ctx.person_id, ctx.now.getTime() + 60_000]);
  let callbacks = 0, failTerminal = false;
  const handler = createSigningHandler({ db, site_url: ctx.site_url, network: { name: "Control", explorerUrl: "https://explorer.test" },
    now: async () => ctx.now.getTime(),
    authenticate: async (sql, bearer, at) => {
      const row = (await sql.query("select person from app.test_signing_sessions where token=$1 and expires_at>$2", [bearer, at])).rows[0];
      if (!row) throw new Error("NOT_AUTHENTICATED: expired or revoked session");
      await sql.query(`select set_config('app.person_id',$1,true),set_config('app.owner_kind','person',true),
        set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true)`, [row.person, ctx.sender]);
      return { personId: row.person, safeAddress: ctx.sender };
    },
    requireFeature: async (sql) => {
      if (!(await sql.query("select enabled from app.test_signing_gate")).rows[0].enabled) throw new Error("FEATURE_NOT_AVAILABLE: signing-test");
    },
    terminal: async (sql, event) => {
      assert.equal((await sql.query("select state from app.approvals where approval_id=$1", [event.approval_id])).rows[0].state, event.outcome);
      if (failTerminal) throw new Error("private database secret should never reach wire");
      callbacks++;
    },
  });
  let lastStream: ServerResponse | undefined;
  const server = createServer((req, res) => {
    if (req.headers.accept === "text/event-stream") lastStream = res;
    void handler(req, res).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const coreUrl = `http://127.0.0.1:${address.port}`;
  const sdk = createApprovalsClient({ coreUrl, bearer: async () => "original-bearer" });
  const other = createApprovalsClient({ coreUrl, bearer: async () => "other-bearer" });
  const key = await born("http-sign");
  const input = { approvalId: key.approval_id };
  const wire = (method: string, body: unknown, callId = "http-call") => fetch(`${coreUrl}/approvals/signing/${method}`, {
    method: "POST", headers: { authorization: "Bearer original-bearer", "content-type": "application/json",
      "x-capxul-trace": "http-trace", "x-capxul-call-id": callId }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await sdk.get(input)).state, "sponsoring");
    const unavailable = await other.get(input).then(() => null, (e) => e);
    const missing = await other.get({ approvalId: "approval_missing" }).then(() => null, (e) => e);
    assert.equal(unavailable.code, "INVALID_INPUT"); assert.equal(unavailable.message, missing.message);
    assert.equal((await fetch(`${coreUrl}/approvals/signing/get?approvalId=${key.approval_id}`)).status, 401);
    assert.equal((await wire("review", { ...input, person_id: ctx.person_id })).status, 400);
    const reviewed = await sdk.review(input, { traceId: "review-trace", callId: "review-call" });
    assert.equal(reviewed.reviewedAt, ctx.now.toISOString());
    const digest = `0x${"ac".repeat(32)}` as const;
    // A pending operation fixture tests the actual HTTP raw-recovery boundary, not sponsorship.
    await admin.query(`update app.approvals set state='pending',digest=$2,signer_address=$3,valid_until=deadline
      where approval_id=$1`, [key.approval_id, digest, account.address.toLowerCase()]);
    assert.equal((await wire("sign", { ...input, signature: `0x${"00".repeat(65)}` }, "invalid-signature")).status, 400);
    const signature = await account.sign({ hash: digest });
    const signed = await sdk.sign({ ...input, signature }, { traceId: "sign-trace", callId: "sign-call" });
    assert.equal(signed.state, "signed");
    assert.equal((await sdk.sign({ ...input, signature }, { traceId: "different-retry-trace", callId: "sign-call" })).state, "signed");
    assert.equal((await wire("decline", input, "sign-call")).status, 400);
    assert.equal((await admin.query("select count(*)::int as n from app.transition_outbox where event->>'trace_id'='sign-trace'")).rows[0].n, 1);
    assert.equal((await admin.query("select count(*)::int as n from app.approval_calls where call_id='invalid-signature'")).rows[0].n, 0);

    const declining = { approvalId: (await born("http-decline")).approval_id };
    failTerminal = true;
    const refused = await wire("decline", declining, "decline-call");
    assert.equal(refused.status, 503); assert.deepEqual(await refused.json(), { error: { code: "PROVIDER_ERROR", message: "Signing service unavailable" } });
    assert.equal((await sdk.get(declining)).state, "sponsoring");
    failTerminal = false;
    assert.equal((await sdk.decline(declining, { traceId: "decline-trace", callId: "decline-call" })).state, "declined");
    await sdk.decline(declining, { traceId: "decline-trace", callId: "decline-call" }); assert.equal(callbacks, 1);

    const controller = new AbortController();
    const stream = sdk.observe(input, controller.signal);
    assert.equal((await stream.next()).value?.state, "signed");
    const openTransactions = (await admin.query(`select count(*)::int as n from pg_stat_activity
      where datname=current_database() and usename='capxul_core' and state='idle in transaction'`)).rows[0].n;
    assert.equal(openTransactions, 0, "SSE must release tenant transactions before emitting/waiting");
    const cancelled = new AbortController();
    const live = sdk.observe(input, cancelled.signal);
    assert.equal((await live.next()).value?.state, "signed");
    assert(lastStream);
    const closed = once(lastStream, "close");
    cancelled.abort();
    await closed;
    assert.equal((await live.next()).done, true, "disconnect cancels an active stream without another frame");
    await admin.query("update app.test_signing_gate set enabled=false");
    await assert.rejects(stream.next(), (e: unknown) => e instanceof Error && "code" in e && e.code === "FEATURE_NOT_AVAILABLE");
    await admin.query("update app.test_signing_gate set enabled=true");
    const revoked = sdk.observe(input, controller.signal); await revoked.next();
    await admin.query("delete from app.test_signing_sessions where token='original-bearer'");
    await assert.rejects(revoked.next(), (e: unknown) => e instanceof Error && "code" in e && e.code === "NOT_AUTHENTICATED");
    const disconnect = other.observe({ approvalId: "approval_missing" }, controller.signal);
    await assert.rejects(disconnect.next(), (e: unknown) => e instanceof Error && "code" in e && e.code === "INVALID_INPUT");
    controller.abort();
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
