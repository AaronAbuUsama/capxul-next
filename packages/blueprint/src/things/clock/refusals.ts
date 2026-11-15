// The ways the clock's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { Instant } from "../../common/values.ts";

/** A world's clock only moves forward. */
export class ClockBackwards extends refusal<ClockBackwards, { readonly brand: unique symbol }>()(
  "ClockBackwards",
  {
    now: Instant,
    asked: Instant,
  },
  2,
) {}

export const refusals = { ClockBackwards } as const;
