// One line that says why something failed: its tag and its message, never a stack trace and never a secret.
import * as Cause from "effect/Cause";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

const CONNECTION_STRING = /postgres(ql)?:\/\/\S+/g;

/** The tag of a tagged failure, if it has one. */
export const tagOf = (failure: unknown): string | undefined =>
  Predicate.hasProperty(failure, "_tag") && Predicate.isString(failure._tag) ? failure._tag : undefined;

/** A failure that carries fields but no message, as the blueprint's refusals do: its fields, without its tag. */
const fieldsOf = (failure: unknown): string => {
  if (!Predicate.isObject(failure)) return Formatter.format(failure);
  return Formatter.format(Rec.remove({ ...failure }, "_tag"));
};

/** Describes one failure, as `Tag: message`. */
export const describeFailure = (failure: unknown): string => {
  const tag = tagOf(failure);
  const message =
    Predicate.hasProperty(failure, "message") && Predicate.isString(failure.message) && Str.isNonEmpty(failure.message)
      ? failure.message
      : fieldsOf(failure);
  return pipe(
    tag === undefined ? message : `${tag}: ${message}`,
    Str.replace(CONNECTION_STRING, "<connection string>"),
    Str.slice(0, 400),
  );
};

/** Describes why an effect ended badly, from the first failure its cause holds. */
export const describe = <E>(cause: Cause.Cause<E>): string =>
  Cause.hasInterruptsOnly(cause) ? "interrupted" : cause.pipe(Cause.squash, describeFailure);
