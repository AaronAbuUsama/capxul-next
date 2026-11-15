// The thing "starting point": a named state a journey begins from (the glossary's word for today's starting world).
// The points themselves are declared in src/starting-points/points.ts; this thing's verb makes one from its typed
// steps (roadmap item 7.2, ratchet R11).
//
// A starting point's values.
import * as Schema from "effect/Schema";

/** A starting point, by its name, as src/starting-points/points.ts declares it. */
export const StartingPointName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,30}$/));
/** One of a starting point's steps, counted from 1. */
export const PointStep = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
