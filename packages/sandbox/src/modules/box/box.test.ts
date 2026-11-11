// The box's environment passes pi-durable's own conformance suite for an ExecutionEnv, and a lane goes in and comes back
// as git. The server runs in this process here; `pnpm loop:box-test` (README) runs the same tests against the real image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createEnvConformance } from "@earendil-works/pi-durable/testing";
import { boxOf, docker, serveBox, type Link } from "./service.ts";

const IMAGE = process.env.LOOP_BOX_IMAGE;   // set: test against a container of that image instead of an in-process server
let link: Link, close: () => Promise<void>;

before(async () => {
  if (IMAGE) {
    const d = docker(IMAGE), r = await d.start("box-test", { owner: "test", ttlMs: 3_600_000 });
    if (!r.ok) throw new Error(r.error.message);
    link = r.value; close = () => d.stop("box-test");
  } else {
    const s = await serveBox({ port: 0, host: "127.0.0.1", machine: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir() }, repo: process.cwd() });
    link = { url: `http://127.0.0.1:${s.port}`, headers: {} }; close = s.close;
  }
});
after(() => close());

const fresh = async (): Promise<string> => {
  const r = await boxOf(link).run("mktemp -d", { cwd: "/" });
  return r.out.trim().split("\n").at(-1)!;
};

describe("the box's environment conforms to pi-durable's ExecutionEnv", () => {
  const cases = createEnvConformance({
    assertions: {
      ok: (v, m) => assert.ok(v, m), strictEqual: (a, b) => assert.strictEqual(a, b), deepEqual: (a, b) => assert.deepStrictEqual(a, b),
      partialDeepEqual: (a, b) => assert.partialDeepStrictEqual(a, b), greaterThan: (a, b) => assert.ok(a > b, `${a} > ${b}`),
      rejects: async (p, m) => { await assert.rejects(p, (e: Error) => e.message.includes(m)); },
    },
    withEnv: async (use) => { const dir = await fresh(); try { await use(boxOf(link).env(dir)); } finally { await boxOf(link).run(["rm", "-rf", dir], { cwd: "/" }); } },
  });
  // Watching is not offered over a link (it says not_supported); every other case must pass.
  for (const c of cases.filter((c) => !/watch/i.test(c.name))) test(c.name, { timeout: c.timeoutMs ?? 30_000 }, () => c.run());
});

test("a command's output streams, and a stop kills it", async () => {
  const seen: string[] = [];
  const r = await boxOf(link).run("echo one; echo two >&2; exit 3", { cwd: "/", onOutput: (t) => seen.push(t) });
  assert.equal(r.code, 3);
  assert.match(seen.join(""), /one[\s\S]*two/);
  const t0 = Date.now();
  const k = await boxOf(link).run("sleep 30", { cwd: "/", stopped: () => Date.now() - t0 > 500 });
  assert.equal(k.stopped, true);
  assert.ok(Date.now() - t0 < 10_000);
});

test("the box's PATH and HOME win over the caller's", async () => {
  const r = await boxOf(link).run("echo $HOME:$CAPXUL_X", { cwd: "/", env: { HOME: "/nowhere", CAPXUL_X: "seen" } });
  assert.doesNotMatch(r.out, /nowhere/);
  assert.match(r.out, /:seen/);
});

test("a lane goes into the box as git and its new commits come back", async () => {
  const root = mkdtempSync(join(tmpdir(), "box-lane-")), repo = join(root, "repo");
  const g = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["init", "-q", "-b", "lane/x", repo]);
    g(repo, "config", "user.name", "T"); g(repo, "config", "user.email", "t@x");
    writeFileSync(join(repo, "a.txt"), "a\n"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "a");
    // In a run the lane has the same absolute path here and in the box; under Docker that is a real second copy.
    const box = boxOf(link);
    const pushed = await box.push(repo, "lane/x");
    assert.ok(pushed.ok, pushed.ok ? "" : pushed.error.message);
    await box.run("echo b > b.txt", { cwd: repo });
    const pulled = await box.pull(repo, "lane/x", "loop: test");
    assert.ok(pulled.ok, pulled.ok ? "" : pulled.error.message);
    assert.equal(g(repo, "show", "HEAD:b.txt"), "b");
    const undone = await box.restore(repo);
    assert.deepEqual(undone.ok && undone.value, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

