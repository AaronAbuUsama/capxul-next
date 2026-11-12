import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseRunReceipt } from "../../../blueprint-engine/src/index.ts";
import type { composeWorld } from "./composition.ts";
import { acceptanceFixture, bench, fixturePath, persistFixture, preparePayment, provisionFixture, requirePaymentSlot, settledPayment, submitPayment, type FixtureState } from "./fixture.ts";
import { signedCore } from "./supervisor.ts";

/** Preparation evidence is attached to a running attempt, never relabeled as public journey operations/events. */
export async function prepareSlice(stack: Awaited<ReturnType<typeof composeWorld>>, configFile: string, slug: string) {
  const { c } = stack;
  const directory = process.env.CAPXUL_EVAL_RUN_DIR;
  assert(directory, "preparation requires the harness's running receipt");
  const parsed = parseRunReceipt(JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")));
  assert(parsed.ok, "invalid running receipt");
  const receipt = parsed.value;
  assert.equal(receipt.state, "running");
  assert.equal(resolve(directory), join(c.root, "status/runs", receipt.id));
  assert.equal(receipt.commit, c.codeVersion, "preparation build differs from running Core");
  assert.equal(receipt.environment.components.core, c.codeVersion);
  assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
  assert.equal(receipt.environment.world, "slice-zero");
  assert.equal(receipt.environment.storage, "postgres");
  assert.equal(receipt.environment.indexer, "ponder");
  assert(Date.parse(receipt.at) <= Date.now(), "receipt starts in the future");
  assert.equal(process.env.CAPXUL_WORLD_CONFIG, resolve(configFile));
  assert.equal(process.env.CAPXUL_ACCEPTANCE_FIXTURE, join(c.controlDir, "acceptance.json"));
  for (const file of [fixturePath(c), join(c.controlDir, "fixture-pending.json"), process.env.CAPXUL_ACCEPTANCE_FIXTURE]) {
    try { await access(file); throw new Error("same-run preparation requires a fresh fixture; use a new world, never reuse earlier journey actions"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
  requirePaymentSlot(c);
  const evidence = join(directory, "preparation");
  await mkdir(evidence, { mode: 0o700 });
  const record = { version: 1, run: { id: receipt.id, at: receipt.at, commit: receipt.commit },
    world: { id: c.world.id, epoch: c.world.epoch }, kind: "fixture-preparation-not-journey-proof",
    phases: [] as { name: string; startedAt: string; finishedAt?: string; sourcePath?: string }[] };
  const secrets = [c.secret, c.siteToken, c.bench.dbPassword, c.bench.adminPassword, process.env.CAPXUL_WORLD_RUN_TOKEN,
    ...Object.values(c.database).flatMap((url) => [url, decodeURIComponent(new URL(url).password)])].filter((s): s is string => !!s);
  const save = () => writeFile(join(directory, "preparation.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  const phase = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const entry: typeof record.phases[number] = { name, startedAt: new Date().toISOString() };
    record.phases.push(entry); await save();
    const value = await action();
    entry.finishedAt = new Date().toISOString(); entry.sourcePath = `preparation/${name}.json`;
    let source = JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v, 2);
    for (const secret of secrets) source = source.replaceAll(secret, "[REDACTED]");
    await writeFile(join(directory, entry.sourcePath), source, { mode: 0o600 });
    await save(); return value;
  };
  await save();
  let f!: FixtureState;
  await phase("provisioned-readback", async () => {
    f = await provisionFixture(c, configFile, slug);
    return { org: await signedCore(c, "/admin/org-info", { slug }), delivery: await signedCore(c, "/admin/status", { slug }),
      company: f.name, site: f.site, safeAccount: f.safeAccount };
  });
  const payment = await phase("requested-payment", () => preparePayment(c, f, 125.5));
  f.invoice = payment.pi; f.paymentEntry = payment.pe; await persistFixture(c, f);
  const result = await phase("submitted-userop", () => submitPayment(c, f, payment.approval));
  f.txHash = result.txHash; f.userOpHash = result.userOpHash; await persistFixture(c, f);
  const readPayment = async () => {
    await settledPayment(c, f);
    const state = await bench(c, f.site, "capxul.testutil.state", [], { pe: f.paymentEntry, pi: f.invoice });
    return { paymentEntry: state.pe, outstanding: state.outstanding, safeCredit: state.safe_credit,
      gl: await bench(c, f.site, "frappe.get_all", [], { doctype: "GL Entry", filters: { voucher_no: f.paymentEntry, is_cancelled: 0 },
        fields: ["name", "account", "debit", "credit", "voucher_no"], order_by: "name" }) };
  };
  const before = await phase("settled-payment", readPayment);
  const snapshot = `slicezero_${receipt.id.replaceAll("-", "_")}`;
  await phase("snapshot-save", () => stack.save(snapshot));
  await phase("snapshot-integrity", () => stack.read(snapshot));
  await phase("snapshot-restore", () => stack.restore(snapshot));
  const after = await phase("restored-payment", readPayment);
  assert.deepEqual(after, before, "native recovery changed the selected payment or original GL rows");
  await phase("restored-world", () => stack.inspect());
  record.world.epoch = c.world.epoch; await save();
  // Do not restore under acceptance: the restored site has just invalidated all previous sessions.
  await acceptanceFixture(c, f, configFile, snapshot);
  return { fixture: process.env.CAPXUL_ACCEPTANCE_FIXTURE, evidence: "preparation.json" };
}
