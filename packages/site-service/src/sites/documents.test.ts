import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { privateKeyToAccount } from "viem/accounts";
import { createDocumentClient, DOCUMENT_PATH } from "@capxul/sdk";
import { createDocumentHandler, type DocumentProvider, type SiteRequestAnswer } from "./documents.ts";

const key = `0x${"11".repeat(32)}` as const;
const person = privateKeyToAccount(key);
const cli = fileURLToPath(new URL("../../../cli/src/main.ts", import.meta.url));
const exec = promisify(execFile);
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};

test("human Access principal with no wallet binding reaches the document door", async (t) => {
  let handler: ReturnType<typeof createDocumentHandler>;
  const server = createServer((req, res) => void handler(req, res));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = await listen(server);
  const traces: string[][] = [];
  handler = createDocumentHandler({
    authorize: ({ traceId }) => { traces.push([traceId]); return Effect.succeed({ personId: "person-original", kind: "person", email: "director@example.invalid",
      safeAddress: person.address, signerAddress: null }); },
    provider: { doorCall: (input) => { traces.at(-1)!.push(input.traceId!); return Effect.succeed({ doctype: "Supplier", name: "S-1", docstatus: 0, fields: { user: input.user } }); },
      doorReport: () => Effect.succeed({ columns: [], rows: [] }) },
    store: { site: async () => ({ host: "acme-town1.localhost", state: "ready" }) as any, logCall: async (call) => { traces.at(-1)!.push(call.trace); } },
    requestAnswer: () => Effect.succeed({ status: "collecting" }),
  });
  const response = await fetch(`${url}${DOCUMENT_PATH}`, { method: "POST", headers: { Authorization: "Bearer actual-session" },
    body: JSON.stringify({ verb: "get", orgId: "acme", doctype: "Supplier", name: "S-1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).fields.user, "director@example.invalid");
  // Core's request signal sets x-capxul-trace; authorization, the site call and the audit all join it.
  const joined = "0af7651916cd43dd8448eb211c80319c";
  const send = (trace: string) => fetch(`${url}${DOCUMENT_PATH}`, { method: "POST",
    headers: { Authorization: "Bearer actual-session", "x-capxul-trace": trace },
    body: JSON.stringify({ verb: "get", orgId: "acme", doctype: "Supplier", name: "S-1" }) });
  assert.equal((await send(joined)).status, 200);
  assert.deepEqual(traces.at(-1), [joined, joined, joined]);
  for (const malformed of ["0AF7651916CD43DD8448EB211C80319C", "0af76519-16cd-43dd-8448-eb211c80319c"]) {
    assert.equal((await send(malformed)).status, 200);
    const [fresh, ...rest] = traces.at(-1)!;
    assert.match(fresh!, /^[0-9a-f]{32}$/); assert.notEqual(fresh, joined); assert.deepEqual(rest, [fresh, fresh]);
  }
});

test("Core is told to record a document call only once its caller is authorized", async (t) => {
  let admits = 0;
  const handler = createDocumentHandler({
    authorize: ({ bearer }) => bearer === "seated" ? Effect.succeed({ personId: "person-1", kind: "person", email: "director@example.invalid",
      safeAddress: person.address, signerAddress: null }) : Effect.fail({ code: "ROLE_PERMISSION_DENIED", message: "current Seat required" }),
    provider: { doorCall: () => Effect.succeed({ doctype: "Supplier", name: "S-1", docstatus: 0, fields: {} }),
      doorReport: () => Effect.succeed({ columns: [], rows: [] }) },
    store: { site: async () => ({ host: "acme-town1.localhost", state: "ready" }) as any, logCall: async () => {} },
    requestAnswer: () => Effect.succeed({ status: "collecting" }),
  });
  const server = createServer((req, res) => void handler(req, res, () => { admits++; }));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = await listen(server);
  const get = (bearer?: string) => fetch(`${url}${DOCUMENT_PATH}`, { method: "POST", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    body: JSON.stringify({ verb: "get", orgId: "acme", doctype: "Supplier", name: "S-1" }) }).then((r) => r.status);
  assert.deepEqual([await get(), await get("unseated")], [401, 403]);
  assert.equal(admits, 0);
  assert.equal(await get("seated"), 200);
  assert.equal(admits, 1);
});

test("Bearer public SDK/CLI resolves its principal and exact document/report/held results", async (t) => {
  const calls: unknown[] = [];
  const receipts = new Map<string, Record<string, unknown>>();
  let token = "director-session", revoked = false, activeSeat = true;
  let providerFailure: string | undefined, invalid = false;
  let lookups = 0;
  let siteAnswer: Record<string, unknown> | undefined;
  let requestAnswer: SiteRequestAnswer = { status: "answered", approval_id: "A-4", approval_url: "https://core.invalid/approve/A-4",
    requested_by: "director@example.invalid", awaiting: person.address };
  const provider: DocumentProvider = {
    doorCall(input) {
      if (providerFailure) return Effect.fail({ code: providerFailure, message: "Site refused" });
      assert.equal(input.user, "director@example.invalid");
      assert.equal(input.site, "acme-town1.localhost");
      assert.ok(input.traceId);
      if (input.doctype === "Payment Entry") return Effect.succeed(siteAnswer ?? { safe: true, status: "Requesting", approval_url: null, request: "R-7" });
      if (input.verb === "create" && receipts.has(input.callId)) return Effect.succeed(receipts.get(input.callId)!);
      const result = { doctype: invalid ? "Wrong Type" : input.doctype, name: input.verb === "create" ? `SUP-${9 + receipts.size}` : input.name,
        docstatus: input.verb === "submit" ? 1 : 0, fields: input.verb === "create" ? input.fields : {} };
      if (input.verb === "create") receipts.set(input.callId, result);
      return Effect.succeed(result);
    },
    doorReport: () => Effect.succeed({ columns: [{ fieldname: "balance" }], rows: [{ balance: 17.25 }] }),
  };
  let handler: ReturnType<typeof createDocumentHandler>;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-capxul-signature"], undefined);
    if (!await handler(req, res)) { res.writeHead(404); res.end(); }
  });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = await listen(server);
  handler = createDocumentHandler({ provider,
    authorize: ({ orgId, bearer }) => {
      assert.equal(orgId, "acme");
      if (revoked || !["director-session", "rotated-session", "agent-session", "other-person-session"].includes(bearer))
        return Effect.fail({ code: "NOT_AUTHENTICATED", message: "Session is inactive" });
      if (!activeSeat) return Effect.fail({ code: "ROLE_PERMISSION_DENIED", message: "Seat is inactive" });
      return Effect.succeed({ personId: bearer === "other-person-session" ? "another-person" : "original-person",
        kind: bearer === "agent-session" ? "agent" : "person", email: bearer === "agent-session" ? null : "director@example.invalid",
        safeAddress: person.address, signerAddress: bearer === "agent-session" ? person.address : null });
    },
    requestAnswer: (input) => {
      assert.deepEqual(input, { org: "acme", request_id: "R-7", requested_by: "director@example.invalid" });
      return Effect.succeed(++lookups === 1 ? { status: "collecting" } : requestAnswer);
    },
    store: { site: async () => ({ host: "acme-town1.localhost", state: "ready" }) as any, logCall: async (call) => { calls.push(call); } } });
  const client = createDocumentClient({ coreUrl: url, bearer: async () => token });
  const created = await client.create({ orgId: "acme", doctype: "Supplier", fields: { supplier_name: "Brightside", disabled: false }, callId: "create-1" });
  assert.deepEqual(created, { doctype: "Supplier", name: "SUP-9", docstatus: 0, fields: { supplier_name: "Brightside", disabled: false } });
  token = "rotated-session";
  assert.deepEqual(await client.create({ orgId: "acme", doctype: "Supplier", fields: { supplier_name: "Brightside", disabled: false }, callId: "create-1" }), created);
  token = "other-person-session";
  const other = await client.create({ orgId: "acme", doctype: "Supplier", fields: { supplier_name: "Brightside", disabled: false }, callId: "create-1" });
  assert.notEqual(other.name, created.name, "another principal cannot replay this person's receipt, even with the same email");
  token = "director-session";
  assert.equal((await client.get({ orgId: "acme", doctype: "Supplier", name: "SUP-9" })).name, "SUP-9");
  assert.equal((await client.submit({ orgId: "acme", doctype: "Purchase Invoice", name: "INV-2", callId: "submit-1" }) as any).docstatus, 1);
  assert.deepEqual(await client.submit({ orgId: "acme", doctype: "Payment Entry", name: "PAY-3", callId: "submit-2" }),
    { held: true, requestId: "R-7", approvalId: "A-4", awaiting: person.address });
  assert.equal(lookups, 2);
  for (const forged of [{ held: true, requestId: "R-7", approvalId: "A-site", awaiting: person.address },
    { safe: true, status: "Waiting for signature", approval_url: "https://core.invalid/approve/A-site", request: "R-7" }]) {
    siteAnswer = forged;
    await assert.rejects(client.submit({ orgId: "acme", doctype: "Payment Entry", name: "PAY-3", callId: "site-answer" }),
      { code: "PROVIDER_RESPONSE_INVALID" });
  }
  siteAnswer = undefined;
  requestAnswer = { status: "refused", error: { code: "INVALID_INPUT", message: "Committed request refused" } };
  await assert.rejects(client.submit({ orgId: "acme", doctype: "Payment Entry", name: "PAY-4", callId: "submit-refused" }),
    { code: "INVALID_INPUT", message: "Committed request refused" });
  requestAnswer = { status: "answered", approval_id: "A-4", approval_url: "https://core.invalid/approve/A-4",
    requested_by: "another@example.invalid", awaiting: person.address };
  await assert.rejects(client.submit({ orgId: "acme", doctype: "Payment Entry", name: "PAY-4", callId: "submit-wrong-person" }),
    { code: "PROVIDER_RESPONSE_INVALID" });
  requestAnswer = { ...requestAnswer, requested_by: "director@example.invalid", awaiting: "signer@example.invalid" };
  await assert.rejects(client.submit({ orgId: "acme", doctype: "Payment Entry", name: "PAY-4", callId: "submit-no-signer" }),
    { code: "PROVIDER_RESPONSE_INVALID" });
  assert.deepEqual(await client.report({ orgId: "acme", report: "General Ledger", filters: { company: "Acme" } }),
    { columns: [{ fieldname: "balance" }], rows: [{ balance: 17.25 }] });
  const run = (...args: string[]) => exec(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, ...args],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, CAPXUL_CORE_URL: url, CAPXUL_ACCESS_TOKEN: token } });
  const result = await run("doc", "create", "Supplier", "--org", "acme", "--field", "supplier_name=Other Supplier", "--call-id", "cli-create", "--json");
  assert.deepEqual(JSON.parse(result.stdout).fields, { supplier_name: "Other Supplier" });
  assert.equal(result.stderr, "");
  for (const [code, exit] of [["FEATURE_NOT_AVAILABLE", 6], ["ROLE_PERMISSION_DENIED", 4], ["INVALID_INPUT", 2], ["PROVIDER_ERROR", 5]] as const) {
    providerFailure = code;
    await assert.rejects(run("doc", "create", "Supplier", "--org", "acme", "--data", "{}", "--call-id", "refusal", "--json"),
      (e: any) => e.code === exit && !e.stdout && JSON.parse(e.stderr).error.code === code);
  }
  providerFailure = undefined;
  invalid = true;
  await assert.rejects(client.create({ orgId: "acme", doctype: "Supplier", fields: {}, callId: "invalid" }), { code: "PROVIDER_RESPONSE_INVALID" });
  const before = calls.length;
  const nativeBefore = receipts.size;
  for (const value of ["", "unknown-session", "agent-session"]) {
    token = value;
    await assert.rejects(client.create({ orgId: "acme", doctype: "Supplier", fields: {}, callId: "create-1" }),
      { code: value === "agent-session" ? "ROLE_PERMISSION_DENIED" : "NOT_AUTHENTICATED" });
  }
  token = "director-session"; revoked = true;
  await assert.rejects(client.create({ orgId: "acme", doctype: "Supplier", fields: {}, callId: "create-1" }), { code: "NOT_AUTHENTICATED" });
  revoked = false;
  activeSeat = false;
  await assert.rejects(client.create({ orgId: "acme", doctype: "Supplier", fields: {}, callId: "create-1" }), { code: "ROLE_PERMISSION_DENIED" });
  activeSeat = true;
  const body = { verb: "create", orgId: "acme", doctype: "Supplier", fields: {}, callId: "forged" };
  const unsigned = await fetch(`${url}${DOCUMENT_PATH}`, { method: "POST", body: JSON.stringify(body) });
  assert.equal(unsigned.status, 401);
  for (const extra of [{ caller: person.address, expiresAt: Date.now() + 50_000 }, { user: "Administrator" }]) {
    const injected = await fetch(`${url}${DOCUMENT_PATH}`, { method: "POST", body: JSON.stringify({ ...body, ...extra }),
      headers: { authorization: `Bearer ${token}` } });
    assert.equal(injected.status, 400);
    assert.equal((await injected.json() as any).error.code, "INVALID_INPUT");
  }
  assert.equal(calls.length, before);
  assert.equal(receipts.size, nativeBefore, "refused admission creates no native receipt");
  assert(calls.every((call: any) => ["original-person", "another-person"].includes(call.person)));
  assert(!JSON.stringify(calls).includes("director-session"));
  await assert.rejects(run("doc", "create", "Supplier", "--org", "acme", "--as", "Administrator"), (e: any) => e.code === 2);
});
