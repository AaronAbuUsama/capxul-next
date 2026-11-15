// The thing "journey": a written story of operations that must pass (docs/design/blueprint.md, parts 8 and 12). Its
// steps stay the journey author's, in `packages/scenarios`; the blueprint names what judges it.
//
// A journey's values.
import * as Schema from "effect/Schema";

/** A journey, by its name. Naming each journey here, with its starting point, is roadmap item 3.6's to finish. */
export const JourneyName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,63}$/));
/** One step of a journey, counted from 1. */
export const JourneyStep = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
