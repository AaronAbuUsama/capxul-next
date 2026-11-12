import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command } from "./processes.ts";
import { writeConfig, type Config } from "./supervisor.ts";

/** Local disposable defaults. Secrets stay under var, outside snapshots and version control. */
export async function initializeConfig(file: string, id: string, basePort = 18000): Promise<Config> {
  if (!/^[a-z][a-z0-9]{0,11}$/.test(id)) throw new Error("world id must be 1–12 lowercase alphanumeric characters, starting with a letter");
  if (!Number.isSafeInteger(basePort) || basePort < 1024 || basePort + 10 > 65535) throw new Error("world needs eleven consecutive unprivileged ports");
  try { await access(file); throw new Error("config already exists"); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  const root = resolve(import.meta.dirname, "../../../..");
  const required = (key: string) => { if (!process.env[key]) throw new Error(`${key} required; source the orb's runtime environment`); return process.env[key]!; };
  const database = { admin: required("PG_ADMIN_URL"), tenant: required("DATABASE_URL"), worker: required("WORKER_DATABASE_URL"), ponder: required("PONDER_DATABASE_URL") };
  const maintenance = new URL(database.admin); maintenance.pathname = "/postgres"; database.admin = maintenance.href;
  const controlDir = join(root, "var/worlds", id), volumes = join(controlDir, "bench");
  await mkdir(join(controlDir, "env"), { recursive: true, mode: 0o700 });
  const random = () => randomBytes(24).toString("hex");
  const dbPassword = random(), adminPassword = random();
  await writeFile(join(controlDir, "env/mariadb.env"), `MARIADB_ROOT_PASSWORD=${dbPassword}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(join(controlDir, "env/bench.env"), `CAPXUL_ADMIN_PASSWORD=${adminPassword}\n`, { flag: "wx", mode: 0o600 });
  const c: Config = {
    version: 1, root, controlDir, snapshots: join(root, "var/world-snapshots"), codeVersion: await command(["git", "rev-parse", "HEAD"], root),
    world: { id, kind: "local", database: `world_${id}`, stateDir: join(controlDir, "state"), sites: [], epoch: 1 },
    ports: { anvil: basePort, ponder: basePort + 1, core: basePort + 2, siteService: basePort + 3, bench: basePort + 4, socket: basePort + 5,
      publicCore: basePort + 6, publicRpc: basePort + 7, publicBench: basePort + 8, publicBundler: basePort + 9, bundler: basePort + 10 },
    database,
    secret: random(), siteToken: random(), finality: 0, chainId: 84532,
    bench: { composeArgs: ["--env-file", join(controlDir, "env/compose.env"), "-f", join(root, "packages/bench-image/compose.yaml"), "-f", join(root, "packages/devnet/src/devnet/compose.yaml"), "-p", `world-${id}`],
      env: { CAPXUL_ENV_DIR: join(controlDir, "env"), CAPXUL_VOLUMES: volumes, CAPXUL_BENCH_IMAGE: "capxul-bench:orb",
        CAPXUL_BENCH_PORT: String(basePort + 4), CAPXUL_SOCKET_PORT: String(basePort + 5),
        CAPXUL_APP_DIR: join(root, "packages/frappe-app") }, dbPassword, adminPassword, baseDomain: "localhost" },
  };
  // sudo's Docker shim intentionally does not forward arbitrary host environment variables.
  await writeFile(join(controlDir, "env/compose.env"), Object.entries(c.bench.env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { flag: "wx", mode: 0o600 });
  for (const directory of ["capxul-sites", "capxul-bench-logs", "capxul-mariadb-data", "capxul-redis-queue-data"]) await mkdir(join(volumes, directory), { recursive: true });
  await command(["docker", "run", "--rm", "--user", "0", "-v", `${volumes}:/world-bench`, "capxul-bench:orb", "chown", "1000:0", "/world-bench/capxul-sites", "/world-bench/capxul-bench-logs"], root);
  await writeConfig(file, c);
  return c;
}
