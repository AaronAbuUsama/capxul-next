import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { watchChild } from "./service.ts";

// A real detached child, as the wrapper spawns its component. It appends each signal it receives to a log, then says ready.
async function component(behaviour: string) {
  const dir = await mkdtemp(join(tmpdir(), "capxul-stop-"));
  const log = join(dir, "signals");
  const child = spawn(process.execPath, ["-e", `const { appendFileSync } = require("node:fs"); const log = process.argv[1];
    const seen = (s) => appendFileSync(log, s + "\\n"); setInterval(() => {}, 1000); ${behaviour}; console.log("ready");`, log],
  { detached: true, stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout!, "data");
  let code!: (value: number) => void;
  const finished = new Promise<number>((done) => { code = done; });
  return {
    child, finished, finish: (value: number) => { code(value); },
    signals: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
    [Symbol.asyncDispose]: async () => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} await rm(dir, { recursive: true, force: true }); },
  };
}

test("a service stop signals the child once; its clean teardown inside the grace is recorded clean", { timeout: 10_000 }, async () => {
  await using c = await component(`process.on("SIGTERM", () => { seen("SIGTERM"); setTimeout(() => process.exit(0), 300); });
    process.on("SIGINT", () => seen("SIGINT"))`);
  const close = watchChild(c.child, "core", c.finish, { asked: () => true, graceMs: 2000, settleMs: 100 });
  process.kill(-c.child.pid!, "SIGTERM"); // systemd signals the whole control group
  await close();
  assert.equal(await c.finished, 0);
  assert.deepEqual(await c.signals(), ["SIGTERM"], "a second signal would run the child's stop handler twice");
});

test("a child still running after the grace gets the wrapper's SIGINT and its exit 0 stays clean", { timeout: 10_000 }, async () => {
  await using c = await component(`process.on("SIGTERM", () => seen("SIGTERM")); process.on("SIGINT", () => { seen("SIGINT"); process.exit(0); })`);
  const close = watchChild(c.child, "ponder", c.finish, { asked: () => true, graceMs: 300, settleMs: 100 });
  process.kill(-c.child.pid!, "SIGTERM");
  await Promise.race([close(), setTimeout(5000, undefined, { ref: false }).then(() => { throw new Error("the hung child was never signalled"); })]);
  assert.equal(await c.finished, 0);
  assert.deepEqual(await c.signals(), ["SIGTERM", "SIGINT"]);
});

test("a child that fails its own stop is unclean", { timeout: 10_000 }, async () => {
  await using c = await component(`process.on("SIGTERM", () => process.exit(3))`);
  const close = watchChild(c.child, "core", c.finish, { asked: () => true, graceMs: 2000, settleMs: 100 });
  process.kill(-c.child.pid!, "SIGTERM");
  await assert.rejects(close(), /core exited 3/);
  assert.equal(await c.finished, 1);
});

test("a crash nobody asked for is unclean", { timeout: 10_000 }, async () => {
  await using c = await component(`setTimeout(() => process.exit(1), 100)`);
  watchChild(c.child, "anvil", c.finish, { asked: () => false, graceMs: 2000, settleMs: 100 });
  assert.equal(await c.finished, 1);
});

test("an unasked exit 0 is unclean, because the service manager would restart the wrapper mid-snapshot", { timeout: 10_000 }, async () => {
  await using c = await component(`setTimeout(() => process.exit(0), 100)`);
  watchChild(c.child, "site-service", c.finish, { asked: () => false, graceMs: 2000, settleMs: 300 });
  assert.equal(await c.finished, 1);
});

test("a child that exits 0 just before the wrapper handles the same stop signal is clean", { timeout: 10_000 }, async () => {
  let asked = false;
  await using c = await component(`setTimeout(() => process.exit(0), 50)`);
  watchChild(c.child, "site-service", c.finish, { asked: () => asked, graceMs: 2000, settleMs: 500 });
  await once(c.child, "exit");
  void setTimeout(100).then(() => { asked = true; }); // the wrapper's own handler runs late in the same stop
  assert.equal(await c.finished, 0);
});
