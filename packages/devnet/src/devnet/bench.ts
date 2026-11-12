import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Cut, Site } from "./door.ts";

const exec = promisify(execFile);
/** The production-shaped bench compose layout: database/Redis stay up; all bench writers stop. */
export function composeBench(composeArgs: string[], benchDir = "/home/frappe/frappe-bench", siteUrl?: (site: Site) => string, coreUrl?: () => string) {
  const script = resolve(import.meta.dirname, "bench-recovery.py");
  let ownsPause = false, involved = false;
  const compose = async (args: string[]) => {
    try { return await exec("docker", ["compose", ...composeArgs, ...args], { timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 }); }
    catch { throw new Error("bench recovery command failed; world remains fenced, inspect container logs before retrying"); }
  };
  const python = async (args: string[], directory?: string) => {
    await compose(["run", "--rm", "-T", "--no-deps", "-v", `${script}:/recovery.py:ro`,
      ...(directory ? ["--user", "0:0", "-v", `${resolve(directory)}:/recovery${args[0] === "restore" ? ":ro" : ""}`] : []),
      "--workdir", benchDir, "site-admin", `${benchDir}/env/bin/python`, "/recovery.py", ...args]);
  };
  return {
    ownsPause: () => ownsPause,
    async pause() {
      await python(["prepare"]);
      ownsPause = true; involved = true;
      await compose(["stop", "--timeout", "120", "frontend", "backend", "websocket", "scheduler"]);
      await python(["drain", "120"]);
      await compose(["stop", "--timeout", "120", "queue-short", "queue-long"]);
      await python(["drain", "0"]);
      const { stdout } = await compose(["ps", "--all", "--format", "json"]);
      const rows = stdout.trim().startsWith("[") ? JSON.parse(stdout) : stdout.trim().split("\n").filter(Boolean).map((s) => JSON.parse(s));
      if (rows.some((r: { Service: string; ExitCode: number }) => ["backend", "queue-short", "queue-long"].includes(r.Service) && r.ExitCode !== 0 && r.ExitCode !== 143)) {
        throw new Error("a bench writer did not stop cleanly; snapshot refused");
      }
    },
    backup: (site: Site, directory: string) => python(["backup", site.name, "/recovery"], directory),
    restore: (site: Site, directory: string, inPlace: boolean) => python(["restore", site.name, "/recovery", inPlace ? "in-place" : "new"], directory),
    rewrite: (site: Site, world: string, cut: Cut) => python(["rewrite", site.name, world, String(cut.nowMs), cut.clockMode === "stopped" ? "frozen" : "running", String(cut.rate),
      ...(siteUrl || coreUrl ? [siteUrl?.(site) ?? "", coreUrl?.() ?? ""] : [])]),
    async resume() {
      if (!ownsPause) throw new Error("this adapter does not own the bench pause; refusing to release another recovery's guard");
      await python(["release"]);
      await compose(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "300", "backend", "websocket", "queue-short", "queue-long", "scheduler", "frontend"]);
      ownsPause = false;
    },
    async hold() {
      if (!involved) return;
      await compose(["stop", "--timeout", "120", "frontend", "backend", "websocket", "scheduler", "queue-short", "queue-long"]);
      await python(["hold"]);
    },
  };
}
