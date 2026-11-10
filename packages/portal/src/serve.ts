/**
 * The local server behind `pnpm portal:serve`: the generated site from `dist`, the answers endpoint, and what is under
 * `/runs/`, which is the loop's host passed through (modules/runs). It listens on 127.0.0.1 only. The files and the clock are handed to the answers module as `Deps`; this file only does the sockets.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { parsePlan } from "@capxul/plan";
import type { LogEntry } from "@capxul/plan";
import { respond, MAX_BODY, type Deps, type Waiting } from "#src/modules/answers/service.ts";
import { DEFAULT_HOST_PORT, passThrough } from "#src/modules/runs/service.ts";
import type { SiteInput } from "#src/modules/site/types.ts";

import type { Result } from "./load.ts";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

const lines = (file: string): string => (existsSync(file) ? readFileSync(file, "utf8") : "");

/** What waits on the owner now: the blueprint's decisions (as loaded) and the plan's tasks blocked on a need of his (read afresh). */
const waitingOf = (input: SiteInput, root: string): Waiting => {
  const owner = input.direction.settings.reviewer.toLowerCase();
  const decisions = new Map([...input.blueprint.records.values()].filter((r) => r._kind === "decision" && input.waits(r)).map((d) => {
    const options = Array.isArray(d["options"]) ? (d["options"] as readonly { label?: unknown }[]).map((o) => String(o.label)) : [];
    return [d.id, options] as const;
  }));
  const plan = parsePlan(JSON.parse(lines(join(root, "plan/plan.json")) || "null") as unknown);
  const tasks = new Set(plan.ok
    ? plan.value.tasks.filter((t) => t.state === "blocked" && t.blockedBy !== undefined && "need" in t.blockedBy && t.blockedBy.who.toLowerCase() === owner).map((t) => t.id)
    : []);
  return { decisions, tasks };
};

const depsOf = (input: SiteInput, root: string, dist: string, port: number, extraHosts: readonly string[] = []): Deps => ({
  now: () => new Date().toISOString(),
  newId: () => `a-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`,
  waiting: () => waitingOf(input, root),
  answerLines: () => lines(join(root, "plan/answers.jsonl")),
  log: () => lines(join(root, "plan/log.jsonl")).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as LogEntry),
  append: (line) => appendFileSync(join(root, "plan/answers.jsonl"), line),
  file: (path) => {
    const full = resolve(dist, path);
    if (!full.startsWith(dist + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
    return { type: TYPES[extname(full)] ?? "application/octet-stream", body: readFileSync(full) };
  },
  hosts: [`127.0.0.1:${port}`, `localhost:${port}`, ...extraHosts],
});

/** Starts the server on 127.0.0.1:`port`. */
export const listen = (input: SiteInput, root: string, port: number, extraHosts: readonly string[] = [], runsPort: number = DEFAULT_HOST_PORT): Promise<Result<{ readonly server: Server; readonly url: string }>> => {
  const dist = resolve(root, "packages/portal/dist");
  if (!existsSync(join(dist, "index.html"))) return Promise.resolve({ ok: false, error: `${dist} holds no site: run pnpm portal first` });
  const deps = depsOf(input, root, dist, port, extraHosts);
  const runs = passThrough({ port: runsPort, hosts: deps.hosts });
  const server = createServer((req, res) => {
    if (runs.owns((req.url ?? "/").split("?")[0]!)) { runs.request(req, res); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) tooLarge = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const out = respond({
          method: req.method ?? "GET", path: req.url ?? "/", host: req.headers.host ?? "", origin: String(req.headers.origin ?? ""),
          body: Buffer.concat(chunks).toString("utf8"), tooLarge,
        }, deps);
        res.writeHead(out.status, { "content-type": out.type, "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : out.body);
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"server error"}\n');
      }
    });
  });
  server.on("upgrade", (req, socket, head) => { if (runs.owns((req.url ?? "/").split("?")[0]!)) runs.upgrade(req, socket, head); else socket.destroy(); });
  return new Promise((done) => {
    server.once("error", (e) => done({ ok: false, error: `could not listen on 127.0.0.1:${port}: ${e.message}` }));
    server.listen(port, "127.0.0.1", () => done({ ok: true, value: { server, url: `http://127.0.0.1:${port}/` } }));
  });
};
