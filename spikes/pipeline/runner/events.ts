// The generic `events` check. For a successful call the contract declares which events it emits and, as a pure
// function of what the caller sent and got back, what each must carry; this compares that with what Core recorded
// under the call's trace id. A call that did not succeed must have recorded nothing. No scenario writes this.
import * as Arr from "effect/Array";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { operations, type EventClass, type Expected, type Operation } from "../contract/door.ts";
import type { Call } from "./client.ts";
import type { EventRow } from "./database.ts";

/** A value in a check's detail: JSON on one line. */
const show = (value: unknown): string => JSON.stringify(value) ?? "nothing";

const listed = (items: ReadonlyArray<string>): string => [...items].sort().join(", ") || "none";

/** The schema of what Core records for an event: what it carries (its fields without `_tag`), as JSON. */
const recordedAs = (event: EventClass) => Schema.toCodecJson(Schema.Struct(Struct.omit(event.fields, ["_tag"])));

/** Every field in which what was recorded is not what is declared, in words. Empty when the two are equal. */
const differencesOf = (recorded: unknown, declared: unknown): ReadonlyArray<string> => {
  if (!Predicate.isObject(recorded) || !Predicate.isObject(declared)) {
    return Equal.equals(recorded, declared) ? [] : [`its whole payload (recorded ${show(recorded)}, declared ${show(declared)})`];
  }
  return Arr.union(Object.keys(declared), Object.keys(recorded)).flatMap((field) => {
    if (!Object.hasOwn(recorded, field)) return [`${field} (not recorded, declared ${show(declared[field])})`];
    if (!Object.hasOwn(declared, field)) return [`${field} (recorded ${show(recorded[field])}, not declared)`];
    return Equal.equals(recorded[field], declared[field]) ? [] : [`${field} (recorded ${show(recorded[field])}, declared ${show(declared[field])})`];
  });
};

/** One declared event of a successful call against the rows recorded for the call: what is declared, and what is wrong. */
const compare = (operation: string, expected: Expected, recorded: ReadonlyArray<EventRow>): { readonly declared: string; readonly problems: ReadonlyArray<string> } => {
  const name = expected.event.identifier;
  const codec = recordedAs(expected.event);
  const declared = Schema.encodeUnknownExit(codec, { onExcessProperty: "error" })(expected.carried);
  if (Exit.isFailure(declared)) return { declared: name, problems: [`what ${operation} declares for ${name} does not encode as ${name}`] };
  const shown = `${name} ${show(declared.value)}`;
  const [row, ...others] = recorded.filter((candidate) => candidate.event === name);
  if (row === undefined || others.length > 0) return { declared: shown, problems: [`${operation} recorded ${name} ${row === undefined ? 0 : others.length + 1} times, declared once`] };
  const differing = differencesOf(row.payload, declared.value);
  const decodes = Exit.isSuccess(Schema.decodeUnknownExit(codec, { onExcessProperty: "error" })(row.payload));
  return {
    declared: shown,
    problems: [
      ...(differing.length > 0 ? [`${operation}'s ${name} differs in ${differing.join(", ")}`] : []),
      ...(decodes ? [] : [`${operation}'s ${name} does not decode as the contract's ${name}`]),
    ],
  };
};

/**
 * Applies the check to one call, given the events recorded under its trace id. Passes when a successful call
 * recorded exactly the declared events, each once, each carrying what the declaration computes from the call's
 * payload and result and decoding with the event's schema; and when any other call recorded nothing. Pure.
 */
export const checkEvents = (call: Call, recorded: ReadonlyArray<EventRow>): { readonly passed: boolean; readonly detail: string } => {
  const operation: Operation = operations[call.operation];
  const seen = `recorded: ${listed(recorded.map((row) => `${row.event} ${show(row.payload)}`))}`;
  const misfiled = recorded.filter((row) => row.operation !== call.operation).length;
  const elsewhere = misfiled > 0 ? [`${misfiled} filed under another operation`] : [];
  if (call.outcome !== "success") {
    const names = `recorded: ${listed(recorded.map((row) => row.event))}`;
    return { passed: recorded.length === 0, detail: [`${names}; declared for a ${call.outcome}: none`, ...elsewhere].join("; ") };
  }
  const expected = Option.flatMap(call.success, (success) => operation.expected({ payload: call.payload, success }));
  if (Option.isNone(expected)) {
    return { passed: false, detail: `${seen}; what the caller sent and got back is not a successful ${call.operation} call, so what its events must carry cannot be computed` };
  }
  const compared = expected.value.map((event) => compare(call.operation, event, recorded));
  const declaredNames = expected.value.map((event) => event.event.identifier);
  const undeclared = Arr.dedupe(recorded.map((row) => row.event).filter((name) => !declaredNames.includes(name)));
  const problems = [
    ...compared.flatMap((event) => event.problems),
    ...undeclared.map((name) => `${call.operation} recorded ${name}, which it does not declare`),
    ...elsewhere,
  ];
  return {
    passed: problems.length === 0,
    detail: [`${seen}; declared for a success: ${listed(compared.map((event) => event.declared))}`, ...problems].join("; "),
  };
};
