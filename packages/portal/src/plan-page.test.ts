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

test("what waits on the owner is one list on the Questions page: the waiting decisions, then the plan's needs of his", () => {
  const { site, page } = withPlan();
  const review = site.pages.find((p) => p.id === "review");
  assert.ok(review?.type === "questions");
  assert.deepEqual(review.questions.map((q) => [q.kind, q.id]), [["decision", WAITING], ["need", "t-need"]]);
  const decision = review.questions[0];
  assert.deepEqual(decision?.holdsUp.map((t) => t.id), ["t-decide"], "a decision says which task it holds up");
  const need = review.questions[1];
  assert.deepEqual([need?.title, need?.question, need?.concept, need?.options.length], ["Sign in to the cloud", "sign in on this Mac", "m1", 0]);
  assert.equal(need?.ref.anchor, "q-task-t-need");
  assert.equal(site.waiting, 2, "one count: decisions and needs");
  const blocked = page.blocked.find((x) => x.task.id === "t-decide");
  assert.deepEqual(blocked?.inbox, { label: "t-decide", page: "review", anchor: `q-${WAITING}` });
  assert.deepEqual(page.blocked.find((x) => x.task.id === "t-need")?.inbox, { label: "t-need", page: "review", anchor: "q-task-t-need" });
});

test("the HTML: Plan lists what is blocked in a line with a link; Questions holds the context and the answer buttons; the count is on Questions only", () => {
  const { site } = withPlan();
  const files = renderSite(site, fixtureAssets);
  const plan = files.get("plan/index.html") ?? "";
  assert.match(plan, /Settle who invites/);
  assert.match(plan, /href="\.\.\/review\/index\.html#q-task-t-need"/);
  assert.doesNotMatch(plan, /Recommended/, "the plan does not repeat the context");
  assert.doesNotMatch(plan, /Plan <span class="nav-count"/);
  const review = files.get("review/index.html") ?? "";
  assert.match(review, /Questions <span class="nav-count" data-total="2" id="nav-questions-count">2<\/span>/);
  assert.match(review, /data-kind="need" data-target="t-need"/);
  assert.match(review, /I've done this/);
  assert.match(review, /Holds up <a href="[^"]*">Settle who invites<\/a>/);
  assert.match(review, /not served by <code>pnpm portal:serve<\/code>/, "the fallback line is on the page");
  const index = files.get("index.html") ?? "";
  assert.match(index, /Latest note: three things wait\./);
  assert.match(index, /href="review\/index\.html"/);
  const twins = twinsOf(site);
  assert.match(twins.get("plan.md") ?? "", /1\. `t-doing`/);
  assert.equal((JSON.parse(twins.get("data/plan.json") ?? "{}") as { type: string }).type, "plan");
  assert.match(twins.get("llms.txt") ?? "", /\(plan\.md\)/);
});

test("the portal check compares the Questions list with the judgments list plus the plan's needs of the owner", () => {
  const { input } = withPlan();
  const site = buildSite(input);
  const files = new Map([...renderSite(site, fixtureAssets), ...twinsOf(site)]);
  const want = { problems: [], tasks: 3, ownerNeeds: ["t-need"] };
  const ok = portalCheck(files, files, expect(input.book, input.waits, null, want));
  assert.deepEqual(ok.filter((o) => o.failures > 0).map((o) => o.check), []);
  const missing = portalCheck(files, files, expect(input.book, input.waits, null, { ...want, ownerNeeds: ["t-need", "t-other"] }));
  assert.ok(missing.some((o) => o.failures > 0 && o.check.includes("Questions list")));
  const bad = portalCheck(files, files, expect(input.book, input.waits, null, { ...want, problems: ["t1: it is doing, and names no thread"], tasks: 4 }));
  assert.equal(bad.filter((o) => o.failures > 0).length, 2);
  assert.equal(passed(bad), false);
});

test("with no plan file the page says so, and holds nothing else", () => {
  const site = buildSite(fixtureInput());
  const page = site.pages.find((p) => p.id === "plan");
  assert.ok(page?.type === "plan");
  assert.equal(page.present, false);
  const html = renderSite(site, fixtureAssets).get("plan/index.html") ?? "";
  assert.match(html, /plan\/plan\.json<\/code> is absent/);
  assert.doesNotMatch(renderSite(site, fixtureAssets).get("index.html") ?? "", /Where the plan is/);
});
