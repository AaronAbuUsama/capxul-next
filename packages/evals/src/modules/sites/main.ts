import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { fixtureFrom, localUrl } from "../acceptance/fixture.ts";
import { cents, frappe } from "../acceptance/sources.ts";
import { redact } from "../runs/service.ts";

const checks = ["SITES.selected-stack", "SITES.create-draft-and-validation", "SITES.member-create-refused",
  "SITES.signed-out-create-refused", "SITES.create-return", "SITES.ordinary-submit", "SITES.submit-return",
  "SITES.report-return", "SITES.invalid-report-refused", "SITES.member-report-refused",
  "SITES.member-submit-refused", "SITES.signed-out-submit-refused", "SITES.signed-out-report-refused", "SITES.submitted-submit-refused"];
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../../../cli/src/main.ts", import.meta.url));

if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const seen = new Set<string>();
  let failures = 0;
  const secrets = Object.entries(process.env).filter(([key]) => /secret|password|private.?key|token|database_url/i.test(key))
    .flatMap(([, value]) => value ? [value] : []);
  const emit = async (name: string, check: () => Promise<void>) => {
    const at = Date.now(); let passed = true, detail = "public operation and independent native read established";
    try { await check(); } catch {
      passed = false; failures++; detail = "public operation, selected-stack prerequisite or independent native assertion failed; inspect sanitized sites evidence";
    }
    seen.add(name);
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Date.now() - at}\t${detail}`);
    return passed;
  };
  try {
    const slug = process.argv[2], runPath = process.env.CAPXUL_EVAL_RUN_DIR, fixturePath = process.env.CAPXUL_ACCEPTANCE_FIXTURE;
    const configPath = process.env.CAPXUL_WORLD_CONFIG, actorsPath = process.env.CAPXUL_SITES_ACTORS;
    assert(slug && runPath && fixturePath && configPath && actorsPath, "selected runtime and actors required");
    const run = resolve(runPath), dir = join(run, "sites");
    const f = fixtureFrom(fixturePath, slug);
    assert(isAbsolute(actorsPath) && relative(realpathSync(run), realpathSync(actorsPath)).startsWith(`..${sep}`),
      "actors must remain outside retained evidence, including through symlinks");
    assert.equal(statSync(actorsPath).mode & 0o777, 0o600);
    const actors = JSON.parse(readFileSync(actorsPath, "utf8"));
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    for (const actor of [actors.director, actors.member]) {
      assert(/^0x[0-9a-fA-F]{64}$/.test(actor.privateKey));
      secrets.push(actor.privateKey, actor.privateKey.slice(2));
      assert.equal(privateKeyToAccount(actor.privateKey as Hex).address.toLowerCase(), actor.address.toLowerCase());
    }
    const coreUrl = localUrl(process.env.CAPXUL_CORE_URL!).origin;
    mkdirSync(dir, { recursive: true });
    const save = (name: string, value: unknown) => writeFileSync(join(dir, name), redact(JSON.stringify(value, null, 2), secrets) + "\n");
    const selected = await emit("SITES.selected-stack", async () => {
      const receipt = JSON.parse(readFileSync(join(run, "receipt.json"), "utf8"));
      assert.equal(receipt.state, "running");
      assert.equal(receipt.environment.world, "slice-zero"); assert.equal(f.world, "slice-zero");
      assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
      assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
      assert.equal(receipt.commit, config.codeVersion);
      assert.equal(receipt.environment.components.core, config.codeVersion);
      assert.equal(actors.version, 1); assert.equal(actors.world.id, config.world.id); assert.equal(actors.world.epoch, config.world.epoch);
      const preparation = JSON.parse(readFileSync(join(run, "preparation.json"), "utf8"));
      assert.equal(preparation.kind, "fixture-preparation-not-journey-proof");
      assert.deepEqual(preparation.run, { id: receipt.id, at: receipt.at, commit: receipt.commit });
      assert.deepEqual(preparation.world, actors.world);
      const phase = preparation.phases.find((entry: any) => entry.name === "restored-world");
      assert.equal(phase?.sourcePath, "preparation/restored-world.json");
      assert(Date.parse(phase.startedAt) >= Date.parse(receipt.at));
      assert(Date.parse(phase.finishedAt) >= Date.parse(phase.startedAt) && Date.parse(phase.finishedAt) <= Date.now());
      const restored = JSON.parse(readFileSync(join(run, phase.sourcePath), "utf8"));
      assert.equal(restored.codeVersion, receipt.commit); assert.equal(restored.stack, receipt.environment.stack);
      assert.equal(restored.world.id, actors.world.id); assert.equal(restored.world.epoch, actors.world.epoch);
      assert.equal(actors.org, slug); assert.equal(actors.site, f.site); assert.equal(actors.director.email, f.user);
      assert.notEqual(actors.member.address.toLowerCase(), actors.director.address.toLowerCase());
      assert.equal(Number(new URL(coreUrl).port), config.ports.publicCore);
      const response = await fetch(new URL("/ready", coreUrl), { signal: AbortSignal.timeout(10000) });
      assert(response.ok, "live Core not ready");
      const ready: any = await response.json();
      assert.equal(ready.world, config.world.id);
      assert.equal(ready.ok, true); assert.equal(ready.paused, false);
      assert.equal(ready.storage, "postgres"); assert.equal(ready.indexer, "ponder");
      const identity = await frappe(f, "/api/method/frappe.auth.get_logged_user");
      assert.equal(identity.message, actors.director.email);
      save("selected.json", { run: receipt.id, commit: receipt.commit, world: actors.world, org: slug, site: f.site,
        epochSource: phase.sourcePath, ready });
    });
    assert(selected, "selected-stack guard failed");
    const command = async (actor: "director" | "member" | "signed-out", args: string[]) => {
      const startedAt = new Date().toISOString();
      let stdout = "", stderr = "", exitCode = 0, signal: string | null = null;
      try {
        const result = await exec(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, ...args, "--org", slug, "--json"],
          { env: { ...process.env, CAPXUL_CORE_URL: coreUrl, CAPXUL_PRIVATE_KEY: actor === "signed-out" ? "" : actors[actor].privateKey }, timeout: 150000 });
        stdout = result.stdout; stderr = result.stderr;
      } catch (error: any) {
        stdout = error.stdout ?? ""; stderr = error.stderr ?? "";
        exitCode = typeof error.code === "number" ? error.code : -1; signal = error.signal ?? null;
      }
      const id = randomUUID();
      writeFileSync(join(dir, `${id}.stdout`), redact(stdout, secrets));
      writeFileSync(join(dir, `${id}.stderr`), redact(stderr, secrets));
      appendFileSync(join(dir, "invocations.jsonl"), JSON.stringify({ actor, startedAt, finishedAt: new Date().toISOString(),
        argv: [process.execPath, "--experimental-strip-types", "--no-warnings", cli, ...args, "--org", slug, "--json"],
        exitCode, signal, stdoutPath: `sites/${id}.stdout`, stderrPath: `sites/${id}.stderr` }) + "\n");
      return { exitCode, signal, stdout, stderr };
    };
    const success = (result: Awaited<ReturnType<typeof command>>) => {
      assert.equal(result.exitCode, 0); assert.equal(result.signal, null); assert.equal(result.stderr, ""); return JSON.parse(result.stdout);
    };
    const refusal = (result: Awaited<ReturnType<typeof command>>, code: string, exit: number) => {
      assert.equal(result.exitCode, exit); assert.equal(result.signal, null); assert.equal(result.stdout, "");
      const value = JSON.parse(result.stderr); assert.deepEqual(Object.keys(value), ["error"]);
      assert.deepEqual(Object.keys(value.error).sort(), ["code", "message"]); assert.equal(value.error.code, code); assert(value.error.message);
    };
    const resource = async (type: string, name: string) => (await frappe(f, `/api/resource/${encodeURIComponent(type)}/${encodeURIComponent(name)}`)).data;
    const list = async (type: string, filters: unknown, fields: string[]) => {
      const result = await frappe(f, `/api/resource/${encodeURIComponent(type)}`, { filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: "1000" });
      assert(result.data.length < 1000, "source list truncated"); return result.data;
    };
    const prefix = `sites-${randomUUID()}`, callId = `${prefix}-supplier`;
    let supplier: any, submitted: any, invoice: any;
    const created = await emit("SITES.create-draft-and-validation", async () => {
      supplier = success(await command("director", ["doc", "create", "Supplier", "--field", `supplier_name=${prefix}`, "--call-id", callId]));
      const native = await resource("Supplier", supplier.name);
      assert.equal(supplier.docstatus, 0); assert.equal(native.docstatus, 0); assert.equal(native.supplier_name, prefix);
      const read = success(await command("director", ["doc", "get", "Supplier", supplier.name]));
      assert.equal(read.docstatus, 0); assert.equal(read.fields.supplier_name, prefix); assert.equal(read.name, supplier.name);
      const repeated = success(await command("director", ["doc", "create", "Supplier", "--field", `supplier_name=${prefix}`, "--call-id", callId]));
      assert.deepEqual(repeated, supplier); assert.equal((await list("Supplier", { supplier_name: prefix }, ["name"])).length, 1);
      refusal(await command("director", ["doc", "create", "Supplier", "--data", JSON.stringify({ supplier_name: `${prefix}-bad`, supplier_group: `${prefix}-absent` }),
        "--call-id", `${prefix}-invalid`]), "INVALID_INPUT", 2);
      assert.deepEqual(await list("Supplier", { supplier_name: `${prefix}-bad` }, ["name"]), []);
      save("created.json", { output: supplier, source: native });
    });
    await emit("SITES.member-create-refused", async () => {
      refusal(await command("member", ["doc", "create", "Supplier", "--field", `supplier_name=${prefix}-denied`, "--call-id", `${prefix}-member`]), "ROLE_PERMISSION_DENIED", 4);
      assert.deepEqual(await list("Supplier", { supplier_name: `${prefix}-denied` }, ["name"]), []);
    });
    await emit("SITES.signed-out-create-refused", async () => {
      refusal(await command("signed-out", ["doc", "create", "Supplier", "--field", `supplier_name=${prefix}-guest`]), "NOT_AUTHENTICATED", 3);
      assert.deepEqual(await list("Supplier", { supplier_name: `${prefix}-guest` }, ["name"]), []);
    });
    await emit("SITES.create-return", async () => {
      assert(created); assert.deepEqual(Object.keys(supplier).sort(), ["docstatus", "doctype", "fields", "name"]);
      assert.equal(supplier.doctype, "Supplier"); assert.equal(supplier.docstatus, 0); assert.equal(typeof supplier.name, "string"); assert(supplier.fields && typeof supplier.fields === "object");
    });
    const posted = await emit("SITES.ordinary-submit", async () => {
      assert(created);
      const template = await resource("Purchase Invoice", f.invoice); assert(template.items[0].item_code);
      invoice = success(await command("director", ["doc", "create", "Purchase Invoice", "--call-id", `${prefix}-invoice`, "--data",
        JSON.stringify({ supplier: supplier.name, company: f.company, items: [{ item_code: template.items[0].item_code, qty: 2, rate: 1.37 }] })]));
      assert.equal(invoice.docstatus, 0); assert.deepEqual(await list("GL Entry", { voucher_no: invoice.name }, ["name"]), []);
      submitted = success(await command("director", ["doc", "submit", "Purchase Invoice", invoice.name, "--call-id", `${prefix}-submit`]));
      const native = await resource("Purchase Invoice", invoice.name); assert.equal(native.docstatus, 1); assert.equal(cents(native.grand_total), 274n);
      const gl = await list("GL Entry", { voucher_no: invoice.name, is_cancelled: 0 }, ["name", "account", "debit", "credit", "voucher_no"]);
      assert(gl.length >= 2); assert.equal(gl.reduce((s: bigint, row: any) => s + cents(row.debit), 0n), 274n);
      assert.equal(gl.reduce((s: bigint, row: any) => s + cents(row.credit), 0n), 274n);
      const ledgerReport = success(await command("director", ["report", "run", "General Ledger", "--filters",
        JSON.stringify({ company: f.company, from_date: native.posting_date, to_date: native.posting_date, voucher_no: invoice.name })]));
      const reported = ledgerReport.rows.filter((row: any) => row.voucher_no === invoice.name);
      assert.equal(reported.length, gl.length);
      assert.equal(reported.reduce((s: bigint, row: any) => s + cents(row.debit), 0n), 274n);
      assert.equal(reported.reduce((s: bigint, row: any) => s + cents(row.credit), 0n), 274n);
      assert.deepEqual(success(await command("director", ["doc", "submit", "Purchase Invoice", invoice.name, "--call-id", `${prefix}-submit`])), submitted);
      assert.deepEqual(await list("GL Entry", { voucher_no: invoice.name, is_cancelled: 0 }, ["name", "account", "debit", "credit", "voucher_no"]), gl);
      save("submitted.json", { output: submitted, source: native, gl, publicReport: ledgerReport });
    });
    await emit("SITES.submit-return", async () => {
      assert(posted); assert.deepEqual(Object.keys(submitted).sort(), ["docstatus", "doctype", "fields", "name"]);
      assert.equal(submitted.doctype, "Purchase Invoice"); assert.equal(submitted.name, invoice.name); assert.equal(submitted.docstatus, 1);
    });
    await emit("SITES.report-return", async () => {
      const source = await resource("Purchase Invoice", f.invoice);
      const filters = { company: f.company, from_date: source.posting_date, to_date: source.posting_date, voucher_no: f.invoice };
      const report = success(await command("director", ["report", "run", "General Ledger", "--filters", JSON.stringify(filters)]));
      assert.deepEqual(Object.keys(report).sort(), ["columns", "rows"]); assert(Array.isArray(report.columns) && report.columns.length);
      assert(Array.isArray(report.rows) && report.rows.length); assert(report.rows.every((row: any) => row && typeof row === "object" && !Array.isArray(row)));
      assert(report.rows.some((row: any) => row.voucher_no === f.invoice)); save("report.json", report);
    });
    await emit("SITES.invalid-report-refused", async () => {
      const before = await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]);
      refusal(await command("director", ["report", "run", `${prefix}-missing`]), "INVALID_INPUT", 2);
      assert.deepEqual(await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]), before);
    });
    await emit("SITES.member-report-refused", async () => {
      const before = await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]);
      refusal(await command("member", ["report", "run", "General Ledger", "--filters", JSON.stringify({ company: f.company })]), "ROLE_PERMISSION_DENIED", 4);
      assert.deepEqual(await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]), before);
    });
    for (const actor of ["member", "signed-out"] as const) await emit(`SITES.${actor}-submit-refused`, async () => {
      const before = await resource("Purchase Invoice", f.invoice);
      const gl = await list("GL Entry", { voucher_no: f.invoice }, ["name", "debit", "credit"]);
      refusal(await command(actor, ["doc", "submit", "Purchase Invoice", f.invoice, "--call-id", `${prefix}-${actor}-submit`]),
        actor === "member" ? "ROLE_PERMISSION_DENIED" : "NOT_AUTHENTICATED", actor === "member" ? 4 : 3);
      assert.deepEqual(await resource("Purchase Invoice", f.invoice), before);
      assert.deepEqual(await list("GL Entry", { voucher_no: f.invoice }, ["name", "debit", "credit"]), gl);
    });
    await emit("SITES.signed-out-report-refused", async () => {
      const gl = await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]);
      refusal(await command("signed-out", ["report", "run", "General Ledger"]), "NOT_AUTHENTICATED", 3);
      assert.deepEqual(await list("GL Entry", { company: f.company }, ["name", "debit", "credit"]), gl);
    });
    await emit("SITES.submitted-submit-refused", async () => {
      assert(posted);
      const before = await resource("Purchase Invoice", invoice.name);
      const gl = await list("GL Entry", { voucher_no: invoice.name }, ["name", "debit", "credit"]);
      refusal(await command("director", ["doc", "submit", "Purchase Invoice", invoice.name, "--call-id", `${prefix}-second-submit`]), "WRONG_STATE", 2);
      assert.deepEqual(await resource("Purchase Invoice", invoice.name), before);
      assert.deepEqual(await list("GL Entry", { voucher_no: invoice.name }, ["name", "debit", "credit"]), gl);
    });
  } catch { /* Every omitted claim below explicitly fails; setup cannot print scoring lines. */ }
  for (const name of checks.filter((name) => !seen.has(name))) await emit(name, async () => { throw new Error("selected runtime or public operation did not run"); });
  process.exitCode = failures ? 1 : 0;
}
