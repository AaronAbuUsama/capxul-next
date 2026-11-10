/** The runs module's door: `passThrough` (types.ts). Nothing here reads the loop's code or its files; it only joins sockets. */
import { request as httpRequest } from "node:http";
import { connect } from "node:net";

import { RUNS_PREFIX, type Pass, type PassOptions } from "./types.ts";

export type * from "./types.ts";
export { DEFAULT_HOST_PORT, RUNS_PREFIX } from "./types.ts";

const DOWN = (port: number): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Runs</title>` +
  `<body style="font: 16px/1.6 Inter, system-ui, sans-serif; max-width: 40rem; margin: 15vh auto; padding: 0 1rem">` +
  `<h1 style="font-size: 1.4rem">The loop's host is not running</h1>` +
  `<p>The Runs pages are served by it, on this machine at port ${port}. Start it with <code>pnpm loop serve</code>, then open this page again.</p>` +
  `<p><a href="/plan/">Back to the Plan</a></p></body>\n`;

export const passThrough = (o: PassOptions): Pass => ({
  owns: (path) => path === RUNS_PREFIX.slice(0, -1) || path.startsWith(RUNS_PREFIX),
  request: (req, res) => {
    if (!o.hosts.includes(req.headers.host ?? "")) { res.writeHead(403, { "content-type": "application/json" }); res.end('{"error":"wrong host"}\n'); return; }
    if (req.url === RUNS_PREFIX.slice(0, -1)) { res.writeHead(302, { location: RUNS_PREFIX }); res.end(); return; }
    const up = httpRequest({ host: "127.0.0.1", port: o.port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${o.port}` } }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(DOWN(o.port)); });
    req.pipe(up);
  },
  upgrade: (req, socket, head) => {
    if (!o.hosts.includes(req.headers.host ?? "")) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const up = connect(o.port, "127.0.0.1", () => {
      // The request as it came, origin included: the host decides who may attach. Only the host header names the host itself.
      const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${o.port}` }).flatMap(([k, v]) => (Array.isArray(v) ? v : [v ?? ""]).map((x) => `${k}: ${x}`));
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const end = (): void => { up.destroy(); socket.destroy(); };
    up.on("error", () => { socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
    socket.on("error", end);
    socket.on("close", end);
    up.on("close", end);
  },
});
