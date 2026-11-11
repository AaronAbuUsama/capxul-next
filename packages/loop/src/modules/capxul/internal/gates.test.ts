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
    const ctx = { root: dir, env: { LOOP_BASE: base }, now: () => new Date(), say: () => undefined, agents: [], gates: [] };
    const run = (t = task) => runGates(ctx, dir, t, { out: join(dir, "var/gates.out") });
    assert.equal((await run())[0]?.ok, true, "existing questions do not fail");
    records([old, { _kind: "decision", id: "new.question", why: "Aaron's ruling" }, { _kind: "table", id: "not.decision", why: "Aaron" }]);
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
    const missing = await runGates({ ...ctx, env: { LOOP_BASE: "missing-base" } }, dir, task, { out: join(dir, "var/gates.out") });
    assert.equal(missing[0]?.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
