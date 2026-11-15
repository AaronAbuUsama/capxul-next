// The delta check (docs/roadmap.md, "Typed once, by check", step 3.5): every operation has every format that exists
// (formats.ts), or is on that format's `unmigrated` list, which may only shrink. Pure: `pnpm delta:check` runs it
// through delta.entry.ts. It takes the operations and the formats as its inputs, the blueprint's own by default, so
// its tests can run it on made-up ones.
import { operations } from "../../../blueprint/src/index.ts";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Format } from "./format.ts";
import { formats } from "./formats.ts";

/** One thing the delta check finds: an operation (or a domain's folder), the format, and why. */
export interface Finding {
  readonly operation: string;
  readonly format: string;
  readonly reason: string;
}

export interface DeltaInputs {
  /** Every operation's name. */
  readonly operations: ReadonlyArray<string>;
  /** Every format, by name. */
  readonly formats: { readonly [format: string]: Format };
}

/** The blueprint's own operations and formats. */
export const blueprint: DeltaInputs = { operations: Rec.keys(operations), formats };

/** What one format finds over `names`. */
const checkFormat = (names: ReadonlyArray<string>, format: string, declared: Format): ReadonlyArray<Finding> => {
  const finding = (operation: string, reason: string): Finding => ({ operation, format, reason });
  const listed = declared.unmigrated;
  return [
    ...Arr.flatMap(names, (operation) => {
      const missing = declared.missing(operation);
      const allowed = Arr.contains(listed, operation);
      if (missing.length === 0)
        return allowed ? [finding(operation, `it has the format now: remove it from ${format}'s unmigrated list`)] : [];
      return allowed ? [] : Arr.map(missing, (reason) => finding(operation, reason));
    }),
    ...Arr.flatMap(listed, (operation) =>
      Arr.contains(names, operation) ? [] : [finding(operation, `${format}'s unmigrated list names no operation`)],
    ),
    ...Arr.flatMap(Arr.dedupe(listed), (operation) =>
      Arr.filter(listed, (each) => each === operation).length > 1
        ? [finding(operation, `${format}'s unmigrated list names it more than once`)]
        : [],
    ),
    ...Arr.map(declared.strays?.() ?? [], (stray) => finding(stray.operation, stray.reason)),
  ];
};

/** Every finding of every format over every operation: nothing when the blueprint's declarations comply. */
export const deltaCheck = (inputs: DeltaInputs = blueprint): ReadonlyArray<Finding> =>
  Arr.flatMap(Rec.toEntries(inputs.formats), ([name, format]) => checkFormat(inputs.operations, name, format));
