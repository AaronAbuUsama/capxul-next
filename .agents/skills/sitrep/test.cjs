// Tests the sitrep template with a fake `window.claude` (db, user, tts) fed from example/*.json.
//   node .agents/skills/sitrep/test.cjs            # uses the preinstalled Playwright and Chromium
// Writes screenshots to $SITREP_SHOTS (default: a temp folder) and exits non-zero on the first failure.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");

const here = __dirname;
const template = fs.readFileSync(path.join(here, "template.html"), "utf8");
const example = (f) => JSON.parse(fs.readFileSync(path.join(here, "example", f), "utf8"));
const shots = process.env.SITREP_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "sitrep-"));
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

  // 1. Every width and theme: renders, no sideways scroll, no errors.
  for (const width of [390, 768, 1440]) for (const scheme of ["light", "dark"]) {
    const { p, ctx, errors } = await open(browser, { width, scheme, data: JSON.parse(JSON.stringify(full)) });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= width, `${width} ${scheme}: no sideways scroll (${sw})`);
    check(errors.length === 0, `${width} ${scheme}: no errors ${errors.join(" | ")}`);
    check(await p.isVisible("text=Foundations core"), `${width} ${scheme}: next milestone shown`);
    check((await p.locator("#tiles .tile").count()) === 4, `${width} ${scheme}: four tiles`);
    check(await p.evaluate(() => document.documentElement.classList.contains("native")) === (width <= 600), `${width}: native layout only on a phone`);
    await p.screenshot({ path: path.join(shots, `now-${width}-${scheme}.png`), fullPage: true });
    await ctx.close();
  }

  // 2. Interactions at phone width.
  {
    const { p, ctx, errors } = await open(browser, { width: 390, data: JSON.parse(JSON.stringify(full)) });
    const bb = await p.locator("#chart").boundingBox();
    await p.locator("#chart").scrollIntoViewIfNeeded();
    const b2 = await p.locator("#chart").boundingBox();
    await p.mouse.move(b2.x + b2.width * 0.5, b2.y + 60); await p.mouse.move(b2.x + b2.width * 0.6, b2.y + 70);
    check(await p.isVisible("#tip") && /left ·/.test(await p.textContent("#tip")), "chart: hover shows a point's detail");
    check(bb.width > 300, "chart: drawn at full width");
    await p.click("button.lane >> nth=1");
    check(await p.isVisible("text=Full run time"), "lane: opens in place with its measure");
    check(await p.isVisible(".inline-detail .rhead"), "lane: shows its sitreps");
    await p.click(".inline-detail .rhead >> nth=0");
    check(await p.isVisible(".inline-detail .pbtn"), "lane: its sitrep opens with a play button");
    await p.click(".tabbar button >> nth=1");
    check(await p.isVisible("#view-reps") && !(await p.isVisible("#view-now")), "tab bar: switches to Sitreps");
    check((await p.textContent("#tbbadge")) === "5", "badge: five new");
    await p.click("#reps .rhead >> nth=0");
    check(await p.isVisible("#reps .rlinks a"), "sitrep: opens with its links");
    await p.click("#playnew");
    await p.waitForTimeout(80);
    check(await p.isVisible("#player"), "player: appears when reading starts");
    const first = await p.evaluate(() => window.__log.speaks[0]);
    check(first && first.ids.length >= 10, "player: one line per paragraph, oldest sitrep first");
    await p.click("#pl-next"); await p.waitForTimeout(60);
    check((await p.evaluate(() => window.__log.speaks.length)) === 2, "player: forward starts from the next part");
    await p.click("#pl-speed");
    check((await p.textContent("#pl-speed")) === "1.25×" && (await p.evaluate(() => window.__log.rates.pop())) === 1.25, "player: speed steps to 1.25");
    await p.click("#pl-toggle"); await p.waitForTimeout(40);
    check(/paused/.test(await p.textContent("#pl-where")), "player: pause");
    await p.click("#pl-toggle"); await p.waitForTimeout(40);
    await p.click("#pl-segs button >> nth=0"); await p.waitForTimeout(40);
    check((await p.evaluate(() => window.__log.speaks.pop().ids[0])) === "0", "player: a segment jumps to its part");
    await p.waitForTimeout(2500);
    check(!(await p.isVisible("#player")), "player: hides when the reading ends");
    check((await p.textContent("#tbbadge")) === "0" || !(await p.isVisible("#tbbadge")), "heard: everything read is marked heard");
    await p.waitForTimeout(700);
    const w = await p.evaluate(() => window.__log.writes.filter((x) => x[0].indexOf("data/users/u_test/") === 0).length);
    check(w > 0, "heard: saved to the viewer's own document");
    check(errors.length === 0, "interactions: no errors " + errors.join(" | "));
    await p.screenshot({ path: path.join(shots, "reps-390.png"), fullPage: true });
    await ctx.close();
  }

  // 3. No data yet, and no voice.
  {
    const { p, ctx, errors } = await open(browser, { width: 1440, data: {}, tts: false });
    check(await p.isVisible("text=Waiting for the conductor's first update."), "empty: lanes say what will appear");
    check(await p.isVisible("text=No updates yet"), "empty: header says no updates yet");
    await p.click("#tab-reps");
    check(await p.isVisible("text=No sitreps yet."), "empty: sitreps say what will appear");
    check(!(await p.isVisible("#playnew")), "no voice: no play button");
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
