import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeResults, parseResults, parseStatus, verdictOf, type StatusDocument } from "@capxul/book";

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

test("a bound eval whose check did not run, and none failed, writes nothing and is listed as unfinished", () => {
  const s = scored(out(line("B1.a", "pass")), ["acc:two", "acc:three"]);
  assert.deepEqual(s.rows, []);
  assert.deepEqual(s.unfinished, [{ id: "acc:two", missing: ["B1.b"] }, { id: "acc:three", missing: ["B2.c"] }]);
});

test("an eval that was not asked for is not scored, whatever its checks did", () => {
  assert.deepEqual(verdicts(out(line("B2.c", "fail")), ["acc:one"]), {});
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

test("merged: a pass is recorded with its commit, time, run and evidence; one that did not run stays as it was", () => {
  const status = merge(out(line("B1.a", "pass")), ["acc:one", "acc:three"], doc("pass"));
  assert.deepEqual(status.evals["acc:one"], { verdict: "pass", commit: "abc1234", at: "2026-11-10T12:00:00Z", run: "run-1", evidence: "status/runs/run-1/evidence/acc:one.txt" });
  assert.deepEqual(status.evals["acc:three"], { verdict: "pass", commit: "old0000", at: "2026-11-09T12:00:00Z" });
});

test("merged: a failing check turns an earlier pass into fail, and an asked-for eval with no check turns a stale pass into not_run", () => {
  assert.equal(verdictOf(merge(out(line("B2.c", "fail")), ["acc:three"], doc("pass")), "acc:three"), "fail");
  const stale = parseStatus({ version: 1, evals: { "acc:none": { verdict: "pass", commit: "hand", at: "2026-11-09T12:00:00Z" } } });
  assert.ok(stale.ok);
  assert.equal(verdictOf(merge(out(), ["acc:none"], stale.value), "acc:none"), "not_run");
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
