import assert from "node:assert/strict";
import { test } from "node:test";
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import WS from "ws";
import type { RunDetail } from "../inspect/types.ts";
import { runsContract, serve, type HostDeps } from "./service.ts";

const run = (id: string, step: string): RunDetail => ({ id, task: { id: "t", title: "T", goal: "" }, workflow: "pair", status: "running", round: 1, rounds: 3, startedAt: `2026-11-10T10:00:0${id.length}.000Z`, endedAt: null, updatedAt: "", tokens: 0, branch: null, base: null, reasons: [], error: null, step, steps: [], agents: [] });
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
