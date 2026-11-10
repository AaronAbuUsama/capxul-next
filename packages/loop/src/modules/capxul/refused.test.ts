// The 226 commands the loop's policy refused on 10 November 2026 (post-mortem, change 2), replayed against the policy as
// it is. Each one is now either allowed or refused with a reason that says what to do instead. A change to the policy
// that moves any of them shows here, and the fixture is regenerated on purpose, never to make this pass.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { refuseBash, refusePath } from "../agents/service.ts";
import { POLICY } from "./service.ts";

interface Refused { run: string; tool: string; command?: string; path?: string; refused: string; now: string }
const CALLS = JSON.parse(readFileSync(new URL("./refused-2026-11-10.json", import.meta.url), "utf8")) as Refused[];

const judge = (c: Refused): string =>
  (c.tool === "bash"
    ? refuseBash(c.command ?? "", "/lane", POLICY.bash.write, { deny: POLICY.denyWrite }, POLICY.hints)
    : refusePath(c.path ?? ".", "/lane", c.tool !== "read", POLICY.denyWrite)) ?? "allowed";

test("every call refused on 10 November is allowed now, or refused with a stated reason", () => {
  assert.equal(CALLS.length, 226);
  for (const c of CALLS) assert.equal(judge(c), c.now, `${c.run}: ${(c.command ?? c.path ?? "").slice(0, 120)}`);
  const refused = CALLS.filter((c) => c.now !== "allowed");
  assert.ok(refused.length <= 25, `${refused.length} still refused`);
  // what is still refused leaves the lane, installs, or runs another language: each a reason, not a gap in the list
  for (const c of refused) assert.match(c.now, /outside the lane|not a command this agent may run/, c.now);
});

test("the shell is read as the shell reads it: quotes and here-documents are the program's text", () => {
  const w = (cmd: string) => refuseBash(cmd, "/lane", POLICY.bash.write, { deny: POLICY.denyWrite }, POLICY.hints);
  for (const cmd of [
    "node -e 'const m = new Map(); [1].map((x) => x > 0)'",
    "pnpm test > var/test.log 2>&1; tail -5 var/test.log",
    "node --input-type=module <<'JS'\nconsole.log(1 > 0)\nJS",
    "pnpm --filter @capxul/portal test", "pnpm plan:check", "git branch --show-current", "git grep -n x blueprint",
    "nl -ba f.ts | sed -n '190,220p'", "sed -n '18,24p;55,80p' f.ts", "cp START-HERE.md archive/START-HERE.md",
  ]) assert.equal(w(cmd), undefined, cmd);
  for (const [cmd, why] of [
    ["echo $(whoami)", /substitutions/], ["cat < f", /input redirection/], ["diff <(ls) x", /process substitutions/],
    ["echo x > books/frozen/a.ts", /may not be written/], ["echo x > var/runs/r/run.sqlite", /may not be written/],
    ["echo x > ../out", /outside the lane/], ["cat /home/user/factory/x", /does not exist on this machine/],
    ["pnpm install", /installed before it starts/], ["pnpm loop run x", /does not drive the loop/], ["git push", /the loop moves branches/],
    ["cp x .git/config", /not a command/], ["node --input-type=module <<'JS'\nopen", /never closed/],
  ] as const) assert.match(w(cmd) ?? "allowed", why, cmd);
  // a reader sends nothing to a file
  assert.match(refuseBash("git diff > var/d", "/lane", POLICY.bash.read) ?? "", /only reads/);
});
