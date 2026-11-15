// The door of the domain "record": reading a world's record. Its operations by name, its share of the two Rpc groups
// and its claims, which ../domains.ts gathers with every other domain's. Its events and declarations are in
// operations.ts, its claims in claims.ts, its own refusals in refusals.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Record from "./operations.ts";

export * from "./operations.ts";

/** Its machines, by name (src/machine.ts): none yet. */
export const machines = {} as const;

/** Its operations, by name. */
export const operations = {
  "record.export": Record.exportRecord,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(Record.exportRecord.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "record.export": Claims.exportRecord,
};
