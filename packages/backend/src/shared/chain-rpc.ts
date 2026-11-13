import {
  decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, isAddress, numberToHex,
  type Abi, type AbiEvent, type Address, type Hex,
} from "viem";

/** The blueprint's `chain-rpc` integration: ordered node fallback, bounded attempts, and two caller-visible failures.
 * A malformed call (bad address, ABI arguments or log window) is the caller's programming error and throws a plain error. */
export class ChainRpcError extends Error {
  readonly code: "PROVIDER_ERROR" | "PROVIDER_RESPONSE_INVALID";
  constructor(code: ChainRpcError["code"]) { super(`Chain RPC refused: ${code}`); this.name = "ChainRpcError"; this.code = code; }
}
export type ChainNode = { url: string; wideLogs?: boolean };
export type ChainBlock = { number: bigint; hash: Hex; timestamp: bigint; baseFeePerGas: bigint | null };
export type ChainLog = { blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number; eventName: string; args: unknown };
export interface ChainRpc {
  readContract(input: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
  getCode(address: Address): Promise<Hex>;
  getBlock(blockNumber?: bigint): Promise<ChainBlock>;
  getLogs(input: { address: Address; event: AbiEvent; fromBlock: bigint; toBlock: bigint }): Promise<ChainLog[]>;
}

/** Moves to the next node; a JSON-RPC verdict on the request is final. */
class Retryable extends Error {}
class Verdict extends Error {}
const unavailable = () => new ChainRpcError("PROVIDER_ERROR");
const misuse = () => new TypeError("chain-rpc called with a malformed address, arguments or log window");
const invalid = () => new ChainRpcError("PROVIDER_RESPONSE_INVALID");
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const quantity = (x: unknown): bigint => { if (typeof x !== "string" || !/^0x[0-9a-fA-F]+$/.test(x)) throw invalid(); return BigInt(x); };
const data = (x: unknown): Hex => { if (typeof x !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(x)) throw invalid(); return x as Hex; };
const hash = (x: unknown): Hex => { if (typeof x !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(x)) throw invalid(); return x.toLowerCase() as Hex; };
// -32603 internal error and -32005 limit exceeded are a node's trouble, not a verdict on the request.
const nodeTrouble = new Set([-32603, -32005]);

async function call(url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  } catch { throw new Retryable(); }
  if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new Retryable(); }
  let body: unknown;
  try { body = await response.json(); } catch { throw invalid(); }
  if (!object(body) || body.jsonrpc !== "2.0" || body.id !== 1) throw invalid();
  if (body.error !== undefined) {
    if (!object(body.error) || !Number.isInteger(body.error.code)) throw invalid();
    if (nodeTrouble.has(body.error.code as number) || body.error.code === 429) throw new Retryable();
    throw new Verdict();
  }
  if (!response.ok || !("result" in body)) throw invalid();
  return body.result;
}

type Policy = { timeoutMs: number; attempts: number; backoffMs: (attempt: number) => number };
// Blueprint NODE_READ: 1.5 s an attempt, at most three in all, no backoff. getLogs: 5 s, three, exponential.
const NODE_READ: Policy = { timeoutMs: 1_500, attempts: 3, backoffMs: () => 0 };
const WIDE_LOGS: Policy = { timeoutMs: 5_000, attempts: 3, backoffMs: (attempt) => 200 * 2 ** attempt };
const MAX_LOG_WINDOW = 2_000n;

export function chainRpc(config: { nodes: readonly ChainNode[] }): ChainRpc {
  if (!config.nodes.length || config.nodes.some((n) => !/^https?:\/\//.test(n.url))) throw misuse();
  const request = async (nodes: readonly ChainNode[], policy: Policy, method: string, params: unknown[]) => {
    if (!nodes.length) throw unavailable();
    for (let attempt = 0; attempt < policy.attempts; attempt++) {
      if (attempt && policy.backoffMs(attempt - 1)) await new Promise((r) => setTimeout(r, policy.backoffMs(attempt - 1)));
      try { return await call(nodes[attempt % nodes.length]!.url, method, params, policy.timeoutMs); }
      catch (error) { if (!(error instanceof Retryable)) throw error; }
    }
    throw unavailable();
  };
  const read = (method: string, params: unknown[]) => request(config.nodes, NODE_READ, method, params);
  const finalAsInvalid = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { if (error instanceof Verdict) throw invalid(); throw error; }
  };
  return {
    async readContract({ address, abi, functionName, args = [], blockNumber }) {
      if (!isAddress(address)) throw misuse();
      let callData: Hex;
      try { callData = encodeFunctionData({ abi, functionName, args } as never); } catch { throw misuse(); }
      const tag = blockNumber === undefined ? "latest" : numberToHex(blockNumber);
      // A revert is the node's final verdict; `0x` means no code answered where an answer was expected.
      const result = data(await finalAsInvalid(() => read("eth_call", [{ to: address, data: callData }, tag])));
      if (result === "0x") throw invalid();
      try { return decodeFunctionResult({ abi, functionName, data: result } as never); } catch { throw invalid(); }
    },
    async getCode(address) {
      if (!isAddress(address)) throw misuse();
      return data(await finalAsInvalid(() => read("eth_getCode", [address, "latest"])));
    },
    async getBlock(blockNumber) {
      const block = await finalAsInvalid(() => read("eth_getBlockByNumber", [blockNumber === undefined ? "latest" : numberToHex(blockNumber), false]));
      if (!object(block)) throw invalid();
      return { number: quantity(block.number), hash: hash(block.hash), timestamp: quantity(block.timestamp),
        baseFeePerGas: block.baseFeePerGas === undefined || block.baseFeePerGas === null ? null : quantity(block.baseFeePerGas) };
    },
    async getLogs({ address, event, fromBlock, toBlock }) {
      if (!isAddress(address) || fromBlock < 0n || toBlock < fromBlock || toBlock - fromBlock >= MAX_LOG_WINDOW) throw misuse();
      const topics = encodeEventTopics({ abi: [event], eventName: event.name } as never);
      const wide = config.nodes.filter((n) => n.wideLogs);
      const logs = await finalAsInvalid(() => request(wide, WIDE_LOGS, "eth_getLogs",
        [{ address, topics: [topics[0]], fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock) }]));
      if (!Array.isArray(logs)) throw invalid();
      return logs.map((log) => {
        if (!object(log) || typeof log.address !== "string" || log.address.toLowerCase() !== address.toLowerCase() || log.removed === true) throw invalid();
        const blockNumber = quantity(log.blockNumber);
        if (blockNumber < fromBlock || blockNumber > toBlock) throw invalid();
        let decoded: { eventName: string; args: unknown };
        try { decoded = decodeEventLog({ abi: [event], data: data(log.data), topics: (Array.isArray(log.topics) ? log.topics.map(hash) : []) as [Hex, ...Hex[]], strict: true }) as never; }
        catch { throw invalid(); }
        return { blockNumber, blockHash: hash(log.blockHash), transactionHash: hash(log.transactionHash), logIndex: Number(quantity(log.logIndex)),
          eventName: decoded.eventName, args: decoded.args };
      });
    },
  };
}
