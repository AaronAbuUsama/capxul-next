// Core's own failures, declared here once: faults of the infrastructure Core reaches, not refusals of the contract,
// which are the blueprint's. Nothing here carries a secret.
import * as Schema from "effect/Schema";

/** Core's own failure in reaching a site: not a refusal of the contract. Nothing in it carries a secret. */
export class SiteDoorFailed extends Schema.TaggedError<SiteDoorFailed, { readonly brand: unique symbol }>()(
  "SiteDoorFailed",
  {
    /** `unset`: this Core was deployed with no bench; `unreachable`: no answer; `refused`: the door said no. */
    reason: Schema.Literals(["unset", "unreachable", "refused"]),
    status: Schema.NullOr(Schema.Int),
    /** The door's refusal code (door.py), such as `site-not-in-world` or `site-creating`. */
    code: Schema.NullOr(Schema.String),
    message: Schema.String,
  },
) {}

/**
 * Core's own failure in reaching a world's chain or bundler: a fault, which a handler lets travel as a defect. The
 * chain's address holds the world's token and is never put in a message.
 */
export class ChainFailed extends Schema.TaggedError<ChainFailed, { readonly brand: unique symbol }>()("ChainFailed", {
  /** `rpc`: the chain; `bundler`: the world's bundler; `answer`: an answer of the wrong shape. */
  reach: Schema.Literals(["rpc", "bundler", "answer"]),
  method: Schema.String,
  message: Schema.String,
}) {}
