import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeResults, parseResults, parseRunReceipt, parseStatus, verdictOf, type RunReceipt, type StatusDocument } from "@capxul/blueprint-engine";

import { loadBindings, parseScriptList } from "../bindings/service.ts";
import { cap, evidenceText, foldChecks, parseCheckLines, redact, resultsFile, scoreEvals, type RunInfo } from "./service.ts";

const bindings = (() => {
  const r = loadBindings(
    [{
      source: "f.json", area: "x", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: [
        { eval: "acc:one", checks: ["B1.a"], why: "w" },
        { eval: "acc:two", checks: ["B1.a", "B1.b"], why: "w" },
        { eval: "acc:three", checks: ["B2.c"], why: "w" },
      ],
    }],
    { evals: new Set(["acc:one", "acc:two", "acc:three", "acc:none"]), scripts: new Map([["run.sh", parseScriptList("B1.a\tcheck\nB1.b\tcheck\nB2.c\tcheck\n")]]) },
  );
  assert.ok(r.ok);
  return r.value;
})();
const out = (...lines: string[]): string => ["PASS human line", "INFO noise", ...lines].join("\n");
const line = (name: string, verdict: string, ms = 5, detail = "d") => `@check\t${name}\t${verdict}\t${ms}\t${detail}`;
const scored = (output: string, asked: string[]) => scoreEvals(asked, bindings, foldChecks(parseCheckLines(output).lines));
const verdicts = (output: string, asked: string[]) => Object.fromEntries(scored(output, asked).rows.map((r) => [r.id, r.verdict]));

test("only @check lines are read; a malformed one is counted, not guessed", () => {
  const r = parseCheckLines(out(line("B1.a", "pass", 12, "it held"), "@check\tB1.b\tmaybe\t1\tx", "@check\tonly", line("B1.b", "fail", 3, "tab\tin detail")));
  assert.deepEqual(r.lines.map((l) => [l.name, l.verdict, l.ms]), [["B1.a", "pass", 12], ["B1.b", "fail", 3]]);
  assert.equal(r.lines[1]?.detail, "tab\tin detail");
  assert.equal(r.malformed.length, 2);
});

test("a repeated check passes only if every repeat passed", () => {
  const f = foldChecks(parseCheckLines(out(line("B1.a", "pass"), line("B1.a", "fail", 5, "second broke"), line("B1.a", "pass"))).lines);
  assert.equal(f.get("B1.a")?.verdict, "fail");
  assert.equal(f.get("B1.a")?.times, 3);
  assert.equal(f.get("B1.a")?.detail, "second broke");
});

test("an eval whose every check passed is pass", () => {
  assert.deepEqual(verdicts(out(line("B1.a", "pass"), line("B1.b", "pass")), ["acc:one", "acc:two"]), { "acc:one": "pass", "acc:two": "pass" });
});

test("a failing check fails its eval, and the evals that share the check, even when its other checks never ran", () => {
  assert.deepEqual(verdicts(out(line("B1.a", "fail")), ["acc:one", "acc:two"]), { "acc:one": "fail", "acc:two": "fail" });
});

test("an eval with no check is not_run when asked for, and never pass", () => {
  const s = scored(out(line("B1.a", "pass"), line("B1.b", "pass")), ["acc:none", "acc:one"]);
  assert.deepEqual(s.rows.map((r) => [r.id, r.verdict]), [["acc:none", "not_run"], ["acc:one", "pass"]]);
});

test("a bound eval whose check did not run writes not_run and is listed as unfinished", () => {
  const s = scored(out(line("B1.a", "pass")), ["acc:two", "acc:three"]);
  assert.deepEqual(s.rows.map((r) => [r.id, r.verdict]), [["acc:two", "not_run"], ["acc:three", "not_run"]]);
  assert.deepEqual(s.unfinished, [{ id: "acc:two", missing: ["B1.b"] }, { id: "acc:three", missing: ["B2.c"] }]);
});

test("an eval that was not asked for is not scored, whatever its checks did", () => {
  assert.deepEqual(verdicts(out(line("B2.c", "fail")), ["acc:one"]), { "acc:one": "not_run" });
});

const info: RunInfo = { run: "run-1", commit: "abc1234", at: "2026-11-10T12:00:00Z", script: "run.sh", world: "main", slug: "s1" };
const doc = (verdict: "pass" | "fail"): StatusDocument => {
  const parsed = parseStatus({ version: 1, evals: { "acc:three": { verdict, commit: "old0000", at: "2026-11-09T12:00:00Z" } } });
  assert.ok(parsed.ok);
  return parsed.value;
};
const merge = (output: string, asked: string[], before: StatusDocument | null) => {
  const results = parseResults(resultsFile(info, scored(output, asked).rows, (id) => `status/runs/run-1/evidence/${id}.txt`));
  assert.ok(results.ok);
  const merged = mergeResults({ evals: ["acc:one", "acc:two", "acc:three", "acc:none"].map((id) => ({ id, level: "L1" as const, subject: "x", claim: "c", decider: "machine" as const })) }, before, results.value);
  assert.ok(merged.ok);
  return merged.value;
};

test("merged: a pass keeps its provenance; a requested missing check clears an earlier pass", () => {
  const status = merge(out(line("B1.a", "pass")), ["acc:one", "acc:three"], doc("pass"));
  assert.deepEqual(status.evals["acc:one"], { verdict: "pass", commit: "abc1234", at: "2026-11-10T12:00:00Z", claim: "c", run: "run-1", evidence: "status/runs/run-1/evidence/acc:one.txt" });
  assert.equal(status.evals["acc:three"]?.verdict, "not_run");
  assert.equal(status.evals["acc:three"]?.run, "run-1");
});

test("merged: a failing check turns an earlier pass into fail, and an asked-for eval with no check turns a stale pass into not_run", () => {
  assert.equal(verdictOf(merge(out(line("B2.c", "fail")), ["acc:three"], doc("pass")), "acc:three"), "fail");
  const stale = parseStatus({ version: 1, evals: { "acc:none": { verdict: "pass", commit: "hand", at: "2026-11-09T12:00:00Z" } } });
  assert.ok(stale.ok);
  assert.equal(verdictOf(merge(out(), ["acc:none"], stale.value), "acc:none"), "not_run");
});

test("receipts refuse false completion, incomplete passes, stale contracts and results outside the requested set", () => {
  const receipt: RunReceipt = {
    version: 1, id: "run-1", state: "complete", commit: info.commit, at: info.at, finishedAt: "2026-11-10T12:01:00Z",
    environment: { world: "main", storage: "json", indexer: "inline", stack: "skeleton-json", components: {} },
    requested: ["acc:one"], evals: [{ id: "acc:one", claim: "c" }], scripts: [{ script: "run.sh", exitCode: 0, signal: null }], screens: [],
  };
  const blueprint = { evals: [{ id: "acc:one", level: "L1" as const, subject: "x", claim: "c", decider: "machine" as const }] };
  const run = { commit: info.commit, at: info.at, run: "run-1", receipt, results: [{ id: "acc:one", verdict: "pass" as const }] };
  assert.equal(mergeResults(blueprint, null, run).ok, true);
  const prepared = { ...receipt, prepare: { argv: ["node", "command with spaces", ""], exitCode: 0, signal: null, log: "prepare.log" as const } };
  const parsed = parseRunReceipt(prepared);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.prepare, prepared.prepare);
  assert.equal(mergeResults(blueprint, null, { ...run, receipt: prepared }).ok, true);
  for (const bad of [
    { ...receipt, scripts: [{ script: "run.sh", exitCode: null, signal: null }] },
    { ...receipt, scripts: [{ script: "run.sh", exitCode: 0, signal: "SIGTERM" }] },
    ...[null, 7].map((exitCode) => ({ ...prepared, prepare: { ...prepared.prepare, exitCode } })),
    { ...prepared, prepare: { ...prepared.prepare, signal: "SIGTERM" } },
    ...[[], [""], ["node", "nul\0arg"]].map((argv) => ({ ...prepared, prepare: { ...prepared.prepare, argv } })),
    { ...receipt, requested: ["acc:one", "acc:one"] },
    { ...receipt, evals: [] },
    { ...receipt, environment: { ...receipt.environment, stack: "postgres-ponder-erpnext-v4" } },
    { ...receipt, screens: [{ screen: "s", path: "../outside.png", source: "data", assertion: "source-equality" }] },
  ]) assert.equal(parseRunReceipt(bad).ok, false);
  assert.equal(mergeResults(blueprint, null, { ...run, receipt: { ...receipt, state: "incomplete" } }).ok, false);
  assert.equal(mergeResults(blueprint, null, { ...run, receipt: { ...receipt, evals: [{ id: "acc:one", claim: "old" }] } }).ok, false);
  assert.equal(mergeResults(blueprint, null, { ...run, results: [] }).ok, false);
  const newer = { version: 1 as const, evals: { "acc:one": { verdict: "not_run" as const, commit: "new", at: "2026-11-11T12:00:00Z" } } };
  const late = mergeResults(blueprint, newer, run);
  assert.ok(late.ok);
  assert.deepEqual(late.value, newer, "an older run cannot restore its pass after a newer attempt");
});

test("partial reports require their own completed plan, exact contracts and same-run identities", () => {
  const blueprint = { evals: ["acc:one", "acc:two"].map((id) => ({ id, level: "L1" as const, subject: "x", claim: id, observes: `observe ${id}`, decider: "machine" as const })) };
  const receipt: RunReceipt = {
    version: 1, id: info.run, state: "incomplete", commit: info.commit, at: info.at, finishedAt: "2026-11-10T12:01:00Z",
    environment: { world: "slice-zero", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: {} },
    requested: blueprint.evals.map((e) => e.id), evals: blueprint.evals.map(({ id, claim, observes }) => ({ id, claim, observes })),
    scripts: [{ script: "one.sh", evals: ["acc:one"], completed: true, exitCode: 0, signal: null },
      { script: "two.sh", evals: ["acc:two"], completed: false, exitCode: null, signal: null }],
    prepare: { argv: ["prepare"], exitCode: 0, signal: null, log: "prepare.log" }, screens: [],
  };
  const run = { commit: info.commit, at: info.at, run: info.run, receipt, results: [{ id: "acc:one", verdict: "pass" as const }, { id: "acc:two", verdict: "not_run" as const }] };
  const { finishedAt, ...unfinished } = receipt;
  assert.equal(mergeResults(blueprint, null, run).ok, true);
  for (const changed of [
    { ...receipt, state: "running" as const },
    unfinished,
    { ...receipt, finishedAt: "2026-11-09T12:01:00Z" },
    { ...receipt, state: "complete" as const },
    { ...receipt, id: "other-run" }, { ...receipt, at: "2026-11-10T11:00:00Z" }, { ...receipt, commit: "other-commit" },
    { ...receipt, evals: receipt.evals.map((e) => ({ ...e, observes: "changed" })) },
    ...[null, 7].map((exitCode) => ({ ...receipt, prepare: { ...receipt.prepare!, exitCode } })),
    ...[null, 1, 7].map((exitCode) => ({ ...receipt, scripts: receipt.scripts.map((s) => s.script === "one.sh" ? { ...s, exitCode } : s) })),
    { ...receipt, scripts: receipt.scripts.map((s) => s.script === "one.sh" ? { ...s, signal: "SIGTERM" } : s) },
    { ...receipt, scripts: receipt.scripts.map((s) => ({ ...s, completed: false })) },
    { ...receipt, scripts: receipt.scripts.map((s) => ({ ...s, evals: ["acc:one"] })) },
    { ...receipt, scripts: receipt.scripts.map((s) => ({ ...s, evals: ["acc:unknown"] })) },
  ]) assert.equal(mergeResults(blueprint, null, { ...run, receipt: changed }).ok, false, JSON.stringify(changed));
  assert.equal(mergeResults(blueprint, null, { ...run, results: run.results.map((r) => ({ ...r, verdict: "pass" })) }).ok, false, "one completed script cannot credit another");
  const failed = { ...receipt, state: "complete" as const, scripts: receipt.scripts.map((s) => ({ ...s, completed: true, exitCode: s.script === "two.sh" ? 1 : 0 })) };
  assert.equal(mergeResults(blueprint, null, { ...run, receipt: failed, results: [{ id: "acc:one", verdict: "pass" }, { id: "acc:two", verdict: "fail" }] }).ok, true);
  assert.equal(mergeResults(blueprint, null, { ...run, receipt: failed }).ok, false, "completed plans cannot contain missing verdicts");
});

test("the evidence names the checks and their details; a secret is redacted and a long text is cut in the middle", () => {
  const row = scored(out(line("B1.a", "pass", 7, "key sekret-value-123 shown")), ["acc:one"]).rows[0];
  assert.ok(row);
  const text = redact(evidenceText(info, row, "the claim", "because"), ["sekret-value-123", "abc"]);
  assert.match(text, /PASS {2}B1.a {2}x1 {2}7 ms/);
  assert.match(text, /key \[redacted\] shown/);
  assert.ok(!text.includes("sekret-value-123"));
  assert.match(text, /commit abc1234/, "a secret shorter than 6 characters is not replaced");
  const long = cap("x".repeat(100) + "END", 40);
  assert.ok(long.length < 100 && long.endsWith("END") && long.includes("characters left out"));
});
