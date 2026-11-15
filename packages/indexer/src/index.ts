import { ponder } from "ponder:registry";
import { decodeEventLog } from "viem";
import { INSTALLER } from "../abis.ts";
import { chainLogs, chainPayments, hatTrees, knownSafes, progress, transfers, userOperations } from "ponder:schema";

const lower = (s: string) => s.toLowerCase() as `0x${string}`;
// getTransactionReceipt is Ponder's cached block-pinned client, not a second chain scanner.
async function identity(event: any, context: any) {
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  const ordinal = receipt.logs.findIndex((l: { logIndex: number }) => l.logIndex === event.log.logIndex);
  if (ordinal < 0) throw new Error("indexed log missing from its receipt");
  return {
    log_id: `${context.chain.id}:${lower(event.transaction.hash)}:${ordinal}`,
    chain_id: context.chain.id, block_number: event.block.number, block_hash: event.block.hash,
    block_time: event.block.timestamp * 1000n, tx_hash: lower(event.transaction.hash),
    tx_log_ordinal: ordinal, log_index: event.log.logIndex,
  };
}
ponder.on("Payments:PaymentSent", async ({ event, context }) => {
  const a = event.args;
  if (!await context.db.find(knownSafes, { address: lower(a.sender) })) return;
  await context.db.insert(chainPayments).values({
    ...await identity(event, context), payment_id: lower(a.paymentId), sender: lower(a.sender), recipient: lower(a.recipient),
    token: lower(a.token), amount: a.amount, kind: Number(a.kind), document_hash: lower(a.documentHash),
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
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "company-safe-minter", event: "CompanySafeMinted",
    args: { ...event.args, safe: lower(event.args.safe), founderSafe: lower(event.args.founderSafe) },
  });
});
ponder.on("Company:CapxulSafeClaimed", async ({ event, context }) => {
  await context.db.insert(knownSafes).values({ address: lower(event.args.safe) }).onConflictDoNothing();
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "companies-house-claimer", event: "CapxulSafeClaimed",
    args: { safe: lower(event.args.safe), signer: lower(event.args.signer), deployed: event.args.deployed },
  });
});
ponder.on("Installer:MoneyDeployed", async ({ event, context }) => {
  if (!await context.db.find(knownSafes, { address: lower(event.args.safe) })) return;
  const d = event.args.deployment;
  await context.db.insert(hatTrees).values([d.boardTopHat, d.shareholdersTopHat].map((id) => ({ root: (id >> 224n).toString(), company_safe: lower(event.args.safe) }))).onConflictDoNothing();
});
ponder.on("Hats:TransferSingle", async ({ event, context }) => {
  const root = (event.args.id >> 224n).toString();
  if (!await context.db.find(hatTrees, { root })) {
    // deployMoney emits its admission after the initial Hats mints in the same receipt.
    const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
    let admitted = false;
    for (const log of receipt.logs) {
      if (lower(log.address) !== lower(context.contracts.Installer.address)) continue;
      try {
        const { args } = decodeEventLog({ abi: INSTALLER, eventName: "MoneyDeployed", topics: log.topics, data: log.data });
        if ([args.deployment.boardTopHat, args.deployment.shareholdersTopHat].some((id) => (id >> 224n).toString() === root) && await context.db.find(knownSafes, { address: lower(args.safe) })) admitted = true;
      } catch { /* another installer event */ }
    }
    if (!admitted) return;
  }
  await context.db.insert(chainLogs).values({
    ...await identity(event, context), contract: "hats", event: "TransferSingle",
    args: { operator: lower(event.args.operator), from: lower(event.args.from), to: lower(event.args.to), id: event.args.id.toString(), amount: event.args.amount.toString() },
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
