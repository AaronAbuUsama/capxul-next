import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Task } from "../types.ts";
import { runGates } from "./gates.ts";

const task: Task = { id: "t", source: "plan", title: "Implement a ruling", goal: "Cites Aaron's ruling; do not bring a question.", evals: [], checkers: [], paths: [] };

test("pair and merge gates refuse new for-aaron ids, permit unchanged lists and explicit task authorization, and fail closed", async () => {
  const root = join(import.meta.dirname, "../../../../../..");
  mkdirSync(join(root, "var"), { recursive: true });
  const dir = mkdtempSync(join(root, "var", "questions-test-"));
  const put = (path: string, text: string) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), text); };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
  const records = (rows: object[]) => put("blueprint/index.ts", `export const records = ${JSON.stringify(rows)};`);
  const old = { _kind: "decision", id: "old.question", question: "Aaron must rule" };
  try {
    git("init"); git("config", "user.name", "Gate test"); git("config", "user.email", "gate@example.invalid");
    put("blueprint/shared/waiting.ts", readFileSync(join(root, "blueprint/shared/waiting.ts"), "utf8"));
    put("blueprint/shared/rulings.ts", "export const ACCEPTED = [], CARRIES_OUT = [], REOPENED = [], SUPERSEDED = {};\n");
    put("blueprint/shared/cut.ts", "export const CUT_FOR_AARON = [];\n");
    put("packages/blueprint-engine/placeholder", "fixture");
    records([old]); git("add", "."); git("commit", "-m", "base");
    const base = git("rev-parse", "HEAD");
    const stored = (base: string, laneDir = dir) => put("var/status.json", JSON.stringify({ extra: { lane: { dir: laneDir, base } } }));
    stored(base);
    const ctx = { root: dir, env: { LOOP_BASE: base }, now: () => new Date(), say: () => undefined, agents: [], gates: [] };
    const run = (t = task) => runGates(ctx, dir, t, { out: join(dir, "var/gates.out") });
    assert.equal((await run())[0]?.ok, true, "existing questions do not fail");
    records([old, { _kind: "decision", id: "new.question", why: "Aaron's ruling" }, { _kind: "table", id: "not.decision", why: "Aaron" }]);
    git("add", "."); git("commit", "-m", "current base already has the question");
    ctx.env.LOOP_BASE = git("rev-parse", "HEAD");
    // Both existing callers supply output beside the persisted status, not a base argument.
    for (const file of ["gates.1.out", "merge-gates.123.out"]) {
      const gates = await runGates(ctx, dir, task, { out: join(dir, "var", file) });
      assert.equal(gates[0]?.ok, false, `${file} must use stored base, not changed LOOP_BASE`);
      assert.match(gates[0]!.tail, /new.question/);
    }
    const failed = (await run())[0]!;
    assert.equal(failed.ok, false);
    assert.match(failed.tail, /new.question/);
    assert.doesNotMatch(failed.tail, /old.question|not.decision/);
    assert.equal((await run({ ...task, goal: "Brings Aaron a question: yes" }))[0]?.ok, true);
    assert.equal((await run({ ...task, goal: "Do not use Brings Aaron a question: yes" }))[0]?.ok, false);
    records([{ _kind: "decision", id: "settled", source: "Aaron, ruling", why: "Aaron" }]);
    assert.equal((await run())[0]?.ok, true, "removals and settled decisions are not new questions");
    put("blueprint/index.ts", "throw new Error('broken records');");
    assert.equal((await run())[0]?.ok, false, "failed imports cannot silently pass");
    records([old]);
    ctx.env.LOOP_BASE = "missing-current-base";
    assert.equal((await run())[0]?.ok, true, "current LOOP_BASE is irrelevant");
    stored("missing-stored-base");
    assert.equal((await run())[0]?.ok, false, "missing stored ref fails closed");
    stored(base, join(dir, "wrong-lane"));
    assert.equal((await run())[0]?.ok, false, "a different lane's metadata fails closed");
    rmSync(join(dir, "var/status.json"));
    assert.equal((await run())[0]?.ok, false, "missing metadata must not fall back to LOOP_BASE");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
