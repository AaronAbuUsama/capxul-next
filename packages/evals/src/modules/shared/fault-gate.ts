import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  /** Methods the gate received. */
  received: string[];
  /** Methods the real process answered, with its decoded answer (before any rewrite). */
  forwarded: string[]; answers: { method: string; body: any }[];
  close(): Promise<void>;
};

const readBody = (req: IncomingMessage) => new Promise<string>((done, fail) => {
  let body = ""; req.setEncoding("utf8"); req.on("data", (c) => { body += c; }); req.on("end", () => done(body)); req.on("error", fail);
});

export async function httpGate(target: string): Promise<HttpGate> {
  const t = new URL(target);
  if (t.protocol !== "http:" || t.hostname !== "127.0.0.1" || t.username || t.password) throw new Error("fault gate targets only a plain 127.0.0.1 endpoint");
  let modes: Record<string, HttpMode> = { "*": { kind: "pass" } };
  const held = new Set<ServerResponse>();
  const received: string[] = [], forwarded: string[] = [], answers: { method: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    try {
      const text = await readBody(req);
      let request: JsonRpcBody;
      try { request = JSON.parse(text); } catch { res.writeHead(400).end(); return; }
      received.push(request.method);
      const mode = modes[request.method] ?? modes["*"]!;
      const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (mode.kind === "down") { req.socket.destroy(); return; }
      if (mode.kind === "timeout") { held.add(res); res.on("close", () => held.delete(res)); return; }
      if (mode.kind === "throttle") { json(429, { jsonrpc: "2.0", id: request.id, error: { code: 429, message: "rate limited" } }); return; }
      if (mode.kind === "answer") { json(200, mode.body(request)); return; }
      const upstream = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(30_000) });
      const raw = Buffer.from(await upstream.arrayBuffer());
      let decoded: any;
      try { decoded = JSON.parse(raw.toString("utf8")); } catch { decoded = undefined; }
      // Counted only once the real process has answered: an unreachable upstream is never "forwarded".
      forwarded.push(request.method); answers.push({ method: request.method, body: decoded });
      if (mode.kind === "rewrite") {
        if (decoded === undefined) { req.socket.destroy(); return; }
        json(upstream.status, mode.body(request, decoded)); return;
      }
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" }).end(raw);
    } catch { req.socket.destroy(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { received, forwarded, answers,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    set(next) { modes = { "*": { kind: "pass" }, ...next }; },
    async close() { for (const r of held) r.destroy(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); },
  };
}
