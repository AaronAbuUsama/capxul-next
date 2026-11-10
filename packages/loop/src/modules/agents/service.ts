/**
 * GENERIC. The door of the agents module: open a host on a run's storage, `ask` one agent one question durably, keep a
 * ledger of named steps, look at what an agent is doing. See types.ts.
 */
import { AssistantEntry, defineExtension, ToolResultEntry, UsageDoc, type EntryRecord } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { existsSync } from "node:fs";
import type { Answer, Ask, Host } from "./types.ts";
import { entriesOf, recall, record, remember } from "./internal/ledger.ts";

export { openHost } from "./internal/host.ts";
export { modelsFrom } from "./internal/models.ts";
export { mcpTools, type McpServer } from "./internal/mcp.ts";
export { confine, refuseBash, refusePath } from "./internal/policy.ts";
export { entriesOf, recall, record, remember };
export type * from "./types.ts";

/** The last JSON value in a text: a fenced ```json block if there is one, else the whole text. */
export const lastJson = (text: string): unknown => {
  for (const m of [...text.matchAll(/```json\s*([\s\S]*?)```/g)].reverse()) { try { return JSON.parse(m[1]!); } catch { /* next */ } }
  try { return JSON.parse(text.trim()); } catch { return undefined; }
};

const textOf = (message: AssistantMessage): string => message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
const sleep = (ms: number): Promise<undefined> => new Promise((r) => setTimeout(() => r(undefined), ms));

const spend = async (host: Host, id: number): Promise<{ costUsd: number; tokens: number }> => {
  const doc = await host.harness.snapshot(UsageDoc, id as never, host.context);
  const all = Object.values(doc?.models ?? {});
  return { costUsd: all.reduce((s, u) => s + u.cost.total, 0), tokens: all.reduce((s, u) => s + u.totalTokens, 0) };
};

/**
 * One agent, one question, durably. The conversation is found again by `key` after a restart, and so is the question
 * (its request id is the key), so a killed run's agent continues instead of starting over. Rejects with `stopped` when the
 * stop file appears; a timeout or a failed answer comes back as `ok: false`.
 */
export const ask = async (host: Host, a: Ask): Promise<Answer> => {
  const [provider, ...rest] = a.model.split("/");
  const known = await recall(host, "loop.conversation", a.key);
  const extra = a.tools?.length ? defineExtension({ name: `extra-${a.key}`, tools: [...a.tools] }) : undefined;
  if (extra) host.registry.install(extra);
  const agent = {
    model: { provider: provider!, modelId: rest.join("/") }, instructions: a.system, cwd: a.cwd, ...(a.maxTurns ? { maxTurns: a.maxTurns } : {}),
    extensions: [...host.parts[a.profile].extensions, ...(extra ? [extra] : [])], tools: [...host.parts[a.profile].tools, ...(a.tools ?? [])],
  };
  const conv = known ? (await host.harness.conversation(known.id as never, host.context))! : await host.harness.createConversation({ ownership: { kind: "ownerless" }, agent }, host.context);
  if (!known) await record(host, "loop.conversation", a.key, { id: conv.id as unknown as number });
  const sub = await conv.submit({ type: "input", content: a.prompt, requestId: a.key }, host.context);
  const waiting = sub.wait(host.context);
  const t0 = Date.now();
  for (;;) {
    const settled = await Promise.race([waiting, sleep(1000)]);
    if (settled) {
      const used = await spend(host, conv.id as unknown as number);
      if (settled.status !== "done" || settled.type !== "input") return { ok: false, text: "", ...used, conversation: conv.id as unknown as number, error: `unanswered: ${"reason" in settled ? String(settled.reason) : settled.status}` };
      const entry = (await conv.entries({}, 20, undefined, host.context)).items.find((e) => e.id === settled.answer);
      const text = entry && AssistantEntry.is(entry) ? textOf(entry.model![0] as AssistantMessage) : "";
      return { ok: text !== "", text, json: lastJson(text), ...used, conversation: conv.id as unknown as number };
    }
    if (a.stopFile && existsSync(a.stopFile)) { await conv.abort(host.context); throw new Error("stopped"); }
    if (a.timeoutMs && Date.now() - t0 > a.timeoutMs) {
      await conv.abort(host.context);
      return { ok: false, text: "", ...(await spend(host, conv.id as unknown as number)), conversation: conv.id as unknown as number, error: "timed out" };
    }
  }
};

/** What happened in a conversation after entry `after`, as lines a person can follow, and the newest entry seen. */
export const tail = async (host: Host, conversation: number, after = 0): Promise<{ lines: string[]; last: number }> => {
  const conv = (await host.harness.conversation(conversation as never, host.context))!;
  const items = (await conv.entries({ order: "ascending" }, 1000, undefined, host.context)).items.filter((e: EntryRecord) => Number(e.id) > after);
  const lines = items.flatMap((e) => {
    const m = e.model?.[0] as { role?: string; content?: unknown } | undefined;
    if (AssistantEntry.is(e)) return (m!.content as { type: string; text?: string; name?: string; arguments?: unknown }[]).map((p) => p.type === "text" ? `agent: ${p.text}` : p.type === "toolCall" ? `  -> ${p.name} ${JSON.stringify(p.arguments).slice(0, 140)}` : "");
    if (ToolResultEntry.is(e)) return [`  <- ${JSON.stringify(m?.content).slice(0, 160)}`];
    return e.kind === "pi.user" ? ["prompt sent"] : [];
  }).filter(Boolean);
  return { lines, last: items.length ? Number(items[items.length - 1]!.id) : after };
};
