// What a world's clock announces.
import { event } from "@capxul/blueprint-tools";
import { Instant } from "../../common/values.ts";

/** The world's clock moved forward. */
export class ClockWarped extends event<ClockWarped, { readonly brand: unique symbol }>()("clock_warped", {
  from: Instant,
  to: Instant,
}) {}
