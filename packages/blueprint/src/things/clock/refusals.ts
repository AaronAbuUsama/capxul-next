// The ways the clock's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { Instant } from "../../common/values.ts";

/** A world's clock only moves forward. */
export class ClockBackwards extends Schema.TaggedError<ClockBackwards, { readonly brand: unique symbol }>()(
  "ClockBackwards",
  {
    now: Instant,
    asked: Instant,
  },
) {}

export const refusals = { ClockBackwards } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  ClockBackwards: 2,
};
