/**
 * CAPXUL-SPECIFIC. The vocabulary a script in `loops/` is written in (`lane`, `sandbox`, `agent`, `handback`, `gate`,
 * `review`, `settle`, then `ready`, `blocked`, `answered`), and the commands `main.ts` calls (start, resume, work, merge,
 * clean, status, logs, watch, stop). Each vocabulary function is a few lines and a step of the run: its result is in the
 * run's ledger, so a script replayed after a restart skips what is done.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ask, lastJson, openHost, type Host } from "../agents/service.ts";
import { commitAll, ensureLane, git, head, laneBlocked, slug, type Lane } from "../lanes/service.ts";
import { acquire, alive, ledgerLines, listRuns, play, readInfo, SETTLED, stop as stopRun, watchRun, work as workLoop, type Info, type Run } from "../runs/service.ts";
import { allowedModel, defaultCheckerModel, defaultModel, gatewayOf, modelsOf, POLICY, qualify } from "./internal/config.ts";
import { evidenceBrief, evidenceLines, kitFor, restore } from "./internal/evidence.ts";
import { sendNote, takeNote } from "./internal/notes.ts";
import { openDoor, type Door } from "../door/service.ts";
import { FOLDER as EVIDENCE } from "../evidence/service.ts";
import { serve as serveHost, type Served } from "../host/service.ts";
import { showDetail, showView, statusViews, viewsTable, type Look, type RunDetail, type RunView } from "../inspect/service.ts";
import { findingsOf, gatesFor, runGates } from "./internal/gates.ts";
import * as plan from "./internal/plan.ts";
import { checkerPrompt, makerPrompt as renderMaker, researchPrompt, type CheckInput } from "./internal/prompts.ts";
import { startSandbox, stopSandbox } from "./internal/sandbox.ts";
import { baseOf, runDir, runsDir } from "./internal/where.ts";
import { cleanEnv } from "./internal/sh.ts";
import type { Check, Ctx, Finding, Gate, Handback, Job, Opts, SandboxInfo, Said, Task } from "./types.ts";

export type * from "./types.ts";
export { gatesOf } from "./internal/gates.ts";
export { POLICY } from "./internal/config.ts";

export const DEFAULTS: Opts = { script: "pair", sandbox: "none", rounds: 3, budgetUsd: 5, timeoutMin: 30 };
const CHECKER_ROLES = new Set(["reviewer", "adversary", "diagnoser"]);
/** How many agents may work at once across every run of this checkout (`LOOP_MAX_AGENTS`, default 3: what the gateway has carried). */
const maxAgents = (ctx: Ctx): number => Math.max(1, Number(ctx.env.LOOP_MAX_AGENTS) || 3);
/** How long the loop waits for a failing gateway before it continues an agent, after pi's own retries of the request. */
const MODEL_WAITS_MS: readonly number[] = [20_000, 60_000, 180_000];
/** A gateway's error in a line: one that answers with a web page says nothing useful past its status. */
const modelSaid = (detail = ""): string => (detail.includes("<") ? `The gateway answered ${/^\d{3}/.exec(detail)?.[0] ?? "an error"}${detail.includes("upstream-down") ? ": its upstream is down" : ""}.` : detail.split("\n")[0]!.slice(0, 240));

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
  renderMaker({ task: job.task, round, budgetUsd: job.opts.budgetUsd, spentUsd: job.run.info.spentUsd, spentTokens: job.run.info.tokens, branch: job.lane!.branch, sandbox: boxLine(job.box!), open, ...(last?.handover ? { handover: last.handover } : {}) }, gatesFor(job.ctx, job.lane!.dir, job.task).map((g) => g.sh), findingsOf(job.lane!.dir), evidenceBrief(job, false));

/** One agent (pi-durable conversation, the role's definition as its system prompt, tools confined to the lane) as one step. Its work is committed after. */
export const agent = (job: Job, name: string, o: { role: string; prompt: string; readOnly?: boolean }): Promise<Said> => job.run.step(name, async () => {
  const wt = job.lane!, left = job.opts.budgetUsd - job.run.info.spentUsd;
  if (left <= 0 && job.run.info.spentUsd > 0) return { ok: false, text: "", costUsd: 0, tokens: 0, head: head(wt.dir), error: `the budget of $${job.opts.budgetUsd} is spent` };
  const maker = job.opts.model ? qualify(job.opts.model) : defaultModel(job.ctx);
  const model = qualify(CHECKER_ROLES.has(o.role) ? job.opts.checkerModel ?? defaultCheckerModel(job.ctx) : maker);
  if (!(await allowedModel(job.ctx, model))) return { ok: false, text: "", costUsd: 0, tokens: 0, head: head(wt.dir), error: `the model ${model} is not one the gateway serves; \`curl ${gatewayOf(job.ctx).baseUrl}/models\` lists them` };
  // The gateway carries only so many agents at once: an agent takes a slot shared by every run and process of this checkout, and waits for one.
  const release = await acquire(join(runsDir(job.ctx), ".agents"), maxAgents(job.ctx), { stopped: () => existsSync(job.run.stopFile), waiting: () => job.ctx.say(`${name} waits: ${maxAgents(job.ctx)} agents are already working`), ...(job.ctx.retry ? { pollMs: 20 } : {}) });
  const kit = kitFor(job, name, o.readOnly ?? false);                 // the capture tools: what this agent shows is made by them
  const said = await ask(job.run.host, {
    key: name, model, system: roleBody(job, o.role), prompt: o.prompt, cwd: wt.dir, tools: kit.tools,
    profile: o.readOnly ? "read" : "write", maxTurns: 80, timeoutMs: job.opts.timeoutMin * 60_000, stopFile: job.run.stopFile, modelWaitsMs: job.ctx.retry?.waitsMs ?? MODEL_WAITS_MS,
  }).finally(() => { release(); return kit.close(); });
  if (o.readOnly) { const undone = restore(wt.dir); if (undone.length > 0) job.ctx.say(`${name} left ${undone.length} change(s) in the lane; they are undone`); }
  // A model that never answered is not a hand-back and not a review: the run fails here, with the gateway's words, and no round is spent on it.
  if (!said.ok && /^unanswered: (model_error|no_model|interrupted)/.test(said.error ?? "")) throw new Error(`${name}: the model did not answer (${said.error!.replace("unanswered: ", "").replace("_", " ")}), after waiting for it ${(job.ctx.retry?.waitsMs ?? MODEL_WAITS_MS).length} times. ${modelSaid(said.detail)}`);
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
    note: handback(o.made)?.submit?.note ?? "", shown: evidenceLines(job, `make.${o.round}`, o.made.json ?? lastJson(o.made.text)), evidence: evidenceBrief(job, true), machine: o.gates.map((g) => `- ${g.ok ? "pass" : "FAIL"} ${g.name}${g.ok ? "" : `\n${g.tail}`}`).join("\n"),
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
  openHost({ file: join(dir, "run.sqlite"), models: modelsOf(ctx, wanted), env, policy: POLICY, readOnly, ...(ctx.retry ? { retry: { maxRetries: ctx.retry.maxRetries, baseDelayMs: ctx.retry.baseDelayMs } } : {}) });

const playJob = (ctx: Ctx, id: string, task: Task, opts: Opts, script?: Script): Promise<Info> => {
  const dir = join(runsDir(ctx), id), env: Record<string, string> = cleanEnv(ctx);
  const was = existsSync(join(dir, "status.json")) ? readInfo(dir).extra : {};
  let job: Job | undefined, door: Door | undefined;
  return play({
    dir, id, subject: task.id, now: ctx.now, open: () => open(ctx, dir, env, false, [opts.model, opts.checkerModel].filter((x): x is string => !!x)),
    extra: () => ({ opts, task, lane: job?.lane ?? was.lane, sandbox: job?.box ?? was.sandbox, source: task.source, gateway: ctx.models ? "test" : gatewayOf(ctx).name, door: door?.at ?? null }),
    script: async (run: Run) => {
      job = { ctx, run, env, task, opts, ...(was.lane ? { lane: was.lane as Lane } : {}), ...(was.sandbox ? { box: was.sandbox as SandboxInfo } : {}) };
      Object.assign(env, cleanEnv(ctx, job.box?.env ?? {}));
      door = await openDoor({ note: (n) => takeNote(job!, n) });           // while this process plays the run, a person's note can reach its agents
      await run.save();
      try {
        if (task.source === "plan") await run.step("plan.claim", async () => { plan.claim(ctx, task.id, id); return true; });
        await (script ?? await loadScript(ctx, opts.script))(job);
      } finally { await door.close(); door = undefined; }
    },
  });
};

export const start = async (ctx: Ctx, taskId: string, opts: Opts, script?: Script): Promise<Info> => {
  const task = plan.loadTask(ctx, taskId);
  if (!script) await loadScript(ctx, opts.script);                 // an unknown script is found before anything is claimed or made
  const stamp = ctx.now().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  let id = `${slug(taskId)}-${stamp}`;
  for (let n = 2; existsSync(join(runsDir(ctx), id)); n++) id = `${slug(taskId)}-${stamp}-${n}`;
  const why = laneBlocked(ctx.root, join(runsDir(ctx), id, "lane"), task.id, baseOf(ctx));
  if (why) throw new Error(`cannot start a run on ${taskId}: ${why}`);
  ctx.say(`run ${id}`);
  return playJob(ctx, id, { ...task, budgetUsd: task.budgetUsd ?? opts.budgetUsd }, opts, script);
};

/** Continues a run whose process died, was stopped or failed: the script replays, done steps answer from the ledger, an agent continues in its conversation. */
export const resume = async (ctx: Ctx, id: string, script?: Script): Promise<Info> => {
  const dir = runDir(ctx, id), info = readInfo(dir);
  if (SETTLED.includes(info.status)) throw new Error(`run ${id} is ${info.status}: nothing to resume`);
  if (alive(info.pid) && info.pid !== process.pid) throw new Error(`run ${id} is still running (pid ${info.pid}); \`loop stop ${id}\` first`);
  return playJob(ctx, id, info.extra.task as Task, info.extra.opts as Opts, script);
};

export const stop = (ctx: Ctx, id: string): string => stopRun(runDir(ctx, id));
export { sendNote };
/** `loop status`: every run saved in the last day, with its refused calls, model failures and whether it was superseded. */
export const status = async (ctx: Ctx, sinceHours = 24): Promise<string> => viewsTable(await statusViews(lookOf(ctx, 0), sinceHours));

const quietGit = (ctx: Ctx) => (args: readonly string[]): string => { try { return git(ctx.root, ...args); } catch { return ""; } };
export const lookOf = (ctx: Ctx, events: number): Look => ({ runs: runsDir(ctx), open: (dir) => open(ctx, dir, {}, true), now: ctx.now(), env: ctx.env, events, git: quietGit(ctx), done: plan.doneTasks(ctx) });
/** `loop status --json`: every run that is running or was saved within `sinceHours`, each with its counts and its last three events. */
export const statusJson = (ctx: Ctx, sinceHours: number): Promise<readonly RunView[]> => statusViews(lookOf(ctx, 3), sinceHours);
/** `loop show <run> --json`: one run with its last twenty events, or null. */
export const showJson = (ctx: Ctx, id: string): Promise<RunView | null> => showView(lookOf(ctx, 20), id);
/** `loop show <run> --json --full`: the run with every step's result and every agent's conversation, or null. */
export const showFull = (ctx: Ctx, id: string): Promise<RunDetail | null> => showDetail(lookOf(ctx, 0), id);

/** The ledger of a run, then, with `follow`, what its agent is doing until the run ends. */
export const logs = async (ctx: Ctx, id: string, follow: boolean): Promise<void> => {
  const dir = runDir(ctx, id), host = await open(ctx, dir, {}, true);
  try { (await ledgerLines(host)).forEach(ctx.say); } finally { await host.close(); }
  if (follow) await watchRun(dir, () => open(ctx, dir, {}, true), ctx.say);
};
/** Attach to a running agent: print what it has done so far and follow it live (read-only; it changes nothing). */
export const watch = (ctx: Ctx, id: string): Promise<void> => { const dir = runDir(ctx, id); return watchRun(dir, () => open(ctx, dir, {}, true), ctx.say); };

/** The worker: ready tasks from the plan (named, or on the critical path), a run each, `concurrency` at once; dead runs are resumed first. */
export const work = (ctx: Ctx, o: { concurrency: number; tasks: string[]; opts: Opts; wait: boolean; pause?: number }): Promise<void> => {
  const runs = (): { dir: string; info: Info }[] => listRuns(runsDir(ctx)), gaveUp = new Set<string>(), tried = new Set<string>();
  /** A task named on the command line whose newest run was stopped or failed: that run is resumed, once, before anything new is started for it. */
  const left = (): string[] => o.tasks.flatMap((t) => {
    const newest = runs().filter((r) => r.info.subject === t).sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt))[0];
    return newest && (newest.info.status === "stopped" || newest.info.status === "failed") && !tried.has(newest.info.id) ? [newest.info.id] : [];
  });
  return workLoop({
    concurrency: o.concurrency, wait: o.wait, say: ctx.say, ...(o.pause ? { pause: o.pause } : {}),
    dead: () => [...runs().filter((r) => r.info.status === "running" && !alive(r.info.pid)).map((r) => r.info.id), ...left()],
    ready: () => plan.readyTasks(ctx, o.tasks).filter((t) => !gaveUp.has(t) && !runs().some((r) => r.info.subject === t && !SETTLED.includes(r.info.status))),
    resume: (id) => { tried.add(id); return resume(ctx, id); },
    start: (t) => start(ctx, t, o.opts).catch((e: unknown) => { gaveUp.add(t); ctx.say(e instanceof Error ? e.message : String(e)); }),   // one task that cannot start does not end the worker
  });
};

export { clean, merge } from "./internal/merge.ts";

/** `loop serve`: the host a page or a terminal attaches to. It shows every run that is running or was saved in the last `sinceHours`, and takes `stop`. */
export const serve = (ctx: Ctx, o: { port: number; sinceHours?: number }): Promise<Served> => {
  const mtime = (file: string): number => { try { return statSync(file).mtimeMs; } catch { return 0; } };
  const from = (): number => ctx.now().getTime() - (o.sinceHours ?? 24) * 3_600_000;
  return serveHost({
    ids: () => listRuns(runsDir(ctx)).filter((r) => r.info.status === "running" || (Date.parse(r.info.updatedAt) || 0) >= from())
      .map((r) => ({ id: r.info.id, stamp: `${mtime(join(r.dir, "status.json"))}:${mtime(join(r.dir, "run.sqlite"))}:${mtime(join(r.dir, "run.sqlite-wal"))}:${r.info.status === "running" && !alive(r.info.pid)}` })),
    load: (id) => showDetail(lookOf(ctx, 0), id),
    stop: (id) => stop(ctx, id),
    note: (id, n) => sendNote(ctx, id, n),
    say: ctx.say,
    evidence: (id) => (existsSync(join(runsDir(ctx), id, "status.json")) ? join(runsDir(ctx), id, EVIDENCE) : null),
  }, { port: o.port, ...(ctx.env.LOOP_HOST_ORIGINS ? { origins: ctx.env.LOOP_HOST_ORIGINS.split(",") } : {}), ui: ctx.env.LOOP_UI_DIR ?? join(ctx.root, "packages/loop-ui/dist") });
};
