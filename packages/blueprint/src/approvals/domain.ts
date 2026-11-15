// The door of the domain "approvals": giving a signature an operation asked for. Its operations by name, its share of
// the two Rpc groups and its claims, which ../domains.ts gathers with every other domain's. Its events and declarations
// are in operations.ts, its claims in claims.ts, its own refusals in refusals.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Approvals from "./operations.ts";

export * from "./operations.ts";

/** Its operations, by name. */
export const operations = {
  "approval.sign": Approvals.sign,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(Approvals.sign.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "approval.sign": Claims.sign,
};
