import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database, updateWorldClock } from "@capxul/backend/devnet";
import type { composeBench } from "./bench.ts";
import type { Cut } from "./door.ts";
import { databaseUrl, loopback, type Config } from "./supervisor.ts";

/** devnet.one-world-clock: the world's one business time. Every follower takes it from installClock, nothing else writes it. */
export type WorldClock = Pick<Cut, "nowMs" | "clockMode" | "rate">;
type Bench = Pick<ReturnType<typeof composeBench>, "clock" | "clocks">;

async function rpc(c: Config, method: string, params: unknown[]): Promise<any> {
  const response = await fetch(loopback(c.ports.anvil), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
  const body = await response.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`Anvil ${method} refused: ${body.error.message}`);
  return body.result;
}

export const readWorldClock = async (c: Config): Promise<WorldClock> => JSON.parse(await readFile(join(c.world.stateDir, "clock.json"), "utf8"));

/** (2) The supervisor is the only miner: with a zero interval every later block, automined ones included, is dated at the world's now. */
export async function pinChain(c: Config, clock: WorldClock): Promise<void> {
  if (clock.clockMode !== "stopped") throw new Error("a running world clock needs the control protocol's anchored stops; only a stopped clock can pin the chain");
  await rpc(c, "evm_setNextBlockTimestamp", [Math.floor(clock.nowMs / 1000)]);
  await rpc(c, "anvil_setBlockTimestampInterval", [0]);
}

/** (1) The one door: authority file, database row, bench entry and chain move together. Fresh creation runs it before Ponder and before any site. */
export async function installClock(c: Config, bench: Pick<Bench, "clock">, clock: WorldClock, fresh = false): Promise<void> {
  await writeFile(join(c.world.stateDir, "clock.json"), JSON.stringify(clock), { flag: fresh ? "wx" : "w", mode: 0o600 });
  const db = new Database(databaseUrl(c.database.tenant, c.world), databaseUrl(c.database.worker, c.world));
  try { await updateWorldClock(db, clock); } finally { await db.close(); }
  await bench.clock(c.world.id, clock);
  await pinChain(c, clock);
}

/** (3) Guard on the devnet pnpm patch: Alto's validity windows must read the chain head, never the host clock. */
export async function altoFollowsChain(root: string): Promise<void> {
  const directory = join(root, "packages/devnet/node_modules/@pimlico/alto/esm/rpc/validation");
  for (const file of ["UnsafeValidator.js", "SafeValidator.js"]) {
    const source = await readFile(join(directory, file), "utf8");
    assert.equal(source.split("const now = await chainNow(this.config.publicClient);").length - 1, 2, `Alto ${file} lost the one-world-clock patch`);
    assert(!source.includes("Date.now()"), `Alto ${file} reads the host clock`);
  }
}

const second = (ms: number) => Math.floor(ms / 1000);
/** A site's served now, formatted in its own timezone, compared to the authority to the second. */
const local = (ms: number, timeZone: string) => new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(second(ms) * 1000));

/** (6) Every follower's reading of now. Refuses on any disagreement; the readings are observations, not a recovery cut. */
export async function readClocks(c: Config, bench: Pick<Bench, "clocks">, database: unknown) {
  const authority = await readWorldClock(c);
  assert.deepEqual(database, authority, "the world database's clock differs from the authority");
  assert.equal(authority.clockMode, "stopped", "only a stopped world clock is supported by this supervisor");
  const head = await rpc(c, "eth_getBlockByNumber", ["latest", false]), next = await rpc(c, "eth_getBlockByNumber", ["pending", false]);
  assert.equal(Number(head.timestamp), second(authority.nowMs), "the chain head is not dated at the world's now");
  assert.equal(Number(next.timestamp), second(authority.nowMs), "the next block would not be dated at the world's now");
  const entry = (await bench.clocks())[c.world.id];
  assert(entry && typeof entry === "object" && entry.frozen_at_ms === authority.nowMs, "the bench clock entry differs from the authority");
  const sites: Record<string, string> = {};
  for (const site of c.world.sites) {
    const response = await fetch(`${loopback(c.ports.publicBench)}/api/method/capxul.clock.now`, { headers: { "X-Frappe-Site-Name": site.name }, signal: AbortSignal.timeout(10000) });
    assert(response.ok, `site ${site.company} did not answer its clock`);
    const served = (await response.json() as any).message;
    assert.equal(served.world, c.world.id, `site ${site.company} follows another world`);
    assert.equal(String(served.world_local).slice(0, 19), local(authority.nowMs, served.tz), `site ${site.company} serves a now other than the world's`);
    sites[site.company] = served.world_local;
  }
  if (c.bundler) await altoFollowsChain(c.root);
  return { authority, database: authority, chain: { head: Number(head.timestamp), next: Number(next.timestamp) }, bench: entry, sites,
    bundler: c.bundler ? "chain-head" : null };
}
