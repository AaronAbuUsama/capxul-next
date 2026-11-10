/**
 * The plan stays the source of truth. Tasks are read from it (plan/plan.json, plan/tasks/<id>.md, and for a derived
 * task docs/mission/tasks.json), and every change goes through `tools/plan.ts`, so it is validated and logged there.
 * The runner never writes the critical path and never adds a task: that is the coordinator's judgment.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Task } from "../types.ts";

interface PlanTask { id: string; title: string; why: string; state: string; needs: string[] }
interface PlanView { tasks: PlanTask[]; path: { tasks: string[] } }

const cli = (ctx: Ctx, args: string[]): { ok: boolean; out: string } => {
  const r = spawnSync("node", ["--experimental-strip-types", "--no-warnings", "tools/plan.ts", ...args], { cwd: ctx.root, encoding: "utf8", env: { ...ctx.env } as NodeJS.ProcessEnv });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
};

const plan = (ctx: Ctx): PlanView => {
  const r = cli(ctx, ["show", "--json"]);
  if (!r.ok) throw new Error(`plan show failed: ${r.out.slice(0, 300)}`);
  return (JSON.parse(r.out) as { plan: PlanView }).plan;
};

const derived = (ctx: Ctx): Record<string, Record<string, unknown>> => {
  const file = join(ctx.root, "docs/mission/tasks.json");
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] }).tasks : [];
  return Object.fromEntries(all.map((t) => [String(t.key), t]));
};

export const isPlanTask = (ctx: Ctx, id: string): boolean => plan(ctx).tasks.some((t) => t.id === id);

export const loadTask = (ctx: Ctx, id: string): Task => {
  const t = plan(ctx).tasks.find((x) => x.id === id);
  if (t) {
    const file = join(ctx.root, "plan/tasks", `${id}.md`);
    return { id, source: "plan", title: t.title, goal: existsSync(file) ? readFileSync(file, "utf8") : t.why, evals: [], checkers: ["reviewer"], paths: [] };
  }
  const d = derived(ctx)[id];
  if (!d) throw new Error(`no task ${id}: not in plan/plan.json, not in docs/mission/tasks.json`);
  const list = (k: string): string[] => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
  return { id, source: "derived", title: String(d.title), goal: String(d.goal ?? ""), evals: list("evals"), checkers: list("checkers").length ? list("checkers") : ["reviewer"], paths: list("paths"), ...(typeof d.budgetUsd === "number" ? { budgetUsd: d.budgetUsd } : {}) };
};

/** Tasks the worker may take: todo, every need done, and either named or on the critical path, in that order. */
export const readyTasks = (ctx: Ctx, named: readonly string[] = []): string[] => {
  const p = plan(ctx);
  const done = new Set(p.tasks.filter((t) => t.state === "done").map((t) => t.id));
  const wanted = named.length ? named : p.path.tasks;
  return wanted.filter((id) => { const t = p.tasks.find((x) => x.id === id); return t?.state === "todo" && t.needs.every((n) => done.has(n)); });
};

const change = (ctx: Ctx, args: string[]): void => {
  const r = cli(ctx, [...args, "--by", "loop"]);
  if (!r.ok) throw new Error(`plan ${args.slice(0, 3).join(" ")} was refused: ${r.out.slice(0, 300)}`);
};

export const claim = (ctx: Ctx, id: string, runId: string): void => change(ctx, ["task", "start", id, "--thread", runId]);
export const block = (ctx: Ctx, id: string, need: string): void => change(ctx, ["task", "block", id, "--need", need.replace(/\s+/g, " ").slice(0, 400), "--who", "coordinator"]);
export const finish = (ctx: Ctx, id: string, evidence: string): void => change(ctx, ["task", "done", id, "--evidence", evidence]);
