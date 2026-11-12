import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseRunReceipt, parseStatus, type EvalStatus, type RunEnvironment } from "../../../blueprint-engine/src/index.ts";
import { sitesEnvironment } from "./fixture.ts";
import { command } from "./processes.ts";
import { runtimeEnv } from "./service.ts";
import { databaseUrl, type Config } from "./supervisor.ts";

/** A summary alone cannot turn an old scoreboard, wrong stack or missing screens into slice acceptance. */
export async function verifyRun(root: string, summary: any, required: string[], environment: RunEnvironment, started: number) {
  assert.equal(summary.version, 1);
  assert.equal(summary.runDir, `status/runs/${summary.run}`);
  assert(/^[-a-zA-Z0-9]+$/.test(summary.run));
  const directory = resolve(root, summary.runDir);
  const raw = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"));
  const parsed = parseRunReceipt(raw);
  assert(parsed.ok, "invalid eval run receipt");
  const receipt = parsed.value;
  assert.equal(receipt.id, summary.run); assert.equal(receipt.state, summary.state);
  assert.equal(typeof summary.passed, "boolean");
  assert(Date.parse(receipt.at) >= started, "receipt predates this invocation");
  assert.deepEqual(receipt.environment, environment);
  assert.equal(receipt.commit, environment.components.core, "receipt commit differs from running Core");
  assert.deepEqual([...receipt.requested].sort(), [...required].sort());
  const status = parseStatus(JSON.parse(await readFile(join(directory, "status.json"), "utf8")));
  assert(status.ok, "invalid same-run status");
  for (const id of required) {
    const verdict: EvalStatus | undefined = status.value.evals[id];
    assert(verdict && verdict.run === receipt.id && verdict.at === receipt.at && verdict.commit === receipt.commit, "verdict is not fresh from this run");
    const contract = receipt.evals.find((entry) => entry.id === id)!;
    assert.equal(verdict.claim, contract.claim); assert.equal(verdict.observes, contract.observes);
    if (summary.passed) assert.equal(verdict.verdict, "pass");
  }
  if (!summary.passed) return false;
  assert.equal(receipt.state, "complete"); assert.equal(summary.exitCode, 0);
  assert.equal(summary.counts.pass, required.length); assert.equal(summary.counts.fail, 0); assert.equal(summary.counts.not_run, 0);
  assert(raw.prepare && Array.isArray(raw.prepare.argv) && raw.prepare.argv.length && raw.prepare.exitCode === 0 && raw.prepare.signal === null,
    "successful receipt-first preparation is missing");
  assert.equal(raw.prepare.log, "prepare.log");
  assert((await stat(join(directory, raw.prepare.log))).size > 0, "preparation log missing/empty");
  const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"));
  assert.deepEqual(preparation.run, { id: receipt.id, at: receipt.at, commit: receipt.commit }, "preparation belongs to another run");
  for (const screen of ["supplier-invoice", "payment-entry", "general-ledger", "trial-balance"]) {
    const captures = receipt.screens.filter((entry) => entry.screen === screen && entry.assertion === "source-equality");
    assert(captures.length, `same-run ${screen} source-equality evidence missing`);
    for (const capture of captures) {
      assert(!isAbsolute(capture.source) && resolve(directory, capture.source).startsWith(`${directory}/`) && !/[:\\]/.test(capture.source), "screen source must belong to this run");
      assert((await stat(join(directory, capture.path))).size > 0, "screen evidence missing/empty");
      assert((await stat(join(directory, capture.source))).size > 0, "screen source evidence missing/empty");
    }
  }
  return true;
}

export async function runGate(c: Config, slug: string, token: string, configFile: string) {
  const slices = JSON.parse(await command(["pnpm", "--silent", "blueprint:slices", "--journey", "thin_line", "--json"], c.root));
  const required = slices.slices?.find((s: any) => s.id === "slice-0")?.required;
  if (!Array.isArray(required) || !required.length || new Set(required).size !== required.length || required.some((id) => typeof id !== "string")) throw new Error("full computed slice-0.required is missing or invalid");
  const pins = JSON.parse(await readFile(join(c.root, "packages/bench-image/apps.lock.json"), "utf8"));
  const indexer = JSON.parse(await readFile(join(c.root, "packages/indexer/package.json"), "utf8"));
  const environment: RunEnvironment = { world: "slice-zero", stack: "postgres-ponder-erpnext-v4", storage: "postgres", indexer: "ponder", chainId: c.chainId,
    databaseSchemaVersion: "1", components: { core: c.codeVersion, postgres: "17", ponder: indexer.dependencies.ponder,
      frappe: pins.frappe.commit, erpnext: pins.apps.find((app: any) => app.name === "erpnext").commit, contracts: c.codeVersion } };
  const metadata = join(c.controlDir, "environment.json");
  await writeFile(metadata, JSON.stringify(environment), { mode: 0o600 });
  const prepare = join(c.controlDir, "prepare-argv.json"), fixture = join(c.controlDir, "acceptance.json");
  await writeFile(prepare, JSON.stringify([process.execPath, "--experimental-strip-types", "--no-warnings", join(c.root, "packages/cli/src/main.ts"),
    "world", "prepare", slug, "--config", resolve(configFile), "--json"]), { mode: 0o600 });
  const started = Date.now();
  let stdout: string;
  try {
    stdout = await command(["pnpm", "--silent", "evals", "--", ...required, "--world", "slice-zero", "--slug", slug, "--environment", metadata, "--prepare", prepare, "--json"], c.root,
      { ...runtimeEnv(c, "anvil"), ...sitesEnvironment(c), CAPXUL_STORAGE_EVAL_DATABASE: databaseUrl(c.database.tenant, c.world),
        CAPXUL_SECRET: c.secret, CAPXUL_ACCEPTANCE_FIXTURE: fixture, CAPXUL_WORLD_CONFIG: resolve(configFile), CAPXUL_WORLD_RUN_TOKEN: token });
  } catch (error: any) {
    // Exit 1 is a truthful failed/not_run attempt and still has a JSON receipt pointer. Preflight errors do not.
    if (typeof error.cause?.stdout !== "string" || !error.cause.stdout.trim()) throw error;
    stdout = error.cause.stdout;
  }
  const summary = JSON.parse(stdout);
  const passed = await verifyRun(c.root, summary, required, environment, started);
  console.log(JSON.stringify(summary));
  return passed ? 0 : 1;
}
