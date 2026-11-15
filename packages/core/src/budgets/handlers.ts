// The handlers of the world group's budgets operations, as src/domains/budgets.ts names them. Each answers with its
// outcome or one of its declared refusals; a fault of the database or the chain travels as a defect
// (packages/blueprint/docs/decisions.md, entry 10), which the runner records as a failed call. They need what
// org.member.grant needs: the database, the world's chain, its cast, its clock and its record.
import type { Budgets } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { budgetCreate } from "./create.ts";
import { budgetList, budgetShow } from "./read.ts";

type Payload<Op extends { readonly rpc: { readonly payloadSchema: { readonly Type: unknown } } }> =
  Op["rpc"]["payloadSchema"]["Type"];

/** A fault of what an operation reaches is not a refusal of the contract: it dies. */
const faults = { SqlError: Effect.die, ChainFailed: Effect.die } as const;

/** Its three handlers, by operation: the budgets domain's share of the world group. */
export const budgetsHandlers = {
  "org.budget.create": (payload: Payload<typeof Budgets.create>) =>
    budgetCreate(payload).pipe(Effect.catchTags(faults)),
  "org.budget.show": (payload: Payload<typeof Budgets.show>) => budgetShow(payload).pipe(Effect.catchTags(faults)),
  "org.budget.list": (payload: Payload<typeof Budgets.list>) => budgetList(payload).pipe(Effect.catchTags(faults)),
};
