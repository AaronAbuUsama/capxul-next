import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { psqlAdmin } from "../../../../devnet/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";
import { assertSchema, observeSchema, type Table } from "./schema.ts";

const checks = { "DEVNET.worlds-schema": "worlds", "DEVNET.snapshots-schema": "world_snapshots", "DEVNET.records-schema": "command_records", "DEVNET.record-export": "record-export",
  "DEVNET.world-show": "world-show", "DEVNET.world-show-unknown": "world-show-unknown" } as const;
if (process.argv.includes("--list")) {
  console.log("DEVNET.selected-stack\tguard");
  for (const name of Object.keys(checks)) console.log(`${name}\tcheck`);
} else {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex < 0 ? [] : (process.argv[onlyIndex + 1] ?? "").split(",");
  const selected = Object.entries(checks).filter(([name]) => !only.length || only.some((prefix) => name.startsWith(prefix))) as [string, Table | "record-export" | "world-show" | "world-show-unknown"][];
  const emit = (name: string, ok: boolean, ms: number, detail: string) => console.log(`@check\t${name}\t${ok ? "pass" : "fail"}\t${ms}\t${detail}`);
  let failed = false;
  try {
    assert(selected.length, "no devnet checks selected");
    const configPath = process.env.CAPXUL_WORLD_CONFIG, run = process.env.CAPXUL_EVAL_RUN_DIR, fixture = process.env.CAPXUL_ACCEPTANCE_FIXTURE;
    assert(configPath && run && fixture && process.argv[2], "selected-world inputs are required");
    assert.equal((await stat(configPath)).mode & 0o077, 0, "world configuration must be private");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const parsed = parseRunReceipt(JSON.parse(await readFile(join(run, "receipt.json"), "utf8")));
    assert(parsed.ok, "invalid running receipt");
    const receipt = parsed.value;
    assert.equal(receipt.state, "running");
    assert.deepEqual([receipt.environment.world, receipt.environment.storage, receipt.environment.indexer, receipt.environment.stack], ["slice-zero", "postgres", "ponder", "postgres-ponder-erpnext-v4"]);
    assert.equal(receipt.commit, config.codeVersion); assert.equal(receipt.environment.components.core, config.codeVersion);
    assert.equal(resolve(config.root), process.cwd());
    const f = fixtureFrom(fixture, process.argv[2]!);
    assert.equal(f.world, "slice-zero");
    assert(config.world.sites.some((site: { name: string; company: string }) => site.name === f.site && site.company === f.slug), "fixture does not belong to this concrete world");
    const { stdout } = await promisify(execFile)(process.execPath, [join(config.root, "packages/cli/src/main.ts"), "world", "inspect", "--config", configPath, "--json"], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const live = JSON.parse(stdout);
    assert.equal(live.version, 1); assert.equal(live.world.id, config.world.id); assert.equal(live.world.epoch, config.world.epoch);
    assert.equal(live.codeVersion, config.codeVersion); assert.equal(live.stack, receipt.environment.stack);
    assert.equal(live.core.world, config.world.id); assert.equal(live.core.storage, "postgres"); assert.equal(live.core.indexer, "ponder");
    assert(live.core.ok && !live.core.paused, "Core is not ready");
    assert.equal(live.chain.chainId, config.chainId);
    assert(Math.abs(Date.now() - Date.parse(live.observedAt)) < 15000, "inspection is stale");
    const worker = new URL(config.database.tenant);
    assert.equal(decodeURIComponent(worker.username), "capxul_core");
    assert(["127.0.0.1", "localhost", "[::1]"].includes(worker.hostname), "nonlocal database refused");
    worker.pathname = `/${config.world.database}`;
    const query = psqlAdmin(worker.href);
    const inventory = new URL(config.database.worker);
    assert.equal(decodeURIComponent(inventory.username), "capxul_worker"); assert.equal(inventory.host, worker.host);
    inventory.pathname = worker.pathname;
    const literal = `'${config.world.id.replaceAll("'", "''")}'`;
    const cli = (args: string[]) => promisify(execFile)(process.execPath, [join(config.root, "packages/cli/src/main.ts"), ...args, "--config", configPath, "--json"], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const dir = resolve(run, "devnet"); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "inspection.json"), JSON.stringify(live, null, 2) + "\n");
    emit("DEVNET.selected-stack", true, 0, "private fixture, running receipt and live public inspection identify one selected stack");
    for (const [name, table] of selected) {
      const start = Date.now();
      try {
        if (table === "record-export") {
          // Independent restricted SQL observations, not a catalogue helper or Core's financial record.
          const [source] = await query(`SELECT jsonb_build_object('lineage',jsonb_build_object('parentWorld',parent_world,'parentSnapshot',parent_snapshot,'parentSeq',parent_seq),
            'records',(SELECT jsonb_agg(to_jsonb(r) ORDER BY epoch,seq) FROM app.command_records r WHERE r.world_id=w.world_id))
            FROM app.worlds w WHERE world_id='${config.world.id.replaceAll("'", "''")}'`);
          assert(source && Array.isArray(source.records) && source.records.length > 0, "selected world's catalogue is not populated");
          const output = join(dir, "record-export.jsonl");
          const exported = await promisify(execFile)(process.execPath, [join(config.root, "packages/cli/src/main.ts"), "record", "export",
            "--config", configPath, "--world", config.world.id, "--out", output, "--json"], { timeout: 60000, maxBuffer: 1024 * 1024 });
          const result = JSON.parse(exported.stdout), data = await readFile(output, "utf8");
          assert.equal((await stat(output)).mode & 0o077, 0);
          assert(data.endsWith("\n"), "export is not newline terminated");
          const lines = data.trimEnd().split("\n").map((line) => JSON.parse(line));
          assert.deepEqual(lines[0], source.lineage);
          assert.deepEqual(lines.slice(1), source.records, "export lost, duplicated, reordered or rewrote catalogue entries");
          assert.deepEqual(result, { lines: source.records.length + 1, bytes: Buffer.byteLength(data), lineage: source.lineage });
          await writeFile(join(dir, "record-export-source.json"), JSON.stringify(source, null, 2) + "\n");
          emit(name, true, Date.now() - start, "public CLI export returns exact line/byte counts and lineage for the same-run selected world's actual catalogue");
          continue;
        }
        if (table === "world-show") {
          // Independent restricted reads: the catalogue through capxul_core and the complete company inventory through capxul_worker.
          const [w] = await query(`SELECT jsonb_build_object('world',to_jsonb(w),'head',coalesce((SELECT max(seq) FROM app.command_records r WHERE r.world_id=w.world_id AND r.epoch=w.epoch),0))
            FROM app.worlds w WHERE world_id=${literal}`);
          const workerQuery = psqlAdmin(inventory.href);
          const orgs = await workerQuery("SELECT jsonb_build_object('orgId',org_id,'name',name) FROM app.organizations ORDER BY org_id");
          // app.sites admits one Organization at a time, even to the worker: read each host in that Organization's own scope.
          const lit = (s: unknown) => `'${String(s).replaceAll("'", "''")}'`;
          const hosts = orgs.length ? (await workerQuery(orgs.map((o) => `SELECT jsonb_build_object('scope',set_config('app.org_id',${lit(o.orgId)},false));
            SELECT jsonb_build_object('orgId',org_id,'host',host) FROM app.sites WHERE org_id=${lit(o.orgId)};`).join("\n"))).filter((r) => "host" in r) : [];
          const site = (orgId: unknown) => hosts.find((h) => h.orgId === orgId)?.host ?? null;
          assert(w && orgs.length > 0, "selected world's catalogue or company inventory is not populated");
          const row = w.world as Record<string, unknown>;
          const shown = JSON.parse((await cli(["world", "show", config.world.id])).stdout);
          const expected = { worldId: row.world_id, name: row.name, kind: row.kind, profile: row.profile, address: row.address, state: row.state, clockMode: row.clock_mode,
            rate: row.rate, worldNow: row.world_now, epoch: row.epoch, chainId: row.chain_id, hosted: row.hosted, parentWorld: row.parent_world,
            parentSnapshot: row.parent_snapshot, parentSeq: row.parent_seq,
            companies: orgs.map((o) => ({ orgId: o.orgId, name: o.name, url: site(o.orgId) === null ? null : `http://${site(o.orgId)}:${config.ports.publicBench}` })), recordHead: w.head };
          // The declared WorldView exactly: no extra or missing field, declared enums and JSON types.
          assert.deepEqual(Object.keys(shown).sort(), Object.keys(expected).sort());
          assert(["local", "simulated", "staging", "production"].includes(shown.kind) && ["core", "full"].includes(shown.profile) && ["frozen", "running"].includes(shown.clockMode) &&
            ["creating", "running", "stopped", "restoring", "parked", "closed"].includes(shown.state), "WorldView enum differs");
          for (const key of ["rate", "worldNow", "epoch", "chainId", "recordHead"]) assert(Number.isFinite(shown[key]), `${key} is not a number`);
          assert.deepEqual(shown, expected, "world show differs from the selected world's catalogue or Organizations inventory");
          assert.equal(shown.chainId, config.chainId);
          // Anchor to the same-run live inspection, so a stale catalogue cannot pass by agreeing with itself.
          assert.equal(shown.state, "running", "the inspected live world is not running in its catalogue");
          assert.equal(shown.epoch, live.world.epoch);
          assert.equal(shown.worldNow, live.clock.nowMs, "catalogue worldNow differs from the live authority clock");
          assert.equal(shown.clockMode, live.clock.clockMode === "stopped" ? "frozen" : "running");
          await writeFile(join(dir, "world-show.json"), JSON.stringify({ shown, catalogue: w, inventory: orgs }, null, 2) + "\n");
          emit(name, true, Date.now() - start, "public world show prints exactly the declared WorldView of the same-run selected world's catalogue and complete company inventory");
          continue;
        }
        if (table === "world-show-unknown") {
          const state = `SELECT jsonb_build_object('worlds',(SELECT jsonb_agg(to_jsonb(w) ORDER BY world_id) FROM app.worlds w),
            'records',(SELECT count(*) FROM app.command_records),'head',(SELECT max(real_time) FROM app.command_records))`;
          const [before] = await query(state);
          // A refusal against an empty or foreign catalogue would prove nothing about this world.
          assert(Array.isArray(before?.worlds) && before.worlds.some((w: { world_id?: string }) => w.world_id === config.world.id), "selected world's catalogue row is missing");
          const unknown = config.world.id === "nosuchworld" ? "otherworld" : "nosuchworld";
          assert(!before.worlds.some((w: { world_id?: string }) => w.world_id === unknown), "the unknown name exists in this catalogue");
          const refused = await cli(["world", "show", unknown]).then(() => assert.fail("unknown world was shown"), (e: { code?: number; stdout?: string; stderr?: string }) => e);
          assert.equal(refused.code, 2, "INVALID_INPUT exit code");
          assert.equal(refused.stdout, "");
          const printed = JSON.parse(refused.stderr ?? "");
          assert.deepEqual(Object.keys(printed), ["error"]); assert.deepEqual(Object.keys(printed.error).sort(), ["code", "message"]);
          assert.equal(printed.error.code, "INVALID_INPUT");
          assert.match(printed.error.message, /no such world/, "refused for the selection, not for an absent world");
          const [after] = await query(state);
          assert.deepEqual(after, before, "a refused world show changed the catalogue");
          await writeFile(join(dir, "world-show-unknown.json"), JSON.stringify({ unknown, refusal: printed, before, after }, null, 2) + "\n");
          emit(name, true, Date.now() - start, "world show of an unknown world exits 2 with only {error:{code:INVALID_INPUT,message}} and leaves the same-run catalogue unchanged");
          continue;
        }
        const schema = await observeSchema(query, table);
        await writeFile(join(dir, `${table}-schema.json`), JSON.stringify(schema, null, 2) + "\n");
        assertSchema(table, schema);
        emit(name, true, Date.now() - start, "live restricted-store fields/types/nullability/key/indexes/enums equal the declared catalogue");
      } catch {
        failed = true; emit(name, false, Date.now() - start, "live catalogue observation or public export is missing or differs; see same-run devnet evidence");
      }
    }
  } catch {
    failed = true;
    emit("DEVNET.selected-stack", false, 0, "selected-world prerequisite refused; no component proof or historical receipt accepted");
    for (const [name] of selected) emit(name, false, 0, "no verified selected-world observation in this run");
  }
  process.exitCode = failed ? 1 : 0;
}
