/**
 * The run's ledger: entries of the root conversation, committed by pi-durable like everything else. `loop.start` and
 * `loop.done` bracket each named step (the result rides in `done`), `loop.conversation` says which conversation an agent
 * step uses. Written with a request id, so writing twice is writing once.
 */
import type { JsonValue } from "@earendil-works/chord";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { Host } from "../types.ts";

export const entriesOf = async (host: Host): Promise<EntryRecord[]> =>
  (await host.root.entries({ order: "ascending" }, 1000, undefined, host.context)).items.filter((e) => e.kind.startsWith("loop."));

export const recall = async (host: Host, kind: string, name: string): Promise<Record<string, JsonValue> | undefined> =>
  (await entriesOf(host)).find((e) => e.kind === kind && (e.data as { name?: string } | undefined)?.name === name)?.data as Record<string, JsonValue> | undefined;

export const record = async (host: Host, kind: string, name: string, data: Record<string, JsonValue> = {}): Promise<void> => {
  const s = await host.root.submit({ type: "write", entry: { kind, data: { name, ...data } }, requestId: `${kind}:${name}` }, host.context);
  await s.wait(host.context);
};

/** Runs `fn` once for `name`; asked again (after a restart, or when a script replays) it answers from the ledger. */
export const remember = async <T>(host: Host, name: string, fn: () => Promise<T>): Promise<T> => {
  const done = await recall(host, "loop.done", name);
  if (done) return done.result as T;
  await record(host, "loop.start", name);
  const result = await fn();
  await record(host, "loop.done", name, { result: result as unknown as JsonValue });
  return result;
};
