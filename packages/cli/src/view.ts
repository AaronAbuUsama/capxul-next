// The readable view a terminal gets of an answer (roadmap item 3.9, the blueprint's `CLI_OUTPUTS`): the operation's
// command, its outcome, and the answer encoded with the operation's own schemas, shown field by field in the
// schemas' order, one field a line, nested values indented beneath. Nothing here is written per operation: an
// operation added to the blueprint is shown with no change to this file. A pipe, or `--json`, gets the JSON line
// instead (output.ts).
import { commands, Errors, operations, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import type { Answer } from "./output.ts";

const INDENT = "  ";

/** A value with no parts, as text. */
const scalar = (value: unknown): string =>
  value === null
    ? "none"
    : Predicate.isString(value)
      ? value
      : Predicate.isNumber(value) || Predicate.isBoolean(value)
        ? `${value}`
        : "?";

/** An object of fields, not a list. */
const isFields = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isObject(value) && !Arr.isArray(value);

const isEmpty = (value: unknown) =>
  (Arr.isArray(value) && value.length === 0) || (isFields(value) && Rec.keys(value).length === 0);

/** The lines that show `value` at `depth`, each field or item on its own line. */
const linesOf = (value: unknown, depth: number): ReadonlyArray<string> => {
  const pad = Str.repeat(depth)(INDENT);
  if (Arr.isArray(value))
    return Arr.flatMap(value, (item: unknown) => {
      if (!isFields(item) && !Arr.isArray(item)) return [`${pad}- ${scalar(item)}`];
      const [first = "", ...rest] = linesOf(item, depth + 1);
      return [`${pad}- ${Str.trimStart(first)}`, ...rest];
    });
  if (isFields(value))
    return Arr.flatMap(Rec.toEntries(value), ([field, inner]) =>
      (isFields(inner) || Arr.isArray(inner)) && !isEmpty(inner)
        ? [`${pad}${field}:`, ...linesOf(inner, depth + 1)]
        : [`${pad}${field}: ${isEmpty(inner) ? "none" : scalar(inner)}`],
    );
  return [`${pad}${scalar(value)}`];
};

/** The answer's own part, encoded with the operation's schema for it. */
const encoded = (answer: Answer) => {
  const rpc = operations[answer.operation].rpc;
  return answer.outcome === "success"
    ? Schema.encodeUnknownEffect(Schema.toCodecJson(rpc.successSchema))(answer.success)
    : Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Union([rpc.errorSchema, Errors.NotSignedIn])))(
        answer.refusal,
      );
};

const commandOf = (name: OperationName) => `capxul ${Arr.join(commands[name], " ")}`;

/** The readable view of an answer, its lines joined. */
export const answerView = (answer: Answer): Effect.Effect<string> =>
  Effect.map(Effect.orDie(encoded(answer)), (value) => {
    const head =
      answer.outcome === "success"
        ? `${commandOf(answer.operation)} (${answer.operation}): done`
        : `${commandOf(answer.operation)} (${answer.operation}): refused`;
    return Arr.join([head, ...linesOf(value, 1)], "\n");
  });
