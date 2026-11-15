// The thing "check": what judges one call or run (docs/design/blueprint.md, part 3). Each layer of the eight is
// declared work, so every second a check takes is on the record. Its verbs are work no door serves.
//
// A check's values.
import * as Schema from "effect/Schema";

/** A check, by the name of its span: a piece of work's or one of its spans'. */
export const CheckName = Schema.String.check(Schema.isPattern(/^check\.[a-z]+(\.[a-z-]+)*$/));
/** The layers of part 3, by name. */
export const CheckLayer = Schema.Literals([
  "generate",
  "lint",
  "types",
  "delta",
  "self-consistency",
  "run time",
  "confirm",
  "watch",
]);
/** The gate's rungs, as `pnpm check` runs them in order (AGENTS.md, "The ladder"). */
export const Rung = Schema.Literals(["shape", "format", "generate", "seed", "lint", "types", "test", "delta"]);
/** The generic checks run on every call of every journey (AGENTS.md, "How it is measured"). */
export const CallCheck = Schema.Literals(["events", "spans", "logs", "path", "timings"]);
/** A measure watched after a deploy, by its metric's or monitor's name. */
export const Measure = Schema.String.check(Schema.isPattern(/^capxul\.[a-z.-]+$/));
