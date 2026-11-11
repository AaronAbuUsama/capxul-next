/**
 * GENERIC. The door of the agents module: open a host on a run's storage, `ask` one agent one question durably, keep a
 * ledger of named steps, look at what an agent is doing. See types.ts.
 */
import { AssistantEntry, ConversationIdle, defineExtension, LiveDoc, ToolResultEntry, UsageDoc, type EntryRecord, type SettledSubmissionRecord, type Submission } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { existsSync } from "node:fs";
import type { Answer, Ask, Host, Note } from "./types.ts";
import { entriesOf, recall, record, remember } from "./internal/ledger.ts";

export { hostAs, openHost } from "./internal/host.ts";
export { modelsFrom } from "./internal/models.ts";
export { mcpTools, type McpServer } from "./internal/mcp.ts";
export { confine, refuseBash, refusePath, segmentsOf } from "./internal/policy.ts";
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
 * stop file appears; a timeout or a failed answer comes back as `ok: false`. A model that fails is waited for and the
 * conversation continued (`modelWaitsMs`) before that failure is the answer. A note a person sent meanwhile (`say`) is
 * part of the same piece of work: the answer is the agent's last one, after every note has had its turn.
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
  const id = conv.id as unknown as number, t0 = Date.now();
  const waits = [...(a.modelWaitsMs ?? [])];
  const timedOut = async (): Promise<Answer> => ({ ok: false, text: "", ...(await spend(host, id)), conversation: id, error: "timed out" });
  /** Waits for one submission to settle. Undefined when the time ran out; throws `stopped` when the stop file appears. */
  const settle = async (one: Submission): Promise<SettledSubmissionRecord | undefined> => {
    const waiting = one.wait(host.context);
    let settled: SettledSubmissionRecord | undefined;
    while (!(settled = await Promise.race([waiting, sleep(1000)]))) {
      if (a.stopFile && existsSync(a.stopFile)) { await conv.abort(host.context); throw new Error("stopped"); }
      if (a.timeoutMs && Date.now() - t0 > a.timeoutMs) { await conv.abort(host.context); return undefined; }
    }
    return settled;
  };
  let sub = await conv.submit({ type: "input", content: a.prompt, requestId: a.key }, host.context);
  for (;;) {
    let settled = await settle(sub);
    if (!settled) return timedOut();
    if (settled.status === "done" && "answer" in settled) {
      // A person's notes are part of the same work: one that joined this turn settles with it, one that was queued has
      // a turn of its own. The answer is the last one the agent gave.
      for (let note = host.notes.get(a.key)?.shift(); note; note = host.notes.get(a.key)?.shift()) {
        const more = await settle(note);
        if (!more) return timedOut();
        if (more.status === "done" && "answer" in more) settled = more;
      }
      const answer = settled.answer;
      const entry = (await conv.entries({}, 20, undefined, host.context)).items.find((e) => e.id === answer);
      const text = entry && AssistantEntry.is(entry) ? textOf(entry.model![0] as AssistantMessage) : "";
      return { ok: text !== "", text, json: lastJson(text), ...(await spend(host, id)), conversation: id };
    }
    const reason = "reason" in settled ? String(settled.reason) : settled.status;
    const detail = String((await host.harness.snapshot(LiveDoc, id as never, host.context))?.runFailure?.detail ?? "");
    const wait = MODEL_FAILURES.has(reason) ? waits.shift() : undefined;
    if (wait === undefined) return { ok: false, text: "", ...(await spend(host, id)), conversation: id, error: `unanswered: ${reason}`, ...(detail ? { detail } : {}) };
    // The model failed beyond pi's own retries: wait, then continue this conversation where it stands. Nothing it did is lost.
    for (const until = Date.now() + wait; Date.now() < until; await sleep(Math.min(1000, Math.max(1, until - Date.now())))) if (a.stopFile && existsSync(a.stopFile)) throw new Error("stopped");
    sub = await conv.submit({ type: "continue", requestId: `${a.key}:again:${Date.now()}` }, host.context);
  }
};

/**
 * A person's note to a working agent. Only the process that owns the storage can call this. An agent that is not
 * working takes no note: a note never starts work of its own.
 */
export const say = async (host: Host, n: Note): Promise<{ ok: boolean; said: string }> => {
  const known = await recall(host, "loop.conversation", n.key);
  const conv = known ? await host.harness.conversation(known.id as never, host.context) : undefined;
  if (!conv) return { ok: false, said: `there is no agent ${n.key} in this run` };
  try {
    const sub = await conv.submit({ type: "input", content: n.text, whenBusy: n.mode === "steer" ? "steer" : "followUp", whenIdle: "reject", requestId: `note:${n.key}:${Date.now()}` }, host.context);
    host.notes.set(n.key, [...(host.notes.get(n.key) ?? []), sub]);
    return { ok: true, said: n.mode === "steer" ? `sent: ${n.key} reads it after its current tool call` : `queued: ${n.key} reads it when its turn ends, and then goes on` };
  } catch (e) {
    return { ok: false, said: e instanceof ConversationIdle ? `${n.key} is not working now: nothing was sent` : `the note was not sent: ${e instanceof Error ? e.message : String(e)}` };
  }
};

/** The ways a run ends without an answer that are the model's or the gateway's, not the agent's: worth trying again. */
const MODEL_FAILURES = new Set(["model_error", "interrupted"]);

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
