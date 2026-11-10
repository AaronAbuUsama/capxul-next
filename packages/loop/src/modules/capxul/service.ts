/**
 * CAPXUL-SPECIFIC. The vocabulary a script in `loops/` is written in (`lane`, `sandbox`, `agent`, `handback`, `gate`,
 * `review`, `settle`, then `ready`, `blocked`, `answered`), and the commands `main.ts` calls (start, resume, work, merge,
 * clean, status, logs, watch, stop). Each vocabulary function is a few lines and a step of the run: its result is in the
 * run's ledger, so a script replayed after a restart skips what is done.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask, lastJson, openHost, type Host } from "../agents/service.ts";
import { catchUp, commitAll, dropLane, ensureLane, git, head, slug, type Lane } from "../lanes/service.ts";
import { alive, ledgerLines, listRuns, play, readInfo, SETTLED, stop as stopRun, table, watchRun, work as workLoop, type Info, type Run } from "../runs/service.ts";
import { allowedModel, defaultCheckerModel, defaultModel, modelsOf, POLICY, qualify } from "./internal/config.ts";
import { showView, statusViews, type Look, type RunView } from "../inspect/service.ts";
import { runGates } from "./internal/gates.ts";
import * as plan from "./internal/plan.ts";
import { checkerPrompt, makerPrompt as renderMaker, researchPrompt, type CheckInput } from "./internal/prompts.ts";
import { startSandbox, stopSandbox } from "./internal/sandbox.ts";
import { cleanEnv } from "./internal/sh.ts";
import type { Check, Ctx, Finding, Gate, Handback, Job, Opts, SandboxInfo, Said, Task } from "./types.ts";

export type * from "./types.ts";
export { GATES } from "./internal/gates.ts";
export { POLICY } from "./internal/config.ts";

export const DEFAULTS: Opts = { script: "pair", sandbox: "none", rounds: 3, budgetUsd: 5, timeoutMin: 30 };
/** Where the runs are: `runs/` of the checkout, or the folder `LOOP_RUNS` names (the portal can read another checkout's). */
const runsDir = (ctx: Ctx): string => ctx.env.LOOP_RUNS ?? join(ctx.root, "runs");
const baseOf = (ctx: Ctx): string => ctx.env.LOOP_BASE ?? "integration/build";
const CHECKER_ROLES = new Set(["reviewer", "adversary", "diagnoser"]);

// ── the vocabulary ──────────────────────────────────────────────────────────────────────────────

/** The lane: a worktree on `lane/<task>` cut from integration/build. `{ install: false }` when the agent only reads. */
export const lane = async (job: Job, o: { install?: boolean } = {}): Promise<Lane> => {
  const made = await job.run.step("lane", async () => ensureLane(job.ctx.root, join(job.run.dir, "lane"), job.task.id, baseOf(job.ctx), (dir) => {
    if ((o.install ?? true) && existsSync(join(dir, "pnpm-lock.yaml"))) execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir, stdio: "ignore", env: cleanEnv(job.ctx) });
  }));
  return (job.lane = made);
};

/** The sandbox the run asked for (`--sandbox`), started now or found again; its variables are what agents' commands see. */
export const sandbox = async (job: Job): Promise<SandboxInfo> => {
  job.box = await startSandbox(job.ctx, job.opts.sandbox, job.lane!, job.run.id, job.box);
  for (const k of Object.keys(job.env)) delete job.env[k];
  Object.assign(job.env, cleanEnv(job.ctx, job.box.env));
  await job.run.save();
  return job.box;
};

const boxLine = (box: SandboxInfo): string => box.kind === "none" ? "" : `A ${box.kind} sandbox is running for you: ${Object.entries(box.env).map(([k, v]) => `${k}=${v}`).join(" ")} (these are set in your shell)`;
const roleBody = (job: Job, role: string): string => {
  const m = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(readFileSync(join(job.ctx.root, ".claude/agents", `${role}.md`), "utf8"));
  return (m?.[1] ?? "").trim();
};

/** The maker's brief for round `round`: the task, the open findings, the last handover, the sandbox (swarm-templates.md 2.1). */
export const makerPrompt = (job: Job, round: number, open: Finding[], last?: Handback): string =>
  renderMaker({ task: job.task, round, budgetUsd: job.opts.budgetUsd, spentUsd: job.run.info.spentUsd, branch: job.lane!.branch, sandbox: boxLine(job.box!), open, ...(last?.handover ? { handover: last.handover } : {}) });

/** One agent (pi-durable conversation, the role's definition as its system prompt, tools confined to the lane) as one step. Its work is committed after. */
export const agent = (job: Job, name: string, o: { role: string; prompt: string; readOnly?: boolean }): Promise<Said> => job.run.step(name, async () => {
  const wt = job.lane!, left = job.opts.budgetUsd - job.run.info.spentUsd;
  if (left <= 0 && job.run.info.spentUsd > 0) return { ok: false, text: "", costUsd: 0, tokens: 0, head: head(wt.dir), error: `the budget of $${job.opts.budgetUsd} is spent` };
  const maker = job.opts.model ? qualify(job.opts.model) : defaultModel(job.ctx);
  const model = qualify(CHECKER_ROLES.has(o.role) ? job.opts.checkerModel ?? defaultCheckerModel(job.ctx) : maker);
  if (!allowedModel(model)) return { ok: false, text: "", costUsd: 0, tokens: 0, head: head(wt.dir), error: `the model ${model} is not allowed: only gpt-6.1-sol and gpt-6.1-terra` };
  const said = await ask(job.run.host, {
    key: name, model, system: roleBody(job, o.role), prompt: o.prompt, cwd: wt.dir,
    profile: o.readOnly ? "read" : "write", maxTurns: 80, timeoutMs: job.opts.timeoutMin * 60_000, stopFile: job.run.stopFile,
  });
  return { ...said, head: o.readOnly ? head(wt.dir) : commitAll(wt.dir, `loop: ${name}`) } as unknown as Said;
});

/** What the maker handed back (swarm-templates.md section 3), or nothing if its last message was not one. */
export const handback = (said: Said): Handback | undefined => {
  const j = (said.json ?? lastJson(said.text)) as Handback | undefined;
  return j && typeof j === "object" && (j.submit || j.ask) ? j : undefined;
};

/** The repository's checks, run by the runner in the lane. A failing gate is data: it becomes the next round's finding. */
export const gate = (job: Job, name: string): Promise<Gate[]> =>
  job.run.step(name, () => runGates(job.ctx, job.lane!.dir, job.task, { env: job.box?.env ?? {}, out: join(job.run.dir, `${name}.out`), stopped: () => existsSync(job.run.stopFile) }) as unknown as Promise<Gate[]>) as Promise<Gate[]>;

export interface ReviewSpec { role: string; round: number; made: Said; gates: Gate[]; open: Finding[]; from?: string }

/** A checker with a fresh context and read-only tools reviews the diff and returns the Check of swarm-templates.md 4.1. */
export const review = (job: Job, name: string, o: ReviewSpec): Promise<Check> => job.run.step(name, async () => {
  const wt = job.lane!, to = o.made.head;
  const input: CheckInput = {
    task: job.task, role: o.role, round: o.round, version: to, from: o.from ?? git(wt.dir, "merge-base", wt.base, to), open: o.open, branch: wt.branch,
    note: handback(o.made)?.submit?.note ?? "", machine: o.gates.map((g) => `- ${g.ok ? "pass" : "FAIL"} ${g.name}${g.ok ? "" : `\n${g.tail}`}`).join("\n"),
  };
  const said = await agent(job, `${name}.agent`, { role: o.role, prompt: checkerPrompt(input), readOnly: true });
  const c = said.json as Check | undefined;
  if (!said.ok || !c || !Array.isArray(c.findings)) {
    return { verdict: "changes", fixed: [], findings: [{ severity: "blocking", text: `The ${o.role} returned no check (${said.error ?? "its last message was not the json block"}).` }] } as unknown as Check;
  }
  const blocking = c.findings.some((f) => f.severity === "blocking");
  return { ...c, fixed: c.fixed ?? [], verdict: blocking ? "changes" : c.verdict } as unknown as Check;
}) as Promise<Check>;

/** The findings still open after a round: the old ones not fixed, plus every failed gate and every new blocking finding. */
export const settle = (round: number, open: Finding[], gates: Gate[], checks: Check[]): Finding[] => {
  const fixed = new Set(checks.flatMap((c) => c.fixed));
  const fresh: Finding[] = [
    ...gates.filter((g) => !g.ok).map((g) => ({ severity: "blocking" as const, check: `gate:${g.name}`, text: `Seen: this check failed. ${g.tail}` })),
    ...checks.flatMap((c) => c.findings.filter((f) => f.severity === "blocking")),
  ];
  return [...open.filter((f) => !fixed.has(f.id ?? "") && !f.check?.startsWith("gate:")), ...fresh.map((f, i) => ({ ...f, id: `F-${round}.${i + 1}` }))];
};

export { researchPrompt };

const finish = async (job: Job, status: "ready" | "blocked" | "answered", reasons: string[]): Promise<void> => {
  await stopSandbox(job.ctx, job.lane, job.box);
  job.box = { kind: "none", env: {} };
  await job.run.end(status, reasons);
};

/** The run's branch is good: push it (never integration/build) and stop. `pnpm loop merge` re-runs the gates and merges. */
export const ready = async (job: Job, reasons: string[] = ["every gate and every checker passed"]): Promise<void> => {
  await job.run.step("push", async () => { git(job.lane!.dir, "push", "-u", "origin", job.lane!.branch); return job.lane!.branch; });
  await finish(job, "ready", reasons);
};

/** The run could not finish: say why, to the plan (a blocked task for the coordinator) and in the run's ledger. */
export const blocked = async (job: Job, reasons: string[]): Promise<void> => {
  if (job.task.source === "plan") await job.run.step("plan.block", async () => { plan.block(job.ctx, job.task.id, `loop run ${job.run.id}: ${reasons.join(" | ")}`); return true; });
  await finish(job, "blocked", reasons);
};

/** A read-only run's written answer; there is no branch and nothing to merge. */
export const answered = async (job: Job, text: string): Promise<void> => finish(job, "answered", [text.slice(0, 600)]);

// ── the commands ────────────────────────────────────────────────────────────────────────────────

type Script = (job: Job) => Promise<void>;
const loadScript = async (ctx: Ctx, name: string): Promise<Script> => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`a script name is lowercase letters, digits and dashes: ${name}`);
  const file = join(ctx.root, "loops", `${name}.ts`);
  if (!existsSync(file)) throw new Error(`no script ${file}`);
  return ((await import(file)) as { default: Script }).default;
};

const open = (ctx: Ctx, dir: string, env: Record<string, string>, readOnly = false, wanted: string[] = []): Promise<Host> =>
  openHost({ file: join(dir, "run.sqlite"), models: modelsOf(ctx, wanted), env, policy: POLICY, readOnly });

const playJob = (ctx: Ctx, id: string, task: Task, opts: Opts, script?: Script): Promise<Info> => {
  const dir = join(runsDir(ctx), id), env: Record<string, string> = cleanEnv(ctx);
  const was = existsSync(join(dir, "status.json")) ? readInfo(dir).extra : {};
  let job: Job | undefined;
  return play({
    dir, id, subject: task.id, now: ctx.now, open: () => open(ctx, dir, env, false, [opts.model, opts.checkerModel].filter((x): x is string => !!x)),
    extra: () => ({ opts, task, lane: job?.lane ?? was.lane, sandbox: job?.box ?? was.sandbox, source: task.source }),
    script: async (run: Run) => {
      job = { ctx, run, env, task, opts, ...(was.lane ? { lane: was.lane as Lane } : {}), ...(was.sandbox ? { box: was.sandbox as SandboxInfo } : {}) };
      Object.assign(env, cleanEnv(ctx, job.box?.env ?? {}));
      if (task.source === "plan") await run.step("plan.claim", async () => { plan.claim(ctx, task.id, id); return true; });
      await (script ?? await loadScript(ctx, opts.script))(job);
    },
  });
};

export const start = async (ctx: Ctx, taskId: string, opts: Opts, script?: Script): Promise<Info> => {
  const task = plan.loadTask(ctx, taskId);
  const stamp = ctx.now().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  let id = `${slug(taskId)}-${stamp}`;
  for (let n = 2; existsSync(join(runsDir(ctx), id)); n++) id = `${slug(taskId)}-${stamp}-${n}`;
  ctx.say(`run ${id}`);
  return playJob(ctx, id, { ...task, budgetUsd: task.budgetUsd ?? opts.budgetUsd }, opts, script);
};

/** Continues a run whose process died, was stopped or failed: the script replays, done steps answer from the ledger, an agent continues in its conversation. */
export const resume = async (ctx: Ctx, id: string, script?: Script): Promise<Info> => {
  const dir = join(runsDir(ctx), id), info = readInfo(dir);
  if (SETTLED.includes(info.status)) throw new Error(`run ${id} is ${info.status}: nothing to resume`);
  if (alive(info.pid) && info.pid !== process.pid) throw new Error(`run ${id} is still running (pid ${info.pid}); \`loop stop ${id}\` first`);
  return playJob(ctx, id, info.extra.task as Task, info.extra.opts as Opts, script);
};

export const stop = (ctx: Ctx, id: string): string => stopRun(join(runsDir(ctx), id));
export const status = (ctx: Ctx): string => table(listRuns(runsDir(ctx)).map((r) => r.info), ctx.now());

const lookOf = (ctx: Ctx, events: number): Look => ({ runs: runsDir(ctx), open: (dir) => open(ctx, dir, {}, true), now: ctx.now(), env: ctx.env, events });
/** `loop status --json`: every run that is running or was saved within `sinceHours`, each with its counts and its last three events. */
export const statusJson = (ctx: Ctx, sinceHours: number): Promise<readonly RunView[]> => statusViews(lookOf(ctx, 3), sinceHours);
/** `loop show <run> --json`: one run with its last twenty events, or null. */
export const showJson = (ctx: Ctx, id: string): Promise<RunView | null> => showView(lookOf(ctx, 20), id);

/** The ledger of a run, then, with `follow`, what its agent is doing until the run ends. */
export const logs = async (ctx: Ctx, id: string, follow: boolean): Promise<void> => {
  const dir = join(runsDir(ctx), id), host = await open(ctx, dir, {}, true);
  try { (await ledgerLines(host)).forEach(ctx.say); } finally { await host.close(); }
  if (follow) await watchRun(dir, () => open(ctx, dir, {}, true), ctx.say);
};
/** Attach to a running agent: print what it has done so far and follow it live (read-only; it changes nothing). */
export const watch = (ctx: Ctx, id: string): Promise<void> => { const dir = join(runsDir(ctx), id); return watchRun(dir, () => open(ctx, dir, {}, true), ctx.say); };

/** The worker: ready tasks from the plan (named, or on the critical path), a run each, `concurrency` at once; dead runs are resumed first. */
export const work = (ctx: Ctx, o: { concurrency: number; tasks: string[]; opts: Opts; wait: boolean; pause?: number }): Promise<void> => {
  const runs = (): { dir: string; info: Info }[] => listRuns(runsDir(ctx));
  return workLoop({
    concurrency: o.concurrency, wait: o.wait, say: ctx.say, ...(o.pause ? { pause: o.pause } : {}),
    dead: () => runs().filter((r) => r.info.status === "running" && !alive(r.info.pid)).map((r) => r.info.id),
    ready: () => plan.readyTasks(ctx, o.tasks).filter((t) => !runs().some((r) => r.info.subject === t && !SETTLED.includes(r.info.status))),
    resume: (id) => resume(ctx, id), start: (t) => start(ctx, t, o.opts),
  });
};

const dirtyOutsidePlan = (cwd: string): string[] => git(cwd, "status", "--porcelain").split("\n").filter((l) => l !== "" && !/^.. (plan\/|runs\/)/.test(l));

/**
 * Merges a run that is "ready": brings the current base into the lane, runs the gates again there, and only if every one
 * passes merges into the base in this checkout and pushes it. Refuses, and says why, otherwise. Marks the plan task done.
 */
export const merge = async (ctx: Ctx, id: string): Promise<string[]> => {
  const dir = join(runsDir(ctx), id), info = readInfo(dir), wt = info.extra.lane as Lane | undefined, opts = info.extra.opts as Opts;
  if (info.status !== "ready" || !wt) return [`refused: run ${id} is ${info.status}, not ready to merge`];
  if (git(ctx.root, "rev-parse", "--abbrev-ref", "HEAD") !== wt.base) return [`refused: this checkout is not on ${wt.base}`];
  const dirty = dirtyOutsidePlan(ctx.root);
  if (dirty.length) return [`refused: this checkout has uncommitted changes outside plan/ and runs/: ${dirty.slice(0, 3).join("; ")}`];
  if (!catchUp(wt)) return [`refused: ${wt.branch} conflicts with the current ${wt.base}; resolve it in ${wt.dir}`];
  const task = info.extra.task as Task;
  const box = await startSandbox(ctx, opts.sandbox, wt, id);
  let gates: Gate[];
  try { gates = await runGates(ctx, wt.dir, task, { env: box.env as Record<string, string>, out: join(dir, `merge-gates.${ctx.now().getTime()}.out`) }); } finally { await stopSandbox(ctx, wt, box); }
  const failed = gates.filter((g) => !g.ok);
  if (failed.length) return [`refused: ${failed.length} of ${gates.length} gates fail on ${wt.branch} with ${wt.base} merged in`, ...failed.map((g) => `  ${g.name}: ${g.tail.split("\n").slice(-3).join(" ")}`)];
  git(ctx.root, "push", "--dry-run", "origin", wt.base);
  git(ctx.root, "merge", "--no-ff", "-m", `Merge ${wt.branch} (loop run ${id})`, wt.branch);
  const commit = git(ctx.root, "rev-parse", "HEAD");
  try { git(ctx.root, "push", "origin", wt.base); } catch (cause) { return [`merged locally at ${commit} but the push failed: ${String(cause).slice(0, 200)}`]; }
  if (info.extra.source === "plan") plan.finish(ctx, info.subject, commit);
  await writeStatus(dir, { ...info, status: "merged", endedAt: ctx.now().toISOString() });
  dropLane(ctx.root, wt);
  return [`merged ${wt.branch} into ${wt.base} at ${commit.slice(0, 7)} and pushed${info.extra.source === "plan" ? `; plan task ${info.subject} marked done` : ""}`];
};

const writeStatus = async (dir: string, info: Info): Promise<void> => writeFileSync(join(dir, "status.json"), `${JSON.stringify(info, null, 2)}\n`);

/** Removes the worktree of one run (any run that is not running), or of every merged or answered run. The branch stays. */
export const clean = (ctx: Ctx, id?: string): string[] => {
  const picked = listRuns(runsDir(ctx)).filter((r) => (id ? r.info.id === id : r.info.status === "merged" || r.info.status === "answered") && existsSync((r.info.extra.lane as Lane | undefined)?.dir ?? "") && r.info.status !== "running");
  picked.forEach((r) => dropLane(ctx.root, r.info.extra.lane as Lane));
  return picked.length ? picked.map((r) => `removed the lane of ${r.info.id}`) : ["nothing to clean"];
};
