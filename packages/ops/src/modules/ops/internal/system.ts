import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import type { Ports, Process, Saved } from "../types.ts";

const output = (cmd: string, args: string[]): string => {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) { const out = (e as { stdout?: string }).stdout; if (out) return out; throw e; }
};
/** Mac process discovery. ps includes absolute argv; lsof supplies cwd and listening sockets. */
export const processTable = async (): Promise<Process[]> => {
  const rows = output("ps", ["-axo", "pid=,pgid=,lstart=,command="]).trim().split("\n");
  let sockets = "";
  try { sockets = output("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]); } catch { /* no listeners */ }
  const ports = new Map<number, number[]>(); let pid = 0;
  for (const line of sockets.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n")) { const port = Number(line.match(/:(\d+)$/)?.[1]); if (port) ports.set(pid, [...(ports.get(pid) ?? []), port]); }
  }
  let cwd = ""; const dirs = new Map<number, string>();
  try { cwd = output("lsof", ["-a", "-d", "cwd", "-Fpn"]); } catch { /* processes may disappear */ }
  for (const line of cwd.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n")) dirs.set(pid, line.slice(1));
  }
  return rows.flatMap((row) => {
    const m = row.trim().match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), pgid: Number(m[2]), started: Date.parse(m[3]!), command: m[4]!, cwd: dirs.get(Number(m[1])) ?? "unknown", ports: ports.get(Number(m[1])) ?? [] }] : [];
  });
};
export const systemPorts = (root: string): Ports => {
  const dir = join(root, "var/ops"); mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "spikes/skeleton/core/state"), { recursive: true });
  const file = (name: string) => join(dir, name + ".json");
  return {
    root, worktree: statSync(join(root, ".git")).isFile(), now: Date.now, table: processTable,
    read: (name) => { try { return JSON.parse(readFileSync(file(name), "utf8")) as Saved; } catch { return undefined; } },
    save: (name, value) => { writeFileSync(file(name) + ".tmp", JSON.stringify(value, null, 2)); renameSync(file(name) + ".tmp", file(name)); },
    remove: (name) => { if (existsSync(file(name))) unlinkSync(file(name)); },
    prepare: async (command, cwd) => { execFileSync("/bin/sh", ["-c", command], { cwd: join(root, cwd), stdio: "inherit" }); },
    spawn: (s) => new Promise((resolve, reject) => {
      const fd = openSync(join(dir, s.name + ".log"), "a");
      const child = spawn("/bin/sh", ["-c", s.command], { cwd: join(root, s.cwd ?? ""), env: process.env, detached: true, stdio: ["ignore", fd, fd] });
      closeSync(fd);
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(child.pid!); });
    }),
    signal: (pid, signal, group) => { try { process.kill(group ? -pid : pid, signal); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    answering: (port) => new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const finish = (answer: boolean) => { socket.destroy(); resolve(answer); };
      socket.setTimeout(500); socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.once("timeout", () => finish(false));
    }),
    say: console.log,
  };
};
