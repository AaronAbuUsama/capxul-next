// The handlers of the world group's chain operations, as src/handlers.ts names them: org.create, org.member.grant and
// approval.sign. Each answers with its outcome or one of its declared refusals; a fault of the database, the chain,
// the bundler or the bench travels as a defect (decisions.md, 10), which the runner records as a failed call.
//
// What they need is `ChainOps.layer`: the world's chain and bundler, its cast, and its bench's site door, beside the
// database (PgClient) every Core has.
import type { Approvals, Organizations } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { approvalSign } from "../approvals/sign.ts";
import { Cast } from "../cast/Cast.ts";
import { WorldChain } from "../chain/WorldChain.ts";
import { SiteDoor } from "../site/SiteDoor.ts";
import { orgCreate } from "./found.ts";
import { orgMemberGrant } from "./grant.ts";

/** A fault of what an operation reaches is not a refusal of the contract: it dies. */
const faults = { SqlError: Effect.die, ChainFailed: Effect.die } as const;

export const orgCreateHandler = (payload: typeof Organizations.create.rpc.payloadSchema.Type) =>
  orgCreate(payload).pipe(Effect.catchTags(faults));

export const orgMemberGrantHandler = (payload: typeof Organizations.memberGrant.rpc.payloadSchema.Type) =>
  orgMemberGrant(payload).pipe(Effect.catchTags(faults));

export const approvalSignHandler = (payload: typeof Approvals.sign.rpc.payloadSchema.Type) =>
  approvalSign(payload).pipe(Effect.catchTags(faults));

/** What the three handlers need beside the database, from the Worker's environment. */
export const ChainOps = {
  layer: (env: Record<string, unknown>) =>
    Layer.mergeAll(WorldChain.fromEnv(env), Cast.fromDatabase, SiteDoor.fromEnv(env).pipe(Layer.provide(FetchHttpClient.layer))),
  /** A Core with no chain, no cast and no bench, for a test in memory that never calls these three. */
  absent: Layer.mergeAll(
    WorldChain.fromEnv({}),
    Cast.listed([]),
    SiteDoor.fromEnv({}).pipe(Layer.provide(FetchHttpClient.layer)),
  ),
};
