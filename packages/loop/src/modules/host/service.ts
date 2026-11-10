/**
 * GENERIC. The host's door: `serve` starts it. See types.ts for what it is and what travels.
 */
import type { IncomingMessage } from "node:http";
import * as chord from "@earendil-works/chord";
import * as schema from "@earendil-works/pi-schema";
import { WebSocketServer } from "ws";
import type { RunDetail } from "../inspect/types.ts";
import { HOST_NAME, runsContract, type HostDeps, type HostOptions, type Served } from "./types.ts";

export type * from "./types.ts";
export { DEFAULT_PORT, HOST_NAME, runsContract } from "./types.ts";

interface Task { readonly signal: AbortSignal }
interface Cell { replace: (task: Task, value: unknown, o: { diff: boolean }) => void }
interface Self { state: (name: string, schema: unknown, initial: { init: () => Promise<unknown> }) => Cell; task: (run: (task: Task) => Promise<void>) => void }

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((done) => { const t = setTimeout(done, ms); signal.addEventListener("abort", () => { clearTimeout(t); done(); }, { once: true }); });

/** The runs, read again only where a run's stamp changed, so a run that is not moving costs nothing and keeps its place in memory. */
const reader = (deps: HostDeps): (() => Promise<RunDetail[]>) => {
  const kept = new Map<string, { stamp: string; run: RunDetail }>();
  return async () => {
    const ids = deps.ids();
    for (const { id, stamp } of ids) {
      if (kept.get(id)?.stamp === stamp) continue;
      const run = await deps.load(id).catch(() => null);
      if (run) kept.set(id, { stamp, run: JSON.parse(JSON.stringify(run)) as RunDetail });   // plain JSON, as the wire needs
    }
    for (const id of [...kept.keys()]) if (!ids.some((x) => x.id === id)) kept.delete(id);
    return [...kept.values()].map((k) => k.run).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  };
};

export const serve = async (deps: HostDeps, o: HostOptions): Promise<Served> => {
  const read = reader(deps);
  const host = chord.createHost({ self: { kind: "host" }, name: HOST_NAME, onError: (e: unknown) => deps.say(`host: ${e instanceof Error ? e.message : JSON.stringify(e)}`) } as never);
  const Runs = runsContract<never>(chord as never, schema as never);
  (host as unknown as { serve: (type: unknown, factory: (input: unknown, principal: unknown, self: Self) => unknown) => void }).serve(Runs, (_input, _principal, self) => {
    const runs = self.state("runs", schema.unknown(), { init: () => read() });
    self.task(async (task) => {
      while (!task.signal.aborted) {
        await sleep(o.everyMs ?? 1500, task.signal);
        if (!task.signal.aborted) runs.replace(task, await read(), { diff: true });
      }
    });
    return { variant: "owner", runs, stop: async ({ run }: { run: string }) => ({ said: deps.stop(run) }) };
  });

  const wss = new WebSocketServer({ port: o.port, host: "127.0.0.1" });
  await new Promise<void>((ready, failed) => { wss.once("listening", () => ready()); wss.once("error", failed); });
  const allowed = (origin: string | undefined): boolean => origin === undefined || LOCAL.test(origin) || (o.origins ?? []).includes(origin);
  // Whoever reaches this port from an allowed origin is the owner: the host listens on this machine only.
  chord.acceptWebSockets(wss as never, host as never, { principal: (request: IncomingMessage) => (allowed(request.headers.origin) ? { kind: "owner" } : undefined) } as never);
  const port = (wss.address() as { port: number }).port;
  return {
    port, url: `ws://127.0.0.1:${port}/`,
    close: async () => { await new Promise<void>((done) => wss.close(() => done())); for (const c of wss.clients) c.terminate(); await (host as unknown as { close: () => Promise<void> }).close(); },
  };
};
