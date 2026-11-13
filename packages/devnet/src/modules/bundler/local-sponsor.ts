// Test-only local signed ERC-7677 sponsor (decision devnet.local-signed-sponsor). It signs upstream SingletonPaymaster07
// verifying-mode data with a fresh disposable key on a disposable loopback chain. Its admission rules are test policy:
// they are not product or staging sponsorship policy, and the canary's default MockPaymaster path does not use it.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { concat, encodeAbiParameters, encodePacked, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import type { Chain } from "../chain/types.ts";
import type { RpcTransport } from "./types.ts";

/** Pinned @pimlico/mock-paymaster 0.0.8 creation code and stub signature; see the JSON for its npm integrity. */
export const SINGLETON_PAYMASTER_07 = JSON.parse(readFileSync(new URL("./singleton-paymaster07.json", import.meta.url), "utf8")) as { version: string; shasum: string; creationCode: Hex; dummySignature: Hex };
const PACKED = "(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";
export const singletonPaymaster07Abi = parseAbi([
  `function getHash(uint8 mode,${PACKED} userOp) view returns (bytes32)`,
  "function signers(address account) view returns (bool)",
  "function entryPoint() view returns (address)",
]);
const CHAIN_ID = 84532;
/** Stub gas for verifying mode, which returns an empty context and so has no postOp work. */
const STUB_GAS = { verification: 100_000n, postOp: 50_000n };

export type LocalSponsorConfig = {
  /** The explicit opt-in. Any other value refuses to start. */
  admission: "test-only";
  chain: Chain;
  entryPoint: Address;
  paymaster: Address;
  /** A freshly generated disposable key that the deployed paymaster lists as a signer. */
  signerKey: Hex;
  /** The only Safes this test sponsor admits. */
  senders: readonly Address[];
  /** The world's canonical clock, never host time. */
  now: () => Date;
  /** Longest admitted window, both from validAfter and from now. */
  maxWindowSeconds: number;
  /** The real bundler that estimates gas (Alto through httpTransport). The sponsor never sends. */
  bundler: RpcTransport;
  maxPaymasterGas: bigint;
  maxCostWei: bigint;
  port?: number;
};
export type LocalSponsor = { url: string; signer: Address; close(): Promise<void> };

/** A JSON-RPC error with a safe message. -32501 is the ERC-4337 code for a paymaster's refusal. */
export class SponsorRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) { super(message); this.rpcCode = rpcCode; }
}
const refuse = (message: string) => new SponsorRpcError(-32501, message);
const badParams = () => new SponsorRpcError(-32602, "invalid sponsorship params");
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const isAddress = (x: unknown): x is Address => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
const isBytes = (x: unknown): x is Hex => typeof x === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(x);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const quantity = (x: unknown, bits = 256): bigint => {
  if (typeof x !== "string" || !/^0x[0-9a-fA-F]+$/.test(x)) throw badParams();
  const n = BigInt(x);
  if (n >= 1n << BigInt(bits)) throw badParams();
  return n;
};

type Operation = {
  sender: Address; nonce: bigint; callData: Hex; signature: Hex; callGasLimit: bigint; verificationGasLimit: bigint;
  preVerificationGas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; paymasterVerificationGasLimit: bigint; paymasterPostOpGasLimit: bigint;
};

function admitted(config: LocalSponsorConfig, op: unknown, entryPoint: unknown): Operation {
  if (!object(op) || !isAddress(op.sender) || !isBytes(op.callData) || !isBytes(op.signature)) throw badParams();
  if (!isAddress(entryPoint) || !same(entryPoint, config.entryPoint)) throw refuse("unsupported entry point");
  if (!config.senders.some(s => same(s, op.sender as string))) throw refuse("sender is not admitted by this test sponsor");
  if ((op.factory !== undefined && op.factory !== null) || (op.initCode !== undefined && op.initCode !== "0x")) throw refuse("account deployment is not sponsored");
  if (op.paymaster !== undefined && op.paymaster !== null && (!isAddress(op.paymaster) || !same(op.paymaster, config.paymaster))) throw refuse("another paymaster was requested");
  return {
    sender: op.sender, nonce: quantity(op.nonce), callData: op.callData, signature: op.signature,
    callGasLimit: quantity(op.callGasLimit, 128), verificationGasLimit: quantity(op.verificationGasLimit, 128), preVerificationGas: quantity(op.preVerificationGas),
    maxFeePerGas: quantity(op.maxFeePerGas, 128), maxPriorityFeePerGas: quantity(op.maxPriorityFeePerGas, 128),
    paymasterVerificationGasLimit: quantity(op.paymasterVerificationGasLimit ?? "0x0", 128), paymasterPostOpGasLimit: quantity(op.paymasterPostOpGasLimit ?? "0x0", 128),
  };
}

/** The requested window, exactly, if this test admission allows it on the canonical clock. */
function window(config: LocalSponsorConfig, op: Operation, chainId: unknown, context: unknown): { after: bigint; until: bigint } {
  if (quantity(chainId) !== BigInt(config.chain.chainId)) throw refuse("unsupported chain");
  if (!object(context) || context.validAfter === undefined || context.validUntil === undefined) throw refuse("a requested validity window is required");
  const after = quantity(context.validAfter, 48), until = quantity(context.validUntil, 48);
  if (after === 0n || until <= after) throw refuse("a bounded nonzero window is required");
  const nowMs = config.now().getTime();
  if (!Number.isFinite(nowMs)) throw new SponsorRpcError(-32603, "canonical clock is unavailable");
  const now = BigInt(Math.floor(nowMs / 1000)), max = BigInt(config.maxWindowSeconds);
  if (until <= now) throw refuse("the requested window has expired");
  if (until - after > max || until - now > max) throw refuse("the requested window exceeds this test admission");
  // Safe4337Module signatures begin validAfter (6 bytes), validUntil (6 bytes): the account and paymaster windows must agree.
  const s = op.signature;
  if (s.length < 26 || BigInt(`0x${s.slice(2, 14)}`) !== after || BigInt(`0x${s.slice(14, 26)}`) !== until) throw refuse("the Safe signature window differs from the requested window");
  return { after, until };
}

/** Verifying mode with allowAllBundlers: mode byte 1, validUntil, validAfter (upstream singletonPaymasters.ts order). */
const configBytes = (w: { after: bigint; until: bigint }) => encodePacked(["uint8", "uint48", "uint48"], [1, Number(w.until), Number(w.after)]);

function packed(op: Operation, paymaster: Address, paymasterData: Hex) {
  return {
    sender: op.sender, nonce: op.nonce, initCode: "0x" as Hex, callData: op.callData,
    accountGasLimits: encodePacked(["uint128", "uint128"], [op.verificationGasLimit, op.callGasLimit]), preVerificationGas: op.preVerificationGas,
    gasFees: encodePacked(["uint128", "uint128"], [op.maxPriorityFeePerGas, op.maxFeePerGas]),
    paymasterAndData: encodePacked(["address", "uint128", "uint128", "bytes"], [paymaster, op.paymasterVerificationGasLimit, op.paymasterPostOpGasLimit, paymasterData]),
    signature: op.signature,
  };
}

function loopback(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password) throw new Error("local sponsor requires an unauthenticated loopback chain RPC");
}

/** Test-only admission, checked wherever the sponsor's signing can be reached, not only by its HTTP server. */
function admit(config: LocalSponsorConfig): void {
  if (config.admission !== "test-only") throw new Error("the local sponsor requires explicit test-only admission");
  loopback(config.chain.rpcUrl);
  if (config.chain.chainId !== CHAIN_ID) throw new Error("local sponsor requires disposable chain 84532");
  if (!config.senders.length || !config.senders.every(isAddress)) throw new Error("local sponsor needs its admitted Safes");
  if (!Number.isSafeInteger(config.maxWindowSeconds) || config.maxWindowSeconds <= 0) throw new Error("local sponsor needs a positive maximum window");
}

/** JSON-RPC methods of the sponsor, without HTTP. Exported for the transport-free unit tests. */
export function localSponsorHandler(config: LocalSponsorConfig): (method: string, params: unknown) => Promise<unknown> {
  admit(config);
  const signer = privateKeyToAccount(config.signerKey);
  return async (method, params) => {
    if (!Array.isArray(params)) throw badParams();
    if (method === "eth_estimateUserOperationGas") {
      admitted(config, params[0], params[1]);
      try { return await config.bundler.request(method, params); }
      catch (error) {
        const code = object(error) ? (typeof error.rpcCode === "number" ? error.rpcCode : typeof error.code === "number" ? error.code : undefined) : undefined;
        throw code === undefined ? new SponsorRpcError(-32603, "bundler did not answer") : new SponsorRpcError(code, "bundler refused estimation");
      }
    }
    if (method !== "pm_getPaymasterStubData" && method !== "pm_getPaymasterData") throw new SponsorRpcError(-32601, "method not served by this sponsor");
    if (params.length !== 4) throw badParams();
    const op = admitted(config, params[0], params[1]);
    const w = window(config, op, params[2], params[3]);
    if (method === "pm_getPaymasterStubData") {
      return { sponsor: { name: "Capxul test-only local sponsor" }, paymaster: config.paymaster, paymasterData: concat([configBytes(w), SINGLETON_PAYMASTER_07.dummySignature]),
        paymasterVerificationGasLimit: toHex(STUB_GAS.verification), paymasterPostOpGasLimit: toHex(STUB_GAS.postOp), isFinal: false };
    }
    if (op.paymasterVerificationGasLimit === 0n || op.paymasterVerificationGasLimit > config.maxPaymasterGas || op.paymasterPostOpGasLimit > config.maxPaymasterGas) throw refuse("paymaster gas is outside this test admission");
    if (op.maxPriorityFeePerGas > op.maxFeePerGas) throw refuse("priority fee exceeds the fee cap");
    const cost = (op.verificationGasLimit + op.callGasLimit + op.preVerificationGas + op.paymasterVerificationGasLimit + op.paymasterPostOpGasLimit) * op.maxFeePerGas;
    if (cost > config.maxCostWei) throw refuse("maximum cost exceeds this test admission");
    const data = configBytes(w);
    // The deployed paymaster's own hash over the final operation, including every gas field and the window bytes.
    const hash = await config.chain.client.readContract({ address: config.paymaster, abi: singletonPaymaster07Abi, functionName: "getHash", args: [0, packed(op, config.paymaster, data)] });
    return { paymaster: config.paymaster, paymasterData: concat([data, await signer.signMessage({ message: { raw: hash } })]) };
  };
}

/** Deploys pinned SingletonPaymaster07 with the disposable signer as owner, manager and only signer. Disposable chains only. */
export async function deploySingletonPaymaster07(chain: Chain, fundingKey: Hex, signer: Address): Promise<Address> {
  loopback(chain.rpcUrl);
  if (chain.chainId !== CHAIN_ID) throw new Error("local sponsor requires disposable chain 84532");
  const args = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address[]" }], [entryPoint07Address, signer, signer, [signer]]);
  const hash = await chain.walletFor(fundingKey).sendTransaction({ data: concat([SINGLETON_PAYMASTER_07.creationCode, args]) });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("SingletonPaymaster07 deployment failed");
  return receipt.contractAddress;
}

async function serve(req: IncomingMessage, res: ServerResponse, handle: (method: string, params: unknown) => Promise<unknown>): Promise<void> {
  const reply = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)); };
  if (req.method !== "POST") return reply(405, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "POST only" } });
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 1 << 20) return reply(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } }); chunks.push(chunk as Buffer); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  if (!object(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string" || !(typeof body.id === "number" || typeof body.id === "string")) return reply(200, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
  try { reply(200, { jsonrpc: "2.0", id: body.id, result: await handle(body.method, body.params) }); }
  catch (error) {
    // Never echo payloads, chain errors or signatures: only this sponsor's own safe messages.
    const e = error instanceof SponsorRpcError ? error : new SponsorRpcError(-32603, "sponsor could not serve the request");
    reply(200, { jsonrpc: "2.0", id: body.id, error: { code: e.rpcCode, message: e.message } });
  }
}

/** Starts the in-process loopback sponsor after checking the deployed paymaster lists its disposable signer. */
export async function startLocalSponsor(config: LocalSponsorConfig): Promise<LocalSponsor> {
  const handle = localSponsorHandler(config);
  if (await config.chain.client.getChainId() !== CHAIN_ID) throw new Error("local sponsor requires disposable chain 84532");
  const signer = privateKeyToAccount(config.signerKey).address;
  const code = await config.chain.client.getCode({ address: config.paymaster });
  if (!code || code === "0x") throw new Error("paymaster is not deployed");
  const read = { address: config.paymaster, abi: singletonPaymaster07Abi } as const;
  if (!same(await config.chain.client.readContract({ ...read, functionName: "entryPoint" }), config.entryPoint)) throw new Error("paymaster uses another EntryPoint");
  if (!await config.chain.client.readContract({ ...read, functionName: "signers", args: [signer] })) throw new Error("paymaster does not list the disposable signer");
  const server = createServer((req, res) => { void serve(req, res, handle); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port ?? 0, "127.0.0.1", resolve); });
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, signer, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) };
}
