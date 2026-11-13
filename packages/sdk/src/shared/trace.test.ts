import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createAccessClient } from "../access/client.ts";
import { createDocumentClient, createSitesClient } from "../sites/door.ts";
import { isTraceparent, newTraceparent, traceIdOf } from "./trace.ts";

test("every client sends the caller's traceparent, sends none without one, and refuses a malformed one", async () => {
  const seen: { path: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url!, headers: req.headers });
    res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "INVALID_INPUT" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const coreUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const calls = (traceparent?: string) => [
    async () => createAccessClient({ coreUrl, traceparent }).sendCode({ email: "a@example.test" }),
    async () => createSitesClient({ coreUrl, account, traceparent }).provision({ org: "acme" }),
    async () => createDocumentClient({ coreUrl, bearer: () => "token", traceparent }).get({ orgId: "acme", doctype: "Supplier", name: "S-1" }),
  ];
  try {
    const traceparent = newTraceparent();
    assert(isTraceparent(traceparent)); assert.match(traceIdOf(traceparent), /^[0-9a-f]{32}$/);
    assert.notEqual(traceIdOf(newTraceparent()), traceIdOf(traceparent), "each command gets its own trace");
    for (const call of calls(traceparent)) await assert.rejects(call());
    assert.deepEqual(seen.map((s) => [s.path, s.headers.traceparent]),
      [["/access/sign-in/send-code", traceparent], ["/org/site/provision", traceparent], ["/org/site/document", traceparent]]);
    seen.length = 0;
    for (const call of calls()) await assert.rejects(call());
    assert.deepEqual(seen.map((s) => s.headers.traceparent), [undefined, undefined, undefined], "no option, no header");
    seen.length = 0;
    for (const bad of [`00-${"0".repeat(32)}-${"a".repeat(16)}-01`, `00-${"a".repeat(32)}-${"0".repeat(16)}-01`, "00-ABC-def-01", `01-${"a".repeat(32)}-${"b".repeat(16)}-01`])
      for (const call of calls(bad)) await assert.rejects(call(), (e: { code?: string }) => e.code === "INVALID_INPUT", bad);
    assert.equal(seen.length, 0, "a malformed traceparent never reaches the network");
  } finally { server.close(); }
});
