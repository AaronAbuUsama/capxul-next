import { test } from "node:test";
import assert from "node:assert/strict";
import { services, supervisor } from "./service.ts";
import type { Ports, Process } from "./types.ts";

test("owned group survives leader TERM exit and receives KILL at ten seconds", async () => {
  let time = 0;
  let rows: Process[] = [
    { pid: 42, pgid: 42, command: "pnpm loop alerts", cwd: "/repo", started: 0, ports: [] },
    { pid: 43, pgid: 42, command: "node alerts", cwd: "/repo", started: 0, ports: [] },
    { pid: 44, pgid: 44, command: "unrelated", cwd: "/repo", started: 0, ports: [] },
  ];
  const signals: unknown[] = [];
  const io: Ports = {
    root: "/repo", worktree: false, now: () => time, table: async () => rows,
    read: () => ({ pid: 42, command: "pnpm loop alerts", checkout: "/repo", started: 0 }),
    save: () => {}, remove: () => {}, prepare: async () => {}, spawn: async () => 42,
    answering: async () => false, say: () => {}, sleep: async (ms) => { time += ms; },
    signal: (pid, signal, group) => {
      signals.push([pid, signal, group, time]);
      rows = rows.filter((p) => signal === "SIGTERM" ? p.pid !== pid : p.pgid !== pid);
    },
  };
  await supervisor(io).stop(services[2]!);
  assert.deepEqual(signals, [[42, "SIGTERM", true, 0], [42, "SIGKILL", true, 10000]]);
  assert.deepEqual(rows.map((p) => p.pid), [44]);
});
