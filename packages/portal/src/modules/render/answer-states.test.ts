// All DOM nodes and fetch responses are disposable mocks: never contact the real portal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { buildSite, htmlFile } from "#src/modules/site/service.ts";
import { fixtureAssets, fixtureInput } from "#src/testing.ts";
import { renderSite } from "./service.ts";

const script = readFileSync(new URL("../../../assets/site.js", import.meta.url), "utf8");
const html = renderSite(buildSite(fixtureInput()), fixtureAssets).get(htmlFile("review"))!;

type FetchOptions = { method?: string; body?: string };
// A deliberately small DOM double: only the selectors and events used by the Questions script.
function element(): any {
  const children = new Map<string, any>();
  return {
    querySelector(selector: string) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    hidden: false, textContent: "", disabled: true,
    classList: { toggle() {}, add() {} },
    setAttribute() {}, removeAttribute() {},
  };
}

function setup(fallback = false, initial: unknown[] = []) {
  const nodes = new Map<string, any>();
  const button = { ...element(), dataset: { act: "done" } };
  const article: any = {
    ...element(), dataset: { decision: "task-demo", kind: "need", target: "demo" },
    querySelector(selector: string) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return [button]; },
    addEventListener(event: string, handler: unknown) { article[event] = handler; },
  };
  const status = element(), summary = element(), mode = element();
  const count = { ...element(), textContent: "1" };
  const item = {
    ...element(), dataset: { for: "task-demo" },
    querySelector() { return status; }, addEventListener() {},
  };
  const main = {
    dataset: { repo: "https://github.com/example/test", reviewer: "test", commit: "fixture" },
    querySelectorAll(selector: string) { return selector === "article.q" ? [article] : [item]; },
    querySelector(selector: string) {
      return selector === ".q-serving-mode" ? mode : selector === ".q-answer-counts" ? summary :
        selector === ".q-count-big" ? count : item;
    },
  };
  const calls: FetchOptions[] = [];
  let resolveGet!: (value: unknown) => void;
  const context = {
    document: {
      querySelector(selector: string) { return selector === "main[data-repo]" ? main : null; },
      documentElement: element(), getElementById() { return count; },
    },
    location: { protocol: "file:", hash: "" }, history: { replaceState() {} },
    window: { addEventListener() {} }, Date,
    fetch(url: string, options: FetchOptions) {
      assert.equal(url, "/api/answers");
      calls.push(options);
      if (!options.method) return new Promise((resolve) => { resolveGet = resolve; });
      return Promise.resolve({
        ok: true,
        json: async () => options.body?.includes("withdraw") ? {} : {
          answer: { id: "fixture", at: "2026-11-11", answer: { how: "done" } },
        },
      });
    },
  };
  vm.runInNewContext(script, context);
  const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
  return {
    button, count, status, summary, mode, calls, nodes, flush,
    click() { article.click({ target: { closest: () => button } }); },
    async resolve() {
      resolveGet({ ok: !fallback, headers: { get: () => "application/json" }, json: async () => ({ answers: initial }) });
      await flush();
    },
  };
}

test("mode precedes actions and buttons are disabled in generated HTML", () => {
  const modeAt = html.indexOf('class="q-serving-mode"');
  assert.ok(modeAt >= 0 && modeAt < html.indexOf("data-act="));
  const buttons = html.match(/type="button"/g) ?? [];
  assert.ok(buttons.length > 0);
  assert.equal(buttons.length, (html.match(/type="button" disabled/g) ?? []).length);
  assert.match(html, /Saved answers are not applied answers/);
});

test("pending detection cannot post; save and undo keep outstanding count stable", async () => {
  const x = setup();
  x.click();
  assert.equal(x.calls.length, 1);
  assert.equal(x.button.disabled, true);
  await x.resolve();
  assert.match(x.mode.textContent, /Local saving/);
  assert.equal(x.button.disabled, false);
  x.click();
  await x.flush();
  assert.equal(x.calls[1]?.method, "POST");
  assert.match(x.status.textContent, /Saved, not applied/);
  assert.match(x.summary.textContent, /0 unanswered · 1 saved/);
  assert.equal(x.count.textContent, "1");
  x.button.dataset.act = "undo";
  x.click();
  await x.flush();
  assert.equal(x.calls[2]?.body, JSON.stringify({ withdraw: "fixture" }));
  assert.match(x.summary.textContent, /1 unanswered · 0 saved/);
  assert.equal(x.count.textContent, "1");
});

test("static or closed endpoint declares GitHub destination and does not POST", async () => {
  const x = setup(true);
  await x.resolve();
  assert.match(x.mode.textContent, /GitHub issue mode/);
  x.click();
  assert.equal(x.calls.length, 1);
  assert.equal(x.nodes.get(".answer").hidden, false);
});

test("saved answers reloaded from endpoint remain explicitly unapplied", async () => {
  const x = setup(false, [{
    id: "fixture", target: { kind: "task", id: "demo" }, at: "2026-11-11", answer: { how: "done" },
  }]);
  await x.resolve();
  assert.match(x.status.textContent, /Saved, not applied/);
  assert.match(x.summary.textContent, /Applied answers are not returned/);
  assert.equal(x.count.textContent, "1");
});
