/**
 * The repository's checks (CLAUDE.md), run by the runner in a lane, never by an agent. A failing gate is data, not an error.
 * They are the root `package.json`'s scripts wherever one exists, so the loop does not care where the files behind them
 * live: the design folder is `blueprint/` when the lane has it and `books/` until then, and its build script likewise.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Gate, Task } from "../types.ts";
import { sh } from "./sh.ts";

export interface GateSpec { readonly name: string; readonly sh: string }

const scriptsOf = (dir: string): Readonly<Record<string, string>> => {
  try { return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { return {}; }
};

/** The checks of the checkout in `dir`, as commands an agent's shell may run too (`pnpm exec`, `pnpm test`, `pnpm <script>`). */
export const gatesOf = (dir: string): readonly GateSpec[] => {
  const renamed = existsSync(join(dir, "blueprint"));
  return [
    { name: "book types and tests", sh: "pnpm exec tsc -p packages/book && pnpm test" },
    { name: "design types", sh: `pnpm exec tsc -p ${renamed ? "blueprint" : "books"}` },
    { name: "design builds", sh: `pnpm ${"blueprint" in scriptsOf(dir) ? "blueprint" : "book"}` },
    { name: "frozen behaviour", sh: "pnpm frozen" },
  ];
};

/** The gates, plus `pnpm evals -- <the task's eval ids>` when the lane has an `evals` script and the task has evals. */
export const gatesFor = (ctx: Ctx, dir: string, task: Task): readonly GateSpec[] => {
  const evals = task.evals.length > 0 && "evals" in scriptsOf(dir);
  return [...(ctx.gates ?? gatesOf(dir)), ...(evals ? [{ name: "evals", sh: `pnpm evals -- ${task.evals.join(" ")}` }] : [])];
};

export const runGates = async (ctx: Ctx, dir: string, task: Task, o: { env?: Record<string, string>; out: string; stopped?: () => boolean }): Promise<Gate[]> => {
  const out: Gate[] = [];
  for (const g of gatesFor(ctx, dir, task)) {
    const r = await sh(ctx, g.sh, { cwd: dir, ...(o.env ? { env: o.env } : {}), file: join(o.out), timeoutMs: 15 * 60_000, ...(o.stopped ? { stopped: o.stopped } : {}) });
    if (r.stopped) throw new Error("stopped");
    out.push({ name: g.name, ok: r.code === 0, tail: r.out.slice(-1200) });
  }
  return out;
};
