/** One agent conversation read as counts and one-line events. Reads the committed entries; writes nothing. */
import { AssistantEntry, type EntryRecord } from "@earendil-works/pi-durable";
import { CAP, type EventLine } from "../types.ts";
import { scrub } from "./scrub.ts";

export interface Counted {
  readonly model: string | null;
  readonly turns: number;
  readonly tools: Readonly<Record<string, number>>;
  readonly input: number;
  readonly output: number;
  readonly lastAt: number;
  /** Calls the loop's policy refused, and model requests that failed. */
  readonly refused: number;
  readonly failures: number;
  readonly events: readonly EventLine[];
}

/** How a refusal reads in a tool's answer (agents/internal/policy.ts, `confine`). */
export const REFUSED = /Refused by the loop's policy/;
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? (content as { text?: unknown }[]).map((c) => (typeof c.text === "string" ? c.text : "")).join("") : "");

interface Part { type?: string; name?: string; arguments?: unknown }
interface Message { role?: string; content?: unknown; timestamp?: number; provider?: string; model?: string; stopReason?: string; usage?: { input?: number; output?: number } }

/** The argument worth showing for each tool: the command's first line, a path, a pattern. Any other tool shows its name only. */
const argOf = (tool: string, args: unknown, dir: string): string => {
  const a = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const text = (k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");
  const path = (p: string): string => (dir !== "" && p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p);
  if (tool === "bash") { const line = text("command").split("\n")[0] ?? ""; return dir === "" ? line : line.split(dir).join("."); }
  if (tool === "grep") return text("pattern");
  return ["path", "file_path"].map(text).filter((p) => p !== "").map(path)[0] ?? "";
};

/** `dir` is the lane's directory: paths under it are shown relative, so a summary never carries where the checkout is. */
export const countOf = (items: readonly EntryRecord[], who: string, dir: string, secrets: readonly string[]): Counted => {
  const tools: Record<string, number> = {};
  const events: EventLine[] = [];
  let model: string | null = null, turns = 0, input = 0, output = 0, lastAt = 0, refused = 0, failures = 0;
  for (const e of items) {
    const m = (e.model?.[0] ?? undefined) as Message | undefined;
    if (!m) continue;
    if (typeof m.timestamp === "number") lastAt = Math.max(lastAt, m.timestamp);
    if (m.role === "toolResult") { if (REFUSED.test(textOf(m.content))) refused += 1; continue; }
    if (!AssistantEntry.is(e)) continue;
    if (m.stopReason === "error") failures += 1;
    turns += 1;
    input += m.usage?.input ?? 0;
    output += m.usage?.output ?? 0;
    if (model === null && m.provider !== undefined && m.model !== undefined) model = `${m.provider}/${m.model}`;
    const at = new Date(m.timestamp ?? 0).toISOString();
    const calls = (Array.isArray(m.content) ? (m.content as Part[]) : []).filter((p) => p.type === "toolCall" && typeof p.name === "string");
    for (const c of calls) {
      const name = c.name as string;
      tools[name] = (tools[name] ?? 0) + 1;
      events.push({ at, who, what: scrub(`${name} ${argOf(name, c.arguments, dir)}`, secrets, CAP) });
    }
    if (calls.length === 0) events.push({ at, who, what: m.stopReason === "error" ? "model error" : "replied" });
  }
  return { model, turns, tools, input, output, lastAt, refused, failures, events };
};
