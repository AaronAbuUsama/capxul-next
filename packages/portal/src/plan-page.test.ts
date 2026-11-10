import assert from "node:assert/strict";
import { test } from "node:test";

import { apply, check } from "../../../tools/plan/service.ts";
import { EMPTY_PLAN, type Command, type Facts, type Plan } from "../../../tools/plan/types.ts";
import { check as portalCheck, expect, passed } from "#src/modules/check/service.ts";
import { renderSite } from "#src/modules/render/service.ts";
import { buildSite } from "#src/modules/site/service.ts";
import type { PlanInput, PlanPage, Site } from "#src/modules/site/types.ts";
import { twinsOf } from "#src/modules/twins/service.ts";

import { fixtureAssets, fixtureInput, WAITING } from "./testing.ts";

const ctx = { by: "coordinator", date: "2026-11-10", at: "2026-11-10T09:00:00.000Z", commit: "abc1234" };

const planOf = (input = fixtureInput()): { readonly plan: Plan; readonly facts: Facts } => {
  const facts: Facts = {
    decisions: new Set([...input.book.records.values()].filter((r) => r._kind === "decision").map((r) => r.id)),
    records: new Set(input.book.records.keys()), evals: new Set(input.book.evals.map((e) => e.id)), concepts: new Set(input.concepts),
  };
  const commands: Command[] = [
    { kind: "goal.set", title: "The goal title", why: "Because." },
    { kind: "exit.add", owner: "goal", id: "g1", claim: "Everything is a record." },
    { kind: "milestone.add", id: "m1", title: "Foundation", goal: "Get the book fit.", concepts: ["access"] },
    { kind: "milestone.current", id: "m1" },
    { kind: "task.add", id: "t-decide", title: "Settle who invites", why: "Invitations are grants.", milestone: "m1" },
    { kind: "task.add", id: "t-need", title: "Sign in to the cloud", why: "A machine needs an account.", milestone: "m1" },
    { kind: "task.add", id: "t-doing", title: "Write the page", why: "So it is visible.", milestone: "m1" },
    { kind: "task.block", id: "t-decide", blocker: { decision: WAITING } },
    { kind: "task.block", id: "t-need", blocker: { need: "sign in on this Mac", who: "Aaron" } },
    { kind: "task.start", id: "t-doing", thread: "plan-page" },
    { kind: "path.set", tasks: ["t-doing", "t-need"], why: "The page first, then the sign-in." },
    { kind: "note", text: "First note: the book is cut." },
    { kind: "note", text: "Latest note: three things wait." },
  ];
  const plan = commands.reduce((p, c) => {
    const r = apply(p, c, ctx, facts);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.value.plan;
  }, EMPTY_PLAN);
  assert.deepEqual(check(plan, facts), []);
  return { plan, facts };
};

const withPlan = (): { readonly site: Site; readonly page: PlanPage; readonly input: ReturnType<typeof fixtureInput> } => {
  const base = fixtureInput();
  const { plan } = planOf(base);
  const log = [{ at: "2026-11-10T09:00:00.000Z", by: "coordinator", action: "task.add", args: { id: "t-doing" }, commit: "abc1234" }];
  const held: PlanInput = { plan, log, problems: [] };
  const input = fixtureInput("abc1234", "as-is", null, undefined, held);
  const site = buildSite(input);
  const page = site.pages.find((p) => p.id === "plan");
  assert.ok(page?.type === "plan");
  return { site, page, input };
};

test("the Plan page opens with the latest note and follows the plan's own order", () => {
  const { page } = withPlan();
  assert.equal(page.note?.text, "Latest note: three things wait.");
  assert.equal(page.goal?.title, "The goal title");
  assert.deepEqual(page.path?.steps.map((t) => t.id), ["t-doing", "t-need"]);
  assert.equal(page.path?.why, "The page first, then the sign-in.");
  assert.deepEqual(page.groups.map((g) => [g.state, g.tasks.length]), [["doing", 1], ["blocked", 2], ["todo", 0], ["done", 0], ["dropped", 0]]);
  assert.equal(page.groups[0]?.tasks[0]?.thread, "plan-page");
});

test("a task blocked on a decision shows its question, options and recommendation and links to the Questions page", () => {
  const { page, site } = withPlan();
  const b = page.blocked.find((x) => x.task.id === "t-decide");
  assert.equal(b?.on, "decision");
  assert.equal(b?.decision?.id, WAITING);
  assert.equal(b?.decision?.chosen, "owners");
  assert.deepEqual(b?.decision?.options.map((o) => o.recommended), [true, false]);
  assert.deepEqual(b?.decisionRef, { label: WAITING, page: "review", anchor: `q-${WAITING}` });
  assert.equal(b?.waitsOnOwner, true);
  const need = page.blocked.find((x) => x.task.id === "t-need");
  assert.deepEqual([need?.on, need?.who, need?.need], ["need", "Aaron", "sign in on this Mac"]);
  assert.equal(site.planWaiting, 2);
  assert.equal(page.waitsOnOwner, 2);
});

test("the HTML shows the context inline and the count beside Plan; the twins and llms.txt carry the page", () => {
  const { site } = withPlan();
  const html = renderSite(site, fixtureAssets).get("plan/index.html") ?? "";
  assert.match(html, /Settle who invites/);
  assert.match(html, /An invitation gives a person a way in\. Who may send one\?/);
  assert.match(html, /Recommended/);
  assert.match(html, /href="\.\.\/review\/index\.html#q-access\.who-invites"/);
  assert.match(html, /sign in on this Mac/);
  assert.match(html, /Plan <span class="nav-count">2<\/span>/);
  const index = renderSite(site, fixtureAssets).get("index.html") ?? "";
  assert.match(index, /Latest note: three things wait\./);
  assert.match(index, /href="plan\/index\.html"/);
  const twins = twinsOf(site);
  assert.match(twins.get("plan.md") ?? "", /Blocked on decision \[access\.who-invites\]/);
  assert.match(twins.get("plan.md") ?? "", /1\. `t-doing`/);
  assert.equal((JSON.parse(twins.get("data/plan.json") ?? "{}") as { type: string }).type, "plan");
  assert.match(twins.get("llms.txt") ?? "", /\(plan\.md\)/);
});

test("the portal check passes with a plan, and fails with the plan check's problems", () => {
  const { input } = withPlan();
  const files = new Map([...renderSite(buildSite(input), fixtureAssets), ...twinsOf(buildSite(input))]);
  const ok = portalCheck(files, files, expect(input.book, input.waits, null, { problems: [], tasks: 3 }));
  assert.ok(ok.filter((o) => o.check.includes("plan")).every((o) => o.failures === 0), JSON.stringify(ok));
  const bad = portalCheck(files, files, expect(input.book, input.waits, null, { problems: ["t1: it is doing, and names no thread"], tasks: 4 }));
  assert.equal(bad.filter((o) => o.failures > 0).length, 2);
  assert.equal(passed(bad), false);
});

test("with no plan file the page says so, and holds nothing else", () => {
  const site = buildSite(fixtureInput());
  const page = site.pages.find((p) => p.id === "plan");
  assert.ok(page?.type === "plan");
  assert.equal(page.present, false);
  assert.equal(site.planWaiting, 0);
  const html = renderSite(site, fixtureAssets).get("plan/index.html") ?? "";
  assert.match(html, /plan\/plan\.json<\/code> is absent/);
  assert.doesNotMatch(renderSite(site, fixtureAssets).get("index.html") ?? "", /Where the plan is/);
});
