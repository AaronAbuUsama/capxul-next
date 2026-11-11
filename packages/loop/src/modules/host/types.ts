/**
 * GENERIC. The host: one process that clients attach to (a page, a terminal) to see runs as they change and to act on
 * them. It is pi-durable's pattern: one owner, any number of clients, each of which gets the current state and then
 * only what changes. The wire is pi's Chord layer over a WebSocket; what travels is described by the contract below.
 *
 * The host serves every run it can read (a view that updates within a second or two), takes `stop`, and takes a note
 * for a working agent. It does not own any run's storage: a note is handed on to the process that plays the run.
 */
import type { RunDetail } from "../inspect/types.ts";

/** Chord's builders, as the host and a page each have them: both ends build the same contract from their own copy. */
export interface ChordBuilders { remote: (name: string, spec: never) => unknown; hostNamed: (name: string) => unknown; method: (...args: never[]) => unknown }
export interface SchemaBuilders { obj: (shape: never) => unknown; str: () => unknown; bool: () => unknown; unknown: () => unknown }

/** The name of the host on the wire, and of the one object it serves. A page's copy must say the same. */
export const HOST_NAME = "loop";
export const DEFAULT_PORT = 4392;
/** Everything the host answers is under this path, so another server can pass it through whole. */
export const PREFIX = "/runs/";

/** A run in a line, for a page that only lists runs (`GET /runs/summary.json`): what it works on, where it stands, who is working. */
export interface RunSummary {
  readonly id: string;
  readonly task: { readonly id: string; readonly title: string };
  readonly workflow: string;
  readonly status: RunDetail["status"];
  readonly round: number;
  readonly rounds: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly tokens: number;
  /** The agent working now, when one is. */
  readonly working: { readonly key: string; readonly role: string } | null;
  /** Calls the loop's policy refused and model requests that failed, over every agent. */
  readonly refused: number;
  readonly failures: number;
  /** Why the run no longer needs anyone (inspect, `supersededOf`), or null. */
  readonly superseded: string | null;
}
export const summaryOf = (run: RunDetail): RunSummary => {
  const agent = run.agents.find((a) => a.state === "working");
  return { id: run.id, task: { id: run.task.id, title: run.task.title }, workflow: run.workflow, status: run.status, round: run.round, rounds: run.rounds, startedAt: run.startedAt, endedAt: run.endedAt, tokens: run.tokens, working: agent ? { key: agent.key, role: agent.role } : null,
    refused: run.agents.reduce((n, a) => n + a.usage.refused, 0), failures: run.agents.reduce((n, a) => n + a.usage.errors, 0), superseded: run.superseded };
};

/**
 * `loop.runs`: the runs, each in full (`RunDetail[]`, newest first), `stop`, and `note` (a person's note to a working
 * agent: `steer` or `queue`). A change to this shape is a new version: 2 added `note`.
 */
export const runsContract = <T>(chord: ChordBuilders, s: SchemaBuilders): T => chord.remote("loop.runs", {
  version: 2, input: s.obj({} as never), host: chord.hostNamed(HOST_NAME),
  variants: { owner: { state: { runs: s.unknown() }, methods: {
    stop: chord.method(s.obj({ run: s.str() } as never) as never, s.obj({ said: s.str() } as never) as never),
    note: chord.method(s.obj({ run: s.str(), agent: s.str(), text: s.str(), mode: s.str() } as never) as never, s.obj({ ok: s.bool(), said: s.str() } as never) as never),
  } } },
} as never) as T;

/** Everything outside the module: which runs there are, how to read one, how to stop one. */
export interface HostDeps {
  readonly agents?: readonly { readonly name: string; readonly description: string; readonly model: string; readonly tools: readonly string[] }[];
  /** Every run to show, with a stamp that changes whenever the run's stored state does. */
  readonly ids: () => readonly { readonly id: string; readonly stamp: string }[];
  readonly load: (id: string) => Promise<RunDetail | null>;
  readonly stop: (id: string) => string;
  /** Hands a person's note to the process that plays the run, and says what became of it. Absent: this host sends none. */
  readonly note?: (id: string, note: { readonly agent: string; readonly text: string; readonly mode: "steer" | "queue" }) => Promise<{ readonly ok: boolean; readonly said: string }>;
  readonly say: (line: string) => void;
  /** The evidence folder of a run, or null when there is no such run. Its files are served at `evidence/<run id>/<file name>`. */
  readonly evidence?: (id: string) => string | null;
}

export interface HostOptions {
  /** 0 asks the system for a free port. The host listens on 127.0.0.1 only. */
  readonly port: number;
  /** How often the runs are read again, in milliseconds. */
  readonly everyMs?: number;
  /** Origins a browser may attach from, besides this machine's own (`http://localhost:*`, `http://127.0.0.1:*`). */
  readonly origins?: readonly string[];
  /** The folder of the built app, served under `/runs/`. Absent, the host says how to build it. */
  readonly ui?: string;
}

/** `url` is where a client attaches (the WebSocket); `http` is where a browser opens the app. */
export interface Served { readonly port: number; readonly url: string; readonly http: string; close(): Promise<void> }
