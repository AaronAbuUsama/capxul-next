// The door of the domain "organizations": founding a company and granting its members permissions. Its operations by
// name, its share of the two Rpc groups and its claims, which ../domains.ts gathers with every other domain's. Its
// events and declarations are in operations.ts, its claims in claims.ts, its own refusals in refusals.ts. What its
// approvals authorise is in subjects.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Organizations from "./operations.ts";

export * from "./operations.ts";

/** Its machines, by name (src/machine.ts): none yet. */
export const machines = {} as const;

/** Its operations, by name. */
export const operations = {
  "org.create": Organizations.create,
  "org.member.grant": Organizations.memberGrant,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(Organizations.create.rpc, Organizations.memberGrant.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "org.create": Claims.create,
  "org.member.grant": Claims.memberGrant,
};
