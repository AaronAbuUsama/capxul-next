import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("run.sh", import.meta.url).pathname;
const names = ["PLUGS.selected-stack", "PLUGS.native-release-map", "PLUGS.native-site", "PLUGS.saved-answers"];
test("selected Plugs lists without credentials and refuses missing/finalized/foreign receipts without leaking inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "plugs-runner-"));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CAPXUL_EVAL_RUN_DIR: dir,
    CAPXUL_WORLD_CONFIG: join(dir, "private-config.json"), CAPXUL_ACCEPTANCE_FIXTURE: join(dir, "fixture.json") };
  try {
    // Simulate only the external inspection boundary; never connect to a database/native service.
    const marker = join(dir, "inspected");
    writeFileSync(join(dir, "pnpm"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
    const list = spawnSync("bash", [script, "--list"], { encoding: "utf8", env, timeout: 20_000 });
    assert.equal(list.status, 0); assert.equal(list.stderr, "");
    assert.deepEqual(list.stdout.trim().split("\n"), names.map((name) => `${name}\tcheck`));
    const receipt = { version: 1, id: "plugs-runner-test", state: "running",
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), at: "2026-01-01T00:00:00Z",
      environment: { world: "slice-zero", stack: "postgres-ponder-erpnext-v4", storage: "postgres", indexer: "ponder", components: {} },
      requested: [], evals: [], scripts: [], screens: [] };
    const ports = { anvil: 21101, ponder: 21102, core: 21103, siteService: 21104, bench: 21105, socket: 21106,
      publicCore: 21107, publicRpc: 21108, publicBench: 21109, publicBundler: 21110 };
    writeFileSync(env.CAPXUL_WORLD_CONFIG, JSON.stringify({ version: 1, root: dir, controlDir: join(dir, "control"), snapshots: join(dir, "snapshots"),
      codeVersion: receipt.commit, world: { id: "probe1", kind: "local", epoch: 2, database: "probe1", stateDir: join(dir, "world") }, ports,
      database: Object.fromEntries([["admin", "admin"], ["tenant", "capxul_core"], ["worker", "capxul_worker"], ["ponder", "capxul_ponder"]]
        .map(([key, role]) => [key, `postgresql://${role}:DO_NOT_EXPORT_CONFIG_SECRET@127.0.0.1:21111/postgres`])),
      secret: "DO_NOT_EXPORT_CONFIG_SECRET", siteToken: "DO_NOT_EXPORT_CONFIG_SECRET", finality: 0, chainId: 84532,
    }), { mode: 0o600 });
    writeFileSync(env.CAPXUL_ACCEPTANCE_FIXTURE, JSON.stringify({ version: 1, disposable: true, world: "slice-zero", slug: "test-company",
      site: "probe1.localhost", cookieJar: "unused", user: "DO_NOT_EXPORT_PRIVATE_USER", company: "Company", supplier: "Supplier",
      invoice: "PI-17", paymentEntry: "PE-29", safeAccount: "Safe", safe: "0x" + "1".repeat(40), token: "0x" + "2".repeat(40),
      txHash: "0x" + "3".repeat(64), amountAtomic: "1230000", coreUrl: "http://127.0.0.1:21107", rpcUrl: "http://127.0.0.1:21108",
      frappeUrl: "http://127.0.0.1:21109", load: ["unused"], faults: Object.fromEntries(
        ["indexer_unready", "delivery_stuck", "money_event_parked"].map((key) => [key, { seed: ["unused"], repair: ["unused"] }])) }));
    for (const bad of [undefined, { ...receipt, state: "incomplete" }, { ...receipt, state: "complete", finishedAt: receipt.at },
      { ...receipt, commit: "wrong-build" }, { ...receipt, environment: { ...receipt.environment, world: "main" } },
      { ...receipt, at: "2999-01-01T00:00:00Z" }, { ...receipt, environment: { ...receipt.environment, storage: "json" } }]) {
      if (bad) writeFileSync(join(dir, "receipt.json"), JSON.stringify(bad));
      const result = spawnSync("bash", [script, "test-company"], { encoding: "utf8", env, timeout: 20_000 });
      assert.equal(result.status, 1); assert.equal(result.stderr, "");
      const rows = result.stdout.trim().split("\n").map((line) => line.split("\t"));
      assert.deepEqual(rows.map((row) => [row[0], row[1], row[2]]), names.map((name) => ["@check", name, "fail"]));
      assert(!result.stdout.includes("DO_NOT_EXPORT")); assert(!result.stdout.includes(dir));
      assert.equal(existsSync(marker), false, "a refused receipt must not reach external world inspection");
    }
    writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt));
    const valid = spawnSync("bash", [script, "test-company"], { encoding: "utf8", env, timeout: 20_000 });
    assert.equal(valid.status, 1); assert.equal(valid.stderr, "");
    assert.equal(existsSync(marker), true, "a valid running receipt must reach inspection, not an unconditional failure");
    assert(!valid.stdout.includes("DO_NOT_EXPORT"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
