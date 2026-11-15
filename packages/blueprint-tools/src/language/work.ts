// Work no door serves: the pipeline's own operations (docs/design/blueprint.md, part 8), such as a world's reset, a
// run's verdict or the gate. Each is a verb of a thing, like an operation, but has no Rpc: nothing serves it at run
// time, so no Rpc group holds it and Core needs no handler. What it declares is what judges it once it is
// instrumented (roadmap item 4.7): its spans, each of a kind; its logs, each with a schema; its budget, a target only;
// and, where the CLI will call it, its payload, with an example of each. Nothing here reaches outside itself.
//
// The words are the glossary's (part 12): a timed piece of work inside an operation is a **span**. The kinds a span
// may have are the blueprint's (src/telemetry/step-kinds.ts); this format takes any name, and the blueprint's tests
// prove each kind used is declared there.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type { Budget } from "./operation.ts";

/** One declared span of a piece of work: its name, which is the span's name wherever it is recorded, and its kind. */
export interface Span<Name extends string = string, Kind extends string = string> {
  readonly name: Name;
  readonly kind: Kind;
}

/** Declares one span. `kind` is one of the blueprint's step kinds. */
export const span = <const Name extends string, const Kind extends string>(
  name: Name,
  kind: Kind,
): Span<Name, Kind> => ({
  name,
  kind,
});

/** One declared log: its name, and the schema of what it carries. A refusal's log names the rule that decided it. */
export interface Log<Name extends string = string, Fields extends Schema.Struct.Fields = Schema.Struct.Fields> {
  readonly name: Name;
  readonly schema: Schema.Struct<Fields>;
}

/** Declares one log from its fields, each a named value of the blueprint. */
export const log = <const Name extends string, const Fields extends Schema.Struct.Fields>(
  name: Name,
  fields: Fields,
): Log<Name, Fields> => ({ name, schema: Schema.Struct(fields) });

/**
 * One part of a budget that covers other work, such as the run's 10 minutes: the part's name (a piece of work's name
 * where one owns it) and its share, a target as every budget is. The shares of a breakdown sum to the budget.
 */
export interface Share {
  readonly part: string;
  readonly ms: number;
}

/** What a piece of work declares, as it is written. */
export interface WorkDeclaration<
  Name extends string,
  Fields extends Schema.Struct.Fields,
  Spans extends { readonly [short: string]: Span },
  Logs extends { readonly [short: string]: Log },
> {
  /** Its name, `<thing>.<verb>`: the span's, the CLI's (`capxul <thing> <verb>`) and the page's. */
  readonly name: Name;
  /** What it does, in one sentence. */
  readonly does: string;
  /** What its caller gives it, each field a named value; `{}` when it takes nothing. */
  readonly payload: Fields;
  /** Its spans, by a short name code uses (`Pipeline.worldReset.spans.database`), in the order it runs them. */
  readonly spans: Spans;
  /** Its logs, by a short name. */
  readonly logs: Logs;
  readonly budget: Budget;
  /** How its budget splits among the work it covers, when it covers other work. Empty when it does not. */
  readonly breakdown: ReadonlyArray<Share>;
  /** At least one payload it takes, as its caller would send it. */
  readonly examples: ReadonlyArray<{ readonly payload: Schema.Struct.Type<Fields> }>;
}

/** A declared piece of work: the declaration, with its payload as a schema. */
export interface Work<
  Name extends string = string,
  Fields extends Schema.Struct.Fields = Schema.Struct.Fields,
  Spans extends { readonly [short: string]: Span } = { readonly [short: string]: Span },
  Logs extends { readonly [short: string]: Log } = { readonly [short: string]: Log },
> extends Omit<WorkDeclaration<Name, Fields, Spans, Logs>, "payload"> {
  readonly payload: Schema.Struct<Fields>;
}

/** Declares a piece of work no door serves. It has no Rpc and joins no Rpc group. */
export const work = <
  const Name extends string,
  const Fields extends Schema.Struct.Fields,
  const Spans extends { readonly [short: string]: Span },
  const Logs extends { readonly [short: string]: Log },
>(
  declaration: WorkDeclaration<Name, Fields, Spans, Logs>,
): Work<Name, Fields, Spans, Logs> => ({ ...declaration, payload: Schema.Struct(declaration.payload) });

/** The spans of a piece of work, in order. */
export const spansOf = (declared: Work): ReadonlyArray<Span> => Rec.values(declared.spans);

/** The logs of a piece of work. */
export const logsOf = (declared: Work): ReadonlyArray<Log> => Rec.values(declared.logs);

/** The sum of a breakdown's shares, in milliseconds. */
export const shareTotal = (declared: Work): number =>
  Arr.reduce(declared.breakdown, 0, (total, each) => total + each.ms);
