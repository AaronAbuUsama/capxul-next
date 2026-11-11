import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { questionsAt } from "./inputs.ts";
import { reconcile, type Alert } from "./service.ts";

// Exercise the real adapter repeatedly in one parent process. The changed record is
// a transitive import: cache-busting only blueprint/index.ts cannot pass this test.
test("a running reconciler observes added and removed blueprint decisions without restart", async () => {
  mkdirSync("var", { recursive: true });
  const root = mkdtempSync(resolve("var/alerts-inputs-"));
  const put = (path: string, text: string) => writeFileSync(join(root, path), text);
  for (const dir of ["blueprint/shared", "packages/plan/src", "plan"]) mkdirSync(join(root, dir), { recursive: true });
  const realWaiting = new URL("../../../../../blueprint/shared/waiting.ts", import.meta.url).href;
  const realPlan = new URL("../../../../plan/src/index.ts", import.meta.url).href;
  put("blueprint/shared/waiting.ts", `export { forAaron } from ${JSON.stringify(realWaiting)};`);
  put("packages/plan/src/index.ts", `export { waitsOnOwner } from ${JSON.stringify(realPlan)};`);
  put("plan/plan.json", JSON.stringify({ tasks: [] }));
  put("blueprint/index.ts", 'export { records } from "./decisions.ts";');
  const update = (active: boolean) => put("blueprint/decisions.ts", `export const records = ${JSON.stringify(active ? [{ _kind: "decision", id: "test.live-question", question: "Aaron, which option?", source: "Builder" }] : [])};`);
  const sent: Alert[] = [];
  let time = 0;
  const ports = { file: join(root, "alerts.json"), now: () => new Date(time++ * 1000), sender: async (alert: Alert) => { sent.push(alert); } };
  const poll = async () => {
    const questions = await questionsAt(root);
    await reconcile(ports, { questions, runs: [] });
    return questions;
  };
  try {
    update(false);
    assert.deepEqual(await poll(), []);
    update(true);
    assert.equal((await poll())[0]?.id, "decision:test.live-question");
    await poll();
    assert.equal(sent.length, 1);
    update(false);
    assert.deepEqual(await poll(), []);
    update(true);
    await poll();
    assert.equal(sent.length, 2, "removal ended the episode; reappearance announces again");
    put("blueprint/decisions.ts", 'export const records = []; throw new Error("invalid blueprint");');
    await assert.rejects(poll(), /invalid blueprint/);
    assert.equal(sent.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
