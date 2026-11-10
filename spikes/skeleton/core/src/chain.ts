// Chain access (viem) for the stand-in contracts: clients, ABIs, addresses, helpers.
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, keccak256, toBytes, parseUnits, formatUnits,
  BaseError, ContractFunctionRevertedError,
  type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { config } from "./config.ts";

export type Deployment = {
  chainId: number; deployer: Address; usdc: Address; hats: Address; orgs: Address; payments: Address; deployedBlock: number;
};

export const transport = () => http(config.rpcUrl);
export const publicClient = createPublicClient({ chain: foundry, transport: transport(), pollingInterval: 200 });

export const loadAbi = (file: string, name: string): Abi =>
  (JSON.parse(readFileSync(`${config.outDir}/${file}.sol/${name}.json`, "utf8")) as { abi: Abi }).abi;

export const abis = {
  usdc: loadAbi("TestUSDC", "TestUSDC"), hats: loadAbi("Hats", "Hats"),
  orgs: loadAbi("Orgs", "Orgs"), payments: loadAbi("Payments", "Payments"),
};

export function deployment(): Deployment {
  try {
    return JSON.parse(readFileSync(config.deploymentFile, "utf8")) as Deployment;
  } catch (e) {
    throw new Error(`no deployment at ${config.deploymentFile}: run core/bin/chain-up.sh (${(e as Error).message})`);
  }
}

export const orgId = (slug: string): Hex => keccak256(toBytes(slug));
export const toUnits = (amount: string): bigint => parseUnits(amount, 6);
export const fromUnits = (v: bigint): string => {
  const s = formatUnits(v, 6);
  return s.includes(".") ? (s.split(".")[1]!.length < 2 ? s + "0" : s) : s + ".00";
};
export const wallet = (privateKey: Hex) =>
  createWalletClient({ account: privateKeyToAccount(privateKey), chain: foundry, transport: transport() });

// Revert -> the contract error name, or undefined if this was not a contract revert.
export function revertName(e: unknown): string | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? r.reason ?? "Revert") : undefined;
}

export type FailureReason = "NOT_AUTHORISED" | "OVER_BUDGET" | "REVERTED";
export function mapRevert(name: string | undefined): FailureReason {
  if (name === "NotAuthorised") return "NOT_AUTHORISED";
  if (name === "OverBudget") return "OVER_BUDGET";
  return "REVERTED";
}

export type SendArgs = { org: string; to: Address; amount: bigint; documentHash: Hex; privateKey: Hex };
export type SendResult =
  | { ok: true; txHash: Hex }
  | { ok: false; reason: FailureReason; detail: string };

// A signed payment attempt. A revert leaves NO log on the chain, so the attempt is simulated first and the
// refusal is reported by us (payment_failed), not read from the chain.
export async function sendPayment(a: SendArgs): Promise<SendResult> {
  const d = deployment();
  const w = wallet(a.privateKey);
  const params = { address: d.payments, abi: abis.payments, functionName: "send", account: w.account,
    args: [orgId(a.org), a.to, a.amount, a.documentHash] } as const;
  try {
    await publicClient.simulateContract(params);
    const txHash = await w.writeContract(params);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return { ok: false, reason: "REVERTED", detail: `tx ${txHash} reverted` };
    return { ok: true, txHash };
  } catch (e) {
    const name = revertName(e);
    return { ok: false, reason: mapRevert(name), detail: name ?? (e as Error).message.split("\n")[0]! };
  }
}
