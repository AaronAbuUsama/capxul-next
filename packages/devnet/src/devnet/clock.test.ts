import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { altoFollowsChain, readClocks } from "./clock.ts";
import type { Config } from "./supervisor.ts";

const listen = async (server: Server) => { await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); return (server.address() as { port: number }).port; };

test("the Alto guard passes on the installed patch and fails on upstream validators", async () => {
  await altoFollowsChain(resolve(import.meta.dirname, "../../../.."));
  const root = await mkdtemp(join(tmpdir(), "alto-guard-")), directory = join(root, "packages/devnet/node_modules/@pimlico/alto/esm/rpc/validation");
  try {
    await mkdir(directory, { recursive: true });
    // Upstream 0.0.21 reads the host clock for validity windows.
    for (const file of ["UnsafeValidator.js", "SafeValidator.js"]) await writeFile(join(directory, file), "const now = Math.floor(Date.now() / 1000);\nconst now = Date.now() / 1000;\n");
    await assert.rejects(altoFollowsChain(root), /lost the one-world-clock patch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("every follower must read the world's now, and each disagreement refuses inspection", async () => {
  const nowMs = 1_791_555_213_000, second = nowMs / 1000;
  let head = second, next = second, served = "2026-10-09 15:13:33.000000", world = "w1";
  const anvil = createServer((req, res) => {
    let body = ""; req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { const { params } = JSON.parse(body); res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { timestamp: `0x${(params[0] === "pending" ? next : head).toString(16)}` } })); });
  });
  const site = createServer((_req, res) => res.end(JSON.stringify({ message: { world, world_local: served, tz: "Europe/London" } })));
  const directory = await mkdtemp(join(tmpdir(), "world-clock-"));
  const clock = { nowMs, clockMode: "stopped" as const, rate: 1 };
  await writeFile(join(directory, "clock.json"), JSON.stringify(clock));
  const c = { root: directory, world: { id: "w1", stateDir: directory, sites: [{ company: "harbourline", name: "harbourline-w1.localhost" }] },
    ports: { anvil: await listen(anvil), publicBench: await listen(site) } } as unknown as Config;
  let entry: any = { offset_ms: -5, frozen_at_ms: nowMs, rate: 1 };
  const bench = { clocks: async () => ({ w1: entry }) };
  try {
    const readings = await readClocks(c, bench, clock);
    assert.deepEqual(readings.chain, { head: second, next: second });
    assert.equal(readings.sites.harbourline, served);
    await assert.rejects(readClocks(c, bench, { ...clock, nowMs: nowMs + 1000 }), /database's clock differs/);
    head = second - 86_400;
    await assert.rejects(readClocks(c, bench, clock), /chain head is not dated/);
    head = second; next = second + 2;
    await assert.rejects(readClocks(c, bench, clock), /next block would not be dated/, "an unpinned Anvil dates its next block by the host");
    next = second; entry = undefined;
    await assert.rejects(readClocks(c, bench, clock), /bench clock entry differs/, "a bench without the world's entry runs on host time");
    entry = { offset_ms: 0, frozen_at_ms: nowMs + 2_992_191_000, rate: 1 };
    await assert.rejects(readClocks(c, bench, clock), /bench clock entry differs/);
    entry = { offset_ms: -5, frozen_at_ms: nowMs, rate: 1 }; served = "2026-11-13 05:24:13.000000";
    await assert.rejects(readClocks(c, bench, clock), /serves a now other than the world's/);
    served = "2026-10-09 15:13:33.000000"; world = "main";
    await assert.rejects(readClocks(c, bench, clock), /follows another world/);
  } finally { anvil.close(); site.close(); await rm(directory, { recursive: true, force: true }); }
});
