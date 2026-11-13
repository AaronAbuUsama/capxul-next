import { ponder } from "ponder:registry";
import { chainHats, chainLogs, hatTrees, hatWearers, knownSafes } from "ponder:schema";
import { eq } from "ponder";
import { decodeEventLog, zeroAddress } from "viem";
import { HATS, HATS_MODULE, INSTALLER } from "../abis.ts";
import { decoded, hatHex, identity, lower } from "./logs.ts";
import { answers } from "./probe.ts";

async function treeOf(event: any, context: any, id: bigint) {
  const root = (id >> 224n).toString();
  const saved = await context.db.find(hatTrees, { root });
  if (saved) return saved;
  // Initial hat events precede MoneyDeployed, which admits their tree in the same receipt.
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(context.contracts.Installer.address)) continue;
    let e;
    try { e = decodeEventLog({ abi: INSTALLER, topics: log.topics, data: log.data }); } catch { continue; }
    if (!await context.db.find(knownSafes, { address: lower(e.args.safe) })) continue;
    for (const [hat, tree] of [[e.args.deployment.boardTopHat, "board"], [e.args.deployment.shareholdersTopHat, "shareholders"]] as const) {
      if ((hat >> 224n).toString() === root) return { root, company_safe: lower(e.args.safe), tree };
    }
  }
}

for (const item of HATS.filter((x) => x.type === "event")) {
  ponder.on(`Hats:${item.name}` as never, (async ({ event, context }: any) => {
    const id = BigInt(event.args.id ?? event.args.hatId), key = hatHex(id);
    const tree = await treeOf(event, context, id);
    if (!tree) return;
    const base = await identity(event, context);
    const old = await context.db.find(chainHats, { hat_id: key });
    const read = (functionName: string, args: unknown[]) => context.client.readContract({ address: event.log.address, abi: HATS, functionName, args });
    const [details, maxSupply, supply, eligibility, toggle, , , mutable, active] = await read("viewHat", [id]);
    let level = 0, parent = null;
    for (let shift = 208; shift >= 0; shift -= 16) {
      if ((id >> BigInt(shift) & 0xffffn) !== 0n) {
        level++;
        parent = hatHex(id >> BigInt(shift + 16) << BigInt(shift + 16));
      }
    }
    // As Hats does: an eligibility or toggle that answers its call rules wearers and status itself, with no Hats event.
    // Only a revert, no data or undecodable data means "not a module"; an RPC failure rethrows so Ponder retries (probe.ts).
    const module = (address: string, functionName: string, args: unknown[]) => answers(() => context.client.readContract({ address,
      abi: HATS_MODULE, functionName, args, retryEmptyResponse: false }));
    const live = await module(eligibility, "getWearerStatus", [zeroAddress, id]) || await module(toggle, "getHatStatus", [id]);
    const state = { chain_id: context.chain.id, company_safe: tree.company_safe, tree: tree.tree, admin_hat_id: parent, level,
      details, max_supply: BigInt(maxSupply), supply: BigInt(supply), eligibility: lower(eligibility), toggle: lower(toggle), active, mutable,
      created_log_id: old?.created_log_id ?? base.log_id, last_log_id: base.log_id, updated_block: event.block.number, live };
    await context.db.insert(chainHats).values({ hat_id: key, ...state }).onConflictDoUpdate(state);

    const wearers = (await context.db.sql.select().from(hatWearers).where(eq(hatWearers.hat_id, key))).map((w: any) => w.wearer);
    if (item.name === "TransferSingle") wearers.push(event.args.from, event.args.to);
    if (item.name === "WearerStandingChanged") wearers.push(event.args.wearer);
    for (const wearer of new Set<string>(wearers.map(lower))) {
      if (wearer === zeroAddress) continue;
      const previous = await context.db.find(hatWearers, { hat_id: key, wearer });
      const [balance, standing, wearing] = await Promise.all([
        read("balanceOf", [wearer, id]), read("isInGoodStanding", [wearer, id]), read("isWearerOfHat", [wearer, id]),
      ]);
      const holds = balance > 0n;
      const update = { chain_id: context.chain.id, company_safe: tree.company_safe, holds, standing, wearing,
        since_block: holds && !previous?.holds ? event.block.number : previous?.since_block ?? event.block.number,
        created_log_id: previous?.created_log_id ?? base.log_id, last_log_id: base.log_id, updated_block: event.block.number };
      await context.db.insert(hatWearers).values({ hat_id: key, wearer, ...update }).onConflictDoUpdate(update);
    }
    await context.db.insert(chainLogs).values({ ...base, contract: "hats", contract_address: lower(event.log.address), event: item.name,
      safes: [...new Set([tree.company_safe, ...wearers.map(lower).filter((w: string) => w !== zeroAddress)])], args: decoded(event.args) });
  }) as never);
}
