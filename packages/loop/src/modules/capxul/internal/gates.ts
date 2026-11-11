/**
 * The repository's checks (CLAUDE.md), run by the runner in a lane, never by an agent. A failing gate is data, not an error.
 * They are the root `package.json`'s scripts wherever one exists, so the loop does not care where the files behind them
 * live: the design folder is `blueprint/` when the lane has it and `books/` until then, and its build script likewise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Ctx, Gate, Task } from "../types.ts";
import { sh } from "./sh.ts";
import { questionsGate } from "./questions.ts";


export interface GateSpec { readonly name: string; readonly sh: string }

const scriptsOf = (dir: string): Readonly<Record<string, string>> => {
  try { return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { return {}; }
};

/** The checks of the checkout in `dir`, as commands an agent's shell may run too (`pnpm exec`, `pnpm test`, `pnpm <script>`). */
export const gatesOf = (dir: string): readonly GateSpec[] => {
  const renamed = existsSync(join(dir, "blueprint")), engine = existsSync(join(dir, "packages/blueprint-engine")) ? "packages/blueprint-engine" : "packages/book";
  return [
    { name: "engine types and tests", sh: `pnpm exec tsc -p ${engine} && pnpm test` },
    { name: "design types", sh: `pnpm exec tsc -p ${renamed ? "blueprint" : "books"}` },
    { name: "design builds", sh: `pnpm ${"blueprint" in scriptsOf(dir) ? "blueprint" : "book"}` },
    { name: "frozen behaviour", sh: "pnpm frozen" },
  ];
};

/**
 * Where the design's build leaves its problems and gaps in this checkout: the folder the root script builds into (its
 * last word), which is inside the checkout, so every lane has its own. Null when the script names none.
 */
export const findingsOf = (dir: string): string | null => {
  const scripts = scriptsOf(dir), out = (scripts["blueprint"] ?? scripts["book"] ?? "").trim().split(/\s+/).at(-1) ?? "";
  return /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(out) && !out.endsWith(".ts") ? `${out}/findings.json` : null;
};

/** The gates, plus `pnpm evals -- <the task's eval ids>` when the lane has an `evals` script and the task has evals. */
export const gatesFor = (ctx: Ctx, dir: string, task: Task): readonly GateSpec[] => {
  const evals = task.evals.length > 0 && "evals" in scriptsOf(dir);
  return [...(ctx.gates ?? gatesOf(dir)), ...(evals ? [{ name: "evals", sh: `pnpm evals -- ${task.evals.join(" ")}` }] : [])];
};

/** Both pair and merge put their output beside status.json, whose lane is the persisted merge target.
 * Never fall back to LOOP_BASE: it can change after this lane was created.
 */
const storedBase = (dir: string, out: string): string => {
  const info = JSON.parse(readFileSync(join(dirname(out), "status.json"), "utf8")) as { extra?: { lane?: { dir?: string; base?: string } } };
  const lane = info.extra?.lane;
  if (!lane?.dir || resolve(lane.dir) !== resolve(dir) || typeof lane.base !== "string" || !lane.base.trim()) throw new Error("Missing or mismatched stored lane base");
  return lane.base;
};

export const runGates = async (ctx: Ctx, dir: string, task: Task, o: { env?: Record<string, string>; out: string; stopped?: () => boolean }): Promise<Gate[]> => {
  if (o.stopped?.()) throw new Error("stopped");
  const out: Gate[] = [];
  if (existsSync(join(dir, "blueprint/index.ts"))) {
    try { out.push(questionsGate(dir, task, storedBase(dir, o.out))); }
    catch (cause) { out.push({ name: "no new questions for Aaron", ok: false, tail: `Cannot read stored lane base: ${String(cause)}` }); }
  }
  for (const g of gatesFor(ctx, dir, task)) {
    const r = await sh(ctx, g.sh, { cwd: dir, ...(o.env ? { env: o.env } : {}), file: join(o.out), timeoutMs: 15 * 60_000, ...(o.stopped ? { stopped: o.stopped } : {}) });
    if (r.stopped) throw new Error("stopped");
    out.push({ name: g.name, ok: r.code === 0, tail: r.out.slice(-1200) });
  }
  return out;
};
