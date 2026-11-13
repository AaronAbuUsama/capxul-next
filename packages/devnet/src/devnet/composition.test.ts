import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { composeWorld } from "./composition.ts";
import { migrateCatalogue, psqlAdmin, worldCatalogue, type WorldRow } from "./door.ts";
import { databaseUrl, writeConfig, type Config } from "./supervisor.ts";

// A dedicated disposable instance, not a retained world's maintenance connection.
const maintenance = process.env.WORLD_COMPOSITION_PG;
test("composition persists actual lifecycle and restores the catalogue cut independently of the financial cut", { skip: !maintenance }, async () => {
  const root = await mkdtemp(join(tmpdir(), "capxul-composition-"));
  const name = `composed_${randomUUID().replaceAll("-", "")}`;
  const admin = psqlAdmin(maintenance!), owned = new Set<string>([name]);
  const roles: string[] = [], password = randomBytes(24).toString("hex");
  const server = createServer((_, response) => { response.setHeader("content-type", "application/json"); response.end('{"paused":false}'); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const roleUrl = (role: string) => { const u = new URL(maintenance!); u.username = role; u.password = password; return u.href; };
  const c: Config = { version: 1, root, controlDir: join(root, "control"), snapshots: join(root, "snapshots"), codeVersion: "composed-test",
    world: { id: "composed", kind: "local", database: name, stateDir: join(root, "state"), sites: [], epoch: 1 },
    database: { admin: maintenance!, tenant: roleUrl("capxul_core"), worker: roleUrl("capxul_worker"), ponder: roleUrl("capxul_ponder") },
    ports: { core: port, anvil: 21001, ponder: 21002, siteService: 21003, bench: 21004, socket: 21005, publicCore: 21006, publicRpc: 21007, publicBench: 21008, publicBundler: 21009 },
    secret: password, siteToken: password, finality: 0, chainId: 84532,
    bench: { composeArgs: [], env: {}, dbPassword: password, adminPassword: password, baseDomain: "localhost" } };
  const query = psqlAdmin(databaseUrl(maintenance!, c.world));
  const catalogue = worldCatalogue(psqlAdmin(databaseUrl(c.database.worker, c.world)), [password]);
  const clock = { nowMs: 1772442000000, clockMode: "stopped", rate: 1 };
  const world: WorldRow = { world_id: c.world.id, name: c.world.id, kind: "local", profile: "full", address: null, template: null,
    chain_id: c.chainId, chain_instance: "anvil-composed", clock_mode: "frozen", rate: 1, world_now: clock.nowMs, epoch: 1,
    parent_world: null, parent_snapshot: null, parent_seq: null, hosted: false, state: "creating", created_at: clock.nowMs, updated_at: clock.nowMs };
  try {
    for (const role of ["capxul_core", "capxul_worker"]) {
      const existing = await admin(`SELECT row_to_json(r) FROM (SELECT 1 FROM pg_roles WHERE rolname='${role}') r`);
      assert.equal(existing.length, 0, "WORLD_COMPOSITION_PG must be a fresh dedicated disposable instance");
      await admin(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      roles.push(role);
    }
    await admin(`CREATE DATABASE "${name}"`);
    await query(`CREATE SCHEMA app; GRANT USAGE ON SCHEMA app TO capxul_core,capxul_worker;
      CREATE TABLE app.world(world_id text,epoch integer,clock jsonb,lineage jsonb);
      INSERT INTO app.world VALUES ('composed',1,'${JSON.stringify(clock)}','{}');
      CREATE TABLE app.records(org_id text,id bigint,hash text);
      INSERT INTO app.records VALUES ('supplier',91,'financial-head');
      CREATE TABLE app.world_record(id bigint GENERATED ALWAYS AS IDENTITY,kind text,data jsonb);
      GRANT SELECT,UPDATE ON app.world TO capxul_worker;
      GRANT SELECT ON app.records TO capxul_worker;
      GRANT INSERT ON app.world_record TO capxul_worker;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO capxul_worker;`);
    await mkdir(c.world.stateDir);
    for (const [file, value] of Object.entries({ "deployment.json": {}, "anvil-state.json": { native: "external chain boundary is stubbed in this control" }, "clock.json": clock }))
      await writeFile(join(c.world.stateDir, file), JSON.stringify(value));
    const config = join(root, "config.json"); await writeConfig(config, c);
    const stack = await composeWorld(config);
    let starts = 0, failStart = false, resumed = 0;
    // Only external process/chain/bench boundaries are stubbed; catalogue and snapshot databases are real.
    stack.host.start = async () => { starts++; if (failStart) throw new Error("external startup refused"); };
    stack.host.stop = async () => {};
    stack.host.benchUp = stack.host.benchStop = async () => {};
    await assert.rejects(stack.up());
    assert.equal(starts, 0, "missing catalogue must refuse before starting writers");
    await migrateCatalogue(query);
    await catalogue.create(world, { trace: "born", command: "world create", worldTime: clock.nowMs, outcome: "ok" });
    await stack.up();
    assert.equal((await catalogue.show(c.world.id)).state, "running");
    await stack.stop();
    const stopped = await catalogue.cut(c.world.id);
    failStart = true;
    await assert.rejects(stack.up(), /external startup refused/);
    assert.deepEqual(await catalogue.cut(c.world.id), stopped, "failed process startup must not append a successful lifecycle fact");
    assert.equal((await catalogue.show(c.world.id)).state, "stopped");
    failStart = false; await stack.up();
    stack.runtime.running = async () => true;
    stack.runtime.quiesce = async () => ({ ...clock, clockMode: "stopped", recordSeq: 91, recordHead: "f".repeat(64), heads: [] });
    stack.runtime.resume = async () => { resumed++; };
    stack.runtime.hold = async () => {};
    const savedCut = await catalogue.cut(c.world.id);
    const saved = await stack.save("checkpoint"); owned.add(saved.database.name);
    assert.equal(saved.cut.recordSeq, 91);
    const snapshots = await catalogue.snapshots(c.world.id);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]!.record_seq, savedCut.seq);
    assert.notEqual(savedCut.seq, saved.cut.recordSeq, "catalogue and financial cuts deliberately differ");
    await catalogue.append(c.world.id, { trace: "after-save", command: "later command", worldTime: clock.nowMs, outcome: "ok" });
    const rewrite = stack.runtime.rewrite;
    stack.runtime.rewrite = async (target, manifest, abandoned) => {
      if (abandoned) owned.add(abandoned);
      assert.equal((await catalogue.show(target.id)).state, "restoring", "catalogue rewrite precedes backend/bench rewrite and resume");
      await rewrite(target, manifest, abandoned);
    };
    await stack.restore("checkpoint");
    assert.equal(resumed, 2);
    assert.equal(stack.c.world.epoch, 2);
    assert.equal((await catalogue.show(c.world.id)).state, "running");
    const all = await catalogue.records(c.world.id, { includeAbandoned: true });
    assert.equal(all.find((row) => row.trace_id === "after-save")!.branch_abandoned, true);
    const restored = all.find((row) => row.kind === "restore")!;
    assert.equal(restored.epoch, 2);
    assert.equal(JSON.parse(restored.changes as string).lineage.seq, savedCut.seq);
    assert.equal((await catalogue.snapshots(c.world.id)).length, 1, "in-place restore retains actually published snapshot metadata");
    assert.equal(JSON.parse(await readFile(config, "utf8")).world.epoch, 2);
    assert.equal(JSON.stringify(all).includes(password), false);

    const cloneConfig = join(root, "clone-config.json"), cloneDatabase = `${name}_clone`;
    owned.add(cloneDatabase);
    await writeConfig(cloneConfig, { ...c, controlDir: join(root, "clone-control"),
      world: { ...c.world, id: "cloned", database: cloneDatabase, stateDir: join(root, "clone-state"), epoch: 1 } });
    const clone = await composeWorld(cloneConfig);
    clone.runtime.quiesce = async () => undefined;
    clone.runtime.resume = async () => {};
    clone.runtime.hold = async () => {};
    await clone.restore("checkpoint");
    const cloneCatalogue = worldCatalogue(psqlAdmin(databaseUrl(c.database.worker, clone.c.world)), [password]);
    const cloned = await cloneCatalogue.show("cloned");
    assert.equal(cloned.state, "running"); assert.equal(cloned.epoch, 1);
    assert.equal(cloned.parent_world, "composed"); assert.equal(cloned.parent_snapshot, "checkpoint");
    assert.equal(cloned.parent_seq, savedCut.seq);
    assert.equal((await catalogue.show("composed")).epoch, 2, "clone must not mutate its source world");

    stack.runtime.resume = async () => { throw new Error("external resume refused"); };
    await assert.rejects(stack.save("resume-refused"), /external resume refused/);
    const published = JSON.parse(await readFile(join(c.snapshots, "resume-refused", "manifest.json"), "utf8"));
    owned.add(published.database.name);
    assert.equal((await catalogue.snapshots(c.world.id)).length, 1, "failed resume cannot publish successful catalogue save metadata");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const database of owned) await admin(`DROP DATABASE IF EXISTS "${database}"`);
    for (const role of roles.reverse()) await admin(`DROP ROLE ${role}`);
    await rm(root, { recursive: true, force: true });
  }
});
