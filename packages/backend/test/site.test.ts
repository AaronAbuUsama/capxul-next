import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { Effect, Result } from "effect";
import { createFrappeSite, type FrappeSiteError } from "../src/plugs/door.ts";

const secret = "transport-contract-test-only";
const scope = { orgId: "north", site: "north.test", traceId: "trace-one" };
const mac = (raw: string) => createHmac("sha256", secret).update(raw).digest("hex");
const event = { ...scope, event_key: "84532:tx:7", seq: 4, kind: "deposit_received", data: { amount: "12.34" } };
const answer = { ...scope, request_id: "R-1", approval_id: "A-2", approval_url: "https://core.test/approve/A-2", requested_by: "payer@test" };
async function receiver(t: test.TestContext, handle: (req: IncomingMessage, res: ServerResponse, body: any) => void) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    assert.equal(req.headers["x-capxul-signature"], mac(raw));
    assert.equal(req.headers["x-frappe-site-name"], scope.site);
    handle(req, res, JSON.parse(raw));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { baseUrl, site: createFrappeSite({ baseUrl, secret }) };
}
function reply(res: ServerResponse, message: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ message }));
}
async function fails<A>(effect: Effect.Effect<A, FrappeSiteError>, code: FrappeSiteError["code"]) {
  const result = await Effect.runPromise(Effect.result(effect));
  assert.ok(Result.isFailure(result)); assert.equal(result.failure.code, code); return result.failure;
}

test("signed product calls carry the asserted person, stable call identity and normalized results", async (t) => {
  const { site } = await receiver(t, (req, res, body) => {
    assert.equal(req.headers["x-capxul-trace"], scope.traceId);
    const [encoded, signature] = String(req.headers["x-capxul-assertion"]).split(".");
    const raw = Buffer.from(encoded!, "base64url").toString(); assert.equal(signature, mac(raw));
    const claim = JSON.parse(raw); assert.equal(claim.u, "payer@test"); assert.equal(claim.s, scope.site);
    assert.ok(claim.nonce && claim.exp > Date.now() / 1000 && claim.exp <= Date.now() / 1000 + 60);
    assert.equal(body.org, "north"); assert.equal(body.user, undefined); assert.equal(body.endpoint, undefined);
    if (req.url?.endsWith(".report")) {
      assert.deepEqual(body.filters, { company: "North", from_date: "2026-11-01" });
      reply(res, { ok: true, data: { columns: [{ fieldname: "debit" }], rows: [{ debit: 12.34 }] } });
    } else {
      assert.equal(body.call_id, "C-7"); assert.deepEqual(body.fields, { supplier_name: "Asymmetric supplier" });
      reply(res, { ok: true, data: { doctype: "Supplier", name: "SUP-3", docstatus: 0, fields: body.fields } });
    }
  });
  assert.deepEqual(await Effect.runPromise(site.doorCall({ ...scope, user: "payer@test", verb: "create", doctype: "Supplier", callId: "C-7", fields: { supplier_name: "Asymmetric supplier" } })),
    { doctype: "Supplier", name: "SUP-3", docstatus: 0, fields: { supplier_name: "Asymmetric supplier" } });
  const report = await Effect.runPromise(site.doorReport({ ...scope, user: "payer@test", report: "General Ledger", filters: { company: "North", from_date: "2026-11-01" } }));
  assert.deepEqual(report.rows, [{ debit: 12.34 }]);
});

test("account resolution signs the person and accepts only a canonical Account document", async (t) => {
  let document: unknown = { doctype: "Account", name: "Cash - N", docstatus: 0, fields: { account_number: "1010" } };
  const { site } = await receiver(t, (req, res, body) => {
    assert.equal(req.url, "/api/method/capxul.product_door.account");
    assert.deepEqual(body, { reference: "1010", org: scope.orgId });
    const [encoded, signature] = String(req.headers["x-capxul-assertion"]).split(".");
    const raw = Buffer.from(encoded!, "base64url").toString();
    assert.equal(signature, mac(raw)); assert.equal(JSON.parse(raw).u, "reader@test");
    reply(res, { ok: true, data: document });
  });
  const input = { ...scope, user: "reader@test", reference: "1010" };
  assert.deepEqual(await Effect.runPromise(site.resolveAccount(input)), document);
  for (const wrong of [
    { doctype: "Supplier", name: "1010", docstatus: 0, fields: {} },
    { safe: true, status: "Requesting", approval_url: null, request: "R-1" },
  ]) {
    document = wrong; await fails(site.resolveAccount(input), "PROVIDER_RESPONSE_INVALID");
  }
});

test("safe submit accepts only a pending receipt, never a site-invented held answer", async (t) => {
  let data: unknown = { safe: true, status: "Requesting", approval_url: null, request: "R-1" };
  const { site } = await receiver(t, (_req, res) => reply(res, { ok: true, data }));
  const input = { ...scope, user: "payer@test", verb: "submit" as const, doctype: "Payment Entry", name: "PE-1", callId: "C-9" };
  assert.deepEqual(await Effect.runPromise(site.doorCall(input)), data);
  for (const wrong of [
    { safe: true, status: "Waiting for signature", approval_url: null, request: "R-1" },
    { safe: true, status: "Requesting", approval_url: "https://invented.test", request: "R-1" },
  ]) {
    data = wrong; await fails(site.doorCall(input), "PROVIDER_RESPONSE_INVALID");
  }
});

test("native Frappe exceptions without message and product refusals retain typed public errors", async (t) => {
  let response: unknown, status = 403;
  const { site } = await receiver(t, (_req, res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(response)); });
  for (const [native, expected, http] of [
    ["FeatureNotAvailable", "FEATURE_NOT_AVAILABLE", 403], ["PermissionError", "ROLE_PERMISSION_DENIED", 403],
    ["DoesNotExistError", "INVALID_INPUT", 404], ["ValidationError", "ROLE_PERMISSION_DENIED", 417],
  ] as const) {
    response = { exc_type: native, exception: "private SQL and trace" }; status = http;
    const error = await fails(site.doorCall({ ...scope, user: "payer@test", verb: "get", doctype: "Supplier", name: "X" }), expected);
    assert.ok(!JSON.stringify(error).includes("private SQL"));
  }
  response = { exc_type: "ValidationError" }; status = 417;
  await fails(site.readSite(scope), "WRONG_STATE");
  response = { message: { ok: false, error: { code: "WRONG_STATE", message: "Already submitted" } } }; status = 409;
  await fails(site.doorCall({ ...scope, user: "payer@test", verb: "submit", doctype: "Supplier", callId: "C-8" }), "WRONG_STATE");
});

test("bad signatures never retry; transient failures do, with the same durable answer", async (t) => {
  let attempts = 0, status = 401;
  const sent: unknown[] = [];
  const { site } = await receiver(t, (_req, res, body) => {
    attempts++; sent.push(body);
    reply(res, { request_id: "R-1", status: "Waiting for signature", duplicate: true }, status);
    if (status === 503) status = 200;
  });
  await fails(site.answerPaymentRequest(answer), "PROVIDER_ERROR"); assert.equal(attempts, 1);
  attempts = 0; sent.length = 0; status = 503;
  assert.equal((await Effect.runPromise(site.answerPaymentRequest(answer))).duplicate, true);
  assert.equal(attempts, 2); assert.deepEqual(sent[0], sent[1]);
});

test("generic 200, contradictory ACKs, wrong answer identity and cross-site listeners never acknowledge work", async (t) => {
  let response: unknown;
  const { site } = await receiver(t, (_req, res) => reply(res, response));
  for (const ack of [{ ok: true }, { applied: true, duplicate: true, last_seq: 4 }, { applied: true, duplicate: false, parked: true, last_seq: 4 }]) {
    response = ack; await fails(site.applyEvent(event), "PROVIDER_RESPONSE_INVALID");
  }
  response = { applied: false, duplicate: false, parked: true, last_seq: 4, error: "Voucher invalid" };
  assert.equal((await Effect.runPromise(site.applyEvent(event))).parked, true);
  response = { request_id: "OTHER", status: "Sent", duplicate: false };
  await fails(site.answerPaymentRequest(answer), "PROVIDER_RESPONSE_INVALID");
  response = { authorization: "CapxulListener token", namespace: "/other.test", event: "capxul_payment_request", expires_at: Math.floor(Date.now() / 1000) + 60 };
  await fails(site.paymentRequestListener(scope), "PROVIDER_RESPONSE_INVALID");
  response = { ...response as object, namespace: "/north.test", expires_at: Math.floor(Date.now() / 1000) - 1 };
  await fails(site.paymentRequestListener(scope), "PROVIDER_RESPONSE_INVALID");
});

test("collection rejects asymmetric tenant, order, identity and cursor mismatches", async (t) => {
  let requests: unknown[] = [], cursor = 0;
  const { site } = await receiver(t, (_req, res) => reply(res, { requests, cursor }));
  const row = { request_id: "R-1", idempotency_key: "R-1", cursor: 2, trace_id: "T", org: scope.orgId, site: scope.site,
    doctype: "Payment Entry", name: "PE-1", document_hash: "0xhash", requested_by: "payer@test", to_party: "Supplier", to_address: "0xabc", amount: "12.34", asset: "USDC", department: "Finance" };
  cursor = 2; requests = [row]; assert.equal((await Effect.runPromise(site.collectPaymentRequests({ ...scope, after: 1 }))).cursor, 2);
  for (const bad of [{ ...row, org: "south" }, { ...row, site: "south.test" }, { ...row, cursor: 1 }, { ...row, idempotency_key: "other" }]) {
    requests = [bad]; await fails(site.collectPaymentRequests({ ...scope, after: 1 }), "PROVIDER_RESPONSE_INVALID");
  }
  requests = [row]; cursor = 3; await fails(site.collectPaymentRequests({ ...scope, after: 1 }), "PROVIDER_RESPONSE_INVALID");
});

test("redirects cannot forward signed service credentials to another endpoint", async (t) => {
  let reached = false;
  const target = await receiver(t, (_req, res) => { reached = true; reply(res, {}); });
  const { site } = await receiver(t, (_req, res) => { res.writeHead(307, { location: target.baseUrl }); res.end(); });
  await fails(site.applyEvent(event), "PROVIDER_ERROR"); assert.equal(reached, false);
});

test("the response body, not just headers, has a bounded timeout", { timeout: 20000 }, async (t) => {
  const { site } = await receiver(t, (_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{"message":'); });
  const started = Date.now();
  await fails(site.readSite(scope), "PROVIDER_ERROR");
  assert.ok(Date.now() - started < 19000);
});
