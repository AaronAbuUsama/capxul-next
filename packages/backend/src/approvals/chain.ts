import { readFileSync } from "node:fs";
import { erc20Abi, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { ENTRY_POINT_07_ADDRESS, MULTI_SEND_CALL_ONLY, SAFE_4337_MODULE, entryPointAbi, toRpcUserOperation } from "../../../sdk/src/approvals/safe-op.ts";
import { bundler, type RpcTransport } from "../shared/door.ts";
import type { CarrierServices } from "./carrier.ts";
import { carrierSponsor, sponsorHttpTransport, type SponsorTransport } from "./sponsorship.ts";

/** World-level, read once at Core start: the world's deployment record and Runtime's world env. */
export type ChainConfig = {
  client: PublicClient; gatewayUrl: string; paymaster: Address; claimOwner: Address;
  /** Tests inject these; production uses the one gateway URL for both. */
  bundlerTransport?: RpcTransport; sponsorTransport?: SponsorTransport;
};
/**
 * The world's deployment file (the one Ponder reads, kept across restore) names Companies House, the bootstrap owner of
 * every unclaimed personal Safe. The module and EntryPoint are the canonical ones; the sponsor checks both on chain.
 */
export function worldChainConfig(input: { deploymentFile: string; chainId: number; entryPoint: string; paymaster: string },
  rest: Omit<ChainConfig, "claimOwner" | "paymaster">): ChainConfig {
  const deployment = JSON.parse(readFileSync(input.deploymentFile, "utf8"));
  if (deployment?.chainId !== input.chainId || input.entryPoint.toLowerCase() !== ENTRY_POINT_07_ADDRESS.toLowerCase() ||
      !isAddress(String(deployment?.companiesHouse)) || !isAddress(input.paymaster))
    throw new Error("WORLD_DEPLOYMENT: the deployment file, entry point or paymaster does not match this world");
  return { ...rest, paymaster: input.paymaster.toLowerCase() as Address, claimOwner: String(deployment.companiesHouse).toLowerCase() as Address };
}
const seconds = (at: Date | null) => BigInt(Math.floor((at?.getTime() ?? 0) / 1000));

/**
 * The approval carrier's chain-facing half on the world's authority clock: PR84's sponsor, Shared's bundler send and
 * lookup (the carrier compares hashes and never resends), the EntryPoint nonce on the approval's own key, and its needs.
 */
export function carrierChain(config: ChainConfig) {
  const { client } = config;
  const gateway = bundler({ gatewayUrl: config.gatewayUrl, entryPoint: ENTRY_POINT_07_ADDRESS }, config.bundlerTransport);
  return (now: () => Promise<Date>): Pick<CarrierServices, "sponsor" | "send" | "lookup" | "nonce" | "needsAndGate"> => ({
    sponsor: carrierSponsor({ client, gateway: config.sponsorTransport ?? sponsorHttpTransport(config.gatewayUrl),
      entryPoint: ENTRY_POINT_07_ADDRESS, module: SAFE_4337_MODULE, multiSend: MULTI_SEND_CALL_ONLY,
      paymaster: config.paymaster, claimOwner: config.claimOwner }, now),
    // The signature is the owner's raw 65 bytes; the module expects the signed window packed before it.
    send: (a) => gateway.send(toRpcUserOperation(a.user_operation!, seconds(a.valid_after), seconds(a.valid_until), a.signature as Hex),
      { expectedHash: a.user_op_hash as Hex }),
    lookup: async (a) => ({ held: (await gateway.lookup(a.user_op_hash as Hex)).held }),
    nonce: async (a) => (await client.readContract({ address: ENTRY_POINT_07_ADDRESS, abi: entryPointAbi, functionName: "getNonce",
      args: [a.sender as Address, BigInt(a.nonce_key)] })).toString(),
    needsAndGate: async (a) => {
      // Core reads the gate through Access' catalogue before this (access.gate-catalogue); asked about one here, fail closed.
      if (a.gate) return false;
      for (const need of a.needs) {
        const balance = await client.readContract({ address: need.token as Address, abi: erc20Abi, functionName: "balanceOf", args: [need.holder as Address] });
        if (balance < BigInt(need.amount)) return false;
      }
      return true;
    },
  });
}
