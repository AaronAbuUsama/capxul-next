import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { MailError, resendMail } from "../src/shared/door.ts";

test("Mail preserves the caller key, isolates staging and classifies one HTTP attempt", async () => {
  const requests: { key: string | undefined; body: unknown }[] = [];
  let status = 200, reply = '{"id":"mail-731"}';
  const server = createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    requests.push({ key: req.headers["idempotency-key"] as string | undefined, body: JSON.parse(body) });
    res.writeHead(status, { "content-type": "application/json" }); res.end(reply);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const mail = resendMail({ environment: "staging", allowedRecipients: ["recipient@capxul.test"], from: "sender@capxul.test", apiKey: "not-a-live-key",
    transport: (_url, init) => fetch(`http://127.0.0.1:${address.port}/emails`, init) });
  const message = { to: " Recipient@capxul.test ", subject: "A notice", text: "Immutable notice", idempotencyKey: JSON.stringify(["recipient@capxul.test", "notice-731"]) };
  try {
    assert.deepEqual(await mail.send(message), { id: "mail-731" });
    assert.deepEqual(requests[0], { key: message.idempotencyKey, body: { from: "sender@capxul.test", to: ["recipient@capxul.test"], subject: message.subject, text: message.text } });
    for (const to of ["outsider@capxul.test", "recipient@capxul.test,outsider@capxul.test"]) {
      await assert.rejects(mail.send({ ...message, to }), (e: unknown) => e instanceof MailError && e.code === "INVALID_INPUT");
    }
    assert.equal(requests.length, 1, "refused recipients never reach the provider");
    for (const [http, body, code] of [
      [429, "not JSON", "RATE_LIMITED"], [503, "unavailable", "PROVIDER_ERROR"],
      [422, '{"message":"recipient refused"}', "INVALID_INPUT"],
      [403, '{"name":"validation_error"}', "INVALID_INPUT"],
      [401, '{"message":"secret upstream detail"}', "PROVIDER_ERROR"],
      [200, '{}', "PROVIDER_ERROR"], [200, "malformed", "PROVIDER_ERROR"],
    ] as const) {
      status = http; reply = body;
      const before: number = requests.length;
      await assert.rejects(mail.send(message), (e: unknown) => e instanceof MailError && e.code === code && !e.message.includes("secret"));
      assert.equal(requests.length, before + 1, "provider call never retries");
      assert.equal(requests.at(-1)!.key, message.idempotencyKey, "durable retry keeps the same provider key");
    }
  } finally { await new Promise<void>((done) => server.close(() => done())); }
});

test("Mail lost answer is a safe provider error, not a second send", async () => {
  let calls = 0;
  const mail = resendMail({ environment: "production", from: "sender@capxul.test", apiKey: "not-a-live-key", transport: async () => {
    calls++; throw new Error("private vendor detail");
  } });
  await assert.rejects(mail.send({ to: "a@capxul.test", subject: "Notice", text: "Hello", idempotencyKey: "stable" }),
    (e: unknown) => e instanceof MailError && e.code === "PROVIDER_ERROR" && !e.message.includes("private"));
  assert.equal(calls, 1);
});
