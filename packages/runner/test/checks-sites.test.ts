// The whole-run `sites` check (checks/sites.ts) on fixtures: a run whose sites all say where they came from passes;
// a site with no origin or no steps is unexplained; the pool's ready copies must serve the first sites founded; every
// fallback needs its reason; and times are reported, never judged.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import { checkSites, type FellBack, type SiteMade, type SitesSeen } from "../src/checks/sites.ts";

const spans = Pipeline.siteMake.spans;
const TAKEN = [
  { span: spans.take.name, ms: 900 },
  { span: spans.join.name, ms: 1_800 },
  { span: spans.ready.name, ms: 400 },
];

const site = (company: string, origin: SiteMade["origin"], steps = TAKEN, ms: number | null = 3_100): SiteMade => ({
  world: "w-shared-1",
  company,
  origin,
  steps,
  ms,
});

const fell = (origin: FellBack["origin"], reason: FellBack["reason"]): FellBack => ({
  world: "w-shared-1",
  origin,
  reason,
});

/** The failures of the run's sites checks, in order: unexplained, not from the pool, fallbacks with no reason. */
const failuresOf = (seen: SitesSeen) => Arr.map(checkSites(seen).checks, (check) => (check.passed ? "" : check.detail));

test("every site taken from the pool, each with its take and join, passes", () => {
  const seen = {
    founded: [site("northwind-j3", "company pool"), site("northwind-j5", "company pool")],
    readyCopies: 2,
    fellBack: [],
  };
  assert.deepEqual(failuresOf(seen), ["", "", ""]);
  assert.ok(Arr.every(checkSites(seen).checks, (check) => check.check === "sites"));
});

test("a site with no origin, or no steps, is unexplained", () => {
  const [unexplained] = failuresOf({
    founded: [site("northwind-j3", null), site("northwind-j5", "blank copy", [])],
    readyCopies: 0,
    fellBack: [fell("blank copy", "no company template")],
  });
  assert.match(unexplained ?? "", /northwind-j3 in w-shared-1 is unexplained: the record names no origin/u);
  assert.match(unexplained ?? "", /northwind-j5 in w-shared-1 is unexplained: the record names no steps/u);
});

test("a site from the pool whose steps do not name the take and the join is unexplained", () => {
  const [unexplained] = failuresOf({
    founded: [site("northwind-j3", "company pool", [{ span: spans.ready.name, ms: 10 }])],
    readyCopies: 1,
    fellBack: [],
  });
  assert.match(unexplained ?? "", /came from the company pool, but its steps do not name/u);
});

test("the pool's k ready copies must serve the first min(k, founded) sites", () => {
  const founded = [
    site("northwind-j1", "company pool"),
    site("northwind-j2", "company copy"),
    site("northwind-j3", "company copy"),
  ];
  const fellBack = [fell("company copy", "company pool empty"), fell("company copy", "company pool empty")];
  const [, fromPool] = failuresOf({ founded, readyCopies: 2, fellBack });
  assert.match(fromPool ?? "", /site 2 of 2 .*northwind-j2 in w-shared-1, came from company copy/u);
  assert.doesNotMatch(fromPool ?? "", /northwind-j3/u);
  // More ready copies than sites: every site founded must come from the pool, and no more is asked.
  assert.deepEqual(failuresOf({ founded: [site("northwind-j1", "company pool")], readyCopies: 5, fellBack: [] }), [
    "",
    "",
    "",
  ]);
});

test("every fallback needs its site.make.fell_back reason, one log for each site", () => {
  const founded = [
    site("northwind-j1", "blank copy"),
    site("northwind-j2", "blank copy"),
    site("northwind-j3", "from nothing"),
  ];
  const [, , silent] = failuresOf({ founded, readyCopies: 0, fellBack: [fell("blank copy", "no company template")] });
  assert.match(
    silent ?? "",
    /northwind-j2 in w-shared-1 came from blank copy with no site\.make\.fell_back saying why/u,
  );
  assert.match(silent ?? "", /northwind-j3 in w-shared-1 came from from nothing with no site\.make\.fell_back/u);
  assert.doesNotMatch(silent ?? "", /northwind-j1/u);
});

test("times are reported, never judged: a slow site still passes", () => {
  const slow = site("northwind-j1", "company pool", TAKEN, 600_000);
  const { checks, times } = checkSites({ founded: [slow], readyCopies: 1, fellBack: [] });
  assert.ok(Arr.every(checks, (check) => check.passed));
  assert.deepEqual(times, [
    { world: "w-shared-1", company: "northwind-j1", origin: "company pool", ms: 600_000, steps: TAKEN },
  ]);
});

test("a run that founded no company passes and reports nothing", () => {
  const { checks, times } = checkSites({ founded: [], readyCopies: 3, fellBack: [] });
  assert.ok(Arr.every(checks, (check) => check.passed));
  assert.deepEqual(times, []);
});
