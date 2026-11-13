import { ponder } from "ponder:registry";
import { chainBudgets, chainLogs } from "ponder:schema";
import { BUDGETS } from "../abis.ts";
import { decoded, hatHex, identity, lower } from "./logs.ts";

for (const item of BUDGETS.filter((x) => x.type === "event")) {
  ponder.on(`Budgets:${item.name}` as never, (async ({ event, context }: any) => {
    const base = await identity(event, context), a = event.args;
    await context.db.insert(chainLogs).values({ ...base, contract: "budgets", contract_address: lower(event.log.address), event: item.name,
      safes: a.safe ? [lower(a.safe)] : [], args: decoded(a) });
    const id = a.id ?? a.budgetId;
    if (id === undefined) return;
    // A reservation changes every ancestor's committed total, not only the named child.
    let next = id;
    while (next !== 0n) {
      const key = next.toString(), old = await context.db.find(chainBudgets, { budget_id: key });
      const b = await context.client.readContract({ address: event.log.address, abi: BUDGETS, functionName: "budgetOf", args: [next] });
      const state = { chain_id: context.chain.id, company_safe: lower(b.safe), parent_budget_id: b.parent === 0n ? null : b.parent.toString(),
        token: lower(b.token), period: Number(b.period), amount: b.amount, hat_id: hatHex(b.hat), closed: b.closed, committed: b.committed,
        created_log_id: old?.created_log_id ?? base.log_id, last_log_id: base.log_id, updated_block: event.block.number };
      await context.db.insert(chainBudgets).values({ budget_id: key, ...state }).onConflictDoUpdate(state);
      next = b.parent;
    }
  }) as never);
}
