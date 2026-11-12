import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { privateKeyToAccount } from "viem/accounts";
import { createDocumentClient, DOCUMENT_PATH, documentMessage } from "@capxul/sdk";
import { createDocumentHandler, type DocumentProvider, type SiteRequestAnswer } from "./documents.ts";

const key = `0x${"11".repeat(32)}` as const;
const person = privateKeyToAccount(key);
const outsider = privateKeyToAccount(`0x${"22".repeat(32)}`);
const cli = fileURLToPath(new URL("../../../cli/src/main.ts", import.meta.url));
const exec = promisify(execFile);
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};

test("signed public SDK/CLI resolves its person and exact document/report/held results", async (t) => {
  const calls: unknown[] = [];
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
      return Effect.succeed({ doctype: invalid ? "Wrong Type" : input.doctype, name: input.verb === "create" ? "SUP-9" : input.name,
        docstatus: input.verb === "submit" ? 1 : 0, fields: input.verb === "create" ? input.fields : {} });
    },
    doorReport: () => Effect.succeed({ columns: [{ fieldname: "balance" }], rows: [{ balance: 17.25 }] }),
  };
  let handler: ReturnType<typeof createDocumentHandler>;
  const server = createServer(async (req, res) => {
    if (await handler(req, res)) return;
    let raw = ""; for await (const chunk of req) raw += chunk;
    assert.equal(req.headers["x-capxul-signature"], createHmac("sha256", "private").update(raw).digest("hex"));
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    assert.equal(req.url, "/admin/org-info");
    assert.deepEqual(body, { org: "acme" });
    res.end(JSON.stringify({ slug: "acme", site: "acme-town1.localhost", people: [{ address: person.address, email: "director@example.invalid" }] }));
  });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = await listen(server);
  handler = createDocumentHandler({ publicOrigin: url, coreUrl: url, coreSecret: "private", provider,
    requestAnswer: (input) => {
      assert.deepEqual(input, { org: "acme", request_id: "R-7", requested_by: "director@example.invalid" });
      return Effect.succeed(++lookups === 1 ? { status: "collecting" } : requestAnswer);
    },
    store: { site: async () => ({ host: "acme-town1.localhost", state: "ready" }) as any, logCall: async (call) => { calls.push(call); } } });
  const client = createDocumentClient({ coreUrl: url, account: person });
  const created = await client.create({ orgId: "acme", doctype: "Supplier", fields: { supplier_name: "Brightside", disabled: false }, callId: "create-1" });
  assert.deepEqual(created, { doctype: "Supplier", name: "SUP-9", docstatus: 0, fields: { supplier_name: "Brightside", disabled: false } });
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
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, CAPXUL_CORE_URL: url, CAPXUL_PRIVATE_KEY: key } });
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
  await assert.rejects(createDocumentClient({ coreUrl: url, account: outsider }).report({ orgId: "acme", report: "General Ledger", filters: null }), { code: "ROLE_PERMISSION_DENIED" });
  const before = calls.length;
  const body = JSON.stringify({ verb: "create", orgId: "acme", doctype: "Supplier", fields: {}, callId: "forged", caller: person.address, expiresAt: Date.now() + 50_000 });
  const signature = await person.signMessage({ message: documentMessage("https://another-origin.invalid", body) });
  const crossOrigin = await fetch(`${url}${DOCUMENT_PATH}`, { method: "POST", body, headers: { "x-capxul-signature": signature } });
  assert.equal(crossOrigin.status, 401);
  assert.equal((await crossOrigin.json() as any).error.code, "NOT_AUTHENTICATED");
  assert.equal(calls.length, before);
  await assert.rejects(run("doc", "create", "Supplier", "--org", "acme", "--as", "Administrator"), (e: any) => e.code === 2);
});
