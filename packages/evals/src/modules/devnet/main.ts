import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { psqlAdmin } from "../../../../devnet/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";
import { assertSchema, observeSchema, type Table } from "./schema.ts";

const checks = { "DEVNET.worlds-schema": "worlds", "DEVNET.snapshots-schema": "world_snapshots", "DEVNET.records-schema": "command_records" } as const;
if (process.argv.includes("--list")) {
  console.log("DEVNET.selected-stack\tguard");
  for (const name of Object.keys(checks)) console.log(`${name}\tcheck`);
} else {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex < 0 ? [] : (process.argv[onlyIndex + 1] ?? "").split(",");
  const selected = Object.entries(checks).filter(([name]) => !only.length || only.some((prefix) => name.startsWith(prefix))) as [string, Table][];
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
    const dir = resolve(run, "devnet"); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "inspection.json"), JSON.stringify(live, null, 2) + "\n");
    emit("DEVNET.selected-stack", true, 0, "private fixture, running receipt and live public inspection identify one selected stack");
    for (const [name, table] of selected) {
      const start = Date.now();
      try {
        const schema = await observeSchema(query, table);
        await writeFile(join(dir, `${table}-schema.json`), JSON.stringify(schema, null, 2) + "\n");
        assertSchema(table, schema);
        emit(name, true, Date.now() - start, "live restricted-store fields/types/nullability/key/indexes/enums equal the declared catalogue");
      } catch {
        failed = true; emit(name, false, Date.now() - start, "live catalogue schema is missing or differs; see same-run devnet schema observation");
      }
    }
  } catch {
    failed = true;
    emit("DEVNET.selected-stack", false, 0, "selected-world prerequisite refused; no component proof or historical receipt accepted");
    for (const [name] of selected) emit(name, false, 0, "no verified selected-world observation in this run");
  }
  process.exitCode = failed ? 1 : 0;
}
