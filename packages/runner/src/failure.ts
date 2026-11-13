// How the runner fails, and how a failure is worded in a run record: in the failure's own words, without stack
// frames (they name this machine's paths and say nothing about the world).
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
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

/** A typed failure with a tag, such as a refusal, with every field it carries; anything else in Effect's words. */
export const describe = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error) && Predicate.hasProperty(error.value, "_tag"))
    return Str.slice(0, LIMIT)(Formatter.format({ ...error.value }));
  return pipe(
    Str.split(Cause.pretty(cause), "\n"),
    Arr.filter((line) => !Str.startsWith("at ")(Str.trimStart(line))),
    Arr.join("\n"),
    Str.trim,
    Str.slice(0, LIMIT),
  );
};
