import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRunReceipt, parseStatus, type RunReceipt } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("completed assertions differ from crashes and missing output; every attempt keeps same-run contracts", async () => {
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
    const output = (name: string, verdict = "pass") => `printf '@check\\t${name}\\t${verdict}\\t1\\tok\\n'`;
    const both = `${output("B1.done")}\n${output("B2.done")}`;
    const failed = `${output("B1.done")}\n${output("B2.done", "fail")}`;
    const cases = [
      [both, true, ["pass", "pass"], 0, null], ["exit 0", false, ["not_run", "not_run"], 0, null],
      [output("B1.done"), false, ["not_run", "not_run"], 0, null], [`${both}\nexit 7`, false, ["not_run", "not_run"], 7, null],
      [`${both}\nkill -TERM $$`, false, ["not_run", "not_run"], null, "SIGTERM"],
      [`${both}\nprintf '@check\\tbroken\\n'`, false, ["not_run", "not_run"], 0, null],
      [`${failed}\nexit 1`, true, ["pass", "fail"], 1, null],
      [failed, true, ["pass", "fail"], 0, null],
      [`${both}\nexit 1`, false, ["not_run", "not_run"], 1, null],
      [`${failed}\nexit 7`, false, ["not_run", "fail"], 7, null],
      [output("B2.done", "fail"), false, ["not_run", "fail"], 0, null],
      [`${both}\nprintf '[{"screen":"payment","path":"missing.png","source":"doctype:Payment Entry","assertion":"source-equality"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`, false, ["not_run", "not_run"], 0, null],
      [`${both}\nmkdir -p "$CAPXUL_EVAL_RUN_DIR/acceptance"\nprintf image > "$CAPXUL_EVAL_RUN_DIR/acceptance/screen.png"\nprintf '{"payment":1}' > "$CAPXUL_EVAL_RUN_DIR/acceptance/sources.json"\nprintf '[{"screen":"payment","path":"acceptance/screen.png","source":"acceptance/sources.json#/payment","assertion":"source-equality"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`, true, ["pass", "pass"], 0, null],
    ] as const;
    for (const [script, complete, verdicts, exit, signal] of cases) {
      writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: Object.fromEntries(ids.map((id) => [id, { verdict: "pass", commit: "old", at: "2026-01-01T00:00:00Z" }])) }));
      writeFileSync(join(root, "run.sh"), script);
      const code = await executeRun(root, blueprint, loaded.value, ids, { world: "main", slug: "test" }, "abc1234", []);
      assert.equal(code, verdicts.every((v) => v === "pass") ? 0 : 1, script);
      const dirs = readdirSync(join(root, "status/runs")).sort();
      const dir = join(root, "status/runs", dirs.at(-1)!);
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(receipt.value.state, complete ? "complete" : "incomplete");
      assert.deepEqual(receipt.value.requested, ids);
      assert.deepEqual(receipt.value.scripts.map(({ script, exitCode, signal }) => ({ script, exitCode, signal })), [{ script: "run.sh", exitCode: exit, signal }]);
      assert.deepEqual([...receipt.value.evals].sort((a, b) => a.id.localeCompare(b.id)), [...ids].sort().map((id) => ({ id, claim: blueprint.evals.find((e) => e.id === id)!.claim })));
      for (const file of [join(root, "status/status.json"), join(dir, "status.json")]) {
        const status = parseStatus(JSON.parse(readFileSync(file, "utf8")));
        assert.ok(status.ok);
        for (const [i, id] of ids.entries()) {
          assert.equal(status.value.evals[id]?.verdict, verdicts[i], script);
          assert.equal(status.value.evals[id]?.run, receipt.value.id);
          assert.equal(status.value.evals[id]?.at, receipt.value.at);
          assert.equal(status.value.evals[id]?.commit, receipt.value.commit);
        }
      }
      assert.equal(receipt.value.screens.length, complete && script.includes("screens.json") ? 1 : 0);
    }
    assert.equal(readdirSync(join(root, "status/runs")).length, cases.length, "same-second attempts never overwrite one another");
    // Equal names in two scripts cannot let one concept's output satisfy another concept's missing check.
    const split = loadBindings(ids.map((id, i) => ({
      source: `${i}.json`, area: `concept${i}`, script: `${i}.sh`, worlds: ["main"], secrets: [], near: [],
      bindings: [{ eval: id, checks: ["B1.done"], why: "only this script can prove this eval" }],
    })), { evals: new Set(ids), scripts: new Map([0, 1].map((i) => [`${i}.sh`, parseScriptList("B1.done\tcheck")])) });
    assert.ok(split.ok);
    writeFileSync(join(root, "0.sh"), output("B1.done"));
    for (const [script, verdict] of [
      ["exit 0", "not_run"], [`${output("B1.done")}\nexit 7`, "not_run"],
      [`${output("B1.done")}\nkill -TERM $$`, "not_run"],
      [`${output("B1.done")}\nprintf '@check\\tbroken\\n'`, "not_run"],
      [`${output("B1.done", "fail")}\nexit 7`, "fail"],
    ] as const) {
      writeFileSync(join(root, "1.sh"), script);
      assert.equal(await executeRun(root, blueprint, split.value, ids, { world: "main", slug: "test" }, "abc1234", []), 1);
      const status = parseStatus(JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")));
      assert.ok(status.ok);
      assert.deepEqual(ids.map((id) => status.value.evals[id]?.verdict), ["pass", verdict]);
      const dir = join(root, "status/runs", readdirSync(join(root, "status/runs")).sort().at(-1)!);
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(receipt.value.state, "incomplete");
      assert.deepEqual(receipt.value.scripts.map((s) => [s.evals, s.completed]), [[[ids[0]], true], [[ids[1]], false]]);
      if (verdict === "fail") assert.match(readFileSync(join(dir, "checks.tsv"), "utf8"), /B1.done\tfail/);
    }
    // An unbound requested eval cannot make an attempt complete or successful.
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
assert.deepEqual(receipt.scripts[0].evals,['${id}']);
assert.equal(receipt.scripts[0].completed,false);
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

test("unsupported world plans preserve the full receipt without launching incompatible scripts", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const observed = target.blueprint.evals.find((e) => e.id.startsWith("acc:doc.submit/") && e.observes);
  assert.ok(observed);
  const ids = [observed.id, "ret:doc.create", "ret:doc.update", "ret:record.export"];
  const root = mkdtempSync(join(tmpdir(), "eval-world-"));
  try {
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "spikes/skeleton"), { recursive: true });
    mkdirSync(join(root, "status"));
    writeFileSync(join(root, "environment.json"), JSON.stringify({ world: "slice-zero", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: { core: "abc1234" } }));
    writeFileSync(join(root, "prepare.mjs"), `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const dir=process.env.CAPXUL_EVAL_RUN_DIR;
const receipt=JSON.parse(readFileSync(dir+'/receipt.json'));
assert.equal(receipt.state,'running');
assert(receipt.scripts.every(s=>s.exitCode===null));
const status=JSON.parse(readFileSync('status/status.json'));
assert(receipt.requested.every(id=>status.evals[id].verdict==='not_run'));
writeFileSync(dir+'/prepared.json',JSON.stringify(receipt));
console.log('@check\\tB1.done\\tpass\\t1\\tnot binding evidence');
`);
    writeFileSync(join(root, "argv.json"), JSON.stringify([process.execPath, "prepare.mjs"]));
    writeFileSync(join(root, "supported.sh"), `test -f "$CAPXUL_EVAL_RUN_DIR/prepared.json" || exit 9\nprintf yes > "$CAPXUL_EVAL_RUN_DIR/supported-ran"\nprintf '@check\\tB1.done\\tpass\\t1\\tactual selected check\\n'`);
    for (const mode of ["other-world", "skeleton", "skeleton-wrong-alias", "shared-script"]) {
      const script = mode.startsWith("skeleton") ? "spikes/skeleton/run.sh" : "unsupported.sh";
      const files = [{ source: "supported.json", area: "supported", script: "supported.sh", worlds: ["slice-zero"], secrets: [], near: [],
        bindings: [{ eval: ids[0]!, checks: ["B1.done"], why: "supported selected-world check" }] },
      { source: "unsupported.json", area: "unsupported", script, worlds: mode === "skeleton-wrong-alias" ? ["slice-zero"] : ["main"], secrets: [], near: [],
        bindings: [{ eval: ids[1]!, checks: ["B1.done"], why: "cannot prove another world's contract" }] }];
      if (mode === "shared-script") files.push({ source: "shared.json", area: "shared", script, worlds: ["slice-zero"], secrets: [], near: [],
        bindings: [{ eval: ids[2]!, checks: ["B1.done"], why: "a mixed-world script plan must not launch" }] });
      const loaded = loadBindings(files, { evals: new Set(ids), scripts: new Map(["supported.sh", script].map((s) => [s, parseScriptList("B1.done\tcheck")])) });
      assert.ok(loaded.ok);
      writeFileSync(join(root, script), 'printf forbidden > "$CAPXUL_EVAL_RUN_DIR/unsupported-ran"\nprintf "@check\\tB1.done\\tpass\\t1\\tforbidden\\n"');
      writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: Object.fromEntries(ids.map((id) => [id, { verdict: "pass", commit: "old", at: "2026-01-01T00:00:00Z" }])) }));
      const options = { world: "slice-zero", slug: "test", environment: "environment.json", prepare: "argv.json" };
      assert.equal(await executeRun(root, target.blueprint, loaded.value, ids, options, "abc1234", []), 1, mode);
      const dir = join(root, "status/runs", readdirSync(join(root, "status/runs")).sort().at(-1)!);
      const parsed = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(parsed.ok);
      const receipt = parsed.value;
      assert.equal(receipt.state, "incomplete", mode);
      assert.deepEqual(receipt.requested, ids);
      assert.deepEqual(receipt.evals, target.blueprint.evals.filter((e) => ids.includes(e.id)).map(({ id, claim, observes }) => ({ id, claim, ...(observes === undefined ? {} : { observes }) })));
      assert.deepEqual(receipt.scripts.map(({ script, exitCode, signal }) => ({ script, exitCode, signal })), [{ script: "supported.sh", exitCode: 0, signal: null }, { script, exitCode: null, signal: null }]);
      assert.equal(receipt.prepare?.exitCode, 0);
      const before = JSON.parse(readFileSync(join(dir, "prepared.json"), "utf8"));
      assert.deepEqual(before.requested, ids);
      assert.equal(before.id, receipt.id);
      assert.equal(before.at, receipt.at);
      assert.equal(before.commit, receipt.commit);
      assert.equal(readdirSync(dir).includes("supported-ran"), true);
      assert.equal(readdirSync(dir).includes("unsupported-ran"), false, mode);
      assert.match(readFileSync(join(dir, "run.log"), "utf8"), /skipped.*(?:does not support world slice-zero|JSON skeleton)/);
      for (const file of [join(dir, "status.json"), join(root, "status/status.json")]) {
        const status = parseStatus(JSON.parse(readFileSync(file, "utf8")));
        assert.ok(status.ok);
        for (const id of ids) {
          assert.equal(status.value.evals[id]?.verdict, id === ids[0] ? "pass" : "not_run");
          assert.equal(status.value.evals[id]?.run, receipt.id);
          assert.equal(status.value.evals[id]?.at, receipt.at);
          assert.equal(status.value.evals[id]?.commit, receipt.commit);
          const contract: RunReceipt["evals"][number] = receipt.evals.find((e) => e.id === id)!;
          assert.equal(status.value.evals[id]?.claim, contract.claim);
          assert.equal(status.value.evals[id]?.observes, contract.observes);
        }
      }
      assert.match(readFileSync(join(dir, "evidence/ret-doc.create.txt"), "utf8"), /skipped.*(?:does not support world slice-zero|JSON skeleton)/);
      // Unsupported unrequested plans must not prevent a fully supported selection from passing.
      assert.equal(await executeRun(root, target.blueprint, loaded.value, [ids[0]!], options, "abc1234", []), 0);
      // Even with no preparation and no runnable plans, preserve the unsupported request in an incomplete attempt.
      assert.equal(await executeRun(root, target.blueprint, loaded.value, [ids[1]!], { world: "slice-zero", slug: "test", environment: "environment.json" }, "abc1234", []), 1);
      const only = join(root, "status/runs", readdirSync(join(root, "status/runs")).sort().at(-1)!);
      const skipped = parseRunReceipt(JSON.parse(readFileSync(join(only, "receipt.json"), "utf8")));
      assert.ok(skipped.ok);
      assert.equal(skipped.value.state, "incomplete");
      assert.deepEqual(skipped.value.requested, [ids[1]]);
      assert.deepEqual(skipped.value.scripts.map(({ script, exitCode, signal }) => ({ script, exitCode, signal })), [{ script, exitCode: null, signal: null }]);
      assert.equal(readdirSync(only).includes("unsupported-ran"), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
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
