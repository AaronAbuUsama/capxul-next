/**
 * The server inside a box: pi-durable's `NodeExecutionEnv` over HTTP, plus commands run in the background (so no request
 * has to stay open for a fifteen-minute gate) and whole files in and out (the git bundles). It trusts its caller: in the
 * cloud only the Worker can reach it, and the Worker checks the key; under Docker it listens on 127.0.0.1 only.
 *
 *   GET  /info                     what the box holds
 *   POST /call    {cwd, method, args, handle?}   one ExecutionEnv (or opened reader) method; Result as JSON
 *   POST /exec    {cwd, command, options}        starts a command; {id}
 *   GET  /exec/<id>?from=<n>                     its output from chunk n, and its end once it ended
 *   POST /exec/<id>/kill
 *   PUT  /blob?path=  GET /blob?path=           a whole file
 */
import { execFileSync } from "node:child_process";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/chord/context";
import type { ShellExecOptions } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { decode, encode, MACHINE, OPENERS, type Chunk } from "./wire.ts";

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
  /** The box's own PATH, HOME and the like: what every command sees in place of the caller's. */
  readonly machine: Readonly<Record<string, string>>;
  /** The checkout the image holds, whose commit bundles are cut from. */
  readonly repo: string;
}

interface Job { chunks: Chunk[]; end?: unknown; cancel: () => void; touched: number }

const body = async (req: IncomingMessage): Promise<Buffer> => { const parts: Buffer[] = []; for await (const p of req) parts.push(p as Buffer); return Buffer.concat(parts); };
const json = (res: ServerResponse, status: number, v: unknown): void => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };

/** The variables a command sees: the caller's, with the box's own description of the machine on top. */
const envOf = (machine: Readonly<Record<string, string>>, asked: Record<string, string> | undefined): Record<string, string> => {
  const out: Record<string, string> = { ...(asked ?? {}) };
  for (const k of MACHINE) delete out[k];
  return { ...out, ...machine };
};

const infoOf = (repo: string): unknown => {
  let commit = "";
  try { commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* no checkout */ }
  return { commit, repo, node: process.version };
};

export const serveBox = (o: ServerOptions): Promise<{ readonly port: number; close(): Promise<void> }> => {
  const handles = new Map<string, Record<string, (...a: unknown[]) => Promise<unknown>>>();
  const jobs = new Map<string, Job>();
  let next = 0;

  const call = async (req: { cwd: string; method: string; args: unknown[]; handle?: string }): Promise<unknown> => {
    const args = (decode(req.args) as unknown[] | undefined) ?? [];
    if (req.handle) {
      const h = handles.get(req.handle);
      if (!h || typeof h[req.method] !== "function") return { ok: false, error: { $fe: { code: "invalid", message: `no open handle ${req.handle}` } } };
      const r = await h[req.method]!.call(h, ...args, BACKGROUND_CONTEXT);
      if (req.method === "close") handles.delete(req.handle);
      return encode(r);
    }
    const env = new NodeExecutionEnv({ cwd: req.cwd }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    if (req.method === "exec" || req.method === "watch" || typeof env[req.method] !== "function") return { ok: false, error: { $fe: { code: "not_supported", message: `${req.method} is not offered by the box` } } };
    const r = await env[req.method]!.call(env, ...args, BACKGROUND_CONTEXT) as { ok: boolean; value?: unknown } | undefined;
    if (OPENERS.has(req.method) && r?.ok) { const id = `h${++next}`; handles.set(id, r.value as never); return { ok: true, value: { $h: id } }; }
    return encode(r);
  };

  const start = (req: { cwd: string; command: string | string[]; options?: ShellExecOptions & { env?: Record<string, string> } }): string => {
    const id = `x${++next}`, { context, cancel } = withCancel(BACKGROUND_CONTEXT);
    const job: Job = { chunks: [], cancel, touched: Date.now() };
    jobs.set(id, job);
    const env = new NodeExecutionEnv({ cwd: req.cwd });
    const options: ShellExecOptions = {
      ...(req.options?.timeout ? { timeout: req.options.timeout } : {}), ...(req.options?.spill ? { spill: req.options.spill } : {}), ...(req.options?.window ? { window: req.options.window } : {}),
      cwd: req.options?.cwd ?? req.cwd, inheritEnv: false, env: envOf(o.machine, req.options?.env),
      onOutput: (t, _c, info) => { job.chunks.push({ t, s: info.stream, ...(info.skipped ? { k: info.skipped } : {}) }); },
    };
    env.exec(req.command, options, context).then((r) => { job.end = encode(r); }, (e: unknown) => { job.end = { ok: false, error: { $ee: { code: "unknown", message: String(e) } } }; });
    return id;
  };

  // A job nobody has asked about for an hour is killed and forgotten: its caller is gone.
  const sweep = setInterval(() => { for (const [id, j] of jobs) if (Date.now() - j.touched > 3_600_000) { j.cancel(); jobs.delete(id); } }, 60_000);
  sweep.unref();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://box"), path = url.pathname;
    if (req.method === "GET" && path === "/info") return json(res, 200, infoOf(o.repo));
    if (req.method === "POST" && path === "/call") return json(res, 200, await call(JSON.parse((await body(req)).toString())));
    if (req.method === "POST" && path === "/exec") return json(res, 200, { id: start(JSON.parse((await body(req)).toString())) });
    const m = /^\/exec\/(x\d+)(\/kill)?$/.exec(path);
    if (m) {
      const job = jobs.get(m[1]!);
      if (!job) return json(res, 404, { error: `no command ${m[1]}` });
      job.touched = Date.now();
      if (m[2]) { job.cancel(); return json(res, 200, { ok: true }); }
      const from = Number(url.searchParams.get("from") ?? 0);
      const out = { chunks: job.chunks.slice(from), ...(job.end !== undefined ? { end: job.end } : {}) };
      if (job.end !== undefined) jobs.delete(m[1]!);
      return json(res, 200, out);
    }
    const file = url.searchParams.get("path");
    if (path === "/blob" && file) {
      if (req.method === "PUT") { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, await body(req)); return json(res, 200, { ok: true }); }
      if (req.method === "GET") {
        try { res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(statSync(file).size) }); createReadStream(file).pipe(res); return; }
        catch { return json(res, 404, { error: `no file ${file}` }); }
      }
    }
    return json(res, 404, { error: `${req.method} ${path} is not a route of the box` });
  };

  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => { handle(req, res).catch((e: unknown) => json(res, 500, { error: String(e) })); });
    server.listen(o.port, o.host ?? "0.0.0.0", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise((done) => { clearInterval(sweep); for (const j of jobs.values()) j.cancel(); server.closeAllConnections(); server.close(() => done()); }) });
    });
  });
};
