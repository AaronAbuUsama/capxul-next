/** The repository's checks (CLAUDE.md), run by the runner in a lane, never by an agent. A failing gate is data, not an error. */
import { join } from "node:path";
import type { Ctx, Gate, Task } from "../types.ts";
import { sh } from "./sh.ts";

export const GATES: readonly { name: string; sh: string }[] = [
  { name: "book types and tests", sh: "pnpm exec tsc -p packages/book && pnpm test" },
  { name: "books types", sh: "pnpm exec tsc -p books" },
  { name: "book builds", sh: "node --experimental-strip-types packages/book/src/main.ts books/target/index.ts ../book-out" },
  { name: "frozen behaviour", sh: "node --experimental-strip-types tools/check-frozen.ts" },
];

/** The gates, plus `pnpm evals -- <the task's eval ids>` when the lane has an `evals` script and the task has evals (another lane builds that command; its interface here is assumed). */
export const gatesFor = async (ctx: Ctx, dir: string, task: Task): Promise<{ name: string; sh: string }[]> => {
  const has = task.evals.length > 0 && (await sh(ctx, `grep -q '"evals":' package.json`, { cwd: dir })).code === 0;
  return [...(ctx.gates ?? GATES), ...(has ? [{ name: "evals", sh: `pnpm evals -- ${task.evals.join(" ")}` }] : [])];
};

export const runGates = async (ctx: Ctx, dir: string, task: Task, o: { env?: Record<string, string>; out: string; stopped?: () => boolean }): Promise<Gate[]> => {
  const out: Gate[] = [];
  for (const g of await gatesFor(ctx, dir, task)) {
    const r = await sh(ctx, g.sh, { cwd: dir, ...(o.env ? { env: o.env } : {}), file: join(o.out), timeoutMs: 15 * 60_000, ...(o.stopped ? { stopped: o.stopped } : {}) });
    if (r.stopped) throw new Error("stopped");
    out.push({ name: g.name, ok: r.code === 0, tail: r.out.slice(-1200) });
  }
  return out;
};
