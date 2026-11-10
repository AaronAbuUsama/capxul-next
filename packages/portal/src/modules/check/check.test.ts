import assert from "node:assert/strict";
import { test } from "node:test";

import { renderSite } from "#src/modules/render/service.ts";
import { buildSite } from "#src/modules/site/service.ts";
import { fixtureAssets, fixtureInput, WAITING } from "#src/testing.ts";
import { twinsOf } from "#src/modules/twins/service.ts";

import { check, expect, passed } from "./service.ts";
import type { Outcome } from "./types.ts";

const input = fixtureInput();
const generate = (): Map<string, string> => {
  const site = buildSite(input);
  return new Map([...renderSite(site, fixtureAssets), ...twinsOf(site)]);
};
const files = generate();
const expected = expect(input.blueprint, input.waits);
const run = (changed: ReadonlyMap<string, string>, again: ReadonlyMap<string, string> = changed, want = expected): readonly Outcome[] =>
  check(changed, again, want);
/** The names of the parts that failed. */
const failed = (outcomes: readonly Outcome[]): readonly string[] => outcomes.filter((o) => o.failures > 0).map((o) => o.check);
const change = (edit: (files: Map<string, string>) => void): Map<string, string> => {
  const copy = new Map(files);
  edit(copy);
  return copy;
};
const replaceIn = (file: string, from: string, to: string) => (copy: Map<string, string>): void => {
  const text = copy.get(file) ?? assert.fail(`no file ${file}`);
  assert.ok(text.includes(from), `${file} does not hold ${from}`);
  copy.set(file, text.replace(from, to));
};

test("what the blueprint expects: a page per record that has one, the waiting list, the operations", () => {
  assert.deepEqual(expected.pages.slice(0, 6), ["index", "plan", "review", "design", "build", "docs"]);
  assert.ok(expected.pages.includes("operation/org.member.invite") && expected.pages.includes("concept/access"));
  assert.equal(expected.pages.some((p) => /^(transition|call|function|chainEvent|system)\//.test(p)), false);
  assert.deepEqual(expected.waiting, [WAITING]);
  assert.deepEqual([...expected.operations].sort(), ["invite.accept", "org.member.invite"]);
  for (const page of ["docs/commands", "docs/events", "docs/errors", "docs/spans", "docs/decisions", "eval", "eval/acc", "eval/ref"]) {
    assert.ok(expected.pages.includes(page), `no page ${page}`);
  }
  assert.equal(expected.evals, input.blueprint.evals.length);
});

test("a generated site passes every part", () => {
  const outcomes = run(files, generate());
  assert.deepEqual(failed(outcomes), [], JSON.stringify(outcomes, null, 2));
  assert.equal(outcomes.length, 9);
  assert.ok(passed(outcomes));
});

test("a record without its page, or without one twin, fails coverage", () => {
  for (const gone of ["operation/invite.accept/index.html", "operation/invite.accept.md", "data/operation/invite.accept.json"]) {
    const outcomes = run(change((copy) => void copy.delete(gone)));
    assert.ok(failed(outcomes).includes("every record has a page and both twins, and every page belongs to a record"), gone);
    assert.equal(passed(outcomes), false);
  }
});

test("a page that belongs to no record fails coverage", () => {
  const outcomes = run(change((copy) => void copy.set("operation/ghost/index.html", "<!doctype html>")));
  assert.deepEqual(failed(outcomes), ["every record has a page and both twins, and every page belongs to a record"]);
  assert.match(outcomes[0]?.detail.join("\n") ?? "", /operation\/ghost: a page for no record/);
});

test("a link to a missing file, a missing anchor, or a repeated id fails the links part", () => {
  const part = "every internal link and anchor resolves";
  const broken = run(change(replaceIn("index.html", 'href="review/index.html', 'href="nowhere/index.html')));
  assert.deepEqual(failed(broken), [part]);
  const anchor = run(change(replaceIn("review/index.html", `id="q-${WAITING}"`, 'id="q-renamed"')));
  assert.deepEqual(failed(anchor), [part]);
  const twice = run(change((copy) => void copy.set("index.html", `${copy.get("index.html") ?? ""}<p id="climb"></p><p id="climb"></p>`)));
  assert.deepEqual(failed(twice), [part]);
  const twin = run(change(replaceIn("index.md", "](review.md)", "](gone.md)")));
  assert.deepEqual(failed(twin), [part]);
});

test("a link that leaves the site is not followed", () => {
  const outcomes = run(change((copy) => void copy.set("index.html", `${copy.get("index.html") ?? ""}<a href="https://example.test/x">x</a>`)));
  assert.deepEqual(failed(outcomes), []);
});

test("two generations that differ fail the determinism part", () => {
  const outcomes = run(files, change(replaceIn("llms.txt", "abc1234", "fff0000")));
  assert.deepEqual(failed(outcomes), ["two generations are byte-identical"]);
});

test("a Questions page that is not the judgments list fails", () => {
  const part = "the Questions list equals the judgments list plus the plan's needs of the owner";
  assert.deepEqual(failed(run(files, files, { ...expected, waiting: [] })), [part]);
  assert.deepEqual(failed(run(files, files, { ...expected, waiting: [WAITING, "access.one-open"] })), [part]);
});

test("an operation without a stand fails", () => {
  const outcomes = run(change(replaceIn("data/operation/invite.accept.json", '"stand": "build"', '"stand": "later"')));
  assert.deepEqual(failed(outcomes), ["every operation has a stand"]);
});

test("an eval catalogue that drops an eval, or a catalogue page that is missing, fails", () => {
  const dropped = run(files, files, { ...expected, evals: expected.evals + 1 });
  assert.deepEqual(failed(dropped), ["the eval catalogue lists every eval the blueprint derives"]);
  const gone = run(change((copy) => void copy.delete("docs/events/index.html")));
  assert.ok(failed(gone).includes("every record has a page and both twins, and every page belongs to a record"));
});

test("a status entry for an eval the blueprint does not derive fails the check; a known one passes", () => {
  const at = "2026-11-10T10:00:00Z";
  const entry = { verdict: "pass", commit: "abc1234", at } as const;
  const known = expect(input.blueprint, input.waits, { version: 1, evals: { "ret:invite.accept": entry } });
  assert.deepEqual(known.unknownStatus, []);
  assert.deepEqual(failed(run(files, files, known)), []);
  const unknown = expect(input.blueprint, input.waits, { version: 1, evals: { "ret:invite.accept": entry, "ret:ghost": entry } });
  assert.deepEqual(unknown.unknownStatus, ["ret:ghost"]);
  const outcomes = run(files, files, unknown);
  assert.deepEqual(failed(outcomes), ["every status entry names an eval the blueprint derives"]);
  assert.match(outcomes.find((o) => o.failures > 0)?.detail[0] ?? "", /ret:ghost/);
  assert.deepEqual(expected.unknownStatus, [], "no status document, no unknown entry");
});
