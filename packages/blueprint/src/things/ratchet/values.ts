// The thing "ratchet": a gap that may only shrink (docs/design/blueprint.md, part 4). Each is declared once in the
// blueprint's registry (roadmap item 3.6, its own piece of work) and counted by `ratchet.count`.
//
// A ratchet's values.
import * as Schema from "effect/Schema";

/** A ratchet, by its number in part 4's registry. */
export const RatchetName = Schema.String.check(Schema.isPattern(/^R[1-9][0-9]?$/));
/** How many items a ratchet's list holds. */
export const ItemCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
