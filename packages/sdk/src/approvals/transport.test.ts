import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createApprovalsClient } from "./door.ts";

test("signing transport preserves mutation identity and rejects foreign/invalid stream frames", async () => {
  const seen: { url: string; method: string; bearer: string; call: string; trace: string; input: unknown }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ url: req.url!, method: req.method!, bearer: String(req.headers.authorization),
      call: String(req.headers["x-capxul-call-id"]), trace: String(req.headers["x-capxul-trace"]), input: body ? JSON.parse(body) : null });
    if (req.headers.accept === "text/event-stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Fragment an event across writes, and coalesce the heartbeat with its successor.
      res.write("event: approval\ndata: {\"approvalId\":\"approval_a\",");
      res.write("\"state\":\"pending\"}\n\n: heartbeat\n\nevent: approval\ndata: {\"approvalId\":\"foreign\",\"state\":\"landed\"}\n\n");
      res.end(); return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ approvalId: "approval_a", state: "signed" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const client = createApprovalsClient({ coreUrl: `http://127.0.0.1:${address.port}`, bearer: async () => "session-token" });
  try {
    const call = { callId: "stable-call", traceId: "stable-trace" };
    const signature = `0x${"ab".repeat(65)}`;
    assert.equal((await client.sign({ approvalId: "approval_a", signature }, call)).state, "signed");
    assert.deepEqual(seen[0], { url: "/approvals/signing/sign", method: "POST", bearer: "Bearer session-token",
      call: "stable-call", trace: "stable-trace", input: { approvalId: "approval_a", signature } });
    await assert.rejects(client.get({ approvalId: "foreign" }), { code: "PROVIDER_RESPONSE_INVALID" });
    const stream = client.observe({ approvalId: "approval_a" });
    assert.equal((await stream.next()).value?.state, "pending");
    await assert.rejects(stream.next(), { code: "PROVIDER_RESPONSE_INVALID" });
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(client.get({ approvalId: "approval_a" }, cancelled.signal), { code: "CANCELLED" });
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
