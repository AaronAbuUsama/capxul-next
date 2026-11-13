// The generic `events` check. For a successful call the blueprint declares which events it emits and, as a pure
// function of what the caller sent and got back, what each must carry; this compares that with what Core recorded
// under the call's trace id. A call that did not succeed must have recorded nothing. No scenario writes this.
import { operations, type EventClass, type Expected, type Operation } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import type { Call } from "../client.ts";
import type { EventRow } from "../world/database.ts";

const show = (value: unknown): string => Formatter.format(value);
const listed = (items: ReadonlyArray<string>): string =>
  items.length === 0 ? "none" : Arr.join(Arr.sort(items, Order.String), ", ");

/** What Core records for an event: what it carries (its fields without `_tag`), as JSON values. */
const recordedAs = (event: EventClass) => Schema.toCodecJson(Schema.Struct(Struct.omit(event.fields, ["_tag"])));

/** Every field in which what was recorded is not what is declared, in words. Empty when the two are equal. */
const differencesOf = (recorded: unknown, declared: unknown): ReadonlyArray<string> => {
  if (!Predicate.isObject(recorded) || !Predicate.isObject(declared))
    return Equal.equals(recorded, declared)
      ? []
      : [`its whole payload (recorded ${show(recorded)}, declared ${show(declared)})`];
  const recordedFields: Readonly<Record<string, unknown>> = { ...recorded };
  const declaredFields: Readonly<Record<string, unknown>> = { ...declared };
  return Arr.flatMap(Arr.dedupe([...Rec.keys(declaredFields), ...Rec.keys(recordedFields)]), (field) => {
    if (!Rec.has(recordedFields, field)) return [`${field} (not recorded, declared ${show(declaredFields[field])})`];
    if (!Rec.has(declaredFields, field)) return [`${field} (recorded ${show(recordedFields[field])}, not declared)`];
    return Equal.equals(recordedFields[field], declaredFields[field])
      ? []
      : [`${field} (recorded ${show(recordedFields[field])}, declared ${show(declaredFields[field])})`];
  });
};

/** One declared event of a successful call against the rows recorded for it: what is declared, and what is wrong. */
const compare = (operation: string, expected: Expected, recorded: ReadonlyArray<EventRow>) => {
  const name = expected.event.identifier;
  const codec = recordedAs(expected.event);
  const declared = Schema.encodeUnknownExit(codec, { onExcessProperty: "error" })(expected.carried);
  if (Exit.isFailure(declared))
    return { declared: name, problems: [`what ${operation} declares for ${name} does not encode as ${name}`] };
  const shown = `${name} ${show(declared.value)}`;
  const rows = Arr.filter(recorded, (candidate) => candidate.event === name);
  const [row] = rows;
  if (row === undefined || rows.length > 1)
    return { declared: shown, problems: [`${operation} recorded ${name} ${rows.length} times, declared once`] };
  const differing = differencesOf(row.payload, declared.value);
  const decodes = Exit.isSuccess(Schema.decodeUnknownExit(codec, { onExcessProperty: "error" })(row.payload));
  return {
    declared: shown,
    problems: [
      ...(differing.length > 0 ? [`${operation}'s ${name} differs in ${Arr.join(differing, ", ")}`] : []),
      ...(decodes ? [] : [`${operation}'s ${name} does not decode as the blueprint's ${name}`]),
    ],
  };
};

/**
 * Applies the check to one call, given the events recorded under its trace id. Passes when a successful call recorded
 * exactly the declared events, each once, each carrying what the declaration computes from the call's payload and
 * answer and decoding with the event's schema; and when any other call recorded nothing. Pure.
 */
export const checkEvents = (
  call: Call,
  recorded: ReadonlyArray<EventRow>,
): { readonly passed: boolean; readonly detail: string } => {
  const operation: Operation = operations[call.operation];
  const misfiled = Arr.filter(recorded, (row) => row.operation !== call.operation).length;
  const elsewhere = misfiled > 0 ? [`${misfiled} filed under another operation`] : [];
  if (call.outcome !== "success") {
    const names = `recorded: ${listed(Arr.map(recorded, (row) => row.event))}`;
    return {
      passed: recorded.length === 0,
      detail: Arr.join([`${names}; declared for a ${call.outcome}: none`, ...elsewhere], "; "),
    };
  }
  const seen = `recorded: ${listed(Arr.map(recorded, (row) => `${row.event} ${show(row.payload)}`))}`;
  const expected = Option.flatMap(call.success, (success) => operation.expected({ payload: call.payload, success }));
  if (Option.isNone(expected))
    return {
      passed: false,
      detail: `${seen}; what the caller sent and got back is not a successful ${call.operation} call, so what its events must carry cannot be computed`,
    };
  const compared = Arr.map(expected.value, (event) => compare(call.operation, event, recorded));
  const declaredNames = Arr.map(expected.value, (event) => event.event.identifier);
  const undeclared = pipe(
    Arr.map(recorded, (row) => row.event),
    Arr.filter((name) => !Arr.contains(declaredNames, name)),
    Arr.dedupe,
  );
  const problems = [
    ...Arr.flatMap(compared, (event) => event.problems),
    ...Arr.map(undeclared, (name) => `${call.operation} recorded ${name}, which it does not declare`),
    ...elsewhere,
  ];
  return {
    passed: problems.length === 0,
    detail: Arr.join(
      [`${seen}; declared for a success: ${listed(Arr.map(compared, (event) => event.declared))}`, ...problems],
      "; ",
    ),
  };
};
