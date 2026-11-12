// The handlers: every admitted log lands in chain_logs (or its typed fact table), and the projections are rewritten by
// the events that change them. Safe projections read the Safe at the event's block, as safe-owners says, so the RPC
// load is the real one.
import { ponder } from "ponder:registry";
import { chainBudgets, chainLogs, chainPayments, hatWearers, safeOwners, transfers } from "ponder:schema";

import { HATS, SAFE, V4 } from "../abis";

const lower = (x: unknown) => String(x).toLowerCase();
const json = (args: unknown) => JSON.parse(JSON.stringify(args ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const base = (event: any, context: any) => ({
  logId: `${context.chain.id}:${event.transaction.hash}:${event.log.logIndex}`,
  chainId: context.chain.id,
  blockNumber: event.block.number,
  logIndex: event.log.logIndex,
  txHash: event.transaction.hash,
  blockTime: event.block.timestamp * 1000n,
});
/** The Safes a log concerns: every address argument (the real package narrows this to Safes Capxul made). */
const safesOf = (event: any): string[] => Object.values(event.args ?? {}).filter((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)).map(lower);

const log = (contract: string, name: string) => async ({ event, context }: any) => {
  await context.db.insert(chainLogs).values({ ...base(event, context), contract, contractAddress: event.log.address, event: name, args: json(event.args), safes: safesOf(event) }).onConflictDoNothing();
};

const readSafe = async (context: any, safe: `0x${string}`, block: bigint) => {
  const [owners, threshold, nonce] = await Promise.all([
    context.client.readContract({ abi: SAFE, address: safe, functionName: "getOwners", blockNumber: block }),
    context.client.readContract({ abi: SAFE, address: safe, functionName: "getThreshold", blockNumber: block }),
    context.client.readContract({ abi: SAFE, address: safe, functionName: "nonce", blockNumber: block }),
  ]);
  return { owners: (owners as string[]).map(lower), threshold: Number(threshold), nonce: nonce as bigint };
};
/** SAFE_READS=off keeps the row without reading the Safe: measured to see what the reads at past blocks cost on anvil. */
const reads = process.env.SAFE_READS !== "off";
const upsertSafe = async (context: any, safe: `0x${string}`, kind: string, block: bigint) => {
  const s = reads ? await readSafe(context, safe, block) : { owners: [], threshold: 0, nonce: 0n };
  await context.db.insert(safeOwners).values({ safe: lower(safe) as `0x${string}`, kind, ...s, updatedBlock: block }).onConflictDoUpdate({ ...s, updatedBlock: block });
};

const names = (abi: readonly { type: string; name?: string }[]) => abi.filter((x) => x.type === "event").map((x) => x.name as string);
const special = new Set(["Payments:PaymentSent", "Token:Transfer"]);
const plain: Record<string, readonly { type: string; name?: string }[]> = {
  CompaniesHouse: [...V4.CompaniesHouseClaimer, ...V4.CompanySafeMinter],
  Installer: V4.Installer, Budgets: V4.Budgets, Agreements: V4.Agreements, Payments: V4.Payments, EscrowFactory: V4.EscrowFactory,
  AgentOwner: V4.AgentOwner, Escrow: V4.Escrow, Captable: V4.Captable, Governor: V4.Governor, Options: V4.Options, Rounds: V4.Rounds,
  Exits: V4.Exits, CompanySafe: SAFE, PersonSafe: SAFE, AgentSafe: SAFE, Hats: HATS,
};
const after: Record<string, (x: any) => Promise<void>> = {
  "CompaniesHouse:CompanySafeMinted": ({ event, context }) => upsertSafe(context, event.args.safe, "company", event.block.number),
  "CompaniesHouse:CapxulSafeClaimed": ({ event, context }) => upsertSafe(context, event.args.safe, "person", event.block.number),
  "Budgets:BudgetCreated": ({ event, context }) =>
    context.db.insert(chainBudgets).values({ budgetId: event.args.id, safe: lower(event.args.safe), amount: event.args.amount, spent: 0n, updatedBlock: event.block.number }).onConflictDoNothing(),
  "Budgets:BudgetAmountSet": ({ event, context }) =>
    context.db.update(chainBudgets, { budgetId: event.args.id }).set({ amount: event.args.amount, updatedBlock: event.block.number }),
  "Budgets:Spent": ({ event, context }) =>
    context.db.update(chainBudgets, { budgetId: event.args.id }).set((row: any) => ({ spent: row.spent + event.args.amount, updatedBlock: event.block.number })),
  "Hats:TransferSingle": async ({ event, context }) => {
    const { from, to, id } = event.args;
    const zero = "0x0000000000000000000000000000000000000000";
    for (const [who, wearing] of [[to, true], [from, false]] as const) {
      if (lower(who) === zero) continue;
      const key = `${id}:${lower(who)}`;
      await context.db.insert(hatWearers).values({ id: key, hatId: id.toString(), wearer: lower(who), wearing, updatedBlock: event.block.number }).onConflictDoUpdate({ wearing, updatedBlock: event.block.number });
    }
  },
};
for (const kind of ["CompanySafe", "PersonSafe", "AgentSafe"]) {
  for (const e of ["AddedOwner", "RemovedOwner", "ChangedThreshold", "ExecutionSuccess"]) {
    after[`${kind}:${e}`] = ({ event, context }) => upsertSafe(context, event.log.address, kind.replace("Safe", "").toLowerCase(), event.block.number);
  }
}

for (const [contract, abi] of Object.entries(plain)) {
  for (const name of new Set(names(abi))) {
    const key = `${contract}:${name}`;
    if (special.has(key)) continue;
    const write = log(contract, name);
    const then = after[key];
    ponder.on(key as never, (async (x: any) => {
      await write(x);
      if (then) await then(x);
    }) as never);
  }
}

ponder.on("Payments:PaymentSent" as never, (async ({ event, context }: any) => {
  const a = event.args;
  await context.db.insert(chainPayments).values({ ...base(event, context), paymentId: a.paymentId, sender: lower(a.sender), recipient: lower(a.recipient), token: lower(a.token), amount: a.amount, kind: Number(a.kind), documentHash: a.documentHash }).onConflictDoNothing();
}) as never);

ponder.on("Token:Transfer" as never, (async ({ event, context }: any) => {
  const a = event.args;
  await context.db.insert(transfers).values({ ...base(event, context), token: lower(event.log.address), from: lower(a.from), to: lower(a.to), amount: a.value }).onConflictDoNothing();
}) as never);
