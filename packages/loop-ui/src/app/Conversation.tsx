/**
 * One agent's conversation, the way every agent tool shows one: what it was asked on the right, what it said on the
 * left, its tool calls folded into its turn, and a box at the bottom to talk to it.
 */
import { ArrowUp, FilePlus2, FileText, PencilLine, Square, Terminal, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { RefusedIcon } from "./bits.tsx";
import { clock, firstLine } from "./format.ts";
import { HandbackCard, VerdictCard } from "./Results.tsx";
import type { Agent, Handback, Msg, Run, ToolCall } from "./types.ts";

const ICON: Record<string, typeof Terminal> = { bash: Terminal, read: FileText, write: FilePlus2, edit: PencilLine };
const titleOf = (call: ToolCall, result: Msg | undefined): string => {
  const arg = firstLine(String(call.args.command ?? call.args.path ?? ""), 110);
  if (result?.refused) return `Refused ${arg}`;
  const verb = call.name === "bash" ? (result ? (result.isError ? "Failed" : "Ran") : "Running") : call.name === "read" ? (result ? "Read" : "Reading") : call.name === "write" ? (result ? "Wrote" : "Writing") : call.name === "edit" ? (result ? "Edited" : "Editing") : call.name;
  return `${verb} ${arg}`;
};

const ToolRow = ({ call, result, live }: { call: ToolCall; result: Msg | undefined; live: boolean }) => {
  const Icon = result?.refused ? RefusedIcon : (ICON[call.name] ?? Terminal);
  const failed = result?.isError || result?.refused;
  if (!result) return <TraceLine status={live ? "running" : "pending"}><TraceIcon><Icon /></TraceIcon><TraceTitle className="font-mono text-xs">{titleOf(call, result)}</TraceTitle></TraceLine>;
  const input = call.name === "bash" ? String(call.args.command ?? "") : call.name === "write" ? String(call.args.content ?? "") : call.name === "edit" ? JSON.stringify(call.args, null, 2) : "";
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : undefined}><TraceIcon><Icon /></TraceIcon><TraceTitle className="font-mono text-xs">{titleOf(call, result)}</TraceTitle></TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2">
        {input.includes("\n") && <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-48">{input}</CodeBlockContent></CodeBlock>}
        <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-72">{result.text || "(no output)"}</CodeBlockContent></CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
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
      {before && <p className="whitespace-pre-wrap leading-relaxed">{before}</p>}
      {j?.verdict ? <VerdictCard review={j as never} /> : j?.submit || j?.ask ? <HandbackCard handback={j} /> : m ? <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-72">{m[1]}</CodeBlockContent></CodeBlock> : null}
    </>
  );
};

const Brief = ({ msg, first }: { msg: Msg; first: boolean }) => {
  const [open, setOpen] = useState(false);
  const long = msg.text.length > 420;
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{open || !long ? msg.text : `${msg.text.slice(0, 420).trimEnd()}…`}</BubbleContent>
        </Bubble>
        <MessageFooter className="justify-end text-xs text-muted-foreground">
          {first ? "The workflow's brief" : "A note from a person"} · {clock(msg.at)}
          {long && <button className="ml-2 underline underline-offset-2" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show all of it"}</button>}
        </MessageFooter>
      </MessageContent>
    </Message>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 px-4 py-6 text-sm">
              {turns.map((m) => (
                <MessageScrollerItem key={m.id} messageId={String(m.id)} scrollAnchor={m.role === "user"}>
                  {m.role === "user" ? <Brief msg={m} first={m.id === firstUser} /> : (
                    <Message>
                      <MessageContent className="gap-3">
                        {m.thinking && <p className="border-l-2 pl-3 text-muted-foreground italic">{m.thinking}</p>}
                        {m.error && <TraceLine status="error"><TraceIcon><TriangleAlert /></TraceIcon><TraceTitle>The model failed: {firstLine(m.error, 160)}</TraceTitle></TraceLine>}
                        {m.calls && m.calls.length > 0 && <Trace>{m.calls.map((c) => <ToolRow key={c.id} call={c} result={results.get(c.id)} live={live} />)}</Trace>}
                        {m.text && <Final text={m.text} />}
                      </MessageContent>
                    </Message>
                  )}
                </MessageScrollerItem>
              ))}
              {notes.map((n, i) => (
                <MessageScrollerItem key={`note-${i}`} messageId={`note-${i}`} scrollAnchor>
                  <Message align="end"><MessageContent>
                    <Bubble align="end"><BubbleContent>{n.text}</BubbleContent></Bubble>
                    <MessageFooter className="justify-end text-xs text-muted-foreground">You · {n.mode === "steer" ? "joins after its current tool call" : "queued for after this turn"} · not sent, this is a prototype</MessageFooter>
                  </MessageContent></Message>
                </MessageScrollerItem>
              ))}
              {agent.failure && <p className="rounded-lg border border-amber-600/30 bg-amber-600/5 px-3 py-2 text-amber-800">This agent stopped without an answer: {agent.failure.reason?.replace("_", " ")}. {firstLine(agent.failure.detail, 200)}</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
        {canSteer ? (
          <InputGroup>
            <InputGroupTextarea placeholder={`Say something to ${agent.key}`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <InputGroupAddon align="block-end">
              <InputGroupButton variant={mode === "steer" ? "secondary" : "ghost"} onClick={() => setMode("steer")}>Steer now</InputGroupButton>
              <InputGroupButton variant={mode === "queue" ? "secondary" : "ghost"} onClick={() => setMode("queue")}>Queue for later</InputGroupButton>
              <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{mode === "steer" ? "Joins after its current tool call" : "Waits for this turn to end"}</span>
              <InputGroupButton variant="outline" className="ml-auto sm:ml-0"><Square /> Stop</InputGroupButton>
              <InputGroupButton variant="default" size="icon-xs" aria-label="Send" onClick={send}><ArrowUp /></InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span>{live ? "A reviewer can be watched and stopped, not steered, so its check stays independent." : run.status === "running" ? "This agent has finished its part of the run." : "This run has ended. The conversation is kept whole and nothing can be sent."}</span>
            {live && <Button size="sm" variant="outline"><Square /> Stop</Button>}
          </div>
        )}
      </div>
    </div>
  );
};
