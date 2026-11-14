// A failure in words, for a run record: a typed failure with its tag and every field it carries; anything else in
// Effect's words, without stack frames.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";

const LIMIT = 600;

/** A tagged value with its message, which a tagged error keeps out of its enumerable fields. */
export const shown = (value: unknown): string => {
  if (!Predicate.isObject(value)) return Formatter.format(value);
  const message =
    Predicate.hasProperty(value, "message") && Predicate.isString(value.message) && value.message !== ""
      ? { message: value.message }
      : {};
  return Formatter.format({ ...value, ...message });
};

/** `cause` in words. */
export const said = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) return Str.slice(0, LIMIT)(shown(error.value));
  return pipe(
    Str.split(Cause.pretty(cause), "\n"),
    Arr.filter((line) => !Str.startsWith("at ")(Str.trimStart(line))),
    Arr.join("\n"),
    Str.trim,
    Str.slice(0, LIMIT),
  );
};
