// What a world's clock announces.
import * as Schema from "effect/Schema";
import { Instant } from "../../common/values.ts";

/** The world's clock moved forward. */
export class ClockWarped extends Schema.TaggedClass<ClockWarped, { readonly brand: unique symbol }>()("clock_warped", {
  from: Instant,
  to: Instant,
}) {}
