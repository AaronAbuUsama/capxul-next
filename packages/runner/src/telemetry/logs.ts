// A decoded OTLP logs export (otlp.ts) as flat logs: what the tap holds of a call's logs, beside its flat spans
// (flat.ts). One flat log per OTLP log record, its attributes as plain values.
import * as Arr from "effect/Array";
import * as Formatter from "effect/Formatter";
import * as Predicate from "effect/Predicate";
import type { LogEntry, LogsExport } from "./otlp.ts";
import { attributesOf, valueOf } from "./flat.ts";

export interface FlatLog {
  /** Effect's log level, as it writes `severityText`: `Info`, `Warn`, `Error`, ... Empty when it wrote none. */
  readonly level: string;
  /** The log's message: its parts, each as text, joined by a space. */
  readonly message: string;
  /** Empty for a log written outside any span. */
  readonly traceId: string;
  /** The span it was written in; null outside any span. */
  readonly spanId: string | null;
  /** Its attributes: the log's annotations and what Effect adds (`effect.fiberId`, `exception.*`). */
  readonly fields: Readonly<Record<string, unknown>>;
  /** When it was written, in epoch milliseconds. */
  readonly atMs: number;
}

const textOf = (value: unknown): string => (Predicate.isString(value) ? value : Formatter.format(value));

/** A log's body as text: Effect writes one message as itself and several as an array. */
export const messageOf = (entry: LogEntry): string => {
  if (entry.body === undefined) return "";
  const value = valueOf(entry.body);
  return Arr.isArray(value) ? Arr.join(Arr.map(value, textOf), " ") : textOf(value);
};

const flatLog = (entry: LogEntry): FlatLog => ({
  level: entry.severityText ?? "",
  message: messageOf(entry),
  traceId: entry.traceId ?? "",
  spanId: entry.spanId === undefined || entry.spanId === "" ? null : entry.spanId,
  fields: attributesOf(entry.attributes),
  atMs: Number(BigInt(entry.timeUnixNano)) / 1_000_000,
});

/** Every log of a logs export, flat, in the order the export holds them. */
export const flatLogs = (logs: LogsExport): ReadonlyArray<FlatLog> =>
  Arr.flatMap(logs.resourceLogs, (resourceLogs) =>
    Arr.flatMap(resourceLogs.scopeLogs, (scopeLogs) => Arr.map(scopeLogs.logRecords ?? [], flatLog)),
  );
