// Records the evidence: every screen at 390 (2x, light and dark, full length) and 1440 (light), and three videos at
// 390 by 844: answering an ask, walking plan to milestone to step and back, and playing a sitrep.
//   node spikes/sitrep/prototype/record.cjs [folder]
const fs = require("fs"), path = require("path");
const { launch, open, tab, settle, snapshot } = require("./harness.cjs");

const out = process.argv[2] || path.join(process.cwd(), "prototype-evidence");
fs.mkdirSync(out, { recursive: true });
const shots = [];
const m3 = snapshot.milestones.find((m) => m.id === "3") || snapshot.milestones[0];
const s36 = snapshot.steps.find((s) => s.id === "3.6") || snapshot.steps[0];

// Each screen: how to reach it from a fresh page, and what it shows.
const SCREENS = [
  ["now", "Now: the two asks, threads waiting on Aaron, health, new sitreps", async (p) => {}],
  ["now-answered", "Now: an ask answered in place, with the undo toast", async (p) => { await p.locator("article.ask .option").nth(2).click(); }],
  ["now-details", "Now: an ask's Details open (problem, context, rubric, trade-offs, why)", async (p) => { await p.locator("article.ask .fold-head").first().click(); await settle(p); await p.locator("article.ask .details").first().scrollIntoViewIfNeeded(); }],
  ["now-empty", "Now, empty: 'Nothing needs you'", null, "empty"],
  ["ask", "An ask's page with its history", async (p) => { await p.locator("article.ask .option").first().click(); await p.locator("article.ask >> text=History").first().click(); }],
  ["plan", "Plan: the written plan, its state, the burn-down with its verdict, the milestones, its history", async (p) => { await tab(p, "plan"); }],
  ["milestone", "A milestone: goal, why now, done-when, progress, burn-down, Moving, Not started, Done (n) folded", async (p) => { await tab(p, "plan"); await p.click(`button[aria-label="Milestone ${m3.id}: ${m3.fields.title}"]`); }],
  ["step", "A step: state, what, why, done-when, what it needs, lane, proof, pull requests, the ratchet it closes, history", async (p) => { await tab(p, "plan"); await p.click(`button[aria-label="Milestone ${m3.id}: ${m3.fields.title}"]`); await settle(p); await p.locator(".stack-page.pushed .row, .panel .row", { hasText: s36.fields.title }).first().click(); }],
  ["lanes", "Lanes: one row per lane, other threads; the stale source in amber", async (p) => { await tab(p, "lanes"); }],
  ["lane", "A lane: lead, steps, pull requests with states, threads, sitreps, history", async (p) => { await tab(p, "lanes"); await p.locator(".lane-row").first().click(); }],
  ["measures", "Measures: ratchet cards with sparklines and verdicts, the uncounted folded, the budget bar past 1.5x, evals", async (p) => { await tab(p, "measures"); }],
  ["sitreps", "Sitreps: day groups, unheard bold with a dot", async (p) => { await tab(p, "sitreps"); }],
  ["sitrep-playing", "Sitreps: one folded open and playing, the mini player with its parts bar, one partly heard", async (p) => { await tab(p, "sitreps"); await p.locator(".sitrep-row").nth(1).click(); await p.locator(".sitrep-item").nth(1).locator(".part-btn").last().click(); await p.waitForTimeout(400); await p.click('.player [aria-label="Stop"]'); await p.locator(".sitrep-row").first().click(); await p.locator("button.btn.primary", { hasText: "Play" }).click(); await p.waitForTimeout(400); }],
  ["sitreps-no-tts", "Sitreps where reading aloud is not available: the note, and the text still readable", async (p) => { await tab(p, "sitreps"); await p.locator(".sitrep-row").first().click(); }, null, false],
  ["loading", "Loading: the skeleton", null, "loading"],
  ["error", "Error: the snapshot refused, said plainly", null, "error"],
];

async function shoot(width, scheme, scale, full) {
  for (const [name, what, go, hash, tts = true] of SCREENS) {
    const { p, ctx, errors } = await open({ width, scheme, scale, hash: hash || "", tts, lineMs: 1500, height: width > 900 ? 900 : 844 });
    if (go) { await go(p); await settle(p, 400); }
    if (full) {
      const h = await p.evaluate(() => { const pg = [...document.querySelectorAll(".stack-page:not(.under) .page")].pop(); return pg ? pg.scrollHeight : innerHeight; });
      const keep = await p.evaluate(() => { const pg = [...document.querySelectorAll(".stack-page:not(.under) .page")].pop(); return pg ? pg.scrollTop : 0; });
      if (!keep) { await p.setViewportSize({ width, height: Math.max(844, Math.min(h, 6000)) }); await settle(p, 300); }
    }
    await p.mouse.move(1, 1); await settle(p, 200);
    const file = `${name}-${width}-${scheme}.png`;
    await p.screenshot({ path: path.join(out, file) });
    shots.push([file, what + (errors.length ? " (console errors: " + errors.join(" | ") + ")" : "")]);
    await ctx.close();
  }
}

async function film(name, what, steps) {
  const dir = path.join(out, ".video-" + name);
  const { p, ctx } = await open({ width: 390, height: 844, lineMs: 1800, video: { dir, size: { width: 390, height: 844 } } });
  await settle(p, 800);
  await steps(p);
  await settle(p, 1200);
  const v = p.video();
  await ctx.close();
  await v.saveAs(path.join(out, name + ".webm"));
  fs.rmSync(dir, { recursive: true, force: true });
  shots.push([name + ".webm", what]);
}
const slow = (p, ms = 900) => p.waitForTimeout(ms);

(async () => {
  const browser = await launch();
  await shoot(390, "light", 2, true);
  await shoot(390, "dark", 2, true);
  await shoot(1440, "light", 1, false);
  await film("video-answer-an-ask", "Answering an ask: open Details, choose an option, undo, answer in my own words, open its history", async (p) => {
    const card = p.locator("article.ask").first();
    await card.locator(".fold-head").click(); await slow(p, 1400); await card.locator(".fold-head").click(); await slow(p);
    await card.locator(".option").nth(2).click(); await slow(p, 1400);
    await p.click(".toast button"); await slow(p);
    await card.locator(".own-option").click(); await slow(p, 500);
    await card.locator("textarea").pressSequentially("Start with company journeys, and write up what breaks.", { delay: 25 }); await slow(p, 500);
    await card.locator("text=Send answer").click(); await slow(p, 1400);
    await card.locator("text=History").click(); await slow(p, 1400);
    await p.locator(".stack-page.pushed .page").evaluate((e) => e.scrollTo({ top: e.scrollHeight, behavior: "smooth" })); await slow(p, 1400);
  });
  await film("video-plan-milestone-step", "Walking the plan: Plan, a milestone, a step, the step it needs, then back to the plan", async (p) => {
    await tab(p, "plan"); await slow(p);
    await p.locator(".page").first().evaluate((e) => e.scrollTo({ top: 900, behavior: "smooth" })); await slow(p, 1200);
    await p.click(`button[aria-label="Milestone ${m3.id}: ${m3.fields.title}"]`); await slow(p, 1200);
    await p.locator(".stack-page.pushed .row", { hasText: s36.fields.title }).first().click(); await slow(p, 1200);
    await p.locator(".stack-page.pushed .page").evaluate((e) => e.scrollTo({ top: 500, behavior: "smooth" })); await slow(p, 1000);
    await p.locator(`.stack-page.pushed section[aria-labelledby="sec-needs-${s36.id}"] .row`).first().click(); await slow(p, 1200);
    for (let i = 0; i < 3; i++) { await p.locator(".stack-page.pushed .back").click(); await slow(p, 1000); }
  });
  await film("video-play-a-sitrep", "Playing a sitrep: open it, play, pause, resume, forward, back, speed 1.5, jump by the parts bar, stop, play to the end, heard", async (p) => {
    await tab(p, "sitreps"); await slow(p);
    const row = p.locator(".sitrep-item").first();
    await row.locator(".sitrep-row").click(); await slow(p);
    await row.locator("button.btn.primary", { hasText: "Play" }).click(); await slow(p, 1400);
    await p.click(".player .play"); await slow(p, 1000); await p.click(".player .play"); await slow(p, 1000);
    await p.click('.player [aria-label="Forward one part"]'); await slow(p, 1000);
    await p.click('.player [aria-label="Back one part"]'); await slow(p, 1000);
    await p.click(".player .speed"); await slow(p, 700); await p.click('.speeds button:has-text("1.5×")'); await slow(p, 900);
    await p.locator(".parts button").last().click(); await slow(p, 900);
    await p.click('.player [aria-label="Stop"]'); await slow(p, 1000);
    await row.locator(".part-btn").last().click();
    await p.waitForFunction(() => window.__log.states.slice(-1)[0] === "idle", null, { timeout: 15000 }); await slow(p, 1400);
  });
  await browser.close();
  const md = ["# Evidence: the Sitrep prototype", "", "Recorded by `spikes/sitrep/prototype/record.cjs` from `sitrep.html`, built from `snapshot.json` (the blueprint's projection of `events.jsonl`). Screens at 390 are full length at 2x; the tab bar sits at the bottom of each. The fake `window.claude` follows `tts.d.ts`.", "",
    "| File | What it shows |", "|---|---|", ...shots.map(([f, w]) => `| \`${f}\` | ${w} |`), ""];
  fs.writeFileSync(path.join(out, "EVIDENCE.md"), md.join("\n"));
  console.log(`${shots.length} files in ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
