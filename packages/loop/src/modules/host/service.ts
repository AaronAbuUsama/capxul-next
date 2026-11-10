/**
 * GENERIC. The host's door: `serve` starts it. See types.ts for what it is and what travels.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import { WebSocketServer } from "ws";
import type { RunDetail } from "../inspect/types.ts";
import { fileUnder, ranged } from "./internal/files.ts";
import { HOST_NAME, PREFIX, runsContract, summaryOf, type HostDeps, type HostOptions, type Served } from "./types.ts";

export type * from "./types.ts";
export { DEFAULT_PORT, HOST_NAME, PREFIX, runsContract, summaryOf } from "./types.ts";

interface Task { readonly signal: AbortSignal }
interface Cell { replace: (task: Task, value: unknown, o: { diff: boolean }) => void }
interface Self { state: (name: string, schema: unknown, initial: { init: () => Promise<unknown> }) => Cell; task: (run: (task: Task) => Promise<void>) => void }

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((done) => { const t = setTimeout(done, ms); signal.addEventListener("abort", () => { clearTimeout(t); done(); }, { once: true }); });

/** The runs, read again only where a run's stamp changed, so a run that is not moving costs nothing and keeps its place in memory. */
const reader = (deps: HostDeps): (() => Promise<RunDetail[]>) => {
  const kept = new Map<string, { stamp: string; run: RunDetail }>();
  return async () => {
    const ids = deps.ids();
    for (const { id, stamp } of ids) {
      if (kept.get(id)?.stamp === stamp) continue;
      const run = await deps.load(id).catch(() => null);
      if (run) kept.set(id, { stamp, run: JSON.parse(JSON.stringify(run)) as RunDetail });   // plain JSON, as the wire needs
    }
    for (const id of [...kept.keys()]) if (!ids.some((x) => x.id === id)) kept.delete(id);
    return [...kept.values()].map((k) => k.run).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  };
};

export const serve = async (deps: HostDeps, o: HostOptions): Promise<Served> => {
  const read = reader(deps);
  const host = chord.createHost({ self: { kind: "host" }, name: HOST_NAME, onError: (e: unknown) => deps.say(`host: ${e instanceof Error ? e.message : JSON.stringify(e)}`) } as never);
  const Runs = runsContract<never>(chord as never, schema as never);
  (host as unknown as { serve: (type: unknown, factory: (input: unknown, principal: unknown, self: Self) => unknown) => void }).serve(Runs, (_input, _principal, self) => {
    const runs = self.state("runs", schema.unknown(), { init: () => read() });
    self.task(async (task) => {
      while (!task.signal.aborted) {
        await sleep(o.everyMs ?? 1500, task.signal);
        if (!task.signal.aborted) runs.replace(task, await read(), { diff: true });
      }
    });
    return { variant: "owner", runs, stop: async ({ run }: { run: string }) => ({ said: deps.stop(run) }) };
  });

  // Plain reads over HTTP, for a page that is not the app: a summary of the runs, and the app's own files.
  const answer = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const send = (status: number, type: string, body: string | Uint8Array): void => { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(req.method === "HEAD" ? undefined : body); };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain; charset=utf-8", "this host only answers reads over HTTP\n");
    if (path === `${PREFIX}summary.json`) return send(200, "application/json; charset=utf-8", `${JSON.stringify({ runs: (await read()).map(summaryOf) })}\n`);
    if (!path.startsWith(PREFIX)) return send(404, "text/plain; charset=utf-8", `the runs are at ${PREFIX}\n`);
    const shown = /^evidence\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(path.slice(PREFIX.length));
    if (shown) {                                                          // a capture's file: an image, a video, a cast
      const folder = deps.evidence?.(shown[1]!) ?? null, found = folder === null ? null : fileUnder(folder, shown[2]!);
      if (!found) return send(404, "text/plain; charset=utf-8", "no such capture\n");
      const part = ranged(found.body, req.headers.range);
      res.writeHead(part.status, { "content-type": found.type, "cache-control": "private, max-age=3600", "content-length": String(part.body.length), ...part.headers });
      res.end(req.method === "HEAD" ? undefined : part.body);
      return;
    }
    const file = o.ui === undefined ? null : fileUnder(o.ui, path.slice(PREFIX.length) || "index.html");
    if (file) return send(200, file.type, file.body);
    if (path === PREFIX) return send(200, "text/plain; charset=utf-8", "The host is running, but the Runs app is not built: pnpm --filter @capxul/loop-ui build\n");
    return send(404, "text/plain; charset=utf-8", "not found\n");
  };
  const http = createServer((req, res) => { void answer(req, res).catch(() => { res.writeHead(500); res.end(); }); });
  const wss = new WebSocketServer({ server: http, path: `${PREFIX}ws` });
  await new Promise<void>((ready, failed) => { http.once("error", failed); http.listen(o.port, "127.0.0.1", () => ready()); });
  const allowed = (origin: string | undefined): boolean => origin === undefined || LOCAL.test(origin) || (o.origins ?? []).includes(origin);
  // Whoever reaches this port from an allowed origin is the owner: the host listens on this machine only.
  chord.acceptWebSockets(wss as never, host as never, { principal: (request: IncomingMessage) => (allowed(request.headers.origin) ? { kind: "owner" } : undefined) } as never);
  const port = (http.address() as { port: number }).port;
  return {
    port, url: `ws://127.0.0.1:${port}${PREFIX}ws`, http: `http://127.0.0.1:${port}${PREFIX}`,
    close: async () => { for (const c of wss.clients) c.terminate(); await new Promise<void>((done) => wss.close(() => done())); await new Promise<void>((done) => http.close(() => done())); await (host as unknown as { close: () => Promise<void> }).close(); },
  };
};
