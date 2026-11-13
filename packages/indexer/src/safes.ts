import { ponder } from "ponder:registry";
import { knownSafes, safeApprovals, safeExecutions, safeOwners, chainLogs } from "ponder:schema";
import { decodeAbiParameters, decodeEventLog, zeroAddress } from "viem";
import { AGENT_OWNER, SAFE } from "../abis.ts";
import { decoded, identity, lower } from "./logs.ts";

const sentinel = "0x0000000000000000000000000000000000000001";
const guardSlot = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8n;

export async function refreshSafe(event: any, context: any, safe: `0x${string}`, kind: string, extra = {}) {
  safe = lower(safe);
  const old = await context.db.find(safeOwners, { safe_address: safe });
  const read = (functionName: string, args?: unknown[]) => context.client.readContract({ address: safe, abi: SAFE, functionName, args });
  const code = await context.client.getCode({ address: safe });
  let owners: `0x${string}`[] = [], threshold = 0, nonce = 0n, guard = null;
  const modules: `0x${string}`[] = [];
  if (code && code !== "0x") {
    const [o, t, n, g] = await Promise.all([read("getOwners"), read("getThreshold"), read("nonce"), read("getStorageAt", [guardSlot, 1n])]);
    owners = o.map(lower); threshold = Number(t); nonce = n;
    const address = lower(`0x${g.slice(-40)}`); guard = address === zeroAddress ? null : address;
    let start = sentinel;
    do {
      const [page, next] = await read("getModulesPaginated", [start, 100n]);
      modules.push(...page.map(lower)); start = lower(next);
    } while (start !== sentinel);
  }
  const id = await identity(event, context);
  const state = { chain_id: context.chain.id, kind, deployed: !!code && code !== "0x", owners, threshold, nonce, modules, guard,
    founder_safe: old?.founder_safe ?? null, agent_owner: old?.agent_owner ?? null,
    frozen: old?.frozen ?? false, removed: old?.removed ?? false, ...extra,
    created_log_id: old?.created_log_id ?? id.log_id, last_log_id: id.log_id, updated_block: event.block.number };
  await context.db.insert(safeOwners).values({ safe_address: safe, ...state }).onConflictDoUpdate(state);
}

interface Execution { nonce: bigint; msg_sender: string; threshold: number }
// SafeL2 supplies the pre-execution nonce, the caller and the threshold checked. Match the stack, including nested executions of one Safe.
async function execution(event: any, context: any): Promise<Execution | null> {
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  const stack: Execution[] = [];
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(event.log.address)) continue;
    let e;
    try { e = decodeEventLog({ abi: SAFE, topics: log.topics, data: log.data }); } catch { continue; }
    if (e.eventName === "SafeMultiSigTransaction") {
      const [nonce, sender, threshold] = decodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], e.args.additionalInfo);
      stack.push({ nonce, msg_sender: lower(sender), threshold: Number(threshold) });
    } else if (e.eventName === "ExecutionSuccess" || e.eventName === "ExecutionFailure") {
      const executed = stack.pop();
      // A Safe without SafeL2 logs must not halt every tenant's projections; its execution is kept untyped.
      if (log.logIndex === event.log.logIndex) return executed ?? null;
    }
  }
  throw new Error("Safe execution missing from its receipt");
}

for (const [source, kind] of [["CompanySafe", "company"], ["PersonSafe", "person"], ["AgentSafe", "agent"]]) {
  for (const item of SAFE.filter((x) => x.type === "event")) {
    ponder.on(`${source}:${item.name}` as never, (async ({ event, context }: any) => {
      const safe = lower(event.log.address);
      // Factory provenance admits even setup/execution logs before the birth event in that receipt.
      const base = await identity(event, context), a = event.args;
      let executed: Execution | null = null;
      if (item.name === "ApproveHash") {
        await context.db.insert(safeApprovals).values({ ...base, safe_address: safe, safe_tx_hash: lower(a.approvedHash), owner: lower(a.owner) });
      } else if ((item.name === "ExecutionSuccess" || item.name === "ExecutionFailure") && (executed = await execution(event, context)) !== null) {
        await context.db.insert(safeExecutions).values({ ...base, safe_address: safe, safe_tx_hash: lower(a.txHash),
          safe_nonce: executed.nonce, success: item.name === "ExecutionSuccess", msg_sender: executed.msg_sender, threshold: executed.threshold });
      } else {
        await context.db.insert(chainLogs).values({ ...base, contract: "safe", contract_address: safe, event: item.name, safes: [safe], args: decoded(a) });
      }
      await refreshSafe(event, context, safe, kind!);
    }) as never);
  }
}

for (const item of AGENT_OWNER.filter((x) => x.type === "event")) {
  ponder.on(`AgentOwner:${item.name}` as never, (async ({ event, context }: any) => {
    const safe = lower(event.args.safe);
    if (item.name === "AgentCreated") await context.db.insert(knownSafes).values({ address: safe }).onConflictDoNothing();
    const agent = await context.client.readContract({ address: context.contracts.AgentOwner.address, abi: AGENT_OWNER, functionName: "agentOf", args: [safe] });
    await refreshSafe(event, context, safe, "agent", { agent_owner: lower(agent.owner), frozen: agent.frozen, removed: agent.removed });
    await context.db.insert(chainLogs).values({ ...await identity(event, context), contract: "agent-owner", contract_address: lower(event.log.address),
      event: item.name, safes: [safe, lower(agent.owner)], args: decoded(event.args) });
  }) as never);
}
