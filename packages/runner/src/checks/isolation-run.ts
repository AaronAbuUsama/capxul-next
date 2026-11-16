// The generic `isolation` check over a whole run (roadmap step 4.8, part B; the per-call part is isolation.ts). Once
// every journey has ended, it reads every entry of the shared world's history (the telemetry lane's whole-run read):
// each entry written by a call must name only companies of that call's own journey, and an entry no call of the run
// wrote must be one the world writes of itself (its birth), or it fails, with what the tap says wrote it. Review blind
// spot (2) of 4.11: the operation checks see only entries under their own calls' traces, so a wrong side effect
// written under another trace, or none, is caught only here. Pure; no scenario writes it, and a builder never changes
// it. (The chain's half, every user operation and log within one journey's Safes, comes with the run's chain read.)
import { operations, Organizations } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import type { Check } from "./checks.ts";

/** One entry of the shared world's history, as the whole-run read answers it. */
export interface RunEntry {
  readonly seq: number;
  readonly trace: string;
  readonly operation: string;
  readonly event: string;
  readonly carried: unknown;
}

/** What wrote a trace, from the tap, where Core kept it. */
export interface Producer {
  readonly producer: string;
  readonly span: string;
}

/** What the check reads: every call of the run with its journey's key, and the whole history. */
export interface RunSeen {
  readonly calls: ReadonlyArray<{ readonly traceId: string; readonly journey: string }>;
  readonly entries: ReadonlyArray<RunEntry>;
  readonly producers: ReadonlyMap<string, Producer>;
}

/** The world writes its own birth: those entries are no journey's call. */
const BIRTH = operations["world.create"].rpc._tag;

/** The company an entry names, by its id, if it names one. */
const orgOf = (entry: RunEntry): string | null =>
  Predicate.isObject(entry.carried) && Predicate.isString(entry.carried["org"]) ? entry.carried["org"] : null;

/** The run's `isolation` checks over its whole history: one for the companies, one for the entries no call wrote. */
export const checkRunIsolation = (seen: RunSeen): ReadonlyArray<Check> => {
  const journeyOf = new Map(Arr.map(seen.calls, (call) => [call.traceId, call.journey] as const));
  // Each company belongs to the journey whose call founded it.
  const owner = new Map(
    Arr.flatMap(seen.entries, (entry) => {
      const org = orgOf(entry);
      const journey = journeyOf.get(entry.trace);
      return entry.event === Organizations.OrgFounded.identifier && org !== null && journey !== undefined
        ? [[org, journey] as const]
        : [];
    }),
  );
  const crossed = Arr.flatMap(seen.entries, (entry) => {
    const org = orgOf(entry);
    const journey = journeyOf.get(entry.trace);
    const owns = org === null ? undefined : owner.get(org);
    return journey !== undefined && owns !== undefined && owns !== journey
      ? [`entry ${entry.seq} (${entry.event}) of ${journey}'s call names ${owns}'s company ${org}`]
      : [];
  });
  const unwritten = Arr.flatMap(seen.entries, (entry) => {
    if (journeyOf.has(entry.trace) || entry.operation === BIRTH) return [];
    const by = seen.producers.get(entry.trace);
    return [
      `entry ${entry.seq} (${entry.event}, ${entry.operation}) no call of the run wrote${by === undefined ? "" : `; ${by.producer} wrote it in ${by.span}`}`,
    ];
  });
  return [
    { check: "isolation", passed: crossed.length === 0, detail: Arr.join(crossed, "; ") },
    { check: "isolation", passed: unwritten.length === 0, detail: Arr.join(unwritten, "; ") },
  ];
};
