import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Database } from "@capxul/backend/devnet";
import { migrateSites } from "@capxul/site-service";
import { psqlAdmin } from "./door.ts";
import { migrateCatalogue, worldCatalogue, type Command, type WorldRow } from "./catalogue.ts";
import { writeConfig, type Config } from "./supervisor.ts";

const maintenance = process.env.WORLD_SNAPSHOT_PG;
test("native world show reads stopped catalogue facts and Organizations' complete company inventory", { skip: !maintenance }, async () => {
  const database = `test_catalogue_${randomUUID().replaceAll("-", "")}`;
  const maintenanceQuery = psqlAdmin(maintenance!);
  const url = new URL(maintenance!); url.pathname = `/${database}`;
  const admin = psqlAdmin(url.href);
  const password = randomUUID().replaceAll("-", "");
  const restricted = (role: string) => { const u = new URL(url.href); u.username = role; u.password = password; return u.href; };
  const roles = ["capxul_core", "capxul_worker", "capxul_ponder"];
  const existing = new Set((await maintenanceQuery(`SELECT to_jsonb(rolname) FROM pg_roles WHERE rolname IN ('capxul_core','capxul_worker','capxul_ponder')`)) as unknown as string[]);
  const directory = await mkdtemp(join(tmpdir(), "world-show-cli-"));
  const now = Date.parse("2026-03-02T09:00:00Z");
  try {
    await maintenanceQuery(`CREATE DATABASE "${database}"`);
    // The real foundation, Organizations and Sites migrations, never a hand-made organizations or sites table.
    const migrated = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../../../backend/src/migrate.ts", import.meta.url))], { encoding: "utf8", timeout: 60000,
      env: { ...process.env, PG_ADMIN_URL: url.href, DATABASE_URL: restricted("capxul_core"), WORKER_DATABASE_URL: restricted("capxul_worker"), PONDER_DATABASE_URL: restricted("capxul_ponder"), CAPXUL_WORLD: "town1" } });
    assert.equal(migrated.status, 0, migrated.stderr);
    const pools = new Database(url.href, url.href), privileged = await pools.worker.connect();
    try { await migrateSites(privileged); } finally { privileged.release(); await pools.close(); }
    await migrateCatalogue(admin);
    const query = (sql: string) => admin(`SET ROLE capxul_worker; ${sql}`);
    const store = worldCatalogue(query, []);
    const base: WorldRow = { world_id: "town1", name: "Harbour Line", kind: "simulated", profile: "full", address: "http://core-town1.localhost",
      template: null, chain_id: 84532, chain_instance: "anvil-town1", clock_mode: "frozen", rate: 4, world_now: now, epoch: 1,
      parent_world: null, parent_snapshot: null, parent_seq: null, hosted: false, state: "creating", created_at: now, updated_at: now };
    const command: Command = { trace: randomUUID(), command: "world create", worldTime: now, outcome: "ok", surface: "cli" };
    await store.create(base, command);
    await store.transition("town1", "start", { ...command, command: "world start" });
    for (let i = 0; i < 3; i++) await store.append("town1", { ...command, trace: `trace-${i}`, command: "payment send" });
    await store.transition("town1", "stop", { ...command, command: "world stop" });
    // A restored clone's lineage is stored on its own row; this projects it, it does not prove a composed restore.
    await store.create({ ...base, world_id: "town3", name: "town3", parent_world: "town1", parent_snapshot: "m3", parent_seq: 5, world_now: now + 60000 }, command);
    // Harbour Line's Party is released and Core Only has no site: the inventory still lists both.
    const companyRows: [string, string, string, string | null][] = [["harbourline", "Harbour Line Trading", "released", "harbourline-town1.localhost"],
      ["acore", "Core Only Ltd", "active", null], ["zeta", "Zeta Works", "active", "zeta-town1.localhost"]];
    for (const [i, [org, name, state, host]] of companyRows.entries()) {
      const safe = `0x${(0xa0 + i).toString(16).padStart(40, "0")}`, founder = `0x${(0xf0 + i).toString(16).padStart(40, "0")}`;
      await admin(`INSERT INTO app.parties(party_id,kind,state,handle,safe_address,owner_kind,owner_id,created_at,updated_at) VALUES
        ('party_${org}','organization','${state}',${state === "released" ? "NULL" : `'${org}'`},'${safe}','organization','${org}',1,1),
        ('founder_${org}','person','active',NULL,'${founder}','person','founder_${org}',1,1);
        INSERT INTO app.organizations(org_id,party_id,name,country,chain_id,safe_address,founder_party_id,founder_safe,seat_limit,abbr,default_currency,time_zone,fiscal_year_start,created_at,updated_at)
        VALUES ('${org}','party_${org}','${name}','GB',84532,'${safe}','founder_${org}','${founder}',3,'AC','GBP','Europe/London','01-01',1,1)`);
      if (host) await admin(`INSERT INTO app.sites(org_id,site_id,world_id,slug,host,state,bench,created_at,updated_at)
        VALUES ('${org}','${org}','town1','${org}','${host}','ready','bench-town1',1,1)`);
    }

    const configFile = join(directory, "world.json");
    const config: Config = { version: 1, root: directory, controlDir: join(directory, "control"), snapshots: join(directory, "snapshots"), codeVersion: "no-running-build",
      // Config sites deliberately disagree with the inventory: they must not invent company identity.
      world: { id: "town1", kind: "local", database, stateDir: join(directory, "state"), sites: [{ company: "invented", name: "invented-town1.localhost" }], epoch: 1 },
      database: { admin: maintenance!, tenant: restricted("capxul_core"), worker: restricted("capxul_worker"), ponder: restricted("capxul_ponder") },
      ports: { anvil: 20100, ponder: 20101, core: 20102, siteService: 20103, bench: 20104, socket: 20105, publicCore: 20106, publicRpc: 20107, publicBench: 20108, publicBundler: 20109 },
      secret: "private-core-secret", siteToken: "private-site-token", finality: 0, chainId: 84532,
      bench: { composeArgs: [], env: {}, dbPassword: "private-db-secret", adminPassword: "private-admin-secret", baseDomain: "localhost" } };
    await writeConfig(configFile, config);
    // Stopped world, no running process or build, and another operation holds the mutation lock.
    await mkdir(join(config.controlDir, ".operation"), { recursive: true });
    const cli = (args: string[], status = 0) => {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../../../cli/src/main.ts", import.meta.url)), ...args, "--config", configFile, "--json"], { encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, status, result.stderr);
      return JSON.parse(status === 0 ? result.stdout : result.stderr);
    };
    const companies = [
      { orgId: "acore", name: "Core Only Ltd", url: null },
      { orgId: "harbourline", name: "Harbour Line Trading", url: "http://harbourline-town1.localhost:20108" },
      { orgId: "zeta", name: "Zeta Works", url: "http://zeta-town1.localhost:20108" },
    ];
    const expected = { worldId: "town1", name: "Harbour Line", kind: "simulated", profile: "full", address: "http://core-town1.localhost", state: "stopped",
      clockMode: "frozen", rate: 4, worldNow: now, epoch: 1, chainId: 84532, hosted: false, parentWorld: null, parentSnapshot: null, parentSeq: null, companies, recordHead: 6 };
    for (const args of [["world", "show"], ["world", "show", "town1"], ["world", "show", "--world", "town1"]]) assert.deepEqual(cli(args), expected);
    assert.equal((await store.records("town1", { includeAbandoned: true })).length, 6, "show must not append command entries");
    await stat(join(config.controlDir, ".operation"));
    for (const args of [["world", "show", "tow"], ["world", "show", "--world", "town2"], ["world", "show", "town1", "--world", "tow"]]) assert.match(cli(args, 2).error.message, /^INVALID_INPUT: no such world/);
    // A world that exists in this catalogue but is not the configured one is a selection refusal, not "no such world".
    assert.match(cli(["world", "show", "town3"], 2).error.message, /^INVALID_INPUT: world is not the one the private config selects/);
    for (const args of [["world", "show", "--epoch", "1"], ["world", "show", "--world"], ["world", "show", "town1", "extra"]]) assert.equal(cli(args, 2).error.code, "CLI_USAGE");
    await writeConfig(configFile, { ...config, world: { ...config.world, id: "absent" } });
    assert.equal(cli(["world", "show"], 2).error.code, "INVALID_INPUT");
    await writeConfig(configFile, { ...config, world: { ...config.world, id: "town3" } });
    assert.deepEqual(cli(["world", "show", "town3"]), { ...expected, worldId: "town3", name: "town3", state: "creating", worldNow: now + 60000,
      parentWorld: "town1", parentSnapshot: "m3", parentSeq: 5, recordHead: 1 });
  } finally {
    await maintenanceQuery(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    for (const role of roles) if (!existing.has(role)) await maintenanceQuery(`DROP ROLE IF EXISTS "${role}"`);
    await rm(directory, { recursive: true, force: true });
  }
});
