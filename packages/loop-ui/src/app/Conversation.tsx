/**
 * One agent, shown the way a coding terminal shows it: a stream. What it was told, what it says, and each tool call
 * as one line with the start of its output under it; a line opens to the whole input and output. The prompt at the
 * bottom steers it, queues a note, or stops it.
 */
import { ArrowUp, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import { clock, firstLine } from "./format.ts";
import { HandbackCard, VerdictCard } from "./Results.tsx";
import type { Agent, Handback, Msg, Run, ToolCall } from "./types.ts";

/** A model error in a few words: a gateway that answers with a web page says nothing useful past its status. */
const modelError = (e: string): string => e.includes("<") ? `${/^\d{3}/.exec(e)?.[0] ?? "error"} from the gateway${e.includes("upstream-down") ? ": its upstream is down" : ""}` : firstLine(e, 140);
const NAME: Record<string, string> = { bash: "Bash", read: "Read", write: "Write", edit: "Edit" };
const argOf = (call: ToolCall): string => firstLine(String(call.args.command ?? call.args.path ?? ""), 140);

/** One tool call: `● Bash(pnpm frozen)`, the first lines of what came back, and the rest on a click. */
const ToolLine = ({ call, result, live }: { call: ToolCall; result: Msg | undefined; live: boolean }) => {
  const [open, setOpen] = useState(false);
  const bad = result?.isError || result?.refused, running = !result && live;
  const lines = (result?.text ?? "").split("\n").filter((l) => l.trim() !== "");
  const input = call.name === "bash" ? String(call.args.command ?? "") : call.name === "write" ? String(call.args.content ?? "") : call.name === "edit" ? JSON.stringify(call.args, null, 2) : "";
  return (
    <div>
      <button className="flex w-full items-baseline gap-2 text-left hover:bg-white/5" onClick={() => setOpen(!open)}>
        <span className={cn("shrink-0", bad ? "text-red-400" : running ? "animate-pulse text-sky-400" : result ? "text-emerald-400" : "text-neutral-600")}>●</span>
        <span className="min-w-0 break-all"><span className={cn("font-semibold", bad ? "text-red-300" : "text-neutral-100")}>{result?.refused ? "Refused" : (NAME[call.name] ?? call.name)}</span><span className="text-neutral-400">({argOf(call)})</span></span>
      </button>
      {!open && (
        <div className="ml-4 border-l border-neutral-800 pl-3 text-neutral-500">
          {running && <p>running…</p>}
          {lines.slice(0, bad ? 3 : 2).map((l, i) => <p key={i} className={cn("truncate", bad && "text-red-300/80")}>{i === 0 ? "⎿ " : "  "}{l}</p>)}
          {lines.length > (bad ? 3 : 2) && <button className="text-neutral-600 hover:text-neutral-300" onClick={() => setOpen(true)}>  … +{lines.length - (bad ? 3 : 2)} lines</button>}
        </div>
      )}
      {open && (
        <div className="mt-1 ml-4 space-y-1 border-l border-neutral-700 pl-3">
          {input.includes("\n") && <pre className="max-h-56 overflow-auto rounded bg-neutral-900 p-2 whitespace-pre-wrap text-neutral-300">{input}</pre>}
          <pre className={cn("max-h-96 overflow-auto rounded bg-neutral-900 p-2 whitespace-pre-wrap", bad ? "text-red-300" : "text-neutral-300")}>{result?.text || (running ? "running…" : "(no output)")}</pre>
          {result?.durationMs != null && <p className="text-neutral-600">{result.durationMs} ms · {clock(result.at)}</p>}
        </div>
      )}
    </div>
  );
};

/** The agent's last message is a json block the workflow reads; a person gets it as a card, with the words around it. */
const Final = ({ text }: { text: string }) => {
  const m = /```json\s*([\s\S]*?)```/.exec(text);
  let json: unknown;
  try { json = m ? JSON.parse(m[1]!) : undefined; } catch { json = undefined; }
  const before = (m ? text.slice(0, m.index) : text).trim();
  const j = json as (Handback & { verdict?: string }) | undefined;
  return (
    <>
      {before && <p className="whitespace-pre-wrap text-neutral-100">{before}</p>}
      {(j?.verdict || j?.submit || j?.ask) && <div className="font-sans">{j.verdict ? <VerdictCard review={j as never} /> : <HandbackCard handback={j} />}</div>}
      {m && !j?.verdict && !j?.submit && !j?.ask && <pre className="max-h-72 overflow-auto rounded bg-neutral-900 p-2 whitespace-pre-wrap text-neutral-300">{m[1]}</pre>}
    </>
  );
};

const Brief = ({ msg, first }: { msg: Msg; first: boolean }) => {
  const [open, setOpen] = useState(false);
  const lines = msg.text.split("\n"), long = lines.length > 4 || msg.text.length > 400;
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <p className="mb-1 text-neutral-500">{first ? "the workflow's brief" : "a note from a person"} · {clock(msg.at)}</p>
      <div className="flex gap-2"><span className="text-neutral-500">›</span><p className="min-w-0 whitespace-pre-wrap text-neutral-300">{open || !long ? msg.text : `${lines.slice(0, 4).join("\n").slice(0, 400)}…`}</p></div>
      {long && <button className="mt-1 text-neutral-500 underline underline-offset-2 hover:text-neutral-200" onClick={() => setOpen(!open)}>{open ? "show less" : `show all ${lines.length} lines`}</button>}
    </div>
  );
};

export const Conversation = ({ run, agent }: { run: Run; agent: Agent }) => {
  const [notes, setNotes] = useState<{ text: string; mode: string }[]>([]);
  const [draft, setDraft] = useState(""), [mode, setMode] = useState<"steer" | "queue">("steer");
  const results = useMemo(() => new Map(agent.messages.filter((m) => m.role === "tool").map((m) => [m.callId!, m])), [agent]);
  const turns = agent.messages.filter((m) => m.role !== "tool");
  const live = agent.state === "working", canSteer = live && agent.role === "builder";
  const firstUser = turns.find((m) => m.role === "user")?.id;
  const send = (): void => { if (draft.trim() === "") return; setNotes([...notes, { text: draft.trim(), mode }]); setDraft(""); };

  return (
    <div className="dark flex min-h-0 flex-1 flex-col bg-neutral-950 font-mono text-[13px] leading-relaxed text-neutral-300">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-4xl gap-3 px-4 py-4">
              {turns.map((m) => (
                <MessageScrollerItem key={m.id} messageId={String(m.id)} scrollAnchor={m.role === "user"}>
                  {m.role === "user" ? <Brief msg={m} first={m.id === firstUser} /> : (
                    <div className="space-y-2">
                      {m.thinking && <p className="text-neutral-500 italic">{m.thinking}</p>}
                      {m.error && <p className="text-red-300"><span className="text-red-400">●</span> the model failed: {modelError(m.error)}</p>}
                      {m.calls?.map((c) => <ToolLine key={c.id} call={c} result={results.get(c.id)} live={live} />)}
                      {m.text && <Final text={m.text} />}
                    </div>
                  )}
                </MessageScrollerItem>
              ))}
              {notes.map((n, i) => (
                <MessageScrollerItem key={`note-${i}`} messageId={`note-${i}`} scrollAnchor>
                  <div className="rounded border border-sky-900 bg-sky-950/40 px-3 py-2"><p className="mb-1 text-sky-400/80">you · {n.mode === "steer" ? "joins after its current tool call" : "queued for after this turn"} · not sent, this is a prototype</p><div className="flex gap-2"><span className="text-sky-400">›</span><p className="whitespace-pre-wrap text-neutral-100">{n.text}</p></div></div>
                </MessageScrollerItem>
              ))}
              {agent.failure && <p className="rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-amber-200">stopped without an answer: {agent.failure.reason?.replace("_", " ")}. {firstLine(agent.failure.detail, 160)}</p>}
              {live && <p className="text-sky-400"><span className="animate-pulse">●</span> working…</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-3">
        {canSteer ? (
          <InputGroup className="font-mono">
            <InputGroupTextarea className="text-[13px]" placeholder={`› say something to ${agent.key}   (Enter sends)`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <InputGroupAddon align="block-end">
              <InputGroupButton variant={mode === "steer" ? "secondary" : "ghost"} onClick={() => setMode("steer")}>steer now</InputGroupButton>
              <InputGroupButton variant={mode === "queue" ? "secondary" : "ghost"} onClick={() => setMode("queue")}>queue</InputGroupButton>
              <span className="ml-auto hidden text-xs text-neutral-500 sm:inline">{mode === "steer" ? "joins after its current tool call" : "waits for this turn to end"}</span>
              <InputGroupButton variant="outline" className="ml-auto sm:ml-0"><Square /> stop</InputGroupButton>
              <InputGroupButton variant="default" size="icon-xs" aria-label="Send" onClick={send}><ArrowUp /></InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <p className="flex items-center justify-between gap-3 rounded border border-neutral-800 px-3 py-2 text-neutral-500">
            <span>{live ? "a reviewer can be watched and stopped, not steered: its check stays independent" : run.status === "running" ? "this agent has finished its part of the run" : "this run has ended; the conversation is kept whole and nothing can be sent"}</span>
            {live && <button className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-white/5"><Square className="size-3" /> stop</button>}
          </p>
        )}
      </div>
    </div>
  );
};
