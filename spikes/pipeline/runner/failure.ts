// How a failure is put into a run record: what went wrong, in the failure's own words, without the stack frames
// (they name this machine's paths and say nothing about the world).
import * as Cause from "effect/Cause";

const LIMIT = 600;

export const describe = (cause: Cause.Cause<unknown>): string =>
  Cause.pretty(cause)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("at "))
    .join("\n")
    .trim()
    .slice(0, LIMIT);
