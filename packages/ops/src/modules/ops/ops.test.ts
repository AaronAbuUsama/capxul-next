import { test } from "node:test";
import assert from "node:assert/strict";
import { services, supervisor } from "./service.ts";
import type { Ports, Process, Saved } from "./types.ts";

const fake = () => {
  let rows: Process[] = [], time = 1_000_000;
  const records = new Map<string, Saved>(), lines: string[] = [], signals: unknown[] = [];
  const io: Ports = {
    root: "/repo", worktree: false, now: () => time, table: async () => rows,
    read: (n) => records.get(n), save: (n, v) => { records.set(n, v); }, remove: (n) => { records.delete(n); },
    prepare: async () => {}, spawn: async (s) => { rows.push({ pid: 42, command: s.command, cwd: "/repo", started: time, ports: s.port ? [s.port] : [] }); return 42; },
    signal: (pid, signal, group) => { signals.push([pid, signal, group]); rows = rows.filter((p) => p.pid !== pid); },
    sleep: async (ms) => { time += ms; }, answering: async (port) => rows.some((p) => p.ports.includes(port)), say: (l) => { lines.push(l); },
  };
  return { io, records, lines, signals, set: (v: Process[]) => { rows = v; }, ops: supervisor(io) };
};
const portal = services[0]!;
const processOf = (overrides: Partial<Process> = {}): Process => ({ pid: 99, command: "pnpm portal:serve", cwd: "/repo", started: 0, ports: [4391], ...overrides });

test("start saves detached spawn identity and status describes it", async () => {
  const f = fake(); assert.deepEqual(await f.ops.start(portal), { ok: true });
  assert.equal(f.records.get("portal")?.pid, 42);
  await f.ops.status(portal); assert.match(f.lines.at(-1)!, /running; pid=42; uptime=0s; port answering=true; checkout=\/repo/);
  await f.ops.start(portal); assert.equal(f.records.size, 1);
});
test("stop by pidfile even without a listening port", async () => {
  const f = fake(); await f.ops.start(services[2]!); await f.ops.stop(services[2]!);
  assert.deepEqual(f.signals, [[42, "SIGTERM", true]]); assert.equal(f.records.size, 0);
});
test("foreign port holder refuses before spawning and names checkout and reap", async () => {
  const f = fake(); f.set([processOf({ cwd: "/repo/.claude/worktrees/old" })]);
  const r = await f.ops.start(portal); assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /old.*pnpm ops reap/);
  assert.equal(f.records.size, 0); assert.equal(f.signals.length, 0);
});
test("refuses start in worktree", async () => {
  const f = fake(); f.io.worktree = true; assert.equal((await f.ops.start(portal)).ok, false); assert.equal(f.records.size, 0);
});
test("reap dry-run prints worktrees and lanes, excludes unrelated repository and fresh watcher", async () => {
  const f = fake(); f.set([
    processOf({ pid: 1, cwd: "/repo/.claude/worktrees/x" }),
    processOf({ pid: 2, cwd: "/tmp", command: "node /repo/var/runs/r/lane/server.ts" }),
    processOf({ pid: 3, cwd: "/other/.claude/worktrees/x" }),
    processOf({ pid: 4, command: "pnpm loop watch", started: f.io.now() }),
    processOf({ pid: 5, command: "node /repo/packages/loop/src/main.ts watch", started: -50_000_000 }),
  ]);
  await f.ops.reap(true); assert.equal(f.signals.length, 0); assert.equal(f.lines.length, 3);
  await f.ops.reap(); assert.deepEqual(f.signals.map((s) => (s as unknown[])[0]), [1, 2, 5]);
});
test("stop refuses unrelated port command; can stop matching unrecorded listener", async () => {
  const f = fake(); f.set([processOf({ command: "unrelated" })]); await f.ops.stop(portal); assert.equal(f.signals.length, 0);
  f.set([processOf()]); await f.ops.stop(portal); assert.deepEqual(f.signals, [[99, "SIGTERM", false]]);
});
test("pid reuse is not ownership; stubborn owned process gets KILL after ten seconds", async () => {
  const f = fake(); await f.ops.start(services[2]!);
  f.set([processOf({ pid: 42, ports: [], started: -10000, command: "unrelated" })]); await f.ops.stop(services[2]!); assert.equal(f.signals.length, 0);
  await f.ops.start(services[2]!); f.io.signal = (pid, signal) => { f.signals.push([pid, signal, f.io.now()]); };
  const time = f.io.now(); await f.ops.stop(services[2]!);
  assert.deepEqual(f.signals, [[42, "SIGTERM", time], [42, "SIGKILL", time + 10000]]);
});
