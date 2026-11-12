import { createServer, request } from "node:http";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { loopback, type Config } from "./supervisor.ts";

/** Only these loopback ingress ports may be exposed by a portal. Private service ports never are. */
export async function gateway(c: Config) {
  const routes = [
    { port: c.ports.publicCore, upstream: loopback(c.ports.core), admin: false, websocket: false },
    { port: c.ports.publicRpc, upstream: loopback(c.ports.anvil), admin: true, websocket: false },
    { port: c.ports.publicBench, upstream: loopback(c.ports.bench), admin: true, websocket: true },
    ...(c.bundler ? [{ port: c.ports.publicBundler, upstream: c.bundler.url, admin: true, websocket: false }] : []),
  ];
  const upgraded = new Set<Socket>();
  const servers = routes.map((route) => {
    const upstream = new URL(route.upstream);
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://ingress").pathname;
      if (!route.admin && (path.startsWith("/admin/") || path === "/admin")) { res.writeHead(404).end(); return; }
      const proxy = request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: req.headers }, (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(res);
      });
      proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on("aborted", () => proxy.destroy());
      req.pipe(proxy);
    });
    server.on("upgrade", (req, socket, head) => {
      if (!route.websocket) { socket.destroy(); return; }
      const target = connect(Number(upstream.port), upstream.hostname, () => {
        target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((s, v, i) => s + (i % 2 ? `${v}\r\n` : `${v}: `), "")}\r\n`);
        if (head.length) target.write(head);
        socket.pipe(target); target.pipe(socket);
      });
      upgraded.add(socket as Socket);
      socket.once("close", () => { upgraded.delete(socket as Socket); target.destroy(); });
      target.on("error", () => socket.destroy());
    });
    return { server, port: route.port };
  });
  try {
    for (const { server, port } of servers) await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  } catch (error) {
    for (const { server } of servers) server.close();
    throw error;
  }
  return async () => {
    // Websocket clients can reconnect only after the entire cut is released. HTTP mutations drain.
    for (const socket of upgraded) socket.destroy();
    await Promise.all(servers.map(({ server }) => new Promise<void>((done) => server.close(() => done()))));
  };
}
