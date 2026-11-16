// Tests the sitrep template with a fake `window.claude` (db, user, tts) fed from example/*.json.
//   node .agents/skills/sitrep/test.cjs            # uses the preinstalled Playwright and Chromium
// Writes screenshots to $SITREP_SHOTS (default: a temp folder) and exits non-zero on the first failure.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");

const here = __dirname;
const template = fs.readFileSync(path.join(here, "template.html"), "utf8");
const example = (f) => JSON.parse(fs.readFileSync(path.join(here, "example", f), "utf8"));
const shots = process.env.SITREP_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "sitrep-"));
fs.mkdirSync(shots, { recursive: true });
// The publish skeleton the artifact service wraps a page in.
const page = (body) => `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;

// The fake platform, injected before the page's script runs.
function fakeClaude({ data, opts }) {
  const log = (window.__log = { writes: [], speaks: [], rates: [], calls: [] });
  const store = data;
  const snap = (id, d) => ({ id, exists: d != null, fromCache: false, data: () => d && JSON.parse(JSON.stringify(d)) });
  const db = {
    doc(p) {
      return {
        onSnapshot(next) { setTimeout(() => next(snap(p.split("/").pop(), store[p])), 30); return () => {}; },
        set(d) { store[p] = d; log.writes.push([p, d]); return Promise.resolve(); },
      };
    },
    collection(p) {
      const q = { orderBy() { return q; }, limit() { return q; },
        onSnapshot(next) { setTimeout(() => next({ fromCache: false, docs: (store[p] || []).map((r) => snap(r.id, r)) }), 30); return () => {}; } };
      return q;
    },
  };
  const h = { state: [], line: [], pos: [] };
  let timers = [], reject = null, paused = false, queue = [], idx = 0;
  const emit = (k, e) => h[k].forEach((f) => f(e));
  function step() {
    if (paused) return;
    if (idx >= queue.length) { const r = reject; reject = null; emit("state", { state: "idle", reason: "completed" }); return r && r.done(); }
    const l = queue[idx++]; emit("line", { line: idx - 1, id: l.id }); emit("pos", { ms: 0, id: l.id });
    timers.push(setTimeout(step, 120));
  }
  const tts = {
    speak(lines, o) {
      log.speaks.push({ ids: lines.map((l) => l.id), rate: o && o.rate });
      timers.forEach(clearTimeout); timers = [];
      if (reject) { reject.fail({ code: "stopped", reason: "replaced" }); emit("state", { state: "idle", reason: "replaced" }); }
      queue = lines; idx = 0; paused = false;
      return new Promise((done, fail) => { reject = { done, fail }; emit("state", { state: "starting" }); timers.push(setTimeout(() => { emit("state", { state: "speaking" }); step(); }, 20)); });
    },
    stop() { timers.forEach(clearTimeout); timers = []; if (reject) reject.fail({ code: "stopped", reason: "stopped" }); reject = null; emit("state", { state: "idle", reason: "stopped" }); return Promise.resolve(); },
    pause() { paused = true; timers.forEach(clearTimeout); timers = []; emit("state", { state: "paused" }); return Promise.resolve(); },
    resume() { paused = false; emit("state", { state: "speaking" }); step(); return Promise.resolve(); },
    setRate(r) { log.rates.push(r); return Promise.resolve(); },
    onState(f) { h.state.push(f); return () => {}; }, onLine(f) { h.line.push(f); return () => {}; }, onPosition(f) { h.pos.push(f); return () => {}; },
  };
  const user = { id: () => Promise.resolve("u_test") };
  window.claude = { use: (n) => { log.calls.push(n); return Promise.resolve(n === "db" ? (opts.db ? db : null) : n === "user" ? user : n === "tts" ? (opts.tts ? tts : null) : null); } };
}

let failures = 0;
function check(ok, what) { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures++; }

async function open(browser, { width, height = 900, scheme = "light", data, db = true, tts = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
  await p.addInitScript(fakeClaude, { data, opts: { db, tts } });
  await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const file = path.join(shots, "page.html");
  fs.writeFileSync(file, page(template));
  await p.goto("file://" + file, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(250);
  return { p, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();
  const full = { "sitrep/numbers": example("numbers.json"), "sitrep/now": example("now.json"), sitreps: example("sitreps.json") };

  const tab = (p, name) => p.click(`.tabbar .tab >> text=${name}`);

  // 1. Every width and theme: renders, no sideways scroll, no errors, the five tabs.
  for (const width of [390, 768, 1440]) for (const scheme of ["light", "dark"]) {
    const { p, ctx, errors } = await open(browser, { width, scheme, data: JSON.parse(JSON.stringify(full)) });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= width, `${width} ${scheme}: no sideways scroll (${sw})`);
    check((await p.locator(".tabbar .tab").count()) === 5, `${width} ${scheme}: five tabs`);
    check(await p.isVisible("text=Nothing needs you"), `${width} ${scheme}: Now says nothing needs you`);
    check(await p.isVisible("text=Master is green"), `${width} ${scheme}: Now shows master's health`);
    await tab(p, "Plan");
    check(await p.isVisible("text=Foundations core"), `${width} ${scheme}: Plan shows the next milestone`);
    check(errors.length === 0, `${width} ${scheme}: no errors ${errors.join(" | ")}`);
    await p.screenshot({ path: path.join(shots, `plan-${width}-${scheme}.png`), fullPage: true });
    await ctx.close();
  }

  // 2. Interactions at phone width.
  {
    const { p, ctx, errors } = await open(browser, { width: 390, data: JSON.parse(JSON.stringify(full)) });
    await tab(p, "Plan");
    const chart = p.locator(".chartbox svg.chart").first();
    await chart.scrollIntoViewIfNeeded();
    const b2 = await chart.boundingBox();
    await p.mouse.move(b2.x + b2.width * 0.5, b2.y + 60); await p.mouse.move(b2.x + b2.width * 0.6, b2.y + 70);
    check(await p.isVisible(".tip") && /left/.test(await p.textContent(".tip")), "chart: hover shows a point's detail");
    await p.click(".row >> text=Foundations core");
    check(await p.isVisible(".back"), "plan: a milestone opens as its own page with a back button");
    await p.click(".back");
    await tab(p, "Lanes");
    await p.click(".row >> text=Speed");
    check(await p.isVisible("text=Full run time"), "lanes: a lane opens with its measure");
    await p.click(".back");
    await tab(p, "Sitreps");
    check((await p.textContent(".tabbar .badge")) === "5", "badge: five new");
    await p.click(".rep .pl >> nth=0");
    await p.waitForTimeout(80);
    check(await p.isVisible(".mini"), "player: appears when reading starts");
    await p.click(".mini [aria-label=Forward]"); await p.waitForTimeout(60);
    check((await p.evaluate(() => window.__log.speaks.length)) === 2, "player: forward starts from the next part");
    await p.click(".mini .speed");
    check((await p.evaluate(() => window.__log.rates.pop())) === 1.25, "player: speed steps to 1.25");
    await p.click(".mini [aria-label=Pause]"); await p.waitForTimeout(40);
    check(await p.isVisible(".mini [aria-label=Resume]"), "player: pause");
    await p.click(".mini [aria-label=Resume]"); await p.waitForTimeout(40);
    await p.click(".mini .segs button >> nth=0"); await p.waitForTimeout(40);
    check((await p.evaluate(() => window.__log.speaks.pop().ids[0])) === "0", "player: a part jumps to its start");
    await p.waitForTimeout(2500);
    check(!(await p.isVisible(".mini")), "player: hides when the reading ends");
    await p.waitForTimeout(700);
    const w = await p.evaluate(() => window.__log.writes.filter((x) => x[0].indexOf("data/users/u_test/") === 0).length);
    check(w > 0, "heard: saved to the viewer's own document");
    check(errors.length === 0, "interactions: no errors " + errors.join(" | "));
    await p.screenshot({ path: path.join(shots, "reps-390.png"), fullPage: true });
    await ctx.close();
  }

  // 3. No data yet, no voice, no database.
  {
    const { p, ctx, errors } = await open(browser, { width: 1440, data: {}, tts: false });
    await tab(p, "Lanes");
    check(await p.isVisible(".empty"), "empty: lanes say what will appear");
    await tab(p, "Sitreps");
    check((await p.locator(".rep .pl").count()) === 0, "no voice: no play buttons");
    check(errors.length === 0, "empty: no errors " + errors.join(" | "));
    await ctx.close();
  }
  {
    const { p, ctx, errors } = await open(browser, { width: 768, data: {}, db: false, tts: false });
    check(await p.isVisible("text=Sign in to claude.ai"), "no database: says to sign in");
    check(errors.length === 0, "no database: no errors");
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `${failures} failed` : "all passed", "· screenshots in", shots);
  process.exit(failures ? 1 : 0);
})();
