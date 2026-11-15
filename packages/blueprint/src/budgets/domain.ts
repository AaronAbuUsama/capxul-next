// The door of the domain "budgets": a company's budgets on the world's chain, and proposing a new one. Its operations
// by name, its share of the two Rpc groups and its claims, which ../domains.ts gathers with every other domain's. Its
// values are in values.ts, its events and declarations in operations.ts, its claims in claims.ts, its own refusals in
// refusals.ts, and what its approvals authorise in subjects.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Budgets from "./operations.ts";

export * from "./operations.ts";

/** Its machines, by name (src/machine.ts): none yet. */
export const machines = {} as const;

/** Its operations, by name. */
export const operations = {
  "org.budget.create": Budgets.create,
  "org.budget.show": Budgets.show,
  "org.budget.list": Budgets.list,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(Budgets.create.rpc, Budgets.show.rpc, Budgets.list.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "org.budget.create": Claims.create,
  "org.budget.show": Claims.show,
  "org.budget.list": Claims.list,
};
