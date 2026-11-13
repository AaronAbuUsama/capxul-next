// How the runner fails, and how a failure is worded in a run record: in the failure's own words, without stack
// frames (they name this machine's paths and say nothing about the world).
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

/** Something the runner itself could not do: a step of a world, a read of its database, an inventory. */
// oxlint-disable-next-line capxul/blueprint-owns-names -- the runner's own failure, not a refusal of Capxul's
export class RunnerFailure extends Schema.TaggedError<RunnerFailure, { readonly brand: unique symbol }>()(
  "RunnerFailure",
  {
    step: Schema.String,
    message: Schema.String,
  },
) {}

const LIMIT = 600;

/** An error's `message`, which a tagged error keeps out of its enumerable fields; nothing when it is empty. */
const messageOf = (error: object): { readonly message?: string } =>
  Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message !== ""
    ? { message: error.message }
    : {};

/**
 * A typed failure with a tag, such as a refusal or a scenario's expectation, with every field it carries and its
 * message; anything else in Effect's words.
 */
export const describe = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error) && Predicate.hasProperty(error.value, "_tag"))
    return Str.slice(0, LIMIT)(Formatter.format({ ...error.value, ...messageOf(error.value) }));
  return pipe(
    Str.split(Cause.pretty(cause), "\n"),
    Arr.filter((line) => !Str.startsWith("at ")(Str.trimStart(line))),
    Arr.join("\n"),
    Str.trim,
    Str.slice(0, LIMIT),
  );
};

/**
 * How a run's own program ended, before any check: `succeeded`; `failed` with a typed failure (a refusal, a
 * scenario's expectation, the runner's own), whose tag it keeps; or `died` (a defect or an interruption).
 */
export const Ended = Schema.Struct({
  as: Schema.Literals(["succeeded", "failed", "died"]),
  /** The typed failure's tag; null unless it `failed`. */
  tag: Schema.NullOr(Schema.String),
  /** The failure in words (`describe`); null when it succeeded. */
  detail: Schema.NullOr(Schema.String),
});
export type Ended = typeof Ended.Type;

export const endedOf = (exit: Exit.Exit<unknown, unknown>): Ended => {
  if (Exit.isSuccess(exit)) return { as: "succeeded", tag: null, detail: null };
  const error = Cause.findErrorOption(exit.cause);
  const tag =
    Option.isSome(error) && Predicate.hasProperty(error.value, "_tag") && Predicate.isString(error.value._tag)
      ? error.value._tag
      : null;
  return { as: Option.isSome(error) ? "failed" : "died", tag, detail: describe(exit.cause) };
};
