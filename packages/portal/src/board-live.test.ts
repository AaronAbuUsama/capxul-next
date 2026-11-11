import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("Working now reads each running host run, refreshes, and clears stale work on failure", async () => {
  class Element {
    textContent = ""; children: Element[] = []; href = ""; title = "";
    tag: string; className: string;
    constructor(tag = "", className = "") { this.tag = tag; this.className = className; }
    appendChild(e: Element) { this.children.push(e); }
    insertBefore(e: Element) { this.children.push(e); }
  }
  const board = new Element(), nav = new Element();
  let refresh = () => {}; let fail = false; let url = "";
  const source = readFileSync(new URL("../assets/site.js", import.meta.url), "utf8");
  runInNewContext(source, {
    location: { protocol: "http:" }, Date,
    document: {
      querySelector: (s: string) => s === "nav.nav" ? nav : s.startsWith("script") ? { src: "http://localhost/assets/site.js" } : null,
      getElementById: (id: string) => id === "board-running" ? board : null,
      createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }),
    },
    window: { setInterval: (fn: () => void, ms: number) => { assert.equal(ms, 15000); refresh = fn; } },
    fetch: async (path: string) => { url = path; if (fail) throw Error("down"); return { ok: true, json: async () => ({ runs: [
      { id: "r1", status: "running", task: { id: "t1", title: "Build" }, startedAt: new Date(Date.now() - 120000).toISOString(), working: { key: "make.1", role: "builder" } },
      { id: "r2", status: "merged", task: { id: "t2", title: "Old" } },
    ] }) }; },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(url, "http://localhost/runs/summary.json");
  assert.equal(board.children.length, 1);
  assert.match(board.children[0]!.textContent, /Build \(t1\).*builder make.1.*2 min/);
  assert.match(board.children[0]!.href, /runs\/#\/runs\/r1/);
  fail = true; refresh(); await new Promise((r) => setImmediate(r));
  assert.match(board.textContent, /host down/);
});
