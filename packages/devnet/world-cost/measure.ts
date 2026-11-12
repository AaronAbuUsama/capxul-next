// Measures what one world's Ponder costs: K worlds, each a fresh anvil from the seeded v4 state with N companies of
// history, each indexed by its own Ponder on PGlite or on one shared Postgres (a database per world). Records, per
// world: start time (process up, /health) and catch-up time (/ready), memory while catching up, idle at head, while
// indexing live load, after parking (Ponder stopped) and after unparking (restart on the same database), and disk.
// Memory is PSS (proportional set size: shared pages split between the processes sharing them, so sums are honest),
// read from /proc every 250 ms. Prints one JSON document; the human summary is written in docs/mission/world-cost.md.
//   node --experimental-strip-types measure.ts --backend pglite|postgres --worlds 1 --companies 20 --payments 10
// Needs: anvil on PATH (packages/devnet/cloud/setup.sh), a forge build of packages/contracts, and for postgres a server
// at PG_ADMIN_URL (default postgres://capxul:pw@127.0.0.1:55432/postgres) whose processes are visible in /proc.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { openSync, readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CONTRACTS = join(HERE, "../../contracts");
const { values: o } = parseArgs({
  options: {
    backend: { type: "string", default: "pglite" },
    worlds: { type: "string", default: "1" },
    companies: { type: "string", default: "20" },
    payments: { type: "string", default: "10" },
    idle: { type: "string", default: "60" },
    live: { type: "string", default: "3" },
    out: { type: "string", default: join(HERE, "../../../var/world-cost") },
  },
});
const K = Number(o.worlds);
const backend = o.backend as "pglite" | "postgres";
const PG_ADMIN = process.env.PG_ADMIN_URL ?? "postgres://capxul:pw@127.0.0.1:55432/postgres";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const mb = (kb: number) => Math.round(kb / 102.4) / 10;

// ── memory from /proc ─────────────────────────────────────────────────────────────────────────
const children = (): Map<number, number[]> => {
  const m = new Map<number, number[]>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      m.set(ppid, [...(m.get(ppid) ?? []), Number(d)]);
    } catch {}
  }
  return m;
};
const tree = (pid: number, kids = children()): number[] => [pid, ...(kids.get(pid) ?? []).flatMap((c) => tree(c, kids))];
const pssKb = (pid: number): number => {
  try {
    const m = /Pss:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
};
const rssKb = (pid: number): number => {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
};
/** User plus system CPU time of one process, in clock ticks (100 a second). */
const ownTicks = (p: number): number => {
  try {
    const stat = readFileSync(`/proc/${p}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(f[11]) + Number(f[12]);
  } catch {
    return 0;
  }
};
const cpuTicks = (pid: number): number => tree(pid).reduce((s, p) => s + ownTicks(p), 0);
const treePss = (pid: number) => tree(pid).reduce((s, p) => s + pssKb(p), 0);
const treeRss = (pid: number) => tree(pid).reduce((s, p) => s + rssKb(p), 0);
const postgresPids = (): number[] =>
  readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number).filter((p) => {
    try {
      return readFileSync(`/proc/${p}/comm`, "utf8").trim() === "postgres";
    } catch {
      return false;
    }
  });
const postgresPss = () => postgresPids().reduce((s, p) => s + pssKb(p), 0);
const hostAvailableKb = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))![1]);

// ── a world ───────────────────────────────────────────────────────────────────────────────────
interface World { i: number; rpc: string; anvil: ChildProcess; token?: string; seed: number; db: string; ponder?: ChildProcess; port: number; pgliteDir: string; history?: unknown }
const rpcCall = async (rpc: string, method: string, params: unknown[] = []) => {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
  return ((await r.json()) as { result: any }).result;
};
const head = async (w: World) => Number(await rpcCall(w.rpc, "eth_blockNumber"));
const headTime = async (w: World) => Number((await rpcCall(w.rpc, "eth_getBlockByNumber", ["latest", false])).timestamp);

async function bornWorld(i: number): Promise<World> {
  const port = 18600 + i;
  const anvil = spawn("anvil", ["--port", String(port), "--chain-id", "84532", "--silent", "--load-state", join(CONTRACTS, "state/core.json")], { stdio: "ignore" });
  const rpc = `http://127.0.0.1:${port}`;
  for (let t = 0; t < 100; t++) {
    try {
      await rpcCall(rpc, "eth_chainId");
      break;
    } catch {
      await sleep(200);
    }
  }
  const seed = Number(await rpcCall(rpc, "eth_blockNumber"));
  // The seeded state keeps only its head block. At start Ponder binary-searches for the newest block older than its reorg
  // window (180 s), probing first 90 blocks below the head because chain 84532 is Base Sepolia, a two-second chain; a
  // probe that is not old enough sends the search below the seed, to a block the seeded state does not have, and Ponder
  // retries it until it gives up (measured: it cannot start). So a world advances two seconds per block, as Base does,
  // and is born with 200 empty blocks after the seed.
  await rpcCall(rpc, "anvil_setBlockTimestampInterval", [2]);
  await rpcCall(rpc, "anvil_mine", ["0xc8"]);
  return { i, rpc, anvil, seed, db: `world_${i}`, port: 42100 + i, pgliteDir: join(o.out, `pglite-${i}`) };
}

async function load(w: World, companies: number, payments: number, tag: string) {
  const args = ["--experimental-strip-types", "--no-warnings", join(HERE, "load.ts"), "--rpc", w.rpc, "--companies", String(companies), "--payments", String(payments), "--tag", tag];
  if (w.token) args.push("--token", w.token);
  const { stdout } = await run("node", args, { timeout: 900_000, maxBuffer: 1 << 24 });
  const r = JSON.parse(stdout.trim().split("\n").pop()!);
  w.token = r.token;
  return r;
}

async function psql(sql: string, url = PG_ADMIN) {
  const { stdout } = await run("psql", [url, "-tAc", sql], { timeout: 60_000 });
  return stdout.trim();
}

function startPonder(w: World): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    WORLD_RPC: w.rpc,
    WORLD_START_BLOCK: String(w.seed),
    WORLD_TOKEN: w.token!,
    PONDER_LOG_LEVEL: "warn",
    PONDER_TELEMETRY_DISABLED: "true",
    SAFE_READS: process.env.SAFE_READS ?? "on",
  };
  if (backend === "postgres") env.DATABASE_URL = PG_ADMIN.replace(/\/[^/]*$/, `/${w.db}`);
  else env.PGLITE_DIR = w.pgliteDir;
  delete env.DATABASE_PRIVATE_URL;
  if (backend === "pglite") delete env.DATABASE_URL;
  return spawn("node", [join(HERE, "node_modules/ponder/dist/esm/bin/ponder.js"), "start", "--schema", "world", "--port", String(w.port)], { cwd: HERE, env, stdio: ["ignore", openSync(join(o.out!, `ponder-${backend}-${w.i}.log`), "a"), openSync(join(o.out!, `ponder-${backend}-${w.i}.log`), "a")] });
}
const status = async (w: World, path: string) => {
  try {
    return (await fetch(`http://127.0.0.1:${w.port}${path}`, { signal: AbortSignal.timeout(2_000) })).status;
  } catch {
    return 0;
  }
};
const metric = async (w: World, name: string): Promise<number> => {
  try {
    const text = await (await fetch(`http://127.0.0.1:${w.port}/metrics`, { signal: AbortSignal.timeout(5_000) })).text();
    return text.split("\n").filter((l) => l.startsWith(name)).reduce((s, l) => s + Number(l.split(" ").pop()), 0);
  } catch {
    return NaN;
  }
};

/** Samples memory every 250 ms until `until` resolves. */
async function sampled<T>(worlds: World[], until: Promise<T>) {
  const samples: { t: number; ponder: number[]; postgres: number; anvil: number[] }[] = [];
  let done = false;
  const out = until.finally(() => (done = true));
  const t0 = now();
  while (!done) {
    samples.push({ t: now() - t0, ponder: worlds.map((w) => (w.ponder?.pid ? treePss(w.ponder.pid) : 0)), postgres: backend === "postgres" ? postgresPss() : 0, anvil: worlds.map((w) => pssKb(w.anvil.pid!)) });
    await Promise.race([out.catch(() => {}), sleep(250)]);
  }
  const value = await out;
  const peak = (f: (s: (typeof samples)[number]) => number) => mb(Math.max(0, ...samples.map(f)));
  const med = (f: (s: (typeof samples)[number]) => number) => {
    const xs = samples.map(f).sort((a, b) => a - b);
    return mb(xs[Math.floor(xs.length / 2)] ?? 0);
  };
  return {
    value,
    seconds: Math.round((now() - t0) / 100) / 10,
    samples: samples.length,
    ponderPeakMbEach: worlds.map((_, i) => peak((s) => s.ponder[i]!)),
    ponderMedianMbEach: worlds.map((_, i) => med((s) => s.ponder[i]!)),
    ponderPeakMbTotal: peak((s) => s.ponder.reduce((a, b) => a + b, 0)),
    ponderMedianMbTotal: med((s) => s.ponder.reduce((a, b) => a + b, 0)),
    postgresPeakMb: peak((s) => s.postgres),
    postgresMedianMb: med((s) => s.postgres),
    anvilMedianMbEach: worlds.map((_, i) => med((s) => s.anvil[i]!)),
  };
}

async function untilReady(w: World, t0: number) {
  let health: number | undefined;
  for (;;) {
    if (w.ponder?.exitCode !== null) throw new Error(`world ${w.i}'s Ponder exited with ${w.ponder?.exitCode}`);
    if (health === undefined && (await status(w, "/health")) === 200) health = now() - t0;
    if ((await status(w, "/ready")) === 200) return { healthSeconds: Math.round((health ?? now() - t0) / 100) / 10, readySeconds: Math.round((now() - t0) / 100) / 10 };
    await sleep(100);
  }
}
async function untilAtHead(w: World) {
  const target = await headTime(w);
  for (;;) {
    if ((await metric(w, "ponder_indexing_timestamp")) >= target) return;
    await sleep(200);
  }
}
async function stop(w: World) {
  const t0 = now();
  const p = w.ponder!;
  const exited = new Promise((r) => p.once("exit", r));
  p.kill("SIGTERM");
  await Promise.race([exited, sleep(30_000)]);
  if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  w.ponder = undefined;
  return Math.round((now() - t0) / 100) / 10;
}
const du = async (path: string) => Number((await run("du", ["-sk", path], { timeout: 30_000 })).stdout.split("\t")[0]);

// ── the run ───────────────────────────────────────────────────────────────────────────────────
const result: Record<string, unknown> = {
  when: new Date().toISOString(),
  args: o,
  machine: { cpus: (await run("nproc")).stdout.trim(), memTotalMb: mb(Number(/MemTotal:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))![1])), node: process.version, kernel: (await run("uname", ["-r"])).stdout.trim() },
  ponder: JSON.parse(readFileSync(join(HERE, "node_modules/ponder/package.json"), "utf8")).version,
};
mkdirSync(o.out!, { recursive: true });
const worlds: World[] = [];
try {
  for (let i = 0; i < K; i++) worlds.push(await bornWorld(i));
  const t = now();
  result.history = await Promise.all(worlds.map((w) => load(w, Number(o.companies), Number(o.payments), `h${w.i}`)));
  result.historyLoadSeconds = Math.round((now() - t) / 100) / 10;
  for (const w of worlds) {
    if (backend === "postgres") {
      await psql(`DROP DATABASE IF EXISTS ${w.db} WITH (FORCE)`);
      await psql(`CREATE DATABASE ${w.db}`);
    } else rmSync(w.pgliteDir, { recursive: true, force: true });
  }
  result.baseline = { postgresMb: backend === "postgres" ? mb(postgresPss()) : 0, anvilMbEach: worlds.map((w) => mb(pssKb(w.anvil.pid!))), hostAvailableMb: mb(hostAvailableKb()) };

  // 1. Cold start and catch-up: every world's Ponder starts at once on an empty database.
  const t1 = now();
  for (const w of worlds) w.ponder = startPonder(w);
  result.catchUp = await sampled(worlds, Promise.all(worlds.map((w) => untilReady(w, t1))));
  // 2. Idle at head, polling the chain once a second.
  const cpu0 = worlds.map((w) => cpuTicks(w.ponder!.pid!));
  const pgCpu0 = new Map(postgresPids().map((p) => [p, ownTicks(p)]));
  result.idle = await sampled(worlds, sleep(Number(o.idle) * 1000));
  const pct = (ticks: number) => Math.round((ticks / 100 / Number(o.idle)) * 1000) / 10;
  result.idleCpuPercentEach = worlds.map((w, i) => pct(cpuTicks(w.ponder!.pid!) - cpu0[i]!));
  result.idlePostgresCpuPercent = pct(postgresPids().reduce((s, p) => s + ownTicks(p) - (pgCpu0.get(p) ?? 0), 0));
  result.idleRssMbEach = worlds.map((w) => mb(treeRss(w.ponder!.pid!)));
  result.idleNode = await Promise.all(worlds.map(async (w) => ({ heapUsedMb: mb((await metric(w, "nodejs_heap_size_used_bytes")) / 1024), externalMb: mb((await metric(w, "nodejs_external_memory_bytes")) / 1024) })));
  result.events = await Promise.all(worlds.map((w) => metric(w, "ponder_indexing_completed_events")));
  // 3. Live: each world gets more companies while its Ponder follows, then waits until Ponder reaches the head.
  const live = Number(o.live);
  result.live = await sampled(
    worlds,
    Promise.all(worlds.map(async (w) => {
      const r = await load(w, live, 5, `l${w.i}`);
      const t0 = now();
      await untilAtHead(w);
      return { ...r, lagAfterLoadSeconds: Math.round((now() - t0) / 100) / 10 };
    })),
  );
  // 4. Park: stop every Ponder; what is left is the chain (and Postgres).
  const beforePark = { ponderMb: mb(worlds.reduce((s, w) => s + treePss(w.ponder!.pid!), 0)), postgresMb: backend === "postgres" ? mb(postgresPss()) : 0, hostAvailableMb: mb(hostAvailableKb()) };
  const stopSeconds = await Promise.all(worlds.map(stop));
  await sleep(3000);
  result.park = { beforePark, stopSeconds, after: { postgresMb: backend === "postgres" ? mb(postgresPss()) : 0, anvilMbEach: worlds.map((w) => mb(pssKb(w.anvil.pid!))), hostAvailableMb: mb(hostAvailableKb()) } };
  // 5. Unpark: start again on the same database, with blocks mined while parked.
  await Promise.all(worlds.map((w) => load(w, 1, 2, `p${w.i}`)));
  const t5 = now();
  for (const w of worlds) w.ponder = startPonder(w);
  result.unpark = await sampled(worlds, Promise.all(worlds.map((w) => untilReady(w, t5))));
  await Promise.all(worlds.map(untilAtHead));
  (result.unpark as any).secondsToHead = Math.round((now() - t5) / 100) / 10;
  // 6. Disk.
  result.disk =
    backend === "postgres"
      ? { mbEach: await Promise.all(worlds.map(async (w) => mb(Number(await psql(`SELECT pg_database_size('${w.db}')`)) / 1024))) }
      : { mbEach: await Promise.all(worlds.map(async (w) => mb(await du(w.pgliteDir)))) };
  await Promise.all(worlds.map(stop));
} finally {
  for (const w of worlds) {
    if (w.ponder) w.ponder.kill("SIGKILL");
    w.anvil.kill("SIGTERM");
  }
}
console.log(JSON.stringify(result, null, 1));
