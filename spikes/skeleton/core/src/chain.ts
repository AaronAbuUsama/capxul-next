// Chain access (viem) for the world's chain, which runs the real v4 contracts (src/v4.ts): clients, addresses, helpers.
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, keccak256, toBytes, parseUnits, formatUnits, type Address, type Hex } from "viem";
import { config } from "./config.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { touched, touchTx, trace } from "./trace.ts";
import { worldNowMs } from "./world.ts";

export type Deployment = {
  mode: "v4"; chainId: number; deployer: Address; usdc: Address; hats: Address; payments: Address; budgets: Address; companiesHouse: Address; deployedBlock: number;
};

// every call to the chain carries the command's trace id (anvil ignores it; a real node's gateway logs would join on it)
export const transport = () => http(config.rpcUrl, { fetchOptions: { headers: { "x-capxul-trace": trace } } });
const foundry = defineChain({ id: config.chainId, name: `skeleton-${config.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
export const publicClient = createPublicClient({ chain: foundry, transport: transport(), pollingInterval: 200 });

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
// Before a transaction the chain is set to the world's time again (anvil forgets it on a restart; a real chain cannot be moved: finding).
export async function syncTime(): Promise<void> {
  try { await (publicClient as any).request({ method: "anvil_setTime", params: [Math.floor(worldNowMs() / 1000)] }); } catch { /* not anvil */ }
}
// Every transaction a command sends is noted for the recorder, and its hash is filed with the trace id (state/tx-trace.jsonl) so Core can
// pass the id on to the site with the event the transaction causes. The v4 adapter's clients send; this notes and files.
export function touchChainTx(hash: Hex, what: string): void {
  touchTx(hash, what);
  mkdirSync(config.stateDir, { recursive: true });
  appendFileSync(`${config.stateDir}/tx-trace.jsonl`, JSON.stringify({ tx: hash, trace }) + "\n");
}

/** Whether someone wears a hat in an org. */
export async function wears(slug: string, who: Address, hat: string): Promise<boolean> {
  const { v4Wears } = await import("./v4.ts");
  return v4Wears(slug, who, hat);
}

export type FailureReason = "NOT_AUTHORISED" | "OVER_BUDGET" | "REVERTED";

export type SendArgs = { org: string; to: Address; amount: bigint; documentHash: Hex; privateKey: Hex };
export type SendResult =
  | { ok: true; txHash: Hex }
  | { ok: false; reason: FailureReason; detail: string };

// A signed payment attempt. A refusal leaves NO log on the chain, so the attempt is simulated first and the
// refusal is reported by us (payment_failed), not read from the chain.
export async function sendPayment(a: SendArgs): Promise<SendResult> {
  touched.org = a.org;
  await syncTime();
  const { v4Pay } = await import("./v4.ts");
  const r = await v4Pay(a.org, a.to, a.amount, a.documentHash, a.privateKey);
  if (r.ok) touchChainTx(r.txHash, "spend");
  return r;
}
