// The thing "run": one CI or container run of the journeys, from its start to its verdict (docs/design/blueprint.md,
// part 8). Its verbs are work no door serves: the runner does them, and nothing serves them at run time.
//
// A run's values.
import * as Schema from "effect/Schema";

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

/** A run, by its id: the CI run's (`ci-<run id>`) or a container's own. */
export const RunId = pattern(/^[a-z0-9][a-z0-9-]{0,63}$/);
/** One world of a run's several (the glossary's shard; `capxul.lane` on the record), counted from 1. */
export const Shard = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/** How many shards a run splits its journeys across: 2 to start, raised by measured runs (part 8, option B). */
export const ShardCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }));
/** True only for a run in CI: a run from an agent's container is evidence, never proof. */
export const Trusted = Schema.Boolean;
/** The part of a run that failed. */
export const RunPart = Schema.Literals(["prepare", "journeys", "confirm", "verdict", "teardown"]);
/** What a run's preparing failed on. */
export const PreparePart = Schema.Literals(["world", "branch", "index", "starting point"]);
/** Why a verdict does not count. */
export const NotCounted = Schema.Literals(["telemetry did not arrive", "not a trusted run"]);
/** What a teardown left behind. */
export const LeftBehind = Schema.Literals(["world", "branch", "site"]);
