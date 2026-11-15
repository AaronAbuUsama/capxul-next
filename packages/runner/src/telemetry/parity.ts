// Parity between the two records of one call's spans while both exist (roadmap 4.4, side by side): `app.spans`, which
// Core writes today (world/database.ts), and the tap, the same spans as OTLP (tap.ts, flat.ts). They agree when the
// tap holds exactly the kept spans, each with the same name, parent, outcome and declared attributes. Library
// attributes, which only the tap carries, are not compared. An empty tap never agrees: a call always has its span.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { SPAN_ATTRIBUTES } from "@capxul/core";
import type { SpanRow } from "../world/database.ts";
import type { FlatSpan, FlatStatus } from "./flat.ts";

/** What a difference is about. */
export type Disagreement = "empty-tap" | "missing" | "extra" | "name" | "parent" | "outcome" | "attribute";

export interface Difference {
  readonly about: Disagreement;
  /** The span it is about; empty for an empty tap. */
  readonly spanId: string;
  readonly name: string;
  /** The attribute's key, for an attribute that differs. */
  readonly key?: string;
  /** What `app.spans` holds, and what the tap holds. */
  readonly kept: unknown;
  readonly tapped: unknown;
}

export interface Parity {
  readonly agrees: boolean;
  readonly differences: ReadonlyArray<Difference>;
}

/** The OTLP status Effect writes for each outcome Core keeps (core/src/telemetry/spans.ts). */
const STATUS_OF: Readonly<Record<string, FlatStatus>> = {
  success: "ok",
  failure: "error",
  defect: "error",
  interrupted: "unset",
};

const DECLARED: ReadonlyArray<string> = Rec.values(SPAN_ATTRIBUTES);

/** The declared attributes (each a string or a number) of a kept span and of its tapped twin that differ, one difference per key. */
const attributeDifferences = (row: SpanRow, span: FlatSpan): ReadonlyArray<Difference> => {
  const kept: Readonly<Record<string, unknown>> = row.attributes ?? {};
  const keys = Arr.dedupe([...Rec.keys(kept), ...Arr.filter(DECLARED, (key) => key in span.attributes)]);
  return Arr.flatMap(keys, (key) =>
    kept[key] === span.attributes[key]
      ? []
      : [
          {
            about: "attribute" as const,
            spanId: row.span_id,
            name: row.name,
            key,
            kept: kept[key],
            tapped: span.attributes[key],
          },
        ],
  );
};

/** The differences between one kept span and its tapped twin. */
const spanDifferences = (row: SpanRow, span: FlatSpan): ReadonlyArray<Difference> => {
  const differ = (about: Disagreement, kept: unknown, tapped: unknown): ReadonlyArray<Difference> =>
    kept === tapped ? [] : [{ about, spanId: row.span_id, name: row.name, kept, tapped }];
  return [
    ...differ("name", row.name, span.name),
    ...differ("parent", row.parent_span_id, span.parentSpanId),
    ...differ("outcome", STATUS_OF[row.outcome] ?? row.outcome, span.status),
    ...attributeDifferences(row, span),
  ];
};

const key = (traceId: string, spanId: string) => `${traceId}/${spanId}`;

/** Whether the tap holds the same spans as `app.spans` for one call, and every way they differ. */
export const parity = (kept: ReadonlyArray<SpanRow>, tapped: ReadonlyArray<FlatSpan>): Parity => {
  if (Arr.isReadonlyArrayEmpty(tapped))
    return {
      agrees: false,
      differences: [{ about: "empty-tap", spanId: "", name: "", kept: kept.length, tapped: 0 }],
    };
  const tappedByKey = new Map(Arr.map(tapped, (span) => [key(span.traceId, span.spanId), span] as const));
  const keptKeys = new Set(Arr.map(kept, (row) => key(row.trace_id, row.span_id)));
  const differences = [
    ...Arr.flatMap(kept, (row) => {
      const twin = tappedByKey.get(key(row.trace_id, row.span_id));
      return twin === undefined
        ? [{ about: "missing" as const, spanId: row.span_id, name: row.name, kept: row.name, tapped: null }]
        : spanDifferences(row, twin);
    }),
    ...Arr.flatMap(tapped, (span) =>
      keptKeys.has(key(span.traceId, span.spanId))
        ? []
        : [{ about: "extra" as const, spanId: span.spanId, name: span.name, kept: null, tapped: span.name }],
    ),
  ];
  return { agrees: Arr.isReadonlyArrayEmpty(differences), differences };
};
