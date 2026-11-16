// What test.cjs and record.cjs share: the publish skeleton the artifact service wraps the page in, a fake
// window.claude whose tts follows the tts.d.ts contract (speak, add, stop, pause, resume, setRate, onState, onLine,
// onPosition), and a page opened at a width, in a theme, with or without reading aloud.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");

const here = __dirname;
const built = path.join(here, "sitrep.html");
const snapshot = JSON.parse(fs.readFileSync(path.join(here, "snapshot.json"), "utf8"));
const skeleton = (body) =>
  `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sitrep-proto-"));
const file = path.join(dir, "page.html");
fs.writeFileSync(file, skeleton(fs.readFileSync(built, "utf8")));

/* Runs in the page before its scripts. Each line takes `lineMs`; the log records every call the page makes. */
function fakeClaude({ tts: on, lineMs }) {
  const log = (window.__log = { speaks: [], rates: [], calls: [], states: [] });
  const h = { state: [], line: [], pos: [] };
  let timers = [], pending = null, paused = false, queue = [], idx = 0;
  const emit = (k, e) => { if (k === "state") log.states.push(e.state); h[k].forEach((f) => f(e)); };
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  function next() {
    if (paused) return;
    if (idx >= queue.length) { const p = pending; pending = null; emit("state", { state: "idle", reason: "completed" }); return p && p.done(); }
    const l = queue[idx++];
    emit("line", { line: idx - 1, id: l.id }); emit("pos", { ms: 0, line: idx - 1 });
    timers.push(setTimeout(next, lineMs));
  }
  const tts = {
    speak(lines, o) {
      lines = typeof lines === "string" ? [{ text: lines }] : lines;
      log.speaks.push({ ids: lines.map((l) => l.id), rate: o && o.rate });
      clear();
      if (pending) { pending.fail({ code: "stopped", reason: "replaced" }); emit("state", { state: "idle", reason: "replaced" }); }
      queue = lines; idx = 0; paused = false;
      return new Promise((done, fail) => { pending = { done, fail }; emit("state", { state: "starting" }); timers.push(setTimeout(() => { emit("state", { state: "speaking" }); next(); }, 20)); });
    },
    add(lines) { queue = queue.concat(lines); return Promise.resolve(); },
    stop() { clear(); if (pending) pending.fail({ code: "stopped", reason: "stopped" }); pending = null; emit("state", { state: "idle", reason: "stopped" }); return Promise.resolve(); },
    pause() { paused = true; clear(); emit("state", { state: "paused" }); return Promise.resolve(); },
    resume() { paused = false; emit("state", { state: "speaking" }); timers.push(setTimeout(next, lineMs)); return Promise.resolve(); },
    setRate(r) { log.rates.push(r); return Promise.resolve(); },
    onState(f) { h.state.push(f); return () => {}; },
    onLine(f) { h.line.push(f); return () => {}; },
    onPosition(f) { h.pos.push(f); return () => {}; },
  };
  window.claude = { use: (n) => { log.calls.push(n); return Promise.resolve(n === "tts" && on ? tts : null); } };
}

let browser;
async function launch() { browser = await chromium.launch(); return browser; }
async function open({ width, height = 844, scheme = "light", tts = true, lineMs = 700, hash = "", reducedMotion = "no-preference", scale = 1, video }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion, deviceScaleFactor: scale, recordVideo: video });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.addInitScript(fakeClaude, { tts, lineMs });
  await p.goto("file://" + file + (hash ? "#" + hash : ""));
  await p.waitForFunction(() => document.fonts.status === "loaded");
  if (!hash) await p.waitForSelector("[data-tab]");
  return { p, ctx, errors };
}
const tab = (p, id) => p.click(`[data-tab=${id}]`);
const settle = (p, ms = 300) => p.waitForTimeout(ms);

module.exports = { launch, open, tab, settle, snapshot, here };
