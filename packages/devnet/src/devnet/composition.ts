import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database, readSnapshotCut, rewriteRestoredWorld, updateWorldClock } from "@capxul/backend/devnet";
import { canaryBundlerKeys, prepareBundler, suppliedAlto } from "../modules/bundler/service.ts";
import { composeBench } from "./bench.ts";
import { migrateCatalogue, psqlAdmin, readSnapshot, restoreSnapshot, saveSnapshot, type World } from "./door.ts";
import { localRuntime } from "./runtime.ts";
import { alive, command, supervised } from "./processes.ts";
import { databaseUrl, httpReady, loopback, readConfig, stateFile, stop, up, writeConfig, type Config } from "./supervisor.ts";
import { runtimeEnv } from "./service.ts";

/** Fresh pools on the world's actual database, closed before database-template copying. */
async function store<T>(c: Config, world: World, run: (db: Database) => Promise<T>): Promise<T> {
  const db = new Database(databaseUrl(c.database.tenant, world), databaseUrl(c.database.worker, world));
  try { return await run(db); } finally { await db.close(); }
}

export async function composeWorld(configFile: string) {
  const c = await readConfig(configFile);
  const host = supervised(c, configFile);
  const bench = composeBench(c.bench.composeArgs, "/home/frappe/frappe-bench", (site) => `http://${site.name}:${c.ports.publicBench}`, () => loopback(c.ports.publicCore));
  const runtime = localRuntime({ bench, processes: host,
    core: () => ({ url: loopback(c.ports.core), secret: c.secret }),
    clock: async (world) => {
      const clock = JSON.parse(await readFile(join(world.stateDir, "clock.json"), "utf8"));
      if (clock.clockMode !== "stopped") throw new Error("slice-zero supervisor requires a stopped authority clock; running-clock pump is not installed");
      return clock;
    },
    store: {
      updateClock: (world, clock) => store(c, world, (db) => updateWorldClock(db, clock)),
      async rewrite(world, input) {
        await store(c, world, (db) => rewriteRestoredWorld(db, { ...input, coreUrl: loopback(c.ports.publicCore) }));
        await writeFile(join(world.stateDir, "clock.json"), JSON.stringify(input.clock), { mode: 0o600 });
        c.world = world;
        const deployment = JSON.parse(await readFile(join(world.stateDir, "deployment.json"), "utf8"));
        if (deployment.paymaster) {
          assert(c.ports.bundler, "restored sponsor requires an assigned private bundler port");
          c.bundler = suppliedAlto({ ...canaryBundlerKeys(), paymaster: deployment.paymaster,
            rpcUrl: loopback(c.ports.anvil), port: c.ports.bundler, executable: join(c.root, "packages/devnet/node_modules/.bin/alto") });
        }
        await writeConfig(configFile, c);
      },
    },
  });
  const options = { root: c.snapshots, codeVersion: c.codeVersion, admin: psqlAdmin(c.database.admin), runtime };
  return { c, host, runtime,
    async inspect() {
      const components: Record<string, { pid: number; birth: string; codeVersion: string }> = {};
      for (const component of ["anvil", "ponder", "site-service", "core", "ingress", ...(c.bundler ? ["bundler" as const] : [])] as const) {
        assert(await alive(stateFile(c, component)), `${component} is not running`);
        const receipt = JSON.parse(await readFile(stateFile(c, component), "utf8"));
        assert.equal(receipt.codeVersion, c.codeVersion, `${component} runs another build`);
        components[component] = { pid: receipt.pid, birth: receipt.birth, codeVersion: receipt.codeVersion };
      }
      const response = await fetch(`${loopback(c.ports.publicCore)}/ready`, { signal: AbortSignal.timeout(5000) });
      assert(response.ok, "public Core is not ready");
      const core = await response.json() as any;
      assert(core.ok && !core.paused && core.world === c.world.id && core.storage === "postgres" && core.indexer === "ponder" && core.databaseSchemaVersion === "1", "Core identity/stack mismatch");
      assert(await httpReady(`${loopback(c.ports.siteService)}/health`), "site service is not healthy");
      const world = await store(c, c.world, (db) => readSnapshotCut(db));
      assert.equal(world.world_id, c.world.id); assert.equal(Number(world.epoch), c.world.epoch);
      assert.deepEqual(world.clock, JSON.parse(await readFile(join(c.world.stateDir, "clock.json"), "utf8")));
      const { connect } = await import("../modules/chain/service.ts");
      const chain = await connect(loopback(c.ports.publicRpc)), block = await chain.client.getBlock();
      assert.equal(await chain.client.getChainId(), c.chainId);
      const ids = (await command(["docker", "compose", ...c.bench.composeArgs, "ps", "--all", "--quiet", "frontend", "backend", "websocket", "scheduler", "queue-short", "queue-long"], c.root)).split(/\s+/);
      assert.equal(ids.length, 6, "production bench processes missing");
      const containers = JSON.parse(await command(["docker", "inspect", ...ids], c.root)) as any[];
      assert(containers.every((container) => container.State.Running && (!container.State.Health || container.State.Health.Status === "healthy")), "production bench is not healthy");
      return { version: 1, observedAt: new Date().toISOString(), codeVersion: c.codeVersion, stack: "postgres-ponder-erpnext-v4",
        world: { id: world.world_id, epoch: Number(world.epoch), kind: c.world.kind, database: c.world.database, sites: c.world.sites },
        clock: world.clock, lineage: world.lineage, records: { seq: world.recordSeq, head: world.recordHead }, components, core,
        chain: { chainId: c.chainId, blockNumber: String(block.number), blockHash: block.hash },
        bench: containers.map((container) => ({ service: container.Config.Labels["com.docker.compose.service"], image: container.Image, running: container.State.Running, health: container.State.Health?.Status ?? null })),
        bundlerConfigured: !!c.bundler };
    },
    save: (id: string) => saveSnapshot(options, c.world, id),
    read: (id: string) => readSnapshot(options, id),
    restore: (id: string) => restoreSnapshot(options, id, c.world),
  };
}

/** The only schema-writing path. Existing worlds and restored databases cannot enter it. */
export async function createWorld(configFile: string): Promise<void> {
  const { c, host } = await composeWorld(configFile);
  const admin = psqlAdmin(c.database.admin);
  const db = c.world.database;
  const literal = `'${db.replaceAll("'", "''")}'`;
  // Reject an existing/partially-created world before opening any bench writers.
  await mkdir(c.world.stateDir, { recursive: false, mode: 0o700 });
  await writeFile(join(c.world.stateDir, "create-pending.json"), JSON.stringify({ world: c.world.id }), { mode: 0o600 });
  const env = { ...runtimeEnv(c, "core"), PG_ADMIN_URL: c.database.admin, PONDER_DATABASE_URL: databaseUrl(c.database.ponder, c.world) };
  try {
    await host.benchUp();
    if ((await admin(`SELECT row_to_json(d) FROM (SELECT 1 FROM pg_database WHERE datname=${literal}) d`)).length) throw new Error("world database already exists; use world up (never remigrate a restore)");
    await copyFile(join(c.root, "packages/contracts/state/core.json"), join(c.world.stateDir, "anvil-state.json"));
    await admin(`CREATE DATABASE "${db}"`);
    await command(["pnpm", "--filter", "@capxul/backend", "migrate"], c.root, env);
    // The world's own catalogue (worlds, snapshots, command records) sits beside Core's app schema in the same database.
    await migrateCatalogue(psqlAdmin(databaseUrl(c.database.admin, c.world)));
    await host.start("anvil");
    await initializeDeployment(c);
    await writeConfig(configFile, c);
    await command([process.execPath, "packages/devnet/orb/prepare-chain.mjs"], c.root, {
      ...runtimeEnv(c, "anvil"), RPC_URL: loopback(c.ports.anvil), DEPLOYMENT_FILE: join(c.world.stateDir, "deployment.json"),
    });
    const { connect } = await import("../modules/chain/service.ts");
    const block = await (await connect(loopback(c.ports.anvil))).client.getBlock();
    const clock = { nowMs: Number(block.timestamp) * 1000, clockMode: "stopped" as const, rate: 1 };
    await writeFile(join(c.world.stateDir, "clock.json"), JSON.stringify(clock), { flag: "wx", mode: 0o600 });
    await store(c, c.world, (db) => updateWorldClock(db, clock));
    await host.start("ponder");
    await command(["pnpm", "--filter", "@capxul/backend", "bind-indexer"], c.root, env);
    await rm(join(c.world.stateDir, "create-pending.json"));
    await up(c, host);
  } catch (error) {
    try { await stop(c, host); } catch (cleanup) { throw new AggregateError([error, cleanup], "world creation failed and remains fenced; inspect pending state"); }
    throw error;
  }
}

async function initializeDeployment(c: Config) {
  const { connect } = await import("../modules/chain/service.ts");
  const { testKey } = await import("../modules/test-keys/service.ts");
  const { THIRD_PARTY } = await import("../modules/protocol/service.ts");
  const chain = await connect(loopback(c.ports.anvil));
  const record = JSON.parse(await readFile(join(c.root, "packages/contracts/deployments/devnet.json"), "utf8"));
  const token = JSON.parse(await readFile(join(c.root, "packages/contracts/out/MockERC20.sol/MockERC20.json"), "utf8"));
  const hash = await chain.walletFor(testKey("deployer").key).deployContract({ abi: token.abi, bytecode: token.bytecode.object, args: ["World test USD", "USDC", 6] });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("test currency deployment failed");
  assert(c.ports.bundler, "fresh sponsor setup requires an assigned private bundler port");
  const paymasterArtifact = JSON.parse(await readFile(join(c.root, "packages/contracts/out/MockPaymaster.sol/MockPaymaster.json"), "utf8"));
  const sponsor = await prepareBundler({ chain, fundingKey: testKey("deployer").key, paymasterArtifact });
  c.bundler = suppliedAlto({ ...sponsor, rpcUrl: chain.rpcUrl, port: c.ports.bundler,
    executable: join(c.root, "packages/devnet/node_modules/.bin/alto") });
  // Ponder starts before company birth, and the deployment shape never changes on restore.
  await writeFile(join(c.world.stateDir, "deployment.json"), JSON.stringify({ chainId: c.chainId, usdc: receipt.contractAddress,
    payments: record.contracts.Payments.address, hats: THIRD_PARTY.hats, installer: record.contracts.Installer.address,
    budgets: record.contracts.Budgets.address, agreements: record.contracts.Agreements.address, agentOwner: record.contracts.AgentOwner.address,
    companiesHouse: record.companiesHouse, paymaster: sponsor.paymaster, deployedBlock: Number(receipt.blockNumber) }), { flag: "wx", mode: 0o600 });
}
