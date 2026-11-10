/**
 * One run in full, for a page that shows it: its steps with what each left behind, and every agent's conversation.
 * Read from the ledger and the conversations, read-only. Unlike a `RunView` this does carry prompts, replies and tool
 * output: each text is scrubbed of secrets and cut, and paths under the lane are shown relative. The storage keeps
 * everything whole.
 */
import { AssistantEntry, type EntryRecord } from "@earendil-works/pi-durable";
import { entriesOf, type Host } from "../../agents/service.ts";
import type { Info } from "../../runs/types.ts";
import type { AgentSession, Changes, Entry, RunDetail, StepRecord } from "../types.ts";
import { scrubText } from "./scrub.ts";

export const CAPS = { prompt: 9000, reply: 9000, output: 2200, argument: 1600, tail: 1400, instructions: 7000, diff: 14_000 } as const;

interface Model { role?: string; content?: unknown; timestamp?: number; usage?: { input?: number; output?: number }; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; isError?: boolean; durationMs?: number; sections?: { instructions?: string } }
interface Part { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown> }
type Clean = (text: string, cap: number) => string;

const textOf = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content) ? (content as Part[]).map((p) => p.text ?? "").join("") : "";
/** Every string inside a value, scrubbed and cut: for the json an agent handed back. */
const deep = (v: unknown, clean: Clean): unknown => typeof v === "string" ? clean(v, 3000) : Array.isArray(v) ? v.map((x) => deep(x, clean)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, clean)])) : v;
const roleOf = (key: string): string => /^make/.test(key) ? "builder" : /^research/.test(key) ? "researcher" : (key.split(".")[0] ?? key);

const allEntries = async (host: Host, id: number): Promise<readonly EntryRecord[]> => {
  const conv = await host.harness.conversation(id as never, host.context);
  if (!conv) return [];
  const out: EntryRecord[] = [];
  let cursor: Parameters<typeof conv.entries>[2];
  for (let page = 0; page < 40; page++) {
    const got = await conv.entries({ order: "ascending" }, 500, cursor, host.context);
    out.push(...got.items);
    if (got.next === undefined) break;
    cursor = got.next;
  }
  return out;
};

const sessionOf = async (host: Host, key: string, id: number, clean: Clean): Promise<AgentSession> => {
  const conv = await host.harness.conversation(id as never, host.context);
  const items = await allEntries(host, id);
  const view = conv ? await conv.watch(host.context) : undefined;
  const agent = view?.value.docs["pi.agent"] as { model?: { modelId?: string }; tools?: string[]; instructions?: string } | undefined;
  const live = view?.value.docs["pi.live"] as { run?: unknown; runFailure?: { reason?: string; detail?: string } } | undefined;
  await view?.stop();
  const entries: Entry[] = [];
  const usage = { turns: 0, tools: {} as Record<string, number>, refused: 0, errors: 0, tokensIn: 0, tokensOut: 0 };
  let first = 0, last = 0, instructions = agent?.instructions ?? "";
  for (const e of items) {
    const m = e.model?.[0] as Model | undefined;
    if (!m) continue;
    if (m.timestamp) { first ||= m.timestamp; last = m.timestamp; }
    const at = m.timestamp ?? null, id = Number(e.id);
    if (e.kind === "pi.system") instructions ||= m.sections?.instructions ?? "";
    else if (AssistantEntry.is(e)) {
      const parts = Array.isArray(m.content) ? (m.content as Part[]) : [];
      usage.turns += 1; usage.tokensIn += m.usage?.input ?? 0; usage.tokensOut += m.usage?.output ?? 0;
      if (m.stopReason === "error") usage.errors += 1;
      const calls = parts.filter((p) => p.type === "toolCall" && typeof p.name === "string").map((p) => {
        usage.tools[p.name!] = (usage.tools[p.name!] ?? 0) + 1;
        const args = Object.fromEntries(Object.entries(p.arguments ?? {}).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? v : clean(typeof v === "string" ? v : JSON.stringify(v), CAPS.argument)]));
        return { id: p.id ?? "", name: p.name!, args };
      });
      entries.push({ id, role: "assistant", at, text: clean(parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join(""), CAPS.reply), thinking: clean(parts.filter((p) => p.type === "thinking").map((p) => p.thinking ?? "").join(""), 3000), calls, error: m.errorMessage ? clean(m.errorMessage, 500) : null });
    } else if (e.kind === "pi.tool-result") {
      const raw = textOf(m.content), refused = /Refused by the loop's policy/.test(raw);
      if (refused) usage.refused += 1;
      entries.push({ id, role: "tool", at, callId: m.toolCallId ?? "", name: m.toolName ?? "", isError: m.isError === true, refused, durationMs: m.durationMs ?? null, text: clean(refused ? raw.replace(/<\/?harness>|\[error\] Tool call blocked: /g, "").trim() : raw, CAPS.output) });
    } else if (m.role === "user") entries.push({ id, role: "user", at, text: clean(textOf(m.content), CAPS.prompt), note: e.kind !== "pi.user" });
  }
  return {
    key, role: roleOf(key), model: agent?.model?.modelId ?? null, tools: agent?.tools ?? [], instructions: clean(instructions, CAPS.instructions),
    state: live?.run !== undefined ? "working" : live?.runFailure ? "failed" : "done",
    failure: live?.runFailure ? { reason: live.runFailure.reason ?? "", detail: clean(String(live.runFailure.detail ?? ""), 500) } : null,
    startedAt: first || null, endedAt: last || null, usage, messages: entries,
  };
};

const stepsOf = (ledger: readonly EntryRecord[], clean: Clean, changes: (commit: string) => Changes | null): StepRecord[] => {
  const steps: StepRecord[] = [];
  const at = (name: string): StepRecord => steps.find((s) => s.name === name) ?? (steps.push({ name, state: "running" }), steps.at(-1)!);
  for (const e of ledger) {
    const d = e.data as { name: string; result?: unknown; reasons?: string[] };
    if (e.kind === "loop.start") at(d.name);
    else if (e.kind === "loop.end") steps.push({ name: `end.${d.name}`, state: "done", end: d.name, reasons: (d.reasons ?? []).map((r) => clean(r, 600)) });
    else if (e.kind === "loop.done") {
      const s = at(d.name), r = d.result as Record<string, unknown> | unknown[] | boolean | string | null;
      s.state = "done";
      if (Array.isArray(r)) s.checks = r.map((g) => ({ name: String((g as { name: unknown }).name), ok: (g as { ok: unknown }).ok === true, tail: clean(String((g as { tail: unknown }).tail ?? ""), CAPS.tail) }));
      else if (r && typeof r === "object" && "verdict" in r) s.review = deep({ verdict: r["verdict"], findings: r["findings"] ?? [], fixed: r["fixed"] ?? [] }, clean) as NonNullable<StepRecord["review"]>;
      else if (r && typeof r === "object" && "ok" in r) {
        s.said = { ok: r["ok"] === true, error: typeof r["error"] === "string" ? clean(r["error"], 500) : null, head: String(r["head"] ?? "").slice(0, 7), tokens: Number(r["tokens"] ?? 0), json: deep(r["json"] ?? null, clean) };
        if (/^make\./.test(d.name) && s.said.ok && typeof r["head"] === "string") s.changes = changes(r["head"]);
      } else s.result = typeof r === "string" ? clean(r, 600) : r;
    }
  }
  return steps;
};

/** `git` runs a git command in the repository the runs belong to and returns its output, or an empty string. */
export const detailOf = async (host: Host, info: Info, secrets: readonly string[], git?: (args: readonly string[]) => string): Promise<RunDetail> => {
  const lane = (info.extra["lane"] as { dir?: string; branch?: string; base?: string } | undefined) ?? {};
  const opts = (info.extra["opts"] as { script?: string; rounds?: number } | undefined) ?? {};
  const task = (info.extra["task"] as { title?: string; goal?: string } | undefined) ?? {};
  const clean: Clean = (text, cap) => scrubText(lane.dir ? text.split(`${lane.dir}/`).join("").split(lane.dir).join(".") : text, secrets, cap);
  const changes = (commit: string): Changes | null => {
    if (!git) return null;
    const subject = git(["show", "-s", "--format=%s", commit]).trim();
    if (!/^(lane\/|loop: )/.test(subject)) return null;                   // not this run's commit: the builder changed nothing
    return { commit: commit.slice(0, 7), subject: clean(subject, 200), stat: clean(git(["show", "--format=", "--stat=110", "--no-color", commit]).trimEnd(), 6000), diff: clean(git(["show", "--format=", "--no-color", commit]), CAPS.diff) };
  };
  const ledger = await entriesOf(host);
  const named = ledger.filter((e) => e.kind === "loop.conversation").map((e) => e.data as { name?: string; id?: number }).filter((d) => d.name !== undefined && d.id !== undefined);
  return {
    id: info.id, task: { id: info.subject, title: clean(task.title ?? info.subject, 200), goal: clean(task.goal ?? "", 3000) }, workflow: opts.script ?? "",
    status: info.status, round: info.round, rounds: typeof opts.rounds === "number" ? opts.rounds : null, startedAt: info.startedAt, endedAt: info.endedAt ?? null, updatedAt: info.updatedAt,
    tokens: info.tokens, branch: lane.branch ?? null, base: lane.base ?? null, reasons: info.reasons.map((r) => clean(r, 600)), error: info.error ? clean(info.error, 600) : null, step: info.step,
    steps: stepsOf(ledger, clean, changes), agents: await Promise.all(named.map((d) => sessionOf(host, d.name!, d.id!, clean))),
  };
};
