/**
 * The live runs: the page attaches to the loop's host and holds its one object, `loop.runs`. It gets every run, then
 * only what changes. With no host to attach to, the page says so and shows its recording instead.
 */
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import { DEFAULT_PORT, PREFIX, runsContract } from "@capxul/loop/host";
import { useEffect, useRef, useState } from "react";
import type { Run } from "./types.ts";

export type Link = "connecting" | "live" | "offline";
export interface Said { readonly ok: boolean; readonly said: string }
export type NoteMode = "steer" | "queue";
interface RunsRef { runs: { subscribe: (f: (runs: unknown) => void) => () => void }; stop: (input: { run: string }) => Promise<{ said: string }>; note: (input: { run: string; agent: string; text: string; mode: NoteMode }) => Promise<Said>; onStatus: (f: (status: string) => void) => void }
export interface Live {
  readonly link: Link; readonly runs: Run[] | null; readonly updates: number; readonly stop: (run: string) => Promise<string>;
  /** A person's note to a working agent, handed to the host. It answers in words what became of it. */
  readonly note: (run: string, agent: string, text: string, mode: NoteMode) => Promise<Said>;
}

/** Where the host is: the same address the page came from when the host (or the portal in front of it) served it, else this machine's host. `?host=` names another. */
const address = (): string => new URLSearchParams(window.location.search).get("host")
  ?? (window.location.pathname.startsWith(PREFIX) ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${PREFIX}ws` : `ws://127.0.0.1:${DEFAULT_PORT}${PREFIX}ws`);

export const agentsUrl = (): string => address().replace(/^ws/, "http").replace(/ws$/, "agents.json");

/** Where a capture's file is: beside the page when the host served it, else at this machine's host (or the one `?host=` names). */
export const fileUrl = (run: string, name: string): string => {
  const at = address().replace(/^ws/, "http").replace(/ws$/, "");
  return `${at}evidence/${encodeURIComponent(run)}/${encodeURIComponent(name)}`;
};

export const useLive = (): Live => {
  const [link, setLink] = useState<Link>("connecting"), [runs, setRuns] = useState<Run[] | null>(null), [updates, setUpdates] = useState(0);
  const ref = useRef<RunsRef | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true, retry: ReturnType<typeof setTimeout> | undefined;
    const lost = (): void => { if (!current) return; setLink("offline"); retry ??= setTimeout(() => setAttempt((n) => n + 1), 4000); };   // look again: the host may start later
    let socket: WebSocket;
    try { socket = new WebSocket(address()); } catch { lost(); return () => { current = false; clearTimeout(retry); }; }
    socket.addEventListener("error", lost);
    socket.addEventListener("close", lost);
    const host = chord.createHost({ self: { kind: "host" }, name: "page", kind: "client", onError: () => undefined, upstream: { link: chord.webSocketLink(socket as never), principal: { kind: "server" } } } as never);
    const held = (host as unknown as { hold: (type: unknown, input: unknown) => RunsRef }).hold(runsContract(chord as never, schema as never), {});
    ref.current = held;
    held.onStatus((status) => { if (status === "gone") lost(); });
    const off = held.runs.subscribe((value) => { if (!current) return; setRuns(value as Run[]); setUpdates((n) => n + 1); setLink("live"); });
    return () => { current = false; clearTimeout(retry); off(); void (host as unknown as { close: () => Promise<void> }).close(); };
  }, [attempt]);
  return {
    link, runs: link === "live" ? runs : null, updates, stop: async (run) => (await ref.current!.stop({ run })).said,
    note: (run, agent, text, mode) => ref.current!.note({ run, agent, text, mode }).catch((e: unknown): Said => ({ ok: false, said: `the host did not take the note: ${e instanceof Error ? e.message : String(e)}` })),
  };
};
