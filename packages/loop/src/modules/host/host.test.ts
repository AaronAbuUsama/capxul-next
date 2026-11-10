import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import WS from "ws";
import type { RunDetail } from "../inspect/types.ts";
import { runsContract, serve, type HostDeps } from "./service.ts";

const run = (id: string, step: string): RunDetail => ({ id, task: { id: "t", title: "T", goal: "" }, workflow: "pair", status: "running", round: 1, rounds: 3, startedAt: `2026-11-10T10:00:0${id.length}.000Z`, endedAt: null, updatedAt: "", tokens: 0, branch: null, base: null, reasons: [], error: null, step, steps: [], agents: [], captures: [] });
const until = async (ok: () => boolean): Promise<void> => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(ok(), "timed out"); };

test("a client that attaches gets the runs, then what changes; a run that did not change is not read again; stop reaches the owner", async () => {
  const loads: string[] = [], stops: string[] = [];
  let stamp = "1", step = "make.1";
  const deps: HostDeps = {
    ids: () => [{ id: "a", stamp: "fixed" }, { id: "bb", stamp }],
    load: async (id) => { loads.push(id); return run(id, id === "bb" ? step : "lane"); },
    stop: (id) => { stops.push(id); return `stop asked of ${id}`; },
    say: () => undefined,
  };
  const served = await serve(deps, { port: 0, everyMs: 20 });
  const client = chord.createHost({ self: { kind: "host" }, name: "page", kind: "client", onError: () => undefined, upstream: { link: chord.webSocketLink(new WebSocket(served.url) as never), principal: { kind: "server" } } } as never);
  try {
    const runs = await (client as unknown as { get: (t: unknown, i: unknown) => Promise<{ runs: { value: RunDetail[] }; stop: (i: { run: string }) => Promise<{ said: string }> }> }).get(runsContract(chord as never, schema as never), {});
    assert.deepEqual(runs.runs.value.map((r) => `${r.id}:${r.step}`), ["bb:make.1", "a:lane"]);            // newest first
    stamp = "2"; step = "gates.1";
    await until(() => runs.runs.value[0]?.step === "gates.1");
    assert.equal(loads.filter((id) => id === "a").length, 1, "the run that did not change was read once");
    assert.deepEqual(await runs.stop({ run: "bb" }), { said: "stop asked of bb" });
    assert.deepEqual(stops, ["bb"]);
  } finally {
    await (client as unknown as { close: () => Promise<void> }).close();
    await served.close();
  }
});

test("a page from another site cannot attach", async () => {
  const served = await serve({ ids: () => [], load: async () => null, stop: () => "", say: () => undefined }, { port: 0 });
  try {
    const refused = await new Promise<boolean>((done) => {
      const ws = new WS(served.url, { origin: "https://elsewhere.example" });
      ws.on("close", () => done(true));
      ws.on("error", () => done(true));
      setTimeout(() => done(false), 3000);
    });
    assert.equal(refused, true);
  } finally { await served.close(); }
});

test("over HTTP the host answers reads only: a summary of the runs, and the app's files from its folder and nowhere else", async () => {
  const ui = mkdtempSync(join(tmpdir(), "loop-ui-"));
  mkdirSync(join(ui, "assets"));
  writeFileSync(join(ui, "index.html"), "<p>the app</p>");
  writeFileSync(join(ui, "assets/app.js"), "1");
  writeFileSync(join(ui, "..", "secret.txt"), "not served");
  const served = await serve({ ids: () => [{ id: "a", stamp: "1" }], load: async (id) => ({ ...run(id, "make.1"), agents: [{ key: "make.1", role: "builder", model: "m", tools: [], instructions: "", state: "working", failure: null, startedAt: 1, endedAt: null, usage: { turns: 0, tools: {}, refused: 0, errors: 0, tokensIn: 0, tokensOut: 0 }, messages: [] }] }), stop: () => "", say: () => undefined }, { port: 0, ui });
  const get = async (path: string, init?: RequestInit) => { const r = await fetch(`http://127.0.0.1:${served.port}${path}`, init); return { status: r.status, type: r.headers.get("content-type"), text: await r.text() }; };
  try {
    const summary = await get("/runs/summary.json");
    assert.deepEqual((JSON.parse(summary.text) as { runs: unknown[] }).runs, [{ id: "a", task: { id: "t", title: "T" }, workflow: "pair", status: "running", round: 1, rounds: 3, startedAt: "2026-11-10T10:00:01.000Z", endedAt: null, tokens: 0, working: { key: "make.1", role: "builder" } }]);
    assert.deepEqual([(await get("/runs/")).text, (await get("/runs/assets/app.js")).type], ["<p>the app</p>", "text/javascript; charset=utf-8"]);
    assert.equal((await get("/runs/..%2Fsecret.txt")).status, 404);
    assert.equal((await get("/elsewhere")).status, 404);
    assert.equal((await get("/runs/summary.json", { method: "POST" })).status, 405);
  } finally { await served.close(); }
});

test("a capture's file is served from its run's evidence folder, whole or in the part a video player asks for, and nothing outside it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "loop-shown-"));
  writeFileSync(join(folder, "make.1.pays.webm"), "0123456789");
  writeFileSync(join(folder, "..", "outside.txt"), "not served");
  const served = await serve({ ids: () => [], load: async () => null, stop: () => "", say: () => undefined, evidence: (id) => (id === "run-1" ? folder : null) }, { port: 0 });
  const get = async (path: string, headers: Record<string, string> = {}) => { const r = await fetch(`http://127.0.0.1:${served.port}${path}`, { headers }); return [r.status, r.headers.get("content-type"), r.headers.get("content-range"), await r.text()]; };
  try {
    assert.deepEqual(await get("/runs/evidence/run-1/make.1.pays.webm"), [200, "video/webm", null, "0123456789"]);
    assert.deepEqual(await get("/runs/evidence/run-1/make.1.pays.webm", { range: "bytes=2-5" }), [206, "video/webm", "bytes 2-5/10", "2345"]);
    assert.deepEqual(await get("/runs/evidence/run-1/make.1.pays.webm", { range: "bytes=-3" }), [206, "video/webm", "bytes 7-9/10", "789"]);
    assert.deepEqual((await get("/runs/evidence/run-1/make.1.pays.webm", { range: "bytes=50-" })).slice(0, 3), [416, "video/webm", "bytes */10"]);
    assert.equal((await get("/runs/evidence/run-2/make.1.pays.webm"))[0], 404);       // no such run
    assert.equal((await get("/runs/evidence/run-1/nope.gif"))[0], 404);
    assert.equal((await get("/runs/evidence/run-1/..%2Foutside.txt"))[0], 404);
  } finally { await served.close(); }
});
