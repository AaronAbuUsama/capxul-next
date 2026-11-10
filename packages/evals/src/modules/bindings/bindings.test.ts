import assert from "node:assert/strict";
import { test } from "node:test";

import { gapsOf, loadBindings, parseBindingFile, parseScriptList, selectEvals, type BindingFile, type Index, type Known } from "./service.ts";

const known: Known = {
  evals: new Set(["acc:a/1", "acc:a/2", "acc:b/1", "jrn:j"]),
  scripts: new Map([["run.sh", parseScriptList("B1.one\tcheck\nB1.two\tcheck\nB2.three\tcheck\nB2.four\tcheck\nPRE.up\tguard\n")]]),
};
const file = (over: Partial<BindingFile> = {}): BindingFile => ({
  source: "evals/bindings/x.json", area: "x", script: "run.sh", worlds: ["main"], secrets: [], bindings: [], near: [], ...over,
});
const failures = (files: readonly BindingFile[]): string => {
  const r = loadBindings(files, known);
  return r.ok ? "" : r.errors.join("\n");
};

test("a script's list says which names are checks and which are guards", () => {
  const s = parseScriptList("B1.one\tcheck\nPRE.up\tguard\n\nnoise\n");
  assert.deepEqual([...s.checks], ["B1.one"]);
  assert.deepEqual([...s.guards], ["PRE.up"]);
});

test("a binding for an eval the book does not derive fails", () => {
  assert.match(failures([file({ bindings: [{ eval: "acc:nope/1", checks: ["B1.one"], why: "w" }] })]), /acc:nope\/1: the book derives no such eval/);
});

test("an eval bound twice fails, in one file or two", () => {
  const b = { eval: "acc:a/1", checks: ["B1.one"], why: "w" };
  assert.match(failures([file({ bindings: [b, b] })]), /eval acc:a\/1 is bound twice/);
  assert.match(failures([file({ bindings: [b] }), file({ source: "evals/bindings/y.json", bindings: [{ ...b, checks: ["B1.two"] }] })]), /bound twice \(also in evals\/bindings\/x.json\)/);
});

test("a check the script does not have, a guard, and a check named twice each fail", () => {
  assert.match(failures([file({ bindings: [{ eval: "acc:a/1", checks: ["B9.missing"], why: "w" }] })]), /has no check B9.missing/);
  assert.match(failures([file({ bindings: [{ eval: "acc:a/1", checks: ["PRE.up"], why: "w" }] })]), /PRE.up is a guard/);
  assert.match(failures([file({ bindings: [{ eval: "acc:a/1", checks: ["B1.one", "B1.one"], why: "w" }] })]), /named twice/);
});

test("a script the runner does not know fails; an eval cannot be both bound and a near-miss", () => {
  assert.match(failures([file({ script: "other.sh" })]), /not one the runner knows/);
  const both = file({ bindings: [{ eval: "acc:a/1", checks: ["B1.one"], why: "w" }], near: [{ eval: "acc:a/1", checks: ["B1.two"], missing: "m" }] });
  assert.match(failures([both]), /is a near-miss and is bound/);
});

test("good bindings load and are indexed by eval", () => {
  const r = loadBindings([file({ bindings: [{ eval: "acc:a/1", checks: ["B1.one", "B1.two"], why: "w" }] })], known);
  assert.ok(r.ok);
  assert.deepEqual(r.value.byEval.get("acc:a/1")?.binding.checks, ["B1.one", "B1.two"]);
});

test("the file's shape is checked: a name, a script, worlds, and a reason for each binding", () => {
  assert.equal(parseBindingFile("f.json", { area: "a", script: "s", worlds: ["main"], bindings: [{ eval: "acc:a/1", checks: ["B1.one"], why: "w" }] }).ok, true);
  const bad = parseBindingFile("f.json", { area: "", worlds: [], bindings: [{ eval: "acc:a/1", checks: [] }], near: [{ eval: "x", checks: ["c"] }] });
  assert.ok(!bad.ok);
  const text = bad.errors.join("\n");
  assert.match(text, /area/); assert.match(text, /script/); assert.match(text, /worlds/);
  assert.match(text, /checks: at least one check/); assert.match(text, /why: the reason/); assert.match(text, /missing: the reason/);
  assert.equal(parseBindingFile("f.json", [] as unknown).ok, false);
});

const bindings = (() => {
  const r = loadBindings([file({ bindings: [{ eval: "acc:a/1", checks: ["B1.one"], why: "w" }], near: [{ eval: "acc:a/2", checks: ["B1.two"], missing: "m" }] })], known);
  assert.ok(r.ok);
  return r.value;
})();
const index: Index = { journey: (id) => (id === "j" ? ["acc:a/1", "acc:b/1", "acc:a/1"] : null), milestone: () => null };

test("what to run: named evals, a journey, all that have a check; an unknown journey is refused", () => {
  assert.deepEqual(selectEvals({ kind: "evals", ids: ["acc:b/1", "acc:b/1"] }, index, bindings), { ok: true, value: ["acc:b/1"] });
  assert.deepEqual(selectEvals({ kind: "journey", id: "j" }, index, bindings), { ok: true, value: ["acc:a/1", "acc:b/1"] });
  assert.deepEqual(selectEvals({ kind: "all" }, index, bindings), { ok: true, value: ["acc:a/1"] });
  assert.equal(selectEvals({ kind: "journey", id: "none" }, index, bindings).ok, false);
  assert.equal(selectEvals({ kind: "milestone", id: "m" }, index, bindings).ok, false);
});

test("the gaps: checks no eval needs, checks that prove part of one, and the evals with no check", () => {
  const g = gapsOf(bindings, known.scripts, ["acc:a/1", "acc:a/2", "acc:b/1"]);
  assert.deepEqual(g.checksWithNoEval, ["B2.four", "B2.three"]);
  assert.deepEqual(g.checksInNearMisses, ["B1.two"]);
  assert.deepEqual(g.evalsWithNoCheck, [{ id: "acc:a/2", near: true }, { id: "acc:b/1", near: false }]);
});
