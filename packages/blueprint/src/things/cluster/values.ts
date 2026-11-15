// The thing "cluster": the shared containers worlds run on, one per stage (the glossary's word; today's hub or fleet,
// roadmap item 1.15). Its verbs are work no door serves: `packages/world` does them from the command line.
//
// A cluster's values.
import * as Schema from "effect/Schema";

/** A stage, by its name: a deployed instance of a stack, such as `staging`. */
export const StageName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,30}$/));
/** Why a cluster's verb was refused. */
export const ClusterRefusal = Schema.Literals(["already up", "not up", "worlds still on it", "over the spend cap"]);
