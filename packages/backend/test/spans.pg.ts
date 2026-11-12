import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { Effect, Exit, Tracer } from "effect";
import { migrateSpans, readSpans, spanCollector, type SpanContext } from "../src/platform/spans.ts";

const url = process.env.SPAN_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/spans_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("SPAN_TEST_ADMIN_URL must name a dedicated loopback spans_test database");
}

test("retained real Effect spans: parentage, completed errors, isolation, privacy and visible retention failure", async () => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const roleUrl = (name: string) => { const u = new URL(url); u.username = name; return u.href; };
  await admin.query(`create role capxul_core login nosuperuser nobypassrls;
    create role capxul_worker login nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker`);
  await migrateSpans(admin);
  const worker = new pg.Pool({ connectionString: roleUrl("capxul_worker") });
  const tenant = new pg.Pool({ connectionString: roleUrl("capxul_core") });
  const context: SpanContext = { runId: "run-731", worldId: "world-a", codeVersion: "build-731", callId: "call-731",
    capxul_env: "devnet", producer: "backend", org_id: null, actor: "person-a" };
  const attributes = { ownerKind: "person", ownerId: "person-a", referenceKind: "payment", referenceId: "payment-731" };
  const secret = "private@example.test bearer-token memo suggestion";
  try {
    const collector = spanCollector(worker, { ...context, ...{ bearer: secret } }, ["PROVIDER_ERROR"]);
    const result = await Effect.runPromise(Effect.gen(function*() {
      yield* Effect.sleep("5 millis").pipe(Effect.withSpan("chain.readContract", { attributes: { secret } }));
      return secret;
    }).pipe(Effect.withSpan("rpc.books.annotations.save", { attributes: { ...attributes, email: secret, memo: secret } }), Effect.withTracer(collector.tracer)));
    assert.equal(result, secret, "collector does not alter the RPC result");
    await collector.flush();
    const all = (await admin.query("select event from app.completed_spans")).rows.map((r) => r.event);
    const root = all.find((s) => s.name === "rpc.books.annotations.save");
    const child = all.find((s) => s.name === "chain.readContract");
    assert(root && child); assert.equal(all.length, 2);
    assert.equal(root.parentSpanId, null); assert.match(root.spanId, /^[a-f0-9]{16}$/);
    assert.equal(child.traceId, root.traceId); assert.equal(child.parentSpanId, root.spanId);
    assert(root.startedAt <= child.startedAt && child.endedAt <= root.endedAt);
    assert(child.endedAt > child.startedAt); assert.equal(root.errorCode, null); assert.equal(root.outcome, "success");
    assert.deepEqual(root.attributes, attributes); assert.deepEqual(child.attributes, {});
    assert(!JSON.stringify(all).includes(secret));
    const selection = { runId: context.runId, worldId: context.worldId, traceId: root.traceId };
    assert.equal((await readSpans(worker, selection)).length, 2);
    assert.deepEqual(await readSpans(worker, { ...selection, worldId: "world-b" }), []);
    assert.deepEqual(await readSpans(worker, { ...selection, runId: "run-old" }), []);
    await assert.rejects(readSpans(tenant, selection), /permission denied/);
    await assert.rejects(worker.query("update app.completed_spans set event=event"), /permission denied/);

    // A refused operation is retained even though the operation fails; no error message/result is stored.
    const failed = spanCollector(worker, { ...context, callId: "call-failed" }, ["PROVIDER_ERROR"]);
    const parent = Tracer.externalSpan({ traceId: "a".repeat(32), spanId: "b".repeat(16) });
    const exit = await Effect.runPromiseExit(Effect.fail(Object.assign(new Error(secret), { code: "PROVIDER_ERROR" }))
      .pipe(Effect.withSpan("rpc.books.annotations.save", { parent, attributes }), Effect.withTracer(failed.tracer)));
    assert(Exit.isFailure(exit)); await failed.flush();
    const [refused] = await readSpans(worker, { ...selection, traceId: parent.traceId });
    assert(refused); assert.equal(refused.parentSpanId, parent.spanId);
    assert.equal(refused.outcome, "error"); assert.equal(refused.errorCode, "PROVIDER_ERROR");
    assert.equal(refused.callId, "call-failed"); assert(!JSON.stringify(refused).includes(secret));

    const broken = spanCollector(worker, { ...context, callId: "call-storage-down" }, []);
    await admin.query("revoke insert on app.completed_spans from capxul_worker");
    assert.equal(await Effect.runPromise(Effect.succeed(731).pipe(Effect.withSpan("rpc.books.annotations.save"), Effect.withTracer(broken.tracer))), 731);
    await assert.rejects(broken.flush(), /SPAN_RETENTION_FAILED/);
    assert.equal((await admin.query("select count(*)::int as n from app.completed_spans")).rows[0].n, 3);
  } finally { await Promise.all([worker.end(), tenant.end()]); await admin.end(); }
});
