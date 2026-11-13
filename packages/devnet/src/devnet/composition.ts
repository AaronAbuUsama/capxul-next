import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database, readSnapshotCut, rewriteRestoredSites, rewriteRestoredWorld, updateWorldClock } from "@capxul/backend/devnet";
import { canaryBundlerKeys, prepareBundler, suppliedAlto } from "../modules/bundler/service.ts";
import { composeBench } from "./bench.ts";
import { installClock, readClocks } from "./clock.ts";
import { migrateCatalogue, psqlAdmin, readSnapshot, restoreSnapshot, saveSnapshot, worldCatalogue,
  type CatalogueCut, type CatalogueHistory, type Command, type World, type WorldRow } from "./door.ts";
import { localRuntime } from "./runtime.ts";
import { alive, command, supervised } from "./processes.ts";
import { databaseUrl, httpReady, loopback, readConfig, stateFile, stop, up, writeConfig, type Config } from "./supervisor.ts";
import { runtimeEnv } from "./service.ts";

/** Fresh pools on the world's actual database, closed before database-template copying. */
async function store<T>(c: Config, world: World, run: (db: Database) => Promise<T>): Promise<T> {
  const db = new Database(databaseUrl(c.database.tenant, world), databaseUrl(c.database.worker, world));
  try { return await run(db); } finally { await db.close(); }
}

function catalogue(c: Config, world = c.world) {
  return worldCatalogue(psqlAdmin(databaseUrl(c.database.worker, world)), [c.secret, c.siteToken,
    c.bench.dbPassword, c.bench.adminPassword, ...Object.values(c.database).map((url) => decodeURIComponent(new URL(url).password))]);
}

async function recordedCommand(c: Config, command: string, args: object = {}): Promise<Command> {
  const source = await store(c, c.world, (db) => readSnapshotCut(db));
  assert.equal(source.world_id, c.world.id, "command database belongs to another world");
  assert.equal(source.epoch, c.world.epoch, "command database belongs to another epoch");
  assert.equal(source.clock.clockMode, "stopped", "composed catalogue requires stopped authority");
  assert(Number.isSafeInteger(source.clock.nowMs), "invalid world clock");
  return { trace: randomUUID(), command, args, worldTime: source.clock.nowMs, outcome: "ok", surface: "cli" };
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
    installClock: (world, clock) => { c.world = world; return installClock(c, bench, clock, "restore"); },
    store: {
      updateClock: (world, clock) => store(c, world, (db) => updateWorldClock(db, clock)),
      async rewrite(world, input) {
        // Site rows first, on the admin connection the decision names: a missing host mapping refuses before the world changes.
        await rewriteRestoredSites(databaseUrl(c.database.admin, world), input);
        await store(c, world, (db) => rewriteRestoredWorld(db, { ...input, coreUrl: loopback(c.ports.publicCore) }));
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
  return { c, host, runtime, bench,
    async up() {
      const row = await catalogue(c).show(c.world.id);
      assert.equal(row.epoch, c.world.epoch, "catalogue belongs to another epoch");
      assert.equal(row.chain_id, c.chainId, "catalogue belongs to another chain");
      assert(["creating", "running", "stopped", "parked"].includes(row.state), "catalogue world cannot start in its current state");
      await up(c, host);
      const entry = await recordedCommand(c, "world up");
      if (row.state === "running") await catalogue(c).append(c.world.id, entry);
      else await catalogue(c).transition(c.world.id, row.state === "creating" ? "start" : "resume", entry);
    },
    async stop() {
      // Physical stop remains available after crashes; successful catalogue recording never substitutes for it.
      await stop(c, host);
      const row = await catalogue(c).show(c.world.id), entry = await recordedCommand(c, "world stop");
      if (row.state === "stopped") await catalogue(c).append(c.world.id, entry);
      else await catalogue(c).transition(c.world.id, "stop", entry);
    },
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
      const clocks = await readClocks(c, bench, world.clock);
      const { connect } = await import("../modules/chain/service.ts");
      const chain = await connect(loopback(c.ports.publicRpc)), block = await chain.client.getBlock();
      assert.equal(await chain.client.getChainId(), c.chainId);
      const ids = (await command(["docker", "compose", ...c.bench.composeArgs, "ps", "--all", "--quiet", "frontend", "backend", "websocket", "scheduler", "queue-short", "queue-long"], c.root)).split(/\s+/);
      assert.equal(ids.length, 6, "production bench processes missing");
      const containers = JSON.parse(await command(["docker", "inspect", ...ids], c.root)) as any[];
      assert(containers.every((container) => container.State.Running && (!container.State.Health || container.State.Health.Status === "healthy")), "production bench is not healthy");
      return { version: 1, observedAt: new Date().toISOString(), codeVersion: c.codeVersion, stack: "postgres-ponder-erpnext-v4",
        world: { id: world.world_id, epoch: Number(world.epoch), kind: c.world.kind, database: c.world.database, sites: c.world.sites },
        clock: world.clock, clocks, lineage: world.lineage, records: { seq: world.recordSeq, head: world.recordHead }, components, core,
        chain: { chainId: c.chainId, blockNumber: String(block.number), blockHash: block.hash },
        bench: containers.map((container) => ({ service: container.Config.Labels["com.docker.compose.service"], image: container.Image, running: container.State.Running, health: container.State.Health?.Status ?? null })),
        bundlerConfigured: !!c.bundler };
    },
    async save(id: string) {
      const row = await catalogue(c).show(c.world.id);
      assert.equal(row.epoch, c.world.epoch, "catalogue belongs to another epoch");
      assert.equal(row.state, "running", "snapshot catalogue world must be running");
      let saved: CatalogueCut | undefined;
      const manifest = await saveSnapshot({ ...options, runtime: { ...runtime,
        async quiesce(world) {
          const cut = await runtime.quiesce(world);
          saved = await catalogue(c, world).cut(world.id);
          return cut;
        },
      } }, c.world, id);
      assert(saved, "snapshot has no drained catalogue cut");
      assert.equal(saved.epoch, manifest.epoch, "snapshot catalogue epoch differs");
      await catalogue(c).save({ world_id: c.world.id, name: id, epoch: saved.epoch, record_seq: saved.seq,
        chain_state_ref: join(c.snapshots, id, "state", "anvil-state.json"),
        site_backups: manifest.sites.map((site) => ({ org_id: site.company, backup_ref: join(c.snapshots, id, "sites", site.company) })),
        clock_mode: manifest.cut.clockMode === "stopped" ? "frozen" : "running", rate: manifest.cut.rate,
        world_now: manifest.cut.nowMs, code_version: manifest.codeVersion, template: false, created_at: manifest.cut.nowMs,
      }, await recordedCommand(c, "world snapshot save", { snapshot: id }));
      return manifest;
    },
    read: (id: string) => readSnapshot(options, id),
    async restore(id: string) {
      const manifest = await readSnapshot(options, id);
      let abandoned: CatalogueHistory | undefined;
      return restoreSnapshot({ ...options, runtime: { ...runtime,
        async quiesce(world) {
          const cut = await runtime.quiesce(world);
          // Read while the drained source still accepts connections, before it is renamed and fenced.
          if (world.id === manifest.world) abandoned = await catalogue(c, world).history(world.id);
          return cut;
        },
        async rewrite(world, saved, abandonedDatabase) {
          const target = catalogue(c, world);
          const history = await target.history(saved.world), source = await target.show(saved.world);
          assert.equal(history.cut.epoch, saved.epoch, "restored catalogue epoch differs from snapshot");
          const row: WorldRow = { ...source, world_id: world.id, name: world.id === saved.world ? source.name : world.id,
            kind: world.kind, address: loopback(c.ports.publicCore), chain_instance: `anvil-${world.id}`,
            epoch: world.epoch, clock_mode: saved.cut.clockMode === "stopped" ? "frozen" : "running",
            world_now: saved.cut.nowMs, rate: saved.cut.rate, updated_at: saved.cut.nowMs,
            ...(world.id === saved.world ? {} : { created_at: saved.cut.nowMs, parent_world: saved.world, parent_snapshot: saved.id, parent_seq: history.cut.seq }),
          };
          assert.equal(!!abandonedDatabase, !!abandoned, "in-place restore requires its actual drained catalogue history");
          await target.rewrite(row, { sourceWorld: saved.world, snapshot: saved.id, cut: history.cut,
            ...(abandoned ? { abandoned } : {}),
          }, { trace: randomUUID(), command: "world snapshot restore", args: { snapshot: saved.id },
            worldTime: saved.cut.nowMs, outcome: "ok", surface: "cli" });
          await runtime.rewrite(world, saved, abandonedDatabase);
        },
        async resume(world) {
          await runtime.resume(world);
          const row = await catalogue(c, world).show(world.id);
          await catalogue(c, world).transition(world.id, row.state === "creating" ? "start" : "restored",
            await recordedCommand(c, "world snapshot restore resumed", { snapshot: id }));
        },
      } }, id, c.world);
    },
  };
}

/** The only schema-writing path. Existing worlds and restored databases cannot enter it. */
export async function createWorld(configFile: string): Promise<void> {
  const stack = await composeWorld(configFile), { c, host } = stack;
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
    // Narrow fresh-create migration from PR77 8144d0a; no UI or cloud-supervisor changes adopted.
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
    // devnet.one-world-clock: the one door, before Ponder starts and before any site exists.
    await installClock(c, stack.bench, clock, "birth");
    const now = clock.nowMs;
    await catalogue(c).create({ world_id: c.world.id, name: c.world.id, kind: c.world.kind, profile: "full",
      address: loopback(c.ports.publicCore), template: null, chain_id: c.chainId, chain_instance: `anvil-${c.world.id}`,
      clock_mode: "frozen", rate: clock.rate, world_now: clock.nowMs, epoch: c.world.epoch,
      parent_world: null, parent_snapshot: null, parent_seq: null, hosted: false, state: "creating", created_at: now, updated_at: now,
    }, await recordedCommand(c, "world create"));
    await host.start("ponder");
    await command(["pnpm", "--filter", "@capxul/backend", "bind-indexer"], c.root, env);
    await rm(join(c.world.stateDir, "create-pending.json"));
    await stack.up();
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
