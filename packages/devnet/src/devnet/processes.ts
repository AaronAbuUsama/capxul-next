import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pinChain, readWorldClock } from "./clock.ts";
import type { Processes } from "./runtime.ts";
import { httpReady, loopback, signedCore, stateFile, until, type Component, type Config, type Host } from "./supervisor.ts";

const exec = promisify(execFile);
export async function command(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  try { return (await exec(argv[0]!, argv.slice(1), { cwd, env, timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
  catch (cause) { throw new Error(`command ${argv[0]} failed (arguments/output withheld)`, { cause }); }
}
export async function checkCodeVersion(c: Config): Promise<void> {
  if (await command(["git", "rev-parse", "HEAD"], c.root) !== c.codeVersion) throw new Error("world code version differs from this checkout; use the matching build, never relabel an old running world");
}
export type Receipt = { pid: number; birth: string; codeVersion: string; state: "running" | "exited"; code?: number | null; signal?: string | null };
export async function alive(file: string): Promise<boolean> {
  let receipt: Receipt;
  try { receipt = JSON.parse(await readFile(file, "utf8")); } catch (e: any) { if (e.code === "ENOENT") return false; throw e; }
  if (receipt.state !== "running") return false;
  try {
    const proc = await readFile(`/proc/${receipt.pid}/stat`, "utf8");
    return proc.slice(proc.lastIndexOf(")") + 2).split(" ")[19] === receipt.birth;
  } catch (e: any) { if (e.code === "ENOENT") return false; throw e; }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
/** Amp owns lifetime; our foreground wrapper records clean child exit before snapshot proceeds. */
export function supervised(c: Config, configFile: string): Host & Processes {
  const service = (component: Component) => `world-${c.world.id}-${component}`;
  const compose = (args: string[]) => command(["docker", "compose", ...c.bench.composeArgs, ...args], c.root, { ...process.env, ...c.bench.env });
  const host: Host & Processes = {
    async running(_world, component) { return alive(stateFile(c, component)); },
    async fence(_world, closed) {
      if (closed) { await host.stop("ingress"); await host.stop("site-service"); }
      else {
        await until("Core /ready before opening ingress", () => httpReady(`${loopback(c.ports.core)}/ready`));
        await host.start("site-service"); await host.start("ingress");
      }
    },
    async start(worldOrComponent, maybeComponent?: Component) {
      const component = typeof worldOrComponent === "string" ? worldOrComponent : maybeComponent!;
      if (component === "bundler" && !c.bundler) return;
      await checkCodeVersion(c);
      const file = stateFile(c, component);
      if (await alive(file) && JSON.parse(await readFile(file, "utf8")).codeVersion !== c.codeVersion) throw new Error(`${component} is running another code version; stop it before restarting`);
      if (!await alive(file)) {
        await mkdir(c.controlDir, { recursive: true, mode: 0o700 });
        await rm(file, { force: true });
        const argv = [process.execPath, "--experimental-strip-types", "--no-warnings", resolve(import.meta.dirname, "service.ts"), resolve(configFile), component];
        await command(["amp", "orb", "service", "start", service(component), "--cwd", c.root, "--command", argv.map(quote).join(" ")], c.root);
      }
      await until(`${component} process`, () => alive(file));
      if (component === "anvil") {
        await until("Anvil RPC", async () => {
          try {
            const r = await fetch(loopback(c.ports.anvil), { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(2000) });
            return Number((await r.json() as any).result) === c.chainId;
          } catch { return false; }
        });
        // devnet.one-world-clock (2): from the first block after a start, the chain is dated at the world's now. Creation pins once the clock exists.
        const clock = await readWorldClock(c).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
        if (clock) await pinChain(c, clock);
      } else if (component === "core") {
        await until("paused Core /health", () => httpReady(`${loopback(c.ports.core)}/health`));
        const cut = await signedCore(c, "/admin/snapshot/pause");
        if (!cut.paused || cut.world_id !== c.world.id || cut.epoch !== c.world.epoch) throw new Error("Core snapshot identity mismatch");
      } else if (component !== "ingress") {
        if (component === "bundler") {
          await until("bundler EntryPoint readiness", async () => {
            try {
              const r = await fetch(c.bundler!.url, { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }), signal: AbortSignal.timeout(2000) });
              const body = await r.json() as any;
              return body.result?.some((entry: string) => entry.toLowerCase() === "0x0000000071727de22e5e9d8baf0edac6f37da032") === true;
            } catch { return false; }
          });
        } else await until(`${component} readiness`, () => httpReady(`${loopback(component === "ponder" ? c.ports.ponder : c.ports.siteService)}/${component === "ponder" ? "ready" : "health"}`));
      }
    },
    async stop(worldOrComponent, maybeComponent?: Component) {
      const component = typeof worldOrComponent === "string" ? worldOrComponent : maybeComponent!;
      const file = stateFile(c, component);
      let receipt: Receipt;
      try { receipt = JSON.parse(await readFile(file, "utf8")); } catch (e: any) { if (e.code === "ENOENT") return; throw e; }
      if (receipt.state === "exited") {
        if (receipt.code !== 0 || receipt.signal) throw new Error(`${component} did not exit cleanly; snapshot refused`);
        return;
      }
      await command(["amp", "orb", "service", "stop", service(component)], c.root);
      await until(`${component} clean exit`, async () => !await alive(file));
      receipt = JSON.parse(await readFile(file, "utf8"));
      if (receipt.state !== "exited" || receipt.code !== 0 || receipt.signal) throw new Error(`${component} did not exit cleanly; snapshot refused`);
    },
    async benchUp() {
      const pg = new URL(c.database.admin);
      const hostEnv = resolve(c.controlDir, "env/host.env");
      await writeFile(hostEnv, Object.entries({ CAPXUL_PG_USER: decodeURIComponent(pg.username), CAPXUL_PG_PASSWORD: decodeURIComponent(pg.password), CAPXUL_PG_PORT: pg.port || "5432" })
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
      await command(["docker", "compose", "--env-file", hostEnv, "-f", resolve(import.meta.dirname, "host.yaml"), "-p", "capxul-world-host", "up", "-d", "--wait"], c.root);
      await compose(["up", "-d", "--wait", "--wait-timeout", "300"]);
    },
    async benchStop() {
      // Writers first, then the world's own MariaDB and Redis, so a stopped world holds no memory. The host Postgres is shared by
      // every world on this machine and stays up; up() starts all of them again (compose up --wait).
      await compose(["stop", "--timeout", "120", "frontend", "backend", "websocket", "scheduler", "queue-short", "queue-long"]);
      await compose(["stop", "--timeout", "120", "mariadb", "redis-cache", "redis-queue"]);
    },
  };
  return host;
}
