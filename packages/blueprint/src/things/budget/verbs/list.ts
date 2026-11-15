// `capxul budget list` (today `org.budget.list`): every budget of a company.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { NotAMember } from "../../company/refusals.ts";
import { office, top } from "../examples.ts";
import { Budget } from "../values.ts";

export const list = verb({
  rpc: Rpc.make("org.budget.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /**
       * Every budget of the company on the chain, in the order the chain made them: its top budget first. A budget
       * proposed and not yet made is not among them. Its Directors and members see them, and so does the world's
       * owner; anyone else is refused with `NotAMember`.
       */
      budgets: Schema.Array(Budget),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 2_000,
    basis: "the company's BudgetCreated logs, then each budget and its hat's wearers, read on the world's chain",
  },
  examples: [{ payload: { org: "org_northwind1" }, success: { org: "org_northwind1", budgets: [top, office] } }],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists a company's budgets and changes nothing";

/** What `org.budget.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: list,
  claims: [
    claim(
      "A company's budgets are every budget the chain made for its Safe, its top budget first, each as org.budget.show reads it.",
      w.founded,
      "From founded it answers one budget: the top budget founding made, named Northwind Trading, 1,000,000 USDC a month with all of it left, whose hat is Books (chain.hat) and which nobody holds. Once sam's is made it answers the two, in the order of the BudgetCreated logs of the world's Budgets for the company Safe (chain.logs), each as org.budget.show answers it. A budget proposed and not yet signed is not among them. The record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Anyone who does not belong to the company, and a company nobody founded, are refused.",
      w.founded,
      "As olga it is refused with NotAMember naming Northwind and olga; for a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};
