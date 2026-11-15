// What a call's own span says about where and how it ran, beside its name and its time: the Cloudflare data centre
// that ran Core's Worker, and how much of the call Core spent in its Postgres round trips. Each is an attribute of the
// span `measured` opens (spans.ts), under an OpenTelemetry-style key named once here, so the span can later be
// exported as it is and the keys declared in the blueprint. Kept in `app.spans.attributes`
// (migrations/0008_core_span_attributes.sql) and in the platform's `platform.spans.attributes`.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import { pipe } from "effect/Function";
import * as Num from "effect/Number";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";

/** The keys of the attributes Core sets on a call's span. */
export const SPAN_ATTRIBUTES = {
  /** The IATA code of the Cloudflare data centre that ran Core's Worker (`request.cf.colo`), e.g. `LHR`. */
  colo: "cf.colo",
  /** The sum of the milliseconds of every Postgres round trip of the call. */
  queryMs: "db.query_ms",
  /** How many Postgres round trips the call made: statements, and a transaction's BEGIN and COMMIT or ROLLBACK. */
  queryCount: "db.query_count",
} as const;

/** The attribute effect/sql sets on every span of a database client (OpenTelemetry's `db.system.name`). */
const DB_SYSTEM = "db.system.name";
/** The value `@effect/sql-pg` gives it. */
const POSTGRES = "postgresql";

/** The declared attributes of a kept span, each present only when it was set. */
export const SpanAttributes = Schema.Struct({
  [SPAN_ATTRIBUTES.colo]: Schema.optional(Schema.String),
  [SPAN_ATTRIBUTES.queryMs]: Schema.optional(Schema.Finite),
  [SPAN_ATTRIBUTES.queryCount]: Schema.optional(Schema.Int),
});
export type SpanAttributes = typeof SpanAttributes.Type;

const DECLARED: ReadonlyArray<string> = Rec.values(SPAN_ATTRIBUTES);
const decodeAttributes = Schema.decodeUnknownOption(SpanAttributes);

/** The declared attributes among a span's, or null when it has none of them. Library attributes are left out. */
export const declaredOf = (attributes: ReadonlyMap<string, unknown>): SpanAttributes | null => {
  const kept = Arr.filter([...attributes], ([key, value]) => DECLARED.includes(key) && value !== undefined);
  return Arr.isReadonlyArrayEmpty(kept) ? null : Option.getOrNull(decodeAttributes(Rec.fromEntries(kept)));
};

/** True for a span of Core's Postgres driver that went to the database: a statement or a transaction control. */
export const isPostgresRoundTrip = (kind: string, attributes: ReadonlyMap<string, unknown>): boolean =>
  kind === "client" && attributes.get(DB_SYSTEM) === POSTGRES;

/** Where Core's Worker ran the request it is serving. */
export interface Where {
  /** Absent outside Cloudflare, as in a test or on the platform this process serves. */
  readonly colo: Option.Option<string>;
}

/** Where the request being served ran: a fact of each request, provided with its layers (worker.ts). */
export const Placement = Context.Reference<Where>("capxul/core/Placement", {
  defaultValue: () => ({ colo: Option.none() }),
});

/** The colo of a Worker's request, from `request.cf.colo` of the web request it was made from. */
export const coloOf = (source: unknown): Option.Option<string> =>
  Predicate.hasProperty(source, "cf") &&
  Predicate.hasProperty(source.cf, "colo") &&
  Predicate.isString(source.cf.colo) &&
  source.cf.colo !== ""
    ? Option.some(source.cf.colo)
    : Option.none();

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

/**
 * The attributes of a call's span, from where it ran and the round trips among its spans. The milliseconds are a sum:
 * round trips that ran at once (a handler's `Effect.all` of queries on several connections) each count in full, so
 * the sum can exceed the call's own time. Within one transaction they run one after another.
 */
export const callAttributes = (
  placement: Where,
  roundTrips: ReadonlyArray<{ readonly durationMs: number }>,
): ReadonlyArray<readonly [string, string | number]> => [
  ...Option.match(placement.colo, { onNone: () => [], onSome: (colo) => [[SPAN_ATTRIBUTES.colo, colo] as const] }),
  [
    SPAN_ATTRIBUTES.queryMs,
    round(
      pipe(
        Arr.map(roundTrips, (trip) => trip.durationMs),
        Num.sumAll,
      ),
    ),
  ],
  [SPAN_ATTRIBUTES.queryCount, roundTrips.length],
];
