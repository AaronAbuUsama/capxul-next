import assert from "node:assert/strict";
import { test } from "node:test";

import { apply, check } from "@capxul/plan";
import { EMPTY_PLAN, type Command, type Facts, type Plan } from "@capxul/plan";
import { check as portalCheck, expect, passed } from "#src/modules/check/service.ts";
import { renderSite } from "#src/modules/render/service.ts";
import { buildSite } from "#src/modules/site/service.ts";
import type { PlanInput, PlanPage, Site } from "#src/modules/site/types.ts";
import { twinsOf } from "#src/modules/twins/service.ts";

import { planPagesOf } from "./load.ts";
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
    { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t-decide", title: "Settle who invites", why: "Invitations are grants.", milestone: "m1" },
    { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t-need", title: "Sign in to the cloud", why: "A machine needs an account.", milestone: "m1" },
    { kind: "task.add", what: "What it is.", doneWhen: ["It is done."], id: "t-doing", title: "Write the page", why: "So it is visible.", milestone: "m1" },
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

const OUTLINE = [
  "# The plan", "", "## Where we are going", "Capxul is the on-chain company. It runs on **Frappe** with `Core` built in.", "",
  "## What this goal is", "Two things.", "", "1. **The book fully specifies it.** Every operation.", "2. **One shared world runs a thin line.** On a machine.", "",
  "## How we get there", "Six milestones.", "", "## How the work runs", "- One coordinator writes the plan.", "- See [the book](docs/design-book.md) and `plan/plan.json`.", "",
  "## What is not in this goal", "OpenFort sign-in.", "",
].join("\n");
const taskFile = (what: string): string => `## What\n${what}\n\n## Why\nBecause.\n\n## Done when\n- It works.\n- It is tested.\n\n## Links\n- \`docs/mission/cloud.md\`\n`;

const withPlan = (): { readonly site: Site; readonly page: PlanPage; readonly input: ReturnType<typeof fixtureInput> } => {
  const base = fixtureInput();
  const { plan } = planOf(base);
  const log = [{ at: "2026-11-10T09:00:00.000Z", by: "coordinator", action: "task.add", args: { id: "t-doing" }, commit: "abc1234" }];
  const files = {
    outline: OUTLINE, milestones: { m1: "## What it delivers\nA book that is fit. Nothing is guessed.\n\n## How we know it is done\nThe exit lines." },
    tasks: { "t-decide": taskFile("Decide who invites. Then write it down."), "t-need": taskFile("Sign in to the cloud."), "t-doing": taskFile("Write the page. It reads top to bottom. Then more.") },
  };
  const held: PlanInput = { plan, files, log, problems: [] };
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
  assert.deepEqual(page.path?.steps.map((t) => t.task.id), ["t-doing", "t-need"]);
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
  assert.match(twins.get("plan.md") ?? "", /1\. \*\*\[Write the page\]\(plan\/task\/t-doing\.md\)\*\* \(doing, thread plan-page\)/);
  assert.equal((JSON.parse(twins.get("data/plan.json") ?? "{}") as { type: string }).type, "plan");
  assert.match(twins.get("llms.txt") ?? "", /\(plan\.md\)/);
});

test("the portal check compares the Questions list with the judgments list plus the plan's needs of the owner", () => {
  const { input } = withPlan();
  const site = buildSite(input);
  const files = new Map([...renderSite(site, fixtureAssets), ...twinsOf(site)]);
  const want = { problems: [], tasks: 3, ownerNeeds: ["t-need"], pages: planPagesOf(input) };
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

test("the plan page reads top to bottom: where we are going, where we are, what is next, what I need, the whole plan, how it runs, recent changes", () => {
  const { site } = withPlan();
  const html = renderSite(site, fixtureAssets).get("plan/index.html") ?? "";
  const order = ["id=\"going\"", "id=\"goal\"", "id=\"where\"", "id=\"next\"", "id=\"you\"", "id=\"whole\"", "id=\"runs\"", "id=\"not\"", "id=\"log\""].map((m) => html.indexOf(m));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > (order[i - 1] ?? 0))), JSON.stringify(order));
  assert.match(html, /<h1 class="title">Plan<\/h1><p class="lead">The goal title<\/p>/, "a short headline: Plan, and the goal's title under it");
  assert.match(html, /<strong>Frappe<\/strong>/, "the outline is rendered as Markdown");
  assert.match(html, /<code>Core<\/code>/);
  assert.match(html, /<code class="path">plan\/plan\.json<\/code>/, "a repository path is shown as a path");
  assert.match(html, /the book <code class="path">docs\/design-book\.md<\/code>/, "a link to a repository path is shown as a path");
  assert.match(html, /Write the page\. It reads top to bottom\./, "a step shows the first two sentences of its What");
  assert.doesNotMatch(html, /Then more\./);
  assert.match(html, /<li>It works\.<\/li><li>It is tested\.<\/li>/, "and its Done-when bullets");
  assert.match(html, /href="task\/t-doing\/index\.html"|href="\.\/task\/t-doing\/index\.html"|href="task\/t-doing\//, "a step links to its page");
  assert.match(html, /A book that is fit\./, "the milestone row shows the first sentence of What it delivers");
  assert.match(html, /2 things wait on you: /);
  assert.equal(html.split("The exit lines.").length - 1, 1, "How we know it is done appears once");
  assert.equal(html.split("Because.").length - 1, 0, "a task's Why is on its page, not repeated here");
});

test("a page per task and per milestone, with Markdown and JSON twins: the whole file, links both ways, history from the log", () => {
  const { site } = withPlan();
  const files = renderSite(site, fixtureAssets);
  const task = files.get("plan/task/t-doing/index.html") ?? "";
  assert.match(task, /<h2>What<\/h2>/);
  assert.match(task, /<h2>Done when<\/h2>/);
  assert.match(task, /<code class="path">docs\/mission\/cloud\.md<\/code>/);
  assert.match(task, /Step 1 of 2 on the critical path/);
  assert.match(task, /plan-page/, "its thread");
  assert.match(task, /<h2 id="history">History<\/h2>/, "history from the log");
  const waiting = files.get("plan/task/t-need/index.html") ?? "";
  assert.match(waiting, /sign in on this Mac/);
  assert.match(waiting, /Answer it on the Questions page/);
  const m1 = files.get("plan/milestone/m1/index.html") ?? "";
  assert.match(m1, /How we know it is done/);
  assert.match(m1, /Settle who invites/, "its tasks");
  const twins = twinsOf(site);
  for (const id of ["plan/task/t-doing", "plan/milestone/m1"]) {
    assert.ok(twins.has(`${id}.md`) && twins.has(`data/${id}.json`), `no twins for ${id}`);
  }
  assert.equal((JSON.parse(twins.get("data/plan/task/t-doing.json") ?? "{}") as { type: string }).type, "plan-task");
  assert.match(twins.get("plan/task/t-doing.md") ?? "", /## Done when/);
  assert.match(twins.get("plan.md") ?? "", /## Where we are going/);
});

test("the Overview's plan block gives the goal in two sentences, the latest note, and links to Plan and Questions", () => {
  const { site } = withPlan();
  const page = site.pages.find((p) => p.id === "index");
  assert.ok(page?.type === "overview");
  assert.equal(page.planGoal, "The book fully specifies it. One shared world runs a thin line.");
  const html = renderSite(site, fixtureAssets).get("index.html") ?? "";
  assert.match(html, /Latest note: three things wait\./);
  assert.match(html, /href="plan\/index\.html"/);
  assert.match(html, /href="review\/index\.html"/);
});
