// Tests the prototype in Chromium, with a fake window.claude whose tts follows tts.d.ts.
//   node spikes/sitrep/prototype/build.mjs && node spikes/sitrep/prototype/test.cjs
// Exits non-zero if any check fails.
const { launch, open, tab, settle, snapshot } = require("./harness.cjs");

let failures = 0;
function check(ok, what) { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures++; }
const visible = (p, sel) => p.locator(sel).first().isVisible();
const text = (p, sel) => p.locator(sel).first().innerText();

// A milestone with a moving step that needs another, for the walk.
const ix = Object.fromEntries(snapshot.steps.map((s) => [s.id, s]));
const walk = (() => {
  for (const m of snapshot.milestones) for (const id of m.fields.steps) {
    const s = ix[id];
    if (s && s.state === "active" && s.fields.needs.some((n) => ix[n])) return { m, s, need: ix[s.fields.needs.find((n) => ix[n])] };
  }
})();

async function widths() {
  for (const width of [390, 768, 1440]) for (const scheme of ["light", "dark"]) {
    const { p, ctx, errors } = await open({ width, scheme, height: width > 900 ? 900 : 844 });
    const where = `${width} ${scheme}: `;
    let wide = true;
    for (const t of ["now", "plan", "lanes", "measures", "sitreps"]) {
      await tab(p, t); await settle(p, 150);
      wide = wide && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth));
    }
    check(wide, where + "no sideways scroll on any tab");
    check((await p.locator("[data-tab]:visible").count()) === 5, where + "five tabs present");
    check(errors.length === 0, where + "no console errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await ctx.close();
  }
}

async function screens() {
  const { p, ctx, errors } = await open({ width: 390 });
  check(await visible(p, "article.ask"), "Now: an ask card");
  check((await p.locator("article.ask .option.recommended").count()) === 2, "Now: each ask has one recommended option");
  check(await p.locator("text=Answer in my own words").first().isVisible(), "Now: the last option is 'Answer in my own words'");
  const health = await text(p, "section[aria-labelledby=sec-health]");
  check(health.includes("master") && health.includes("Last full run"), "Now: health shows master and the last full run");
  check((await text(p, "section[aria-labelledby=sec-new]")).includes(snapshot.sitreps[snapshot.sitreps.length - 1].fields.title), "Now: new sitreps");
  await p.click("article.ask .fold-head");
  const details = await text(p, "article.ask .details");
  check(["Problem", "Context", "Rubric", "Why this recommendation"].every((w) => details.toUpperCase().includes(w.toUpperCase())), "Now: Details holds problem, context, rubric and why");
  await tab(p, "plan");
  const plan = await text(p, ".page");
  check(plan.includes("Agreed by Aaron, 17:20"), "Plan: its state, agreed by Aaron at 17:20");
  check(["WHY", "WHAT", "WHERE IT ENDS", "WHAT IT LEAVES OUT"].every((w) => plan.toUpperCase().includes(w)), "Plan: why, what, where it ends, what it leaves out");
  check(await visible(p, ".verdict") && (await p.locator(".chart svg").count()) > 0, "Plan: burn-down with a verdict");
  check((await p.locator("section[aria-labelledby=sec-ms] .row").count()) === snapshot.milestones.length, "Plan: every milestone");
  check(plan.includes("History"), "Plan: ends with its history");
  await tab(p, "lanes");
  check((await p.locator(".lane-row").count()) === snapshot.lanes.length, "Lanes: one row per lane");
  check(await visible(p, ".section-foot.stale"), "Lanes: a source older than 30 minutes shows its age in amber");
  await p.click(".lane-row"); await settle(p);
  const lane = await text(p, ".stack-page.pushed");
  check(["Lead", "Steps", "Pull requests", "History"].every((w) => lane.includes(w)), "Lane page: lead, steps, pull requests, history");
  await tab(p, "measures");
  check((await p.locator(".trend").count()) === snapshot.derived.measures.ratchets.filter((r) => r.count != null).length, "Measures: a card per counted ratchet");
  check((await text(p, ".page")).includes("Down 14 today"), "Measures: a verdict, 'Down 14 today'");
  check(await visible(p, ".budget-bar.over"), "Measures: the run's budget bar is red past 1.5 times");
  check((await text(p, ".page")).includes("Not measured yet"), "Measures: evals not measured yet");
  check(await p.locator("text=/Not counted yet \\(\\d+\\)/").isVisible(), "Measures: uncounted ratchets folded");
  await tab(p, "sitreps");
  check(await visible(p, ".day-head") && (await p.locator(".dot-unheard").count()) === snapshot.sitreps.length, "Sitreps: day groups, unheard with a dot");
  check(errors.length === 0, "screens: no console errors");
  await ctx.close();
}

async function asking() {
  const { p, ctx } = await open({ width: 390 });
  const card = p.locator("article.ask").first();
  const id = await card.getAttribute("data-ask");
  const badge = async () => Number((await p.locator("[data-tab=now] .badge").innerText().catch(() => "0")) || 0);
  check((await badge()) === 2, "ask: the Now badge counts 2");
  await card.locator(".option").first().click();
  check(await card.evaluate((e) => e.classList.contains("resolved")), "ask: answering with an option resolves the card in place");
  check(await p.locator(".toast", { hasText: "Answered A" }).isVisible(), "ask: an undo toast");
  check((await badge()) === 1, "ask: the badge falls to 1");
  await p.click(".toast button");
  check(!(await card.evaluate((e) => e.classList.contains("resolved"))), "ask: undo opens it again");
  await card.locator(".own-option").click();
  await card.locator("textarea").fill("Start with company journeys, and write up what breaks.");
  await card.locator("text=Send answer").click();
  check(await card.evaluate((e) => e.classList.contains("resolved")), "ask: answered in my own words");
  await card.locator("text=History").click(); await settle(p);
  const hist = await text(p, ".stack-page.pushed .history");
  check((await text(p, ".stack-page.pushed")).includes(snapshot.asks.find((a) => a.id === id).fields.question), "ask: its page shows the ask");
  check(hist.includes("Answered") && hist.includes("Aaron") && hist.includes("write up what breaks"), "ask: the answer is in its history, by Aaron, with the time");
  check(!hist.includes("Chose A"), "ask: the undone answer is not in its history");
  await ctx.close();
}

async function walking() {
  const { p, ctx } = await open({ width: 390 });
  await tab(p, "plan");
  const title = () => p.locator(".stack-page:not(.under) h1").last().innerText();
  await p.click(`button[aria-label="Milestone ${walk.m.id}: ${walk.m.fields.title}"]`); await settle(p);
  check((await title()) === walk.m.fields.title, "walk: Plan, then milestone " + walk.m.id);
  const mpage = await text(p, ".stack-page.pushed");
  check(["GOAL", "WHY NOW", "DONE WHEN"].every((w) => mpage.toUpperCase().includes(w)) && mpage.includes("Moving") && /Done \(\d+\)/.test(mpage), "walk: the milestone's goal, why now, done-when, Moving, Done (n)");
  await p.locator(".stack-page.pushed .row", { hasText: walk.s.fields.title }).first().click(); await settle(p);
  check((await title()) === walk.s.fields.title, "walk: then step " + walk.s.id);
  const spage = await text(p, ".stack-page.pushed");
  check(["WHAT", "WHY", "DONE WHEN"].every((w) => spage.toUpperCase().includes(w)) && ["Needs", "Lane", "Proof", "History"].every((w) => spage.includes(w)), "walk: the step's what, why, done-when, needs, lane, proof, history");
  await p.locator(`.stack-page.pushed section[aria-labelledby="sec-needs-${walk.s.id}"] .row`, { hasText: walk.need.fields.title }).first().click(); await settle(p);
  check((await title()) === walk.need.fields.title, "walk: then the step it needs, " + walk.need.id);
  await p.locator(".stack-page.pushed .back").click(); await settle(p);
  check((await title()) === walk.s.fields.title, "walk: back to step " + walk.s.id);
  await p.locator(".stack-page.pushed .back").click(); await settle(p);
  check((await title()) === walk.m.fields.title, "walk: back again, to the milestone");
  await p.locator(".stack-page.pushed .back").click(); await settle(p);
  check((await p.locator(".stack-page.pushed").count()) === 0 && (await title()) === snapshot.plan.fields.title, "walk: and back to the plan, where it started");
  await ctx.close();
}

async function playing() {
  const { p, ctx, errors } = await open({ width: 390 });
  const log = () => p.evaluate(() => window.__log);
  await tab(p, "sitreps");
  const row = p.locator(".sitrep-item").first();
  const sid = await row.getAttribute("data-sitrep");
  const parts = snapshot.sitreps.find((s) => s.id === sid).fields.parts.length;
  await row.locator(".sitrep-row").click();
  check(await row.locator(".part-btn").first().isVisible(), "player: the sitrep folds open with its parts");
  await row.locator("button.btn.primary", { hasText: "Play" }).click();
  await p.waitForSelector(".player"); await settle(p, 100);
  check((await log()).speaks.length === 1 && (await log()).speaks[0].ids[0] === "0", "player: play speaks from the first part");
  await p.click(".player .play"); await settle(p, 100);
  check((await p.locator(".player").innerText()).includes("Paused"), "player: pause");
  await p.click(".player .play"); await settle(p, 100);
  check(!(await p.locator(".player").innerText()).includes("Paused") && (await log()).states.slice(-1)[0] === "speaking", "player: resume");
  await p.click('.player [aria-label="Forward one part"]'); await settle(p, 100);
  check((await log()).speaks.slice(-1)[0].ids[0] === "1", "player: forward starts the next part");
  await p.click('.player [aria-label="Back one part"]'); await settle(p, 100);
  check((await log()).speaks.slice(-1)[0].ids[0] === "0", "player: back starts the part before");
  await p.click(".player .speed"); await p.click('.speeds button:has-text("1.5×")');
  check((await log()).rates.includes(1.5) && (await p.locator(".player .speed").innerText()) === "1.5×", "player: speed 1.5, and setRate(1.5) called");
  await p.click(`.parts button[aria-label="Play part ${parts}"]`); await settle(p, 100);
  check((await log()).speaks.slice(-1)[0].ids[0] === String(parts - 1) && (await log()).speaks.slice(-1)[0].rate === 1.5, "player: the parts bar jumps to the last part, at 1.5");
  await p.click('.player [aria-label="Stop"]'); await settle(p, 100);
  check((await p.locator(".player").count()) === 0, "player: stop closes the player");
  check(!(await row.evaluate((e) => e.classList.contains("heard"))), "player: a stopped sitrep is not marked heard");
  await row.locator(".part-btn").last().click();
  await p.waitForFunction(() => window.__log.states.slice(-1)[0] === "idle", null, { timeout: 5000 }); await settle(p, 100);
  check(await row.evaluate((e) => e.classList.contains("heard")), "player: heard to the end, the sitrep shows as heard");
  check((await row.innerText()).includes("Heard") && (await text(p, `.sitrep-item[data-sitrep="${sid}"] .history`)).includes("Aaron"), "player: a sitrep_heard event by Aaron in its history");
  check(errors.length === 0, "player: no console errors");
  await ctx.close();
  const off = await open({ width: 768, tts: false });
  await tab(off.p, "sitreps");
  check(await off.p.locator("text=Reading aloud is not available here").isVisible(), "no tts: the page says reading aloud is not available here");
  await off.p.locator(".sitrep-row").first().click();
  check(await off.p.locator(".part-btn").first().isVisible() && (await off.p.locator(".player").count()) === 0, "no tts: the text stays readable, no player");
  await off.ctx.close();
}

async function keyboard() {
  const { p, ctx } = await open({ width: 1440, height: 900 });
  const controls = await p.evaluate(() => [...document.querySelectorAll("button:not([disabled]), a[href], textarea")].filter((e) => e.offsetParent && !e.closest("[inert]")).length);
  const seen = new Set(); let ring = true, missing = [];
  for (let i = 0; i < controls + 5; i++) {
    await p.keyboard.press("Tab");
    const r = await p.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      if (!e.dataset.k) e.dataset.k = Math.random().toString(36).slice(2);
      const s = getComputedStyle(e);
      return { k: e.dataset.k, ring: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2, name: e.getAttribute("aria-label") || e.innerText.slice(0, 30) };
    });
    if (r) { seen.add(r.k); if (!r.ring) { ring = false; missing.push(r.name); } }
  }
  check(seen.size >= controls, `keyboard: Tab reaches every control on Now (${seen.size} of ${controls})`);
  check(ring, "keyboard: every focused control shows a focus ring" + (missing.length ? ": " + missing.slice(0, 3).join(", ") : ""));
  await p.locator("article.ask .fold-head").first().click();
  check((await p.locator("article.ask .fold-head").first().getAttribute("aria-expanded")) === "true", "keyboard: Details open");
  await p.keyboard.press("Escape");
  check((await p.locator("article.ask .fold-head").first().getAttribute("aria-expanded")) === "false", "keyboard: Escape closes the fold");
  await tab(p, "plan"); await p.locator("section[aria-labelledby=sec-ms] .row").first().click(); await settle(p);
  check(await visible(p, ".panel"), "keyboard: a milestone opens in the right panel");
  await p.keyboard.press("Escape"); await settle(p);
  check((await p.locator(".panel").count()) === 0, "keyboard: Escape closes the panel");
  await tab(p, "sitreps"); await p.locator(".sitrep-row").first().click();
  await p.keyboard.press("Escape");
  check((await p.locator(".sitrep-open").count()) === 0, "keyboard: Escape closes the open sitrep");
  await ctx.close();
}

async function motionAndStates() {
  const { p, ctx } = await open({ width: 390, reducedMotion: "reduce" });
  await tab(p, "plan"); await p.locator(".group .row").first().click();
  const anims = await p.evaluate(() => document.getAnimations().length);
  const trans = await p.evaluate(() => getComputedStyle(document.querySelector(".stack-page.under")).transitionDuration);
  check(anims === 0 && /^0s/.test(trans), "reduced motion: no animation or transition runs");
  await ctx.close();
  const load = await open({ width: 390, hash: "loading" });
  check(await load.p.locator(".skeleton").isVisible(), "state: loading shows a skeleton");
  await load.ctx.close();
  const err = await open({ width: 390, hash: "error" });
  check(await err.p.locator("[role=alert]", { hasText: "could not be shown" }).isVisible(), "state: error explains itself");
  await err.ctx.close();
  const empty = await open({ width: 390, hash: "empty" });
  check(await empty.p.locator("text=Nothing needs you").isVisible(), "state: empty says 'Nothing needs you'");
  await empty.ctx.close();
}

(async () => {
  const browser = await launch();
  try {
    for (const t of [widths, screens, asking, walking, playing, keyboard, motionAndStates]) {
      try { await t(); } catch (e) { check(false, t.name + " threw: " + e.message.split("\n")[0]); }
    }
  } finally { await browser.close(); }
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
