import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { longFetch } from "./long-fetch.ts";

// A raw peer, so it can send what an HTTP server library would refuse to send.
test("longFetch rejects a malformed or silent peer instead of crashing, and keeps the idle cause's code", async (t) => {
  const peer = createServer((socket) => socket.once("data", (data) => {
    const path = String(data).split(" ")[1];
    if (path === "/600") socket.end("HTTP/1.1 600 Odd\r\ncontent-length: 2\r\n\r\nhi");
    if (path === "/ok") socket.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok");
  }));
  await new Promise<void>((done) => peer.listen(0, "127.0.0.1", done));
  t.after(() => { peer.close(); });
  const base = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  const send = longFetch(300);
  await assert.rejects(send(`${base}/600`, { method: "POST" }), RangeError);
  await assert.rejects(send(`${base}/silent`, { method: "POST" }), { code: "IDLE_TIMEOUT" });
  await assert.rejects(send(`${base}/ok`, { method: "POST", body: new Uint8Array([104, 105]) as never }), TypeError);
  const answered = await send(`${base}/ok`, { method: "POST", body: "{}" });
  assert.equal(answered.status, 200); assert.equal(await answered.text(), "ok");
});
