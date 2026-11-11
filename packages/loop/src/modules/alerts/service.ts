/** Durable reconciliation. A single supervised caller owns the journal. No process or delivery globals. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Alert { key: string; title: string; body: string; url: string; at: string }
export interface Snapshot {
  questions: readonly { id: string; text: string }[];
  runs: readonly { id: string; task: string; status: string; superseded: string | null }[];
}
interface Episode { fingerprint: string; alert: Alert; sent: boolean }
interface Journal { version: 1; episodes: Record<string, Episode> }
export interface Alerts {
  file: string;
  now: () => Date;
  sender: (alert: Alert) => Promise<void>;
}
const BASE = "https://macbook.tail4b9a40.ts.net:8443";
const read = (file: string): Journal => {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Journal;
    if (value.version !== 1 || !value.episodes || typeof value.episodes !== "object") throw new Error("invalid alerts journal");
    for (const e of Object.values(value.episodes)) {
      if (typeof e.fingerprint !== "string" || typeof e.sent !== "boolean" || !e.alert || typeof e.alert.key !== "string") throw new Error("invalid alerts episode");
    }
    return value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, episodes: {} };
    throw e;
  }
};
const save = (file: string, value: Journal): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};

/** Preview neither sends nor writes. Failures remain pending and are retried on the next reconciliation. */
export const reconcile = async (o: Alerts, snapshot: Snapshot, preview = false): Promise<readonly Alert[]> => {
  const previous = read(o.file), episodes: Record<string, Episode> = {};
  const add = (id: string, fingerprint: string, title: string, body: string, page: string): void => {
    const old = previous.episodes[id];
    episodes[id] = old?.fingerprint === fingerprint ? old : {
      fingerprint, sent: false,
      alert: { key: `${id}:${o.now().toISOString()}:${fingerprint}`, title, body, url: `${BASE}/${page}/`, at: o.now().toISOString() },
    };
  };
  for (const q of snapshot.questions) add(`question:${q.id}`, q.text, "Capxul: a question needs you", q.text, "review");
  for (const r of snapshot.runs) {
    if (!r.superseded && (r.status === "failed" || r.status === "dead")) add(`run:${r.id}`, r.status, `Capxul: run ${r.status}`, `${r.task} (${r.id})`, "runs");
  }
  const journal: Journal = { version: 1, episodes };
  const pending = Object.values(episodes).filter((e) => !e.sent);
  if (preview) return pending.map((e) => e.alert);
  save(o.file, journal); // pending intent, including cancellations, precedes any outside action
  const errors: unknown[] = [];
  for (const e of pending) {
    try { await o.sender(e.alert); } catch (error) { errors.push(error); continue; }
    e.sent = true;
    save(o.file, journal);
  }
  if (errors.length) throw new AggregateError(errors, "alert delivery failed; pending alerts will retry");
  return pending.map((e) => e.alert);
};
