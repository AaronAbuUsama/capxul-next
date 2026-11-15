// The door of the domain "board": a company's Board, its Directors and how many of them must sign. Its operations by
// name, its share of the two Rpc groups and its claims, which ../domains.ts gathers with every other domain's. Its
// events and declarations are in operations.ts, its claims in claims.ts, its own refusals in refusals.ts. What its
// approvals authorise is in subjects.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Board from "./operations.ts";

export * from "./operations.ts";

/** Its operations, by name. */
export const operations = {
  "org.director.list": Board.directorList,
  "org.director.add": Board.directorAdd,
  "org.threshold.set": Board.thresholdSet,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(Board.directorList.rpc, Board.directorAdd.rpc, Board.thresholdSet.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "org.director.list": Claims.directorList,
  "org.director.add": Claims.directorAdd,
  "org.threshold.set": Claims.thresholdSet,
};
