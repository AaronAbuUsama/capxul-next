/**
 * The inspect module's door: a run as a `RunView` (types.ts), for `loop status --json` and `loop show <run> --json`. It
 * reads `status.json` and, read-only, the run's pi-durable storage (every agent's conversation); it keeps nothing of its
 * own. A run whose storage cannot be opened still gets a view, from its status file alone.
 */
import { join } from "node:path";
import { entriesOf, type Host } from "../agents/service.ts";
import type { Cursor, EntryRecord } from "@earendil-works/pi-durable";
import { alive, listRuns } from "../runs/service.ts";
import type { Info } from "../runs/types.ts";
import { detailOf } from "./internal/detail.ts";
import { countOf, type Counted } from "./internal/events.ts";
import { scrub, secretsOf } from "./internal/scrub.ts";
import { CAP, WHY_CAP, type EventLine, type RunDetail, type RunStatus, type RunView } from "./types.ts";

/** The statuses on the wire are a run's own plus `dead`: this line stops compiling when one is added to either and not the other. */
const _statuses: [Exclude<RunStatus, "dead">] extends [Info["status"]] ? ([Info["status"]] extends [Exclude<RunStatus, "dead">] ? true : never) : never = true;
void _statuses;

export type { AgentSession, Call, Changes, Entry, EventLine, RunDetail, RunStatus, RunView, StepRecord } from "./types.ts";

/** What a view is made from: the runs' folder, how to open one run's storage read-only, the clock, the environment (only its secrets are looked at). */
export interface Look {
  readonly runs: string;
  readonly open: (dir: string) => Promise<Host>;
  readonly now: Date;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** How many of the newest events each view carries. */
  readonly events: number;
  /** Runs git in the repository the runs belong to, for a builder's changes; absent, a detail carries none. */
  readonly git?: (args: readonly string[]) => string;
}

const PAGES = 20;
const entriesPage = async (host: Host, id: number): Promise<readonly EntryRecord[]> => {
  const conv = await host.harness.conversation(id as never, host.context);
  if (!conv) return [];
  const out: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  for (let n = 0; n < PAGES; n++) {
    const page = await conv.entries({ order: "ascending" }, 500, cursor, host.context);
    out.push(...page.items);
    if (page.next === undefined) break;
    cursor = page.next;
  }
  return out;
};

const iso = (ms: number): string => new Date(ms).toISOString();
const rolesOf = (name: string): string | null => (/^make(\.|$)/.test(name) ? null : (/^([a-z][a-z-]*)\.\d+\.agent$/.exec(name)?.[1] ?? name.split(".")[0] ?? name));

/** The agents of a run, as counted conversations by the ledger's names (`make.1`, `reviewer.1.agent`). */
const agentsOf = async (host: Host, dir: string, secrets: readonly string[]): Promise<readonly (readonly [string, Counted])[]> => {
  const named = (await entriesOf(host)).filter((e) => e.kind === "loop.conversation").map((e) => e.data as { name?: string; id?: number }).filter((d) => d.name !== undefined && d.id !== undefined);
  return Promise.all(named.map(async (d) => [d.name as string, countOf(await entriesPage(host, d.id as number), d.name as string, dir, secrets)] as const));
};

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

const whyOf = (info: Info, dead: boolean, secrets: readonly string[], unreadable: string | null): readonly string[] => {
  const said = info.status === "running" || info.status === "ready" || info.status === "merged" ? [] : info.reasons;
  const own = [...(dead ? ["the run's process is gone; `loop resume` continues it"] : []), ...(info.error ? [info.error] : []), ...(unreadable ? [`its storage could not be read: ${unreadable}`] : []), ...said];
  return own.slice(0, 6).map((r) => scrub(r, secrets, WHY_CAP));
};

export const viewOf = async (look: Look, info: Info): Promise<RunView> => {
  const dir = join(look.runs, info.id);
  const secrets = secretsOf(look.env);
  const lane = info.extra["lane"] as { dir?: string; branch?: string } | undefined;
  const opts = info.extra["opts"] as { script?: string; rounds?: number } | undefined;
  let agents: readonly (readonly [string, Counted])[] = [], unreadable: string | null = null;
  try {
    const host = await look.open(dir);
    try { agents = await agentsOf(host, lane?.dir ?? "", secrets); } finally { await host.close(); }
  } catch (cause) { unreadable = cause instanceof Error ? cause.message : String(cause); }
  const byName: Record<string, number> = {};
  for (const [, c] of agents) for (const [k, n] of Object.entries(c.tools)) byName[k] = (byName[k] ?? 0) + n;
  const checkers: Record<string, string> = {};
  let maker: string | null = null;
  for (const [name, c] of agents) {
    const role = rolesOf(name);
    if (c.model === null) continue;
    if (role === null) maker ??= c.model; else checkers[role] ??= c.model;
  }
  const dead = info.status === "running" && !alive(info.pid);
  const events: EventLine[] = agents.flatMap(([, c]) => c.events).sort((a, b) => a.at.localeCompare(b.at)).slice(-look.events);
  const last = Math.max(Date.parse(info.updatedAt) || 0, ...agents.map(([, c]) => c.lastAt));
  return {
    id: info.id, task: scrub(info.subject, secrets, CAP), script: opts?.script ?? null, status: dead ? "dead" : info.status,
    step: info.step, round: info.round, rounds: typeof opts?.rounds === "number" ? opts.rounds : null,
    startedAt: info.startedAt, endedAt: info.endedAt ?? null, lastEventAt: iso(last), models: { maker, checkers },
    turns: sum(agents.map(([, c]) => c.turns)), toolCalls: { total: sum(Object.values(byName)), byName },
    tokens: { in: sum(agents.map(([, c]) => c.input)), out: sum(agents.map(([, c]) => c.output)) },
    branch: lane?.branch ?? null, events, why: whyOf(info, dead, secrets, unreadable), readable: unreadable === null,
  };
};

/** Every run that is running, or that was last saved within `sinceHours`, oldest first. */
export const statusViews = async (look: Look, sinceHours: number): Promise<readonly RunView[]> => {
  const from = look.now.getTime() - sinceHours * 3_600_000;
  const held = listRuns(look.runs).map((r) => r.info).filter((i) => i.status === "running" || (Date.parse(i.updatedAt) || 0) >= from);
  return Promise.all(held.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((i) => viewOf(look, i)));
};

/** One run, or null when there is none of that id. */
export const showView = async (look: Look, id: string): Promise<RunView | null> => {
  const info = listRuns(look.runs).map((r) => r.info).find((i) => i.id === id);
  return info ? viewOf(look, info) : null;
};

/** One run in full (types.ts, `RunDetail`), or null when there is none of that id or its storage cannot be read. */
export const showDetail = async (look: Look, id: string): Promise<RunDetail | null> => {
  const info = listRuns(look.runs).map((r) => r.info).find((i) => i.id === id);
  if (!info) return null;
  const dead = info.status === "running" && !alive(info.pid);
  try {
    const host = await look.open(join(look.runs, id));
    try { return { ...(await detailOf(host, info, secretsOf(look.env), look.git)), status: dead ? "dead" : info.status }; } finally { await host.close(); }
  } catch { return null; }
};
