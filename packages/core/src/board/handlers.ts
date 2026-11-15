// The handlers of the world group's board operations, as src/domains/board.ts names them: org.director.list,
// org.director.add and org.threshold.set. Each answers with its outcome or one of its declared refusals; a fault of
// the database or the chain travels as a defect (packages/blueprint, src/common/refusals.ts), which the runner
// records as a failed call. They need what org.member.grant needs (`ChainOps.layer`, src/organizations/handlers.ts)
// beside the database.
import type { Board } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { directorAdd, directorList, thresholdSet } from "./operations.ts";

type Payload<Op extends { readonly rpc: { readonly payloadSchema: { readonly Type: unknown } } }> =
  Op["rpc"]["payloadSchema"]["Type"];

/** A fault of what an operation reaches is not a refusal of the contract: it dies. */
const faults = { SqlError: Effect.die, ChainFailed: Effect.die } as const;

/** Its three handlers, by operation: the board domain's share of the world group. */
export const boardHandlers = {
  "org.director.list": (payload: Payload<typeof Board.directorList>) =>
    directorList(payload).pipe(Effect.catchTags(faults)),
  "org.director.add": (payload: Payload<typeof Board.directorAdd>) =>
    directorAdd(payload).pipe(Effect.catchTags(faults)),
  "org.threshold.set": (payload: Payload<typeof Board.thresholdSet>) =>
    thresholdSet(payload).pipe(Effect.catchTags(faults)),
};
