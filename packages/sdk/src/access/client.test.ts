import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createAccessClient, AccessClientError } from "./door.ts";

test("Access client sends only bearer authority, preserves OTP controls, and sanitizes malformed/provider responses", async () => {
  let status = 200, body: unknown;
  const requests: { path: string; headers: Record<string, unknown>; input: unknown }[] = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url!, headers: request.headers, input: JSON.parse(Buffer.concat(chunks).toString()) });
    response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const client = createAccessClient({ coreUrl: `http://127.0.0.1:${port}` });
  const safe = `0x${"1".repeat(40)}`, expiresAt = "2026-11-12T11:30:00.000Z", token = "A".repeat(43);
  try {
    body = { email: "person@example.test", expiresAt, resendAfter: expiresAt };
    assert.deepEqual(await client.sendCode({ email: " Person@Example.Test " }), body);
    body = { token, personId: "person-a", safe, expiresAt, email: "person@example.test" };
    assert.deepEqual(await client.verifyCode({ email: "person@example.test", code: "123456", client: "public-host" }), body);
    body = { personId: "person-a", kind: "person", email: "person@example.test", safe, expiresAt, setupState: "setup-required" };
    assert.deepEqual(await client.current(token), body);
    assert.equal(requests.at(-1)!.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(requests.at(-1)!.input, {});
    assert.equal(requests.some(({ headers }) => headers.cookie || headers["x-capxul-signature"]), false);
    status = 400; body = { error: "INVALID_INPUT", triesLeft: 1, message: "must-not-leak" };
    await assert.rejects(client.verifyCode({ email: "person@example.test", code: "111111", client: "public-host" }),
      (error: unknown) => error instanceof AccessClientError && error.code === "INVALID_INPUT" && error.triesLeft === 1 && !error.message.includes("must-not-leak"));
    status = 429; body = { error: "RATE_LIMITED", retryAfterMs: 1501 };
    await assert.rejects(client.sendCode({ email: "person@example.test" }), (error: unknown) => error instanceof AccessClientError && error.retryAfterMs === 1501);
    status = 200; body = { token, personId: "person-a", safe, expiresAt, email: "wrong@example.test" };
    await assert.rejects(client.verifyCode({ email: "person@example.test", code: "123456", client: "public-host" }), /PROVIDER_RESPONSE_INVALID/);
    body = { token: "Frappe-cookie", personId: "person-a", safe, expiresAt, email: "person@example.test" };
    await assert.rejects(client.verifyCode({ email: "person@example.test", code: "123456", client: "public-host" }), /PROVIDER_RESPONSE_INVALID/);
    body = { personId: "agent-a", kind: "agent", email: "person@example.test", safe, expiresAt, setupState: "ready" };
    await assert.rejects(client.current(token), /PROVIDER_RESPONSE_INVALID/);
    body = { personId: "person-a", kind: { toString: null }, email: "person@example.test", safe, expiresAt, setupState: "ready" };
    await assert.rejects(client.current(token), (error: unknown) => error instanceof AccessClientError && error.code === "PROVIDER_RESPONSE_INVALID");
    status = 500; body = { error: "secret-provider-body" };
    await assert.rejects(client.current(token), (error: unknown) => error instanceof AccessClientError && error.message === "PROVIDER_ERROR");
    assert.throws(() => createAccessClient({ coreUrl: "https://user:secret@example.test" }), /INVALID_INPUT/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
