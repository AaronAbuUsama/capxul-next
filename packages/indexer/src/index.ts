import { ponder } from "ponder:registry";
import { decodeEventLog } from "viem";
import { AGREEMENTS, BUDGETS } from "../abis.ts";
import { chainLogs, chainPayments, hatTrees, knownSafes, progress, transfers, userOperations } from "ponder:schema";
import { decoded, identity, lower } from "./logs.ts";
import { refreshSafe } from "./safes.ts";
import "./hats.ts";
import "./budgets.ts";

ponder.on("Payments:PaymentSent", async ({ event, context }) => {
  const a = event.args;
  if (!await context.db.find(knownSafes, { address: lower(a.sender) })) return;
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  const source: { budget_id: string | null; scheduled_id: string | null; agreement_id: string | null; escrow_address: `0x${string}` | null } = {
    budget_id: null, scheduled_id: null, agreement_id: null, escrow_address: null,
  };
  for (const log of receipt.logs) {
    const isBudget = lower(log.address) === lower(context.contracts.Budgets.address);
    const isAgreement = lower(log.address) === lower(context.contracts.Agreements.address);
    if (!isBudget && !isAgreement) continue;
    let e;
    try { e = decodeEventLog({ abi: isBudget ? BUDGETS : AGREEMENTS, topics: log.topics, data: log.data }) as any; } catch { continue; }
    if (e.args.paymentId?.toLowerCase() !== a.paymentId.toLowerCase()) continue;
    if (isAgreement && e.eventName === "Collected") source.agreement_id = e.args.id.toString();
    else if (isBudget) {
      source.budget_id = (e.args.budgetId ?? e.args.id).toString();
      if (e.eventName === "ScheduledPaid") source.scheduled_id = e.args.scheduledId.toString();
    }
  }
  await context.db.insert(chainPayments).values({
    ...await identity(event, context), payment_id: lower(a.paymentId), sender: lower(a.sender), recipient: lower(a.recipient),
    token: lower(a.token), amount: a.amount, kind: Number(a.kind), document_hash: lower(a.documentHash), ...source,
  });
});
ponder.on("Token:Transfer", async ({ event, context }) => {
  await context.db.insert(transfers).values({
    ...await identity(event, context), token: lower(event.log.address), from: lower(event.args.from), to: lower(event.args.to), amount: event.args.value,
  });
});
ponder.on("Company:CompanySafeMinted", async ({ event, context }) => {
  await context.db.insert(knownSafes).values([
    { address: lower(event.args.safe) },
    { address: lower(event.args.founderSafe) },
  ]).onConflictDoNothing();
  await refreshSafe(event, context, lower(event.args.safe), "company", { founder_safe: lower(event.args.founderSafe) });
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "company-safe-minter", contract_address: lower(event.log.address), event: "CompanySafeMinted",
    safes: [lower(event.args.safe), lower(event.args.founderSafe)], args: decoded(event.args),
  });
});
ponder.on("Company:CapxulSafeClaimed", async ({ event, context }) => {
  await context.db.insert(knownSafes).values({ address: lower(event.args.safe) }).onConflictDoNothing();
  await refreshSafe(event, context, lower(event.args.safe), "person");
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "companies-house-claimer", contract_address: lower(event.log.address), event: "CapxulSafeClaimed", safes: [lower(event.args.safe)],
    args: { safe: lower(event.args.safe), signer: lower(event.args.signer), deployed: event.args.deployed },
  });
});
ponder.on("Installer:MoneyDeployed", async ({ event, context }) => {
  if (!await context.db.find(knownSafes, { address: lower(event.args.safe) })) return;
  const d = event.args.deployment;
  await context.db.insert(hatTrees).values([
    { root: (d.boardTopHat >> 224n).toString(), company_safe: lower(event.args.safe), tree: "board" },
    { root: (d.shareholdersTopHat >> 224n).toString(), company_safe: lower(event.args.safe), tree: "shareholders" },
  ]).onConflictDoNothing();
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "installer", contract_address: lower(event.log.address), event: "MoneyDeployed",
    safes: [lower(event.args.safe), lower(event.args.founderSafe)], args: decoded(event.args),
  });
});
ponder.on("EntryPoint:UserOperationEvent", async ({ event, context }) => {
  const a = event.args;
  if (!await context.db.find(knownSafes, { address: lower(a.sender) })) return;
  await context.db.insert(userOperations).values({
    ...await identity(event, context), user_op_hash: lower(a.userOpHash), sender: lower(a.sender), paymaster: lower(a.paymaster), nonce: a.nonce,
    success: a.success, actual_gas_cost: a.actualGasCost, actual_gas_used: a.actualGasUsed,
  });
});
ponder.on("Head:block", async ({ event, context }) => {
  const p = { indexed_block: event.block.number, indexed_block_hash: event.block.hash, indexed_block_time: event.block.timestamp * 1000n };
  await context.db.insert(progress).values({ chain_id: context.chain.id, ...p }).onConflictDoUpdate(p);
});
