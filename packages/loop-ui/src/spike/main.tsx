// SPIKE. A browser as the attaching client: it holds the agent object the host serves, shows its view as it changes,
// and steers it. Proves pi's Chord layer runs in a browser against our pinned 1.5.0.
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { agentContract, SPIKE_PORT } from "./contract.ts";

interface View { entries: { id: number; kind: string; model?: { role?: string; content?: unknown }[] }[]; docs: Record<string, { run?: unknown; tools?: { output?: string }[]; generation?: { message?: { content: { type: string; text?: string }[] } } }> }
interface AgentRef { view: { value: unknown; subscribe: (f: (v: unknown) => void) => () => void }; send: (i: { text: string; whenBusy: string }) => Promise<{ submission: number }>; onStatus: (f: (s: string) => void) => void; status: string }
const Agent = agentContract<never>(chord as never, schema as never);
const textOf = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? (c as { type: string; text?: string; name?: string }[]).map((p) => p.text ?? (p.type === "toolCall" ? `[calls ${p.name}]` : "")).join("") : "";

const App = () => {
  const [view, setView] = useState<View | null>(null), [status, setStatus] = useState("connecting"), [frames, setFrames] = useState(0), [sent, setSent] = useState("");
  const ref = useRef<AgentRef | null>(null);
  useEffect(() => {
    const host = chord.createHost({ self: { kind: "host" }, name: "browser", kind: "client", onError: (e: unknown) => setStatus(`error: ${String((e as { message?: string }).message ?? e)}`),
      upstream: { link: chord.webSocketLink(new WebSocket(`ws://127.0.0.1:${SPIKE_PORT}/`) as never), principal: { kind: "server" } } } as never);
    const agent = (host as unknown as { hold: (t: unknown, i: unknown) => AgentRef }).hold(Agent, { run: "r1", agent: "builder.1" });
    ref.current = agent;
    agent.onStatus((s) => setStatus(s));
    const off = agent.view.subscribe((v) => { setView(v as View); setFrames((n) => n + 1); });
    return () => { off(); void (host as unknown as { close: () => Promise<void> }).close(); };
  }, []);
  const live = view?.docs["pi.live"] ?? {};
  const partial = live.generation?.message?.content.find((b) => b.type === "text")?.text ?? "";
  return (
    <main style={{ font: "14px ui-monospace, monospace", padding: 16, maxWidth: 720 }}>
      <p id="status">link: {status} · frames: {frames} · run: {live.run === undefined ? "idle" : "busy"}</p>
      <ol id="entries">{(view?.entries ?? []).slice(-8).map((e) => <li key={e.id}>{e.kind.replace("pi.", "")}: {textOf(e.model?.[0]?.content).slice(0, 90)}</li>)}</ol>
      <p id="tool">tool output: {JSON.stringify(live.tools?.[0]?.output ?? "")}</p>
      <p id="partial">being written: {partial}</p>
      <button id="steer" onClick={async () => { const r = await ref.current!.send({ text: "A note from the browser", whenBusy: "steer" }); setSent(`sent, submission ${r.submission}`); }}>Steer from the browser</button> <span id="sent">{sent}</span>
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<App />);
