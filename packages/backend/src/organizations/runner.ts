// The runner of organizations.setups.set-up: each tick advances every processing setup, with the workflow's retries
// (max 5, exponential; the last passes `lastTry`, which stalls a provider outage). Its chain facts are indexing's
// finalized rows, or reads pinned to the landed install's block; its sends are Companies House's tier key.
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, encodeFunctionData, http, isAddress, padHex, parseAbi, stringToHex, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMoneyDeployment } from "../indexing/door.ts";
import type { Database, Sql } from "../platform/db.ts";
import { required } from "../platform/config.ts";
import { INSTALLER, tierServiceSigner, type Officer } from "../shared/door.ts";
import { advance, type Advanced, type Call, type SetupProcessServices } from "./process.ts";

export type SetupChain = { rpcUrl: string; chain: Chain; finality: number; hats: Address; agentOwner: Address; installer: Address; usdc: Address };
const HATS = parseAbi(["function mintHat(uint256 hatId,address wearer) returns (bool)", "function isWearerOfHat(address user,uint256 hatId) view returns (bool)"]);
const SAFE = parseAbi(["function isModuleEnabled(address module) view returns (bool)"]);
const AGENT_OWNER = parseAbi(["struct Agent { address owner; address signer; bool frozen; bool removed; }",
  "function create(address signer,address owner) returns (address safe)", "function agentOf(address safe) view returns (Agent)",
  "function safeAddressFor(address signer,address owner) view returns (address)"]);
/** Safe's guard slot: keccak256("guard_manager.guard.address"). */
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function finalBlock(sql: Sql, chainId: number, finality: number): Promise<bigint> {
  const p = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [chainId])).rows[0];
  if (!p?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  return BigInt(p.indexed_block) - BigInt(finality);
}

/** The process's chain facts and the install batch, on this world's chain and deployment. */
export function setupFacts(c: SetupChain): Pick<SetupProcessServices, "facts" | "installCalls" | "fdeSafe"> {
  const client = createPublicClient({ chain: c.chain, transport: http(c.rpcUrl, { retryCount: 0, timeout: 10_000 }) });
  return {
    fdeSafe: async ({ signer, owner }) => (await client.readContract({ address: c.agentOwner, abi: AGENT_OWNER, functionName: "safeAddressFor",
      args: [signer as Address, owner as Address] })).toLowerCase(),
    facts: {
      async safeMinted(sql, q) {
        const log = (await sql.query(`select args from app.chain_logs where chain_id=$1 and tx_hash=$2 and contract='company-safe-minter'
          and event='CompanySafeMinted' and block_number<=$3 order by tx_log_ordinal limit 1`,
        [q.chainId, q.txHash.toLowerCase(), (await finalBlock(sql, q.chainId, q.finality)).toString()])).rows[0];
        return log ? { safe: log.args.safe, owner: log.args.founderSafe } : null;
      },
      async moneyDeployed(sql, q) {
        // The occurrence is named by indexing's log id, copied from its row, never built from log_index.
        const log = (await sql.query(`select log_id from app.chain_logs where chain_id=$1 and tx_hash=$2 and contract='installer'
          and event='MoneyDeployed' and args->>'safe'=$3 order by tx_log_ordinal limit 1`, [q.chainId, q.txHash.toLowerCase(), q.companySafe.toLowerCase()])).rows[0];
        return log ? readMoneyDeployment(sql, { chainId: q.chainId, logId: log.log_id, companySafe: q.companySafe, finality: q.finality }) : null;
      },
      async installed(_sql, q) {
        const receipt = await client.getTransactionReceipt({ hash: q.txHash as Hex }).catch(() => null);
        if (!receipt) return null;
        // Re-included elsewhere after a reorg, the install is judged at the block it is now in.
        if (await client.getBlockNumber({ cacheTime: 0 }) - receipt.blockNumber < BigInt(q.finality)) return null;
        if (receipt.status !== "success") return false;
        const blockNumber = receipt.blockNumber, at = { blockNumber };
        const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) =>
          client.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, ...at }) as Promise<T>;
        const guard = await client.getStorageAt({ address: q.safe as Address, slot: GUARD_SLOT, ...at });
        const wears = await Promise.all([q.directorHat, ...q.officerHats].map((hat) => read<boolean>(c.hats, HATS, "isWearerOfHat", [q.founderSafe, BigInt(hat)])));
        const fde = q.fdeSafe ? await read<{ owner: string }>(c.agentOwner, AGENT_OWNER, "agentOf", [q.fdeSafe]) : null;
        return await read<boolean>(q.safe as Address, SAFE, "isModuleEnabled", [q.gate]) && same(`0x${(guard ?? "0x").slice(-40)}`, q.gate) &&
          wears.every(Boolean) && (!q.fdeSafe || same(fde?.owner, q.safe));
      },
    },
    async installCalls({ deployment: d, founderSafe, fdeSigner }) {
      // buildMoney's batch for the world's USDC, top amount 0, monthly; then the officer hats to the founder's Safe; then the FDE.
      const batch = await client.readContract({ address: c.installer, abi: INSTALLER, functionName: "buildMoney", args: [{
        safe: d.safe as Address, founderSafe: founderSafe as Address, coDirectors: [],
        deployment: { boardTopHat: BigInt(d.board_top_hat), shareholdersTopHat: BigInt(d.shareholders_top_hat), directorHat: BigInt(d.director_hat),
          officerHats: d.officer_hats.map(BigInt), roles: d.roles as Address, gate: d.gate as Address },
        tokens: [{ token: c.usdc, ceiling: 0n, budgetPeriod: 0, topAmount: 0n, topHat: BigInt(d.board_top_hat) }] }] });
      const calls: Call[] = batch.map((x) => ({ to: x.to.toLowerCase(), value: x.value.toString(), data: x.data }));
      for (const hat of d.officer_hats)
        calls.push({ to: c.hats.toLowerCase(), value: "0", data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [BigInt(hat), founderSafe as Address] }) });
      if (fdeSigner) calls.push({ to: c.agentOwner.toLowerCase(), value: "0",
        data: encodeFunctionData({ abi: AGENT_OWNER, functionName: "create", args: [fdeSigner as Address, d.safe as Address] }) });
      return calls;
    },
  };
}

/** What composition binds: Approvals.open, the FDE host, and the founder's window to sign the install. */
export type SetupBindings = Pick<SetupProcessServices, "open" | "fdeHost" | "installWindowMs">;
/** The process's services from Core's env and the world's deployment file (names in packages/backend/README.md). */
export function setupServicesFromEnv(db: Database, bindings: SetupBindings): SetupProcessServices {
  const deployment = JSON.parse(readFileSync(required("DEPLOYMENT_FILE"), "utf8")) as Record<string, string>;
  const names = ["companiesHouse", "companiesHouseRoles", "companySafeMinter", "installer", "hats", "agentOwner", "usdc"];
  const missing = names.filter((n) => !isAddress(deployment[n] ?? ""));
  if (missing.length) throw new Error(`INVALID_CONFIG: the deployment file needs ${missing.join(", ")}`);
  const chainId = Number(process.env.CHAIN_ID ?? deployment.chainId), rpcUrl = required("RPC_URL"), finality = Number(required("FINALITY_DEPTH"));
  const chain = defineChain({ id: chainId, name: `capxul-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const officers = JSON.parse(required("ORG_SETUP_OFFICERS")) as Officer[];
  const signer = tierServiceSigner({ worker: db.worker, rpcUrl, chain, account: privateKeyToAccount(required("COMPANIES_HOUSE_TIER_KEY") as Hex),
    companiesHouse: deployment.companiesHouse as Address, companiesHouseRoles: deployment.companiesHouseRoles as Address,
    minter: deployment.companySafeMinter as Address, installer: deployment.installer as Address,
    companyRole: padHex(stringToHex(`capxul.company.${required("COMPANIES_HOUSE_TIER")}`), { dir: "right", size: 32 }),
    companyNamespace: required("COMPANY_SAFE_NAMESPACE"), officers });
  return { chainId, finality, mint: signer.mint, deployMoney: signer.deployMoney, receipt: signer.receipt, ...bindings,
    ...setupFacts({ rpcUrl, chain, finality, hats: deployment.hats as Address, agentOwner: deployment.agentOwner as Address,
      installer: deployment.installer as Address, usdc: deployment.usdc as Address }) };
}

export type SetupRunnerOptions = {
  /** The world clock, for the setup's records and events (Core's worldNow). */
  now(): number | Promise<number>;
  /** Real elapsed milliseconds, for retry backoff (time.real-elapsed). */
  elapsed?(): number;
  retries?: number; backoffMs?: number;
  log?(orgId: string, error: unknown): void;
};
const MAX_BACKOFF = 5 * 60_000;
/** One advance per step while a setup moves; a thrown run waits `backoffMs·2^(n-1)` real ms, and the `retries`-th try is the last. */
export function setupRunner(db: Database, services: SetupProcessServices, o: SetupRunnerOptions) {
  const elapsed = o.elapsed ?? (() => performance.now()), retries = o.retries ?? 5, backoff = o.backoffMs ?? 1_000;
  const failing = new Map<string, { tries: number; at: number }>();
  async function trace(orgId: string) {
    // The setup's work carries the trace of the call that last moved it: begin, or `org retry`.
    const row = await db.transaction(orgId, (sql) => sql.query(`select event->>'trace_id' as trace_id from app.transition_outbox
      where event->>'name'='org_setup_transitioned' and event->>'entity_id'=$1 order by seq desc limit 1`, [orgId]), true);
    return row.rows[0]?.trace_id as string | undefined;
  }
  const runner = {
    async tick(): Promise<Record<string, Advanced | { error: string }>> {
      const orgs = (await db.transaction("", (sql) => sql.query("select org_id from app.org_setups where status='processing' order by org_id"), true)).rows;
      const out: Record<string, Advanced | { error: string }> = {};
      for (const { org_id: orgId } of orgs) {
        const failed = failing.get(orgId);
        if (failed && failed.at > elapsed()) continue;
        try {
          const t = await trace(orgId);
          if (!t) throw new Error("NOT_FOUND: the setup's trace");
          for (let step = 0; step < 10; step++) {
            out[orgId] = await advance(db, orgId, services, await o.now(), t, { lastTry: (failed?.tries ?? 0) + 1 >= retries });
            failing.delete(orgId);
            if (!(out[orgId] as Advanced).moved || (out[orgId] as Advanced).status !== "processing") break;
          }
        } catch (error) {
          o.log?.(orgId, error);
          out[orgId] = { error: String((error as Error)?.message ?? error) };
          // The tier key busy with another send is a wait, not a failed try.
          if ((error as { code?: string })?.code === "WRONG_STATE") continue;
          const tries = (failed?.tries ?? 0) + 1;
          failing.set(orgId, { tries: tries >= retries ? 0 : tries, at: elapsed() + Math.min(MAX_BACKOFF, backoff * 2 ** (tries - 1)) });
        }
      }
      return out;
    },
    /** Ticks every `intervalMs` until stopped; composition owns where it runs. */
    start(intervalMs: number) {
      let timer: NodeJS.Timeout | undefined, stopped = false;
      const loop = async () => {
        try { await runner.tick(); } catch (error) { o.log?.("", error); }
        if (!stopped) timer = setTimeout(loop, intervalMs);
      };
      void loop();
      return () => { stopped = true; clearTimeout(timer); };
    },
  };
  return runner;
}
