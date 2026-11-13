import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/platform/db.ts";
import { fixtureFrom, localUrl, sessionCookie } from "../acceptance/fixture.ts";

/** Receipt-first, selected live stack only. Never migrates, provisions, restores or uses admin. */
export async function selected(slug: string, concept: "books" | "budgets") {
  const runDir = process.env.CAPXUL_EVAL_RUN_DIR, configPath = process.env.CAPXUL_WORLD_CONFIG;
  const fixturePath = process.env.CAPXUL_ACCEPTANCE_FIXTURE;
  assert(runDir && configPath && fixturePath, "requires running receipt and selected private world/fixture paths");
  assert.equal(statSync(configPath).mode & 0o077, 0, "private world config permissions");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert(["local", "simulated"].includes(config.world.kind), "only disposable local/simulated worlds");
  const fixture = fixtureFrom(fixturePath, slug);
  const parsed = parseRunReceipt(JSON.parse(readFileSync(join(runDir, "receipt.json"), "utf8")));
  assert(parsed.ok, "valid receipt required");
  const receipt = parsed.value;
  assert.equal(receipt.state, "running"); assert.equal(basename(resolve(runDir)), receipt.id);
  assert.equal(receipt.environment.world, "slice-zero"); assert.equal(fixture.world, "slice-zero");
  assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
  assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(receipt.commit, commit); assert.equal(config.codeVersion, commit);
  const selection = JSON.parse(execFileSync("pnpm", ["--silent", "blueprint:slices", "--journey", "thin_line", "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
  const required = selection.slices.find((s: { id: string }) => s.id === "slice-0")?.required;
  assert(Array.isArray(required) && required.length > 0, "dynamic full selection is required");
  assert.deepEqual([...receipt.requested].sort(), [...required].sort(), "component receipts cannot score this full-gate runner");
  assert(config.world.sites.some((s: { company: string; name: string }) => s.company === slug && s.name === fixture.site));
  for (const [key, role] of [["tenant", "capxul_core"], ["worker", "capxul_worker"]] as const) {
    const url = new URL(config.database[key]);
    assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(decodeURIComponent(url.username), role);
    url.pathname = `/${config.world.database}`;
    config.database[key] = url.href;
  }
  const inspect = JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "inspect", "--config", resolve(configPath), "--json"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
  assert.equal(inspect.codeVersion, commit); assert.equal(inspect.stack, receipt.environment.stack);
  assert.equal(inspect.world.id, config.world.id); assert.equal(inspect.world.epoch, config.world.epoch);
  assert.equal(inspect.core.storage, "postgres"); assert.equal(inspect.core.indexer, "ponder"); assert(inspect.core.ok);
  const ready = await fetch(new URL("/ready", localUrl(fixture.coreUrl)), { signal: AbortSignal.timeout(5000) });
  assert(ready.ok, "live Core/Ponder readiness");
  const identity = await ready.json() as { world: string; storage: string; indexer: string };
  assert.equal(identity.world, config.world.id); assert.equal(identity.storage, "postgres"); assert.equal(identity.indexer, "ponder");
  const who = await fetch(new URL("/api/method/frappe.auth.get_logged_user", localUrl(fixture.frappeUrl)), {
    headers: { "x-frappe-site-name": fixture.site, cookie: `sid=${sessionCookie(fixture.cookieJar)}` }, signal: AbortSignal.timeout(5000),
  });
  assert(who.ok, "actual post-restore native user session");
  assert.equal((await who.json() as { message: string }).message, fixture.user);
  const db = new Database(config.database.tenant, config.database.worker);
  const directory = join(runDir, concept); mkdirSync(directory, { recursive: true });
  const save = (name: string, value: unknown) => writeFileSync(join(directory, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  try {
    const world = (await db.worker.query("select world_id,epoch from app.world")).rows[0]!;
    assert.equal(world.world_id, config.world.id); assert.equal(Number(world.epoch), config.world.epoch);
    const role = (await db.tenant.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0]!;
    assert.equal(role.name, "capxul_core"); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    save("selected", { run: { id: receipt.id, at: receipt.at, commit }, world, role, stack: receipt.environment.stack });
    return { db, fixture, config, receipt, save };
  } catch (error) { await db.close(); throw error; }
}

/** A failed prerequisite becomes explicit failure for every selected check, never a skip. */
export async function runChecks(names: readonly string[], checks: (emit: (name: string, action: () => Promise<void>) => Promise<void>) => Promise<void>) {
  const onlyAt = process.argv.indexOf("--only");
  const prefixes = onlyAt < 0 ? [] : (process.argv[onlyAt + 1] ?? "").split(",");
  const wanted = names.filter((name) => !prefixes.length || prefixes.some((prefix) => name.startsWith(prefix)));
  assert(wanted.length, "no known checks selected");
  const seen = new Set<string>(); let failed = false;
  const emit = async (name: string, action: () => Promise<void>) => {
    if (!wanted.includes(name)) return;
    const start = Date.now(); let passed = true;
    try { await action(); } catch { passed = false; failed = true; }
    seen.add(name);
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Date.now() - start}\t${passed ? "independent persisted assertion retained" : "assertion or selected-stack prerequisite failed; no substitute proof"}`);
  };
  try { await checks(emit); } catch { failed = true; }
  for (const name of wanted.filter((n) => !seen.has(n))) await emit(name, async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}

// Budgets shares these selected-stack assertions through this door only.
export { assertSchema } from "./schema.ts";
export { assertWriters } from "./source.ts";
export { tenancy } from "./tenancy.ts";
