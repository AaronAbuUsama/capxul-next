import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRunReceipt, parseStatus } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("only a complete child run replaces prior passes; every attempt keeps intent, exits and same-run contracts", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const blueprint = target.blueprint;
  const ids = ["ret:doc.submit", "ret:doc.create"];
  const root = mkdtempSync(join(tmpdir(), "eval-run-"));
  try {
    // The real recorder and target loader run in child processes; only the score/evidence live in this temporary root.
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{
      source: "test.json", area: "test", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: ids.map((id, i) => ({ eval: id, checks: [`B${i + 1}.done`], why: "public runner regression" })),
    }, {
      source: "other.json", area: "other", script: "other.sh", worlds: ["slice-zero"], secrets: [], near: [],
      bindings: [{ eval: "ret:doc.update", checks: ["B1.done"], why: "an unselected script must not constrain main" }],
    }], { evals: new Set([...ids, "ret:doc.update"]), scripts: new Map([["run.sh", parseScriptList("B1.done\tcheck\nB2.done\tcheck")], ["other.sh", parseScriptList("B1.done\tcheck")]]) });
    assert.ok(loaded.ok);
    const output = (name: string) => `printf '@check\\t${name}\\tpass\\t1\\tok\\n'`;
    const both = `${output("B1.done")}\n${output("B2.done")}`;
    for (const [script, complete, exit, signal] of [
      [both, true, 0, null], ["exit 0", false, 0, null],
      [output("B1.done"), false, 0, null], [`${both}\nexit 7`, false, 7, null],
      [`${both}\nkill -TERM $$`, false, null, "SIGTERM"],
      [`${both}\nprintf '@check\\tbroken\\n'`, false, 0, null],
      [`${both}\nprintf image > "$CAPXUL_EVAL_RUN_DIR/screen.png"\nprintf '[{"screen":"payment","path":"screen.png","source":"doctype:Payment Entry","assertion":"source-equality"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`, true, 0, null],
    ] as const) {
      writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: Object.fromEntries(ids.map((id) => [id, { verdict: "pass", commit: "old", at: "2026-01-01T00:00:00Z" }])) }));
      writeFileSync(join(root, "run.sh"), script);
      const code = await executeRun(root, blueprint, loaded.value, ids, { world: "main", slug: "test" }, "abc1234", []);
      assert.equal(code, complete ? 0 : 1, script);
      const dirs = readdirSync(join(root, "status/runs")).sort();
      const dir = join(root, "status/runs", dirs.at(-1)!);
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(receipt.value.state, complete ? "complete" : "incomplete");
      assert.deepEqual(receipt.value.requested, ids);
      assert.deepEqual(receipt.value.scripts, [{ script: "run.sh", exitCode: exit, signal }]);
      assert.deepEqual([...receipt.value.evals].sort((a, b) => a.id.localeCompare(b.id)), [...ids].sort().map((id) => ({ id, claim: blueprint.evals.find((e) => e.id === id)!.claim })));
      for (const file of [join(root, "status/status.json"), join(dir, "status.json")]) {
        const status = parseStatus(JSON.parse(readFileSync(file, "utf8")));
        assert.ok(status.ok);
        for (const id of ids) {
          assert.equal(status.value.evals[id]?.verdict, complete ? "pass" : "not_run");
          assert.equal(status.value.evals[id]?.run, receipt.value.id);
        }
      }
      assert.equal(receipt.value.screens.length, script.includes("screens.json") ? 1 : 0);
    }
    assert.equal(readdirSync(join(root, "status/runs")).length, 7, "same-second attempts never overwrite one another");
    // Equal names in two scripts cannot let one concept's output satisfy another concept's missing check.
    const split = loadBindings(ids.map((id, i) => ({
      source: `${i}.json`, area: `concept${i}`, script: `${i}.sh`, worlds: ["main"], secrets: [], near: [],
      bindings: [{ eval: id, checks: ["B1.done"], why: "only this script can prove this eval" }],
    })), { evals: new Set(ids), scripts: new Map([0, 1].map((i) => [`${i}.sh`, parseScriptList("B1.done\tcheck")])) });
    assert.ok(split.ok);
    writeFileSync(join(root, "0.sh"), output("B1.done"));
    writeFileSync(join(root, "1.sh"), "exit 0");
    assert.equal(await executeRun(root, blueprint, split.value, ids, { world: "main", slug: "test" }, "abc1234", []), 1);
    const status = parseStatus(JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")));
    assert.ok(status.ok);
    assert.ok(ids.every((id) => status.value.evals[id]?.verdict === "not_run"));
    // Complete execution is not success when even one requested eval has no binding.
    assert.equal(await executeRun(root, blueprint, loaded.value, ["ret:record.export"], { world: "main", slug: "test" }, "abc1234", []), 1);
    const unbound = parseStatus(JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")));
    assert.ok(unbound.ok);
    assert.equal(unbound.value.evals["ret:record.export"]?.verdict, "not_run");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("preparation runs after saved intent and before checks; its failure or output cannot supply passes", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const id = "ret:doc.create";
  const root = mkdtempSync(join(tmpdir(), "eval-prepare-"));
  const previousFixture = process.env["CAPXUL_ACCEPTANCE_FIXTURE"];
  process.env["CAPXUL_ACCEPTANCE_FIXTURE"] = join(root, "acceptance-fixture.json");
  try {
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{
      source: "test.json", area: "test", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: [{ eval: id, checks: ["B1.done"], why: "preparation is not check evidence" }],
    }], { evals: new Set([id]), scripts: new Map([["run.sh", parseScriptList("B1.done\tcheck")]]) });
    assert.ok(loaded.ok);
    writeFileSync(join(root, "prepare command.mjs"), `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const dir=process.env.CAPXUL_EVAL_RUN_DIR;
const receipt=JSON.parse(readFileSync(dir+'/receipt.json'));
assert.equal(receipt.state,'running');
assert.equal(receipt.prepare.exitCode,null);
assert.equal(receipt.scripts[0].exitCode,null);
assert.equal(JSON.parse(readFileSync('status/status.json')).evals['${id}'].verdict,'not_run');
assert.deepEqual(process.argv.slice(2),['literal ; $(not-a-shell)', '']);
writeFileSync(dir+'/prepared.json',JSON.stringify(receipt));
writeFileSync(process.env.CAPXUL_ACCEPTANCE_FIXTURE,JSON.stringify({run:receipt.id}));
console.log('@check\\tB1.done\\tpass\\t1\\tpreparation is not a binding');
console.error('preparation stderr');
const mode=readFileSync('mode','utf8');
if(mode==='failure')process.exit(7);
if(mode==='signal')process.kill(process.pid,'SIGTERM');
`);
    const normal = `
node -e 'const fs=require("node:fs"); const d=process.env.CAPXUL_EVAL_RUN_DIR; const r=JSON.parse(fs.readFileSync(d+"/receipt.json")); if(r.prepare.exitCode!==0 || r.prepare.signal!==null || JSON.parse(fs.readFileSync(process.env.CAPXUL_ACCEPTANCE_FIXTURE)).run!==r.id)process.exit(8); fs.readFileSync(d+"/prepared.json"); fs.writeFileSync(d+"/binding-ran", "yes");' || exit $?
printf '@check\\tB1.done\\tpass\\t1\\tactual check\\n'
`;
    for (const mode of ["success", "failure", "signal", "spawn-error", "no-check"]) {
      writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: { [id]: { verdict: "pass", commit: "old", at: "2026-01-01T00:00:00Z" } } }));
      writeFileSync(join(root, "mode"), mode);
      const argv = mode === "spawn-error" ? [join(root, "no-such-executable")] : [process.execPath, join(root, "prepare command.mjs"), "literal ; $(not-a-shell)", ""];
      writeFileSync(join(root, "argv.json"), JSON.stringify(argv));
      writeFileSync(join(root, "run.sh"), mode === "no-check" ? "exit 0" : normal);
      const passed = mode === "success";
      assert.equal(await executeRun(root, target.blueprint, loaded.value, [id], { world: "main", slug: "test", prepare: "argv.json" }, "abc1234", []), passed ? 0 : 1, mode);
      const dir = join(root, "status/runs", readdirSync(join(root, "status/runs")).sort().at(-1)!);
      const parsed = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(parsed.ok);
      const receipt = parsed.value;
      assert.equal(receipt.state, passed ? "complete" : "incomplete");
      assert.deepEqual(receipt.prepare?.argv, argv);
      assert.equal(receipt.prepare?.log, "prepare.log");
      assert.equal(receipt.prepare?.exitCode, mode === "failure" ? 7 : mode === "signal" ? null : mode === "spawn-error" ? -2 : 0);
      assert.equal(receipt.prepare?.signal, mode === "signal" ? "SIGTERM" : null);
      if (mode !== "spawn-error") {
        assert.match(readFileSync(join(dir, "prepare.log"), "utf8"), /preparation stderr/);
        const before = JSON.parse(readFileSync(join(dir, "prepared.json"), "utf8"));
        assert.equal(before.id, receipt.id);
        assert.equal(before.at, receipt.at);
        assert.equal(before.commit, receipt.commit);
      }
      assert.equal(receipt.scripts[0]?.exitCode, mode === "success" || mode === "no-check" ? 0 : null);
      assert.equal(readdirSync(dir).includes("binding-ran"), passed);
      for (const file of [join(dir, "status.json"), join(root, "status/status.json")]) {
        const status = parseStatus(JSON.parse(readFileSync(file, "utf8")));
        assert.ok(status.ok);
        assert.equal(status.value.evals[id]?.verdict, passed ? "pass" : "not_run");
      }
    }
    for (const argv of [[], [""], ["node", null], ["node", "nul\0arg"]]) {
      writeFileSync(join(root, "argv.json"), JSON.stringify(argv));
      const before = readdirSync(join(root, "status/runs"));
      await assert.rejects(executeRun(root, target.blueprint, loaded.value, [id], { world: "main", slug: "test", prepare: "argv.json" }, "abc1234", []));
      assert.deepEqual(readdirSync(join(root, "status/runs")), before, "invalid argv is refused before creating an attempt");
    }
  } finally {
    if (previousFixture === undefined) delete process.env["CAPXUL_ACCEPTANCE_FIXTURE"];
    else process.env["CAPXUL_ACCEPTANCE_FIXTURE"] = previousFixture;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a check consuming stdin cannot swallow the next concept's registered checks", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-dispatch-"));
  try {
    for (const dir of ["spikes/skeleton/core/bin", "spikes/skeleton/core/state", "spikes/skeleton/frappe/bin", "evals/checks"])
      mkdirSync(join(root, dir), { recursive: true });
    const script = join(root, "spikes/skeleton/run.sh");
    writeFileSync(script, readFileSync(join(import.meta.dirname, "../../../spikes/skeleton/run.sh")));
    writeFileSync(join(root, "spikes/skeleton/.env"), "");
    writeFileSync(join(root, "spikes/skeleton/core/state/deployment.json"), '{"usdc":"fixture","payments":"fixture"}');
    for (const dir of ["core", "frappe"])
      writeFileSync(join(root, `spikes/skeleton/${dir}/bin/up.sh`), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(root, "evals/checks/first.sh"), 'register 10 B1 first ""\nfirst() { cat >/dev/null; ok B1.first "first completed"; }\n');
    writeFileSync(join(root, "evals/checks/second.sh"), 'register 20 B2 second "B1"\nsecond() { ok B2.second "second completed"; }\n');
    const result = spawnSync("bash", [script, "fixture", "--only", "B2"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@check\tB1.first\tpass/);
    assert.match(result.stdout, /@check\tB2.second\tpass/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
