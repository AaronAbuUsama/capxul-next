/**
 * GENERIC. Playing a script against a run's storage, and the commands around it: stop, list, work. Durability is
 * pi-durable's: a script replays from its top, each `step` answers from the ledger if it is done, and an agent step
 * continues in its stored conversation. This file only adds the status index and the loops that start and watch runs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entriesOf, record, remember, tail, type Host } from "../agents/service.ts";
import { SETTLED, type Info, type Run, type Script } from "./types.ts";

export type * from "./types.ts";
export { SETTLED };

export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return pid > 0; } catch { return false; } };
const statusFile = (dir: string): string => join(dir, "status.json");
export const readInfo = (dir: string): Info => JSON.parse(readFileSync(statusFile(dir), "utf8")) as Info;
export const listRuns = (runs: string): { dir: string; info: Info }[] =>
  !existsSync(runs) ? [] : readdirSync(runs).map((d) => join(runs, d)).filter((d) => existsSync(statusFile(d))).map((dir) => ({ dir, info: readInfo(dir) }));

export interface Play { dir: string; id: string; subject: string; open: () => Promise<Host>; script: Script; now?: () => Date; extra?: () => Record<string, unknown> }

/** Plays the script to its end. Never throws: the returned status says how it ended (`stopped`, `failed` and a run whose process died can be played again). */
export const play = async (p: Play): Promise<Info> => {
  mkdirSync(p.dir, { recursive: true });
  const now = p.now ?? (() => new Date());
  const old = existsSync(statusFile(p.dir)) ? readInfo(p.dir) : undefined;
  const info: Info = { ...(old ?? { id: p.id, subject: p.subject, step: null, round: 0, startedAt: now().toISOString(), spentUsd: 0, tokens: 0, reasons: [], extra: {} }), id: p.id, subject: p.subject, status: "running", pid: process.pid, updatedAt: now().toISOString() } as Info;
  delete info.error; delete info.endedAt;
  const stopFile = join(p.dir, "STOP");
  rmSync(stopFile, { force: true });
  const host = await p.open();
  const save = async (): Promise<void> => {
    const used = Object.values((await host.harness.usage(host.context)).models);
    info.spentUsd = used.reduce((s, u) => s + u.cost.total, 0);
    info.tokens = used.reduce((s, u) => s + u.totalTokens, 0);
    info.updatedAt = now().toISOString();
    Object.assign(info.extra, p.extra?.() ?? {});
    writeFileSync(statusFile(p.dir), `${JSON.stringify(info, null, 2)}\n`);
  };
  const run: Run = {
    id: p.id, dir: p.dir, host, info, stopFile, save,
    step: async (name, fn) => {
      if (existsSync(stopFile)) throw new Error("stopped");
      info.step = name;
      const n = /\.(\d+)$/.exec(name);
      if (n) info.round = Math.max(info.round, Number(n[1]));
      await save();
      return remember(host, name, fn);
    },
    end: async (status, reasons) => {
      await record(host, "loop.end", status, { reasons });
      Object.assign(info, { status, reasons, step: null, endedAt: now().toISOString() });
      await save();
    },
  };
  await record(host, "loop.play", `${info.startedAt}:${now().getTime()}`);
  await save();
  try {
    await p.script(run);
    if (info.status === "running") { info.status = "failed"; info.error = "the script returned without ready, blocked or answered"; }
  } catch (cause) {
    const stopped = cause instanceof Error && cause.message === "stopped";
    info.status = stopped ? "stopped" : "failed";
    if (!stopped) info.error = cause instanceof Error ? cause.message : String(cause);
  }
  await save().catch(() => undefined);
  await host.close().catch(() => undefined);
  return info;
};

/** Asks a run to stop: its agent is aborted within a second, and the run ends `stopped`. A run whose process is gone is marked at once. */
export const stop = (dir: string): string => {
  const info = readInfo(dir);
  if (info.status !== "running") return `run ${info.id} is ${info.status}`;
  writeFileSync(join(dir, "STOP"), "");
  if (alive(info.pid)) return `stop asked; run ${info.id} ends within a second or two`;
  writeFileSync(statusFile(dir), `${JSON.stringify({ ...info, status: "stopped" }, null, 2)}\n`);
  return `run ${info.id} was not running; marked stopped`;
};

/** What a run or a step used, for a person: dollars when the provider reports prices, otherwise tokens (never "$0.00" for work that was done). */
export const spendText = (usd: number, tokens: number): string => {
  if (usd > 0) return `$${usd.toFixed(2)}`;
  if (tokens <= 0) return "-";
  return `${tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : tokens >= 10_000 ? `${Math.round(tokens / 1000)}k` : String(tokens)} tokens`;
};

const dur = (ms: number): string => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`; };

export const table = (runs: readonly Info[], now: Date): string => {
  const rows = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((s) => [
    s.id, s.subject, s.status === "running" && !alive(s.pid) ? "dead (resume)" : s.status, s.step ?? "-", s.round ? String(s.round) : "-",
    dur((s.endedAt ? new Date(s.endedAt) : now).getTime() - new Date(s.startedAt).getTime()), spendText(s.spentUsd, s.tokens),
  ]);
  const all = [["run", "task", "status", "step", "round", "elapsed", "spend"], ...rows];
  const w = all[0]!.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  return all.map((r) => r.map((c, i) => c.padEnd(w[i]!)).join("  ").trimEnd()).join("\n");
};

/** The ledger as lines: each step's start and end, the agent conversation it used, how the run ended. */
export const ledgerLines = async (host: Host): Promise<string[]> =>
  (await entriesOf(host)).map((e) => {
    const d = e.data as { name?: string; id?: number; reasons?: string[]; result?: { costUsd?: number; tokens?: number } };
    const extra = e.kind === "loop.conversation" ? ` conversation ${d.id}` : e.kind === "loop.end" ? ` ${(d.reasons ?? []).join(" | ").slice(0, 200)}` : e.kind === "loop.done" && d.result?.tokens !== undefined ? ` ${spendText(d.result.costUsd ?? 0, d.result.tokens)}` : "";
    return `${e.kind.replace("loop.", "").padEnd(12)} ${d.name}${extra}`;
  });

/**
 * Follows a run from another process: opens its storage read-only each second (it never writes or recovers anything),
 * prints what its newest agent did since the last look, and ends when the run is not running. Sending a message to the
 * agent, or taking a turn, is deliberately not built here: `Conversation.submit` with `whenBusy: "steer"` is the call.
 */
export const watchRun = async (dir: string, open: () => Promise<Host>, say: (s: string) => void, o: { follow: boolean; pause?: number } = { follow: true }): Promise<void> => {
  let current = 0, after = 0;
  for (;;) {
    const info = readInfo(dir), host = await open();
    try {
      const last = (await entriesOf(host)).filter((e) => e.kind === "loop.conversation").pop()?.data as { id?: number; name?: string } | undefined;
      if (last?.id !== undefined) {
        if (last.id !== current) { current = last.id; after = 0; say(`-- ${last.name} (conversation ${last.id})`); }
        const t = await tail(host, current, after);
        t.lines.forEach(say);
        after = t.last;
      }
    } finally { await host.close(); }
    if (!o.follow || info.status !== "running" || !alive(info.pid)) return;
    await new Promise((r) => setTimeout(r, o.pause ?? 1000));
  }
};

/**
 * The worker's loop: keep `concurrency` runs going, resuming first, then starting what `ready()` offers; end when idle
 * unless `wait`. A run that ends `stopped` was stopped by a person: the worker then starts nothing more and ends when
 * the runs it has are over, `wait` or not. A start or a resume that throws is said and does not end the worker.
 */
export const work = async (o: { concurrency: number; wait: boolean; pause?: number; dead: () => string[]; ready: () => string[]; resume: (id: string) => Promise<unknown>; start: (subject: string) => Promise<unknown>; say: (s: string) => void }): Promise<void> => {
  const going = new Map<string, Promise<unknown>>();
  let halted = false;
  const go = (key: string, p: Promise<unknown>): void => {
    going.set(key, p.then((ended) => {
      if ((ended as { status?: string } | undefined)?.status === "stopped" && !halted) { halted = true; o.say(`${key} was stopped: the worker starts nothing more and ends when its runs are over`); }
    }, (cause: unknown) => o.say(cause instanceof Error ? cause.message : String(cause))).finally(() => going.delete(key)));
  };
  for (;;) {
    if (!halted) {
      for (const id of o.dead()) if (going.size < o.concurrency && !going.has(id)) { o.say(`resuming ${id}`); go(id, o.resume(id)); }
      for (const s of o.ready()) if (going.size < o.concurrency && !going.has(s)) { o.say(`starting ${s}`); go(s, o.start(s)); }
    }
    if (going.size === 0 && (halted || !o.wait)) return;
    await Promise.race([...going.values(), new Promise((r) => setTimeout(r, o.pause ?? 30_000))]);
  }
};
