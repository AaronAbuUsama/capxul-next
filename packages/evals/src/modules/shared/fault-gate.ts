import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, createServer as createTcp, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

/**
 * A run-local fault switch in front of one of the selected world's actual endpoints. `pass` forwards the exact request
 * to the real process; the other modes are the provider failures the blueprint names (timeout, upstream-down,
 * rate-limited) or an answer that does not decode. The adapter under test is the production adapter, unchanged.
 */
export type JsonRpcBody = { jsonrpc: "2.0"; id: unknown; method: string; params: unknown[] };
export type HttpMode =
  | { kind: "pass" } | { kind: "down" } | { kind: "timeout" } | { kind: "throttle" }
  /** Answer without forwarding. */
  | { kind: "answer"; body: (request: JsonRpcBody) => unknown }
  /** Forward, then rewrite the real process's answer. */
  | { kind: "rewrite"; body: (request: JsonRpcBody, upstream: any) => unknown };
export type HttpGate = {
  url: string;
  /** Per-method mode; `*` is the default. */
  set(modes: Record<string, HttpMode>): void;
  /** Methods the gate received and, separately, the methods it forwarded to the real process. */
  received: string[]; forwarded: string[];
  close(): Promise<void>;
};

const readBody = (req: IncomingMessage) => new Promise<string>((done, fail) => {
  let body = ""; req.setEncoding("utf8"); req.on("data", (c) => { body += c; }); req.on("end", () => done(body)); req.on("error", fail);
});

export async function httpGate(target: string): Promise<HttpGate> {
  let modes: Record<string, HttpMode> = { "*": { kind: "pass" } };
  const held = new Set<ServerResponse>();
  const gate = { received: [] as string[], forwarded: [] as string[] };
  const server = createHttp(async (req, res) => {
    const text = await readBody(req);
    let request: JsonRpcBody;
    try { request = JSON.parse(text); } catch { res.writeHead(400).end(); return; }
    gate.received.push(request.method);
    const mode = modes[request.method] ?? modes["*"]!;
    const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (mode.kind === "down") { req.socket.destroy(); return; }
    if (mode.kind === "timeout") { held.add(res); res.on("close", () => held.delete(res)); return; }
    if (mode.kind === "throttle") { json(429, { jsonrpc: "2.0", id: request.id, error: { code: 429, message: "rate limited" } }); return; }
    if (mode.kind === "answer") { json(200, mode.body(request)); return; }
    gate.forwarded.push(request.method);
    let upstream: Response;
    try {
      upstream = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(30_000) });
    } catch { req.socket.destroy(); return; }
    if (mode.kind === "rewrite") { json(upstream.status, mode.body(request, await upstream.json())); return; }
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { received: gate.received, forwarded: gate.forwarded,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    set(next) { modes = { "*": { kind: "pass" }, ...next }; },
    async close() { for (const r of held) r.destroy(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); },
  };
}

export type TcpMode = "pass" | "down" | "timeout";
export type TcpGate = { host: string; port: number; set(mode: TcpMode): void; close(): Promise<void> };

/** A byte relay for Postgres: `down` resets new and open connections, `timeout` accepts and never answers. */
export async function tcpGate(host: string, port: number): Promise<TcpGate> {
  let mode: TcpMode = "pass";
  const open = new Set<Socket>();
  const server = createTcp((client) => {
    open.add(client); client.on("close", () => open.delete(client)); client.on("error", () => {});
    if (mode === "down") { client.resetAndDestroy(); return; }
    if (mode === "timeout") return;
    const upstream = connect(port, host);
    open.add(upstream); upstream.on("close", () => open.delete(upstream)); upstream.on("error", () => client.destroy());
    client.pipe(upstream).pipe(client);
    client.on("close", () => upstream.destroy());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { host: "127.0.0.1", port: (server.address() as AddressInfo).port,
    set(next) { mode = next; if (next !== "pass") for (const s of open) s.destroy(); },
    async close() { for (const s of open) s.destroy(); await new Promise<void>((done) => server.close(() => done())); },
  };
}
