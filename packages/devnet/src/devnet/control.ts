import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Barrier, type Follower } from "./control-followers.ts";

/** decision devnet.time-protocol: the supervisor's control protocol, HTTP JSON on loopback and on an owner-only Unix socket. */
export const PROTOCOL = "capxul.devnet/1";
export type Role = "owner" | "follower" | "viewer";
export type Grant = { name: string; role: Exclude<Role, "owner">; sha256: string; revoked: boolean };
export type Mode = "frozen" | "running";
export type Clock = { nowMs: number; mode: Mode; rate: number };
export type Snapshot = { name: string; worldId: string; epoch: number; recordSeq: number; clockMode: Mode; rate: number; worldNow: number; template: boolean; createdAt: number; sites: number };

/** What the server drives. The composition supplies the real world (control-world.ts); tests supply a fake. */
export type ControlWorld = {
  id: string; epoch: number; codeVersion: string;
  clock(): Promise<Clock>;
  /** Whether the clock has moved since the world's birth (start-at needs a fresh world). */
  moved(): Promise<boolean>;
  observe(): Promise<{ chain: { number: string; timestampMs: number } | null; backendNowMs: number | null }>;
  /** Write the authority's mode and rate without moving now. */
  setClock(clock: Clock): Promise<void>;
  nextDue(after: number, until: number): Promise<number | null>;
  openDue(at: number): Promise<Record<string, number>>;
  /** Warp a frozen world to `target`; `stop` runs at every stop after the world's own followers and before the authority moves. */
  warp(target: number, stop: (nowMs: number) => Promise<void>): Promise<{ worldNow: number; stops: number[] }>;
  snapshots(): Promise<Snapshot[]>;
  save(name: string, followers: string[]): Promise<Snapshot>;
  /** The stateful followers a saved world lists, or null when no snapshot has that name. */
  manifest(name: string): Promise<{ codeVersion: string; followers: string[] } | null>;
  restore(name: string): Promise<Snapshot>;
  create(input: { worldId: string; template: string | null }): Promise<{ worldId: string; state: "creating" | "running" }>;
  worldExists(id: string): Promise<boolean>;
  restoreAs(name: string, as: string): Promise<{ worldId: string; parentWorld: string; parentSnapshot: string }>;
};

export class Refusal extends Error { constructor(readonly code: string, message: string) { super(`${code}: ${message}`); } }
const STATUS: Record<string, number> = { INVALID_INPUT: 400, WRONG_ENVIRONMENT: 401, ROLE_PERMISSION_DENIED: 403, NOT_FOUND: 404,
  WRONG_STATE: 409, WORK_DIED: 500, NOT_INSTALLED: 501, PROVIDER_ERROR: 502 };
export const handoffFile = (controlDir: string) => join(controlDir, "control.json");
export const grantsFile = (controlDir: string) => join(controlDir, "grants.json");
export const socketFile = (controlDir: string) => join(controlDir, "control.sock");
const sha = (token: string) => createHash("sha256").update(token).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const SNAPSHOT = /^[a-z0-9][a-z0-9-]{0,39}$/, WORLD = /^[a-z][a-z0-9]{0,11}$/;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 65_536) throw new Refusal("INVALID_INPUT", "request body too large"); }
  if (!raw) return {};
  try { const v = JSON.parse(raw); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch {}
  throw new Refusal("INVALID_INPUT", "the body is not a JSON object");
}
const text = (v: unknown, key: string) => { if (typeof v !== "string" || !v) throw new Refusal("INVALID_INPUT", `${key} required`); return v; };
const instant = (v: unknown, key: string) => {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isSafeInteger(ms)) throw new Refusal("INVALID_INPUT", `${key} is not a date`); return ms;
};

export type ControlServer = { url: string; socket: string; token: string; close(): Promise<void> };
/** Serve the protocol for one world. The owner's token is new each start and is written only to the owner-only handoff file. */
export async function serveControl(world: ControlWorld, options: { controlDir: string; port: number; realNow?: () => number; settleMs?: number }): Promise<ControlServer> {
  const realNow = options.realNow ?? (() => Date.now()); // real-on-purpose: the protocol's realAt and realNow are the authority's real time
  const token = randomBytes(32).toString("hex"), barrier = new Barrier(realNow);
  let moving: string | null = null, realAt = realNow(), version = 0;
  const grants = async (): Promise<Grant[]> => {
    try { return JSON.parse(await readFile(grantsFile(options.controlDir), "utf8")); } catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
  };
  async function who(req: IncomingMessage, unix: boolean): Promise<Role> {
    if (unix) return "owner";
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || req.headers.origin) throw new Refusal("WRONG_ENVIRONMENT", "loopback, same-origin callers only");
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!bearer) throw new Refusal("WRONG_ENVIRONMENT", "no control handoff token");
    if (same(bearer, token)) return "owner";
    const grant = (await grants()).find((g) => same(g.sha256, sha(bearer)));
    if (!grant || grant.revoked) throw new Refusal("WRONG_ENVIRONMENT", grant ? "this grant was revoked" : "no grant for this token");
    return grant.role;
  }
  const owner = (role: Role) => { if (role !== "owner") throw new Refusal("ROLE_PERMISSION_DENIED", `only the world's owner may do this; this grant is a ${role}`); };
  async function view() {
    const clock = await world.clock();
    return { world: world.id, epoch: world.epoch, nowMs: clock.nowMs, realAt, mode: clock.mode, rate: clock.rate, stopAt: null, version };
  }
  async function moved(reason: string) { version += 1; realAt = realNow(); barrier.event({ type: "clock", reason, ...await view() }); }
  /** One move of the clock at a time (devnet.warp-barrier); the refusal names the move that holds it. */
  async function move<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (moving) throw new Refusal("WRONG_STATE", `another move of the clock is running: ${moving}`);
    moving = name;
    try { return await fn(); } finally { moving = null; }
  }
  const settleMs = (b: Record<string, unknown>) => {
    const v = b.settleMs ?? options.settleMs ?? 60_000;
    if (!Number.isSafeInteger(v) || (v as number) < 100 || (v as number) > 600_000) throw new Refusal("INVALID_INPUT", "settleMs is 100 to 600000"); return v as number;
  };
  async function warpTo(target: number, reason: string, wait: number) {
    const from = await world.clock();
    if (target <= from.nowMs) throw new Refusal("INVALID_INPUT", `the target ${new Date(target).toISOString()} is not later than now ${new Date(from.nowMs).toISOString()}`);
    if (from.mode !== "frozen") throw new Refusal("WRONG_STATE", "a running clock is frozen before it warps");
    try {
      await world.warp(target, async (nowMs) => { await barrier.stop(nowMs, version + 1, wait); });
    } catch (error) { if (/^WORK_DIED/.test((error as Error).message)) throw new Refusal("WORK_DIED", (error as Error).message.replace(/^WORK_DIED: /, "")); throw error; }
    finally { if ((await world.clock()).nowMs !== from.nowMs) await moved(reason); }
    return view();
  }
  async function settle(wait: number) {
    const now = (await world.clock()).nowMs, deadline = performance.now() + wait;
    let open = await world.openDue(now);
    while (Object.keys(open).length && performance.now() < deadline) { await new Promise((r) => setTimeout(r, 200)); open = await world.openDue(now); }
    if (Object.keys(open).length) throw new Refusal("WORK_DIED", `the devnet did not settle at ${new Date(now).toISOString()}: still open ${Object.entries(open).map(([t, n]) => `${t} ${n}`).join(", ")}`);
    await barrier.stop(now, version, Math.max(100, deadline - performance.now()));
    return view();
  }

  async function route(req: IncomingMessage, res: ServerResponse, unix: boolean): Promise<unknown> {
    const role = await who(req, unix), url = new URL(req.url ?? "/", "http://control"), path = url.pathname, method = req.method ?? "GET";
    const b = method === "POST" ? await body(req) : {};
    if (method === "GET" && path === "/v1/time") {
      const seen = await world.observe(), clock = await view();
      const followers = barrier.list();
      return { clock, realNow: realNow(), chain: seen.chain, backend: { nowMs: seen.backendNowMs }, followers,
        agree: (!seen.chain || seen.chain.timestampMs === clock.nowMs) && (seen.backendNowMs === null || seen.backendNowMs === clock.nowMs) && followers.every((f) => f.acked >= version) };
    }
    if (method === "GET" && path === "/v1/time/events") { barrier.watch(res, await view()); return undefined; }
    if (method === "POST" && path === "/v1/time/warp") {
      owner(role);
      if (!!b.by === !!b.to) throw new Refusal("INVALID_INPUT", "give exactly one of by or to");
      return move("warp", async () => {
        const { warpTarget } = await import("./warp.ts"), now = (await world.clock()).nowMs;
        let target: number;
        try { target = warpTarget(now, { by: b.by as string | undefined, to: b.to as string | undefined }); }
        catch (error) { throw new Refusal("INVALID_INPUT", (error as Error).message.replace(/^INVALID_INPUT: /, "")); }
        return warpTo(target, "warp", settleMs(b));
      });
    }
    if (method === "POST" && path === "/v1/time/step") {
      owner(role);
      const limit = instant(b.limit, "limit"), now = (await world.clock()).nowMs;
      if (limit <= now) throw new Refusal("INVALID_INPUT", "the limit is not later than now");
      return move("step", async () => {
        const due = [await world.nextDue(now, limit), barrier.nextDue(now, limit)].filter((v): v is number => v !== null);
        return warpTo(due.length ? Math.min(...due) : limit, "step", settleMs(b));
      });
    }
    if (method === "POST" && path === "/v1/time/settle") { owner(role); return move("settle", () => settle(settleMs(b))); }
    if (method === "POST" && path === "/v1/time/start-at") {
      owner(role);
      const at = instant(b.at, "at"), now = (await world.clock()).nowMs;
      if (at >= now) throw new Refusal("INVALID_INPUT", `the date ${new Date(at).toISOString()} is not earlier than now`);
      return move("start-at", async () => {
        if (await world.moved()) throw new Refusal("WRONG_STATE", "the clock already moved: this world is not fresh");
        throw new Refusal("NOT_INSTALLED", "starting a fresh world's story earlier is not installed (devnet.time-protocol)");
      });
    }
    if (method === "POST" && path === "/v1/time/freeze") {
      owner(role);
      return move("freeze", async () => { const clock = await world.clock(); if (clock.mode !== "frozen") { await world.setClock({ ...clock, mode: "frozen" }); await moved("freeze"); } return view(); });
    }
    if (method === "POST" && path === "/v1/time/resume") {
      owner(role);
      return move("resume", async () => { throw new Refusal("NOT_INSTALLED", "a running clock is not installed: Core accepts only a frozen authority (devnet.follow-at-a-rate)"); });
    }
    if (method === "POST" && path === "/v1/time/rate") {
      owner(role);
      if (!Number.isInteger(b.rate) || (b.rate as number) < 1 || (b.rate as number) > 60) throw new Refusal("INVALID_INPUT", "the rate is a whole number from 1 to 60");
      return move("rate", async () => { const clock = await world.clock(); await world.setClock({ ...clock, rate: b.rate as number }); await moved("rate"); return view(); });
    }
    if (method === "POST" && path === "/v1/followers") {
      if (role === "viewer") throw new Refusal("ROLE_PERMISSION_DENIED", "only the owner's or a follower grant follows the clock");
      const name = text(b.name, "name");
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw new Refusal("INVALID_INPUT", "a follower name is lowercase letters, digits and hyphens");
      return barrier.join(name, b.stateful === true, await view());
    }
    const follower = /^\/v1\/followers\/([a-z0-9-]+)\/(events|ack|due)$/.exec(path);
    if (follower) {
      if (role === "viewer") throw new Refusal("ROLE_PERMISSION_DENIED", "only the owner's or a follower grant follows the clock");
      const f: Follower = barrier.get(follower[1]!);
      if (follower[2] === "events" && method === "GET") { barrier.stream(f, res); return undefined; }
      if (follower[2] === "ack" && method === "POST") { barrier.ack(f, Number(b.version)); return { name: f.name, acked: f.acked }; }
      if (follower[2] === "due" && method === "POST") { f.nextDue = b.at === null ? null : instant(b.at, "at"); return { name: f.name, nextDue: f.nextDue }; }
    }
    if (method === "GET" && path === "/v1/snapshots") return { snapshots: await world.snapshots() };
    if (method === "POST" && path === "/v1/snapshots") {
      owner(role);
      const name = text(b.name, "name");
      if (!SNAPSHOT.test(name)) throw new Refusal("INVALID_INPUT", "a world's name is lowercase letters, digits and hyphens, up to 40 characters");
      return move("save", async () => {
        if (await world.manifest(name)) {
          if (b.replace !== true) throw new Refusal("WRONG_STATE", `a world named ${name} is saved here; ask replace to replace it`);
          throw new Refusal("NOT_INSTALLED", "replacing a saved world is not installed");
        }
        const stateful = await barrier.save(name, settleMs(b));
        return world.save(name, stateful);
      });
    }
    const restore = /^\/v1\/snapshots\/([^/]+)\/(restore|restore-as)$/.exec(path);
    if (restore && method === "POST") {
      owner(role);
      const name = decodeURIComponent(restore[1]!), manifest = SNAPSHOT.test(name) ? await world.manifest(name) : null;
      if (!manifest) throw new Refusal("INVALID_INPUT", `no world is saved as ${name}; saved here: ${(await world.snapshots()).map((s) => s.name).join(", ") || "none"}`);
      if (manifest.codeVersion !== world.codeVersion) throw new Refusal("WRONG_STATE", `${name} was saved with other backend code (${manifest.codeVersion.slice(0, 12)})`);
      if (restore[2] === "restore-as") {
        const as = text(b.as, "as");
        if (!WORLD.test(as) || await world.worldExists(as)) throw new Refusal("INVALID_INPUT", `the new world id ${as} is taken or malformed`);
        return world.restoreAs(name, as);
      }
      const missing = barrier.statefulNames().filter((n) => !manifest.followers.includes(n));
      if (missing.length) throw new Refusal("WRONG_STATE", `stateful followers missing from ${name}'s manifest: ${missing.join(", ")}`);
      return move("restore", async () => { await barrier.restore(name, settleMs(b)); const out = await world.restore(name); await moved("restore"); return out; });
    }
    if (method === "POST" && path === "/v1/worlds") {
      owner(role);
      const worldId = text(b.worldId, "worldId"), template = b.template === undefined || b.template === null ? null : text(b.template, "template");
      if (!WORLD.test(worldId) || await world.worldExists(worldId)) throw new Refusal("INVALID_INPUT", `a world has the id ${worldId}, or it has a hyphen, a capital or more than 12 characters`);
      if (template !== null && !await world.manifest(template)) throw new Refusal("INVALID_INPUT", `the template ${template} is not saved here`);
      return world.create({ worldId, template });
    }
    throw new Refusal("NOT_FOUND", `${method} ${path} is not a capxul.devnet/1 request`);
  }
  const handler = (unix: boolean) => (req: IncomingMessage, res: ServerResponse) => {
    route(req, res, unix).then((out) => {
      if (out === undefined) return;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-capxul-protocol": PROTOCOL });
      res.end(JSON.stringify({ protocol: PROTOCOL, ...(out as object) }));
    }, (error) => {
      const code = error instanceof Refusal ? error.code : "PROVIDER_ERROR";
      if (!(error instanceof Refusal)) console.error(`control: ${(error as Error).message}`);
      if (res.headersSent) return res.end();
      res.writeHead(STATUS[code] ?? 500, { "content-type": "application/json", "cache-control": "no-store", "x-capxul-protocol": PROTOCOL });
      res.end(JSON.stringify({ protocol: PROTOCOL, error: { code, message: error instanceof Refusal ? error.message.slice(code.length + 2) : "the supervisor failed; see its log" } }));
    });
  };
  const tcp: Server = createServer(handler(false)), unix: Server = createServer(handler(true)), socket = socketFile(options.controlDir);
  await new Promise<void>((done, fail) => { tcp.once("error", fail); tcp.listen(options.port, "127.0.0.1", done); });
  await rm(socket, { force: true });
  await new Promise<void>((done, fail) => { unix.once("error", fail); unix.listen(socket, done); });
  await chmod(socket, 0o600);
  const url = `http://127.0.0.1:${options.port}`, file = handoffFile(options.controlDir);
  await writeFile(`${file}.tmp`, JSON.stringify({ protocol: PROTOCOL, world: world.id, url, socket, token }), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  return { url, socket, token, async close() {
    barrier.close(); await rm(file, { force: true });
    await Promise.all([tcp, unix].map((s) => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); })));
    await rm(socket, { force: true });
  } };
}
/** `world grant`: a follower or viewer grant's token, shown once; only its hash is kept, outside the snapshots. */
export async function grant(controlDir: string, name: string, role: Grant["role"]): Promise<string> {
  const token = randomBytes(32).toString("hex"), list = (await readGrants(controlDir)).filter((g) => g.name !== name);
  await writeGrants(controlDir, [...list, { name, role, sha256: sha(token), revoked: false }]);
  return token;
}
export async function revoke(controlDir: string, name: string): Promise<boolean> {
  const list = await readGrants(controlDir), found = list.some((g) => g.name === name && !g.revoked);
  await writeGrants(controlDir, list.map((g) => g.name === name ? { ...g, revoked: true } : g));
  return found;
}
async function readGrants(controlDir: string): Promise<Grant[]> {
  try { return JSON.parse(await readFile(grantsFile(controlDir), "utf8")); } catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
}
async function writeGrants(controlDir: string, list: Grant[]) {
  const file = grantsFile(controlDir);
  await writeFile(`${file}.tmp`, JSON.stringify(list), { mode: 0o600 }); await rename(`${file}.tmp`, file);
}
