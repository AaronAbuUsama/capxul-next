// Core's own failures in reaching a world's chain and bundler: faults of the infrastructure, not refusals of the
// contract, which are the blueprint's. A handler lets them travel as defects (decisions.md, 10). Nothing in them
// carries a secret: the chain's address holds the world's token and is never put in a message.
import * as Schema from "effect/Schema";

export class ChainFailed extends Schema.TaggedError<ChainFailed, { readonly brand: unique symbol }>()("ChainFailed", {
  /** `rpc`: the chain; `bundler`: the world's bundler; `answer`: an answer of the wrong shape. */
  reach: Schema.Literals(["rpc", "bundler", "answer"]),
  method: Schema.String,
  message: Schema.String,
}) {}
