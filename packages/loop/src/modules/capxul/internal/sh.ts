/** Running a shell command to its end (gates, sandbox scripts, the plan's CLI) with a stripped environment and a time limit. */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { Ctx } from "../types.ts";

/** The only variables a command inherits, besides what its caller adds. No cloud credentials, no tokens, no ssh agent. */
const KEEP = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR"];
export const cleanEnv = (ctx: Ctx, extra: Record<string, string> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of KEEP) { const v = ctx.env[k]; if (v !== undefined) out[k] = v; }
  return { ...out, ...extra };
};

export interface Ran { code: number | null; out: string; timedOut: boolean; stopped: boolean }

export const sh = (ctx: Ctx, command: string | string[], o: { cwd: string; env?: Record<string, string>; file?: string; timeoutMs?: number; stopped?: () => boolean }): Promise<Ran> =>
  new Promise((resolve) => {
    const argv = typeof command === "string" ? ["sh", "-c", command] : command;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: o.cwd, env: cleanEnv(ctx, o.env), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", timedOut = false, stopped = false;
    const feed = (b: Buffer): void => { const s = b.toString(); out = (out + s).slice(-100_000); if (o.file) appendFileSync(o.file, s); };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => { out += String(e); });
    const kill = (): void => { try { process.kill(-child.pid!, "SIGTERM"); } catch { /* gone */ } };
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs) : undefined;
    const watch = o.stopped ? setInterval(() => { if (o.stopped!()) { stopped = true; kill(); } }, 1000) : undefined;
    child.on("close", (code) => { clearTimeout(timer); clearInterval(watch); resolve({ code, out, timedOut, stopped }); });
  });
