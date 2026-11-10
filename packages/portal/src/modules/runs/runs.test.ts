import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { test } from "node:test";

import { passThrough } from "./service.ts";

const listen = (server: Server): Promise<number> => new Promise((done) => server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port)));
/** Closes a server and every socket it ever took, upgraded ones included (a server does not count those as its own). */
const tracked = (server: Server): Server => { const all = new Set<import("node:net").Socket>(); server.on("connection", (s) => all.add(s)); (server as Server & { sockets: typeof all }).sockets = all; return server; };
const close = (server: Server): Promise<void> => new Promise((done) => { for (const s of (server as Server & { sockets: Set<import("node:net").Socket> }).sockets) s.destroy(); server.close(() => done()); });
/** A GET whose `host` header is ours to choose, which fetch does not allow. */
const rawGet = (port: number, path: string, host: string): Promise<number> => new Promise((done) => { request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => { res.resume(); done(res.statusCode ?? 0); }).end(); });

/** A stand-in for the loop's host, and the portal's server in front of it. */
const rig = async (hostUp = true) => {
  const seen: string[] = [];
  const host = tracked(createServer((req, res) => { seen.push(`${req.method} ${req.url} host=${req.headers.host}`); res.writeHead(200, { "content-type": "text/plain" }); res.end(`host says ${req.url}`); }));
  host.on("upgrade", (req, socket) => { seen.push(`UPGRADE ${req.url} origin=${req.headers.origin}`); socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello from the host"); });
  const hostPort = hostUp ? await listen(host) : 1;                       // port 1: nothing listens there
  const portal = tracked(createServer((req, res) => { if (pass.owns(req.url ?? "")) pass.request(req, res); else { res.writeHead(200); res.end("the portal"); } }));
  portal.on("upgrade", (req, socket, head) => pass.upgrade(req, socket, head));
  const port = await listen(portal);
  const pass = passThrough({ port: hostPort, hosts: [`127.0.0.1:${port}`] });
  return { port, seen, end: async () => { await close(portal); if (hostUp) await close(host); } };
};

test("what is under /runs/ is the host's: a request goes through unchanged and its answer comes back; the rest is the portal's", async () => {
  const r = await rig();
  try {
    const get = async (path: string, headers: Record<string, string> = {}) => { const a = await fetch(`http://127.0.0.1:${r.port}${path}`, { headers, redirect: "manual" }); return { status: a.status, text: await a.text(), location: a.headers.get("location") }; };
    assert.deepEqual(await get("/runs/summary.json?x=1"), { status: 200, text: "host says /runs/summary.json?x=1", location: null });
    assert.equal((await get("/plan/")).text, "the portal");
    assert.equal((await get("/runsomething")).text, "the portal");
    assert.deepEqual([(await get("/runs")).status, (await get("/runs")).location], [302, "/runs/"]);
    assert.match(r.seen[0]!, /^GET \/runs\/summary\.json\?x=1 host=127\.0\.0\.1:\d+$/);
  } finally { await r.end(); }
});

test("a WebSocket upgrade under /runs/ reaches the host with its origin, and the two sockets are joined", async () => {
  const r = await rig();
  try {
    const { connect } = await import("node:net");
    const got = await new Promise<string>((done) => {
      const s = connect(r.port, "127.0.0.1", () => s.write(`GET /runs/ws HTTP/1.1\r\nHost: 127.0.0.1:${r.port}\r\nOrigin: https://tailnet.example:8443\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`));
      let all = "";
      s.on("data", (b) => { all += b.toString(); if (all.includes("hello from the host")) { s.destroy(); done(all); } });
    });
    assert.match(got, /^HTTP\/1\.1 101 /);
    assert.deepEqual(r.seen, ["UPGRADE /runs/ws origin=https://tailnet.example:8443"]);
  } finally { await r.end(); }
});

test("a request that names another host is refused, and with the host down the page says so and how to start it", async () => {
  const up = await rig();
  try { assert.equal(await rawGet(up.port, "/runs/", "evil.example"), 403); assert.deepEqual(up.seen, []); } finally { await up.end(); }
  const down = await rig(false);
  try {
    const a = await fetch(`http://127.0.0.1:${down.port}/runs/`);
    assert.equal(a.status, 502);
    assert.match(await a.text(), /The loop's host is not running[\s\S]*pnpm loop serve/);
  } finally { await down.end(); }
});
