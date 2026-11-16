// What Core's chain operations do with the world's chain: read a contract, read the head, and send a transaction
// with the service key and wait until it is in a block. Each is one or a few JSON-RPC calls through `WorldChain`.
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import {
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  decodeFunctionResult,
  encodeFunctionData,
  type EncodeFunctionDataParameters,
  type Hex,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20 } from "./abi.ts";
import { hex } from "./hex.ts";
import { ChainFailed } from "../failures.ts";
import { CHAIN_ID, SEEDED, SERVICE_KEY } from "./seeded.ts";
import { WorldChain } from "./WorldChain.ts";

const answerFailed = (method: string, message: string) => ChainFailed.make({ reach: "answer", method, message });

/** One answer that must be hex. */
export const hexOf = (method: string, answer: unknown): Effect.Effect<Hex, ChainFailed> =>
  typeof answer === "string" && isHex(answer) ? Effect.succeed(answer) : Effect.fail(answerFailed(method, "not hex"));

/** A block tag: a number, or the latest block. */
const tagOf = (block: bigint | null) => (block === null ? "latest" : `0x${block.toString(16)}`);

/** `eth_call` of one view function, decoded by its ABI. */
export const readContract = <
  const A extends Abi,
  N extends ContractFunctionName<A, "pure" | "view">,
  const Args extends ContractFunctionArgs<A, "pure" | "view", N>,
>(read: {
  readonly address: string;
  readonly abi: A;
  readonly functionName: N;
  readonly args: Args;
  readonly block?: bigint | null;
}) =>
  Effect.gen(function* () {
    const chain = yield* WorldChain;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- viem's encoder types its parameters by the ABI's own generics, which a generic wrapper cannot restate.
    const data = encodeFunctionData({
      abi: read.abi,
      functionName: read.functionName,
      args: read.args,
    } as EncodeFunctionDataParameters);
    const answer = yield* hexOf(
      "eth_call",
      yield* chain.rpc("eth_call", [{ to: read.address, data }, tagOf(read.block ?? null)]),
    );
    return yield* Effect.try({
      try: () =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above: the decoded value is the function's return type by the ABI.
        decodeFunctionResult({
          abi: read.abi,
          functionName: read.functionName,
          data: answer,
        } as never) as ContractFunctionReturnType<A, "pure" | "view", N, Args>,
      catch: (cause) => answerFailed("eth_call", `${read.functionName}: ${String(cause)}`),
    });
  });

const Block = Schema.Struct({ number: Schema.String, timestamp: Schema.String });

/** The latest block: its number and its time, which is the world's time (a world's clock is its chain's). */
export const head = Effect.gen(function* () {
  const chain = yield* WorldChain;
  const block = yield* chain.rpc("eth_getBlockByNumber", ["latest", false]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Block)),
    Effect.mapError((error) =>
      Schema.is(ChainFailed)(error) ? error : answerFailed("eth_getBlockByNumber", error.message),
    ),
  );
  return { number: BigInt(block.number), timestampMs: Number(BigInt(block.timestamp)) * 1000 };
});

/** What `holder` holds of the world's test USDC, in its smallest unit. */
export const usdcOf = (holder: string) =>
  readContract({ address: SEEDED.usdc, abi: ERC20, functionName: "balanceOf", args: [hex(holder)] });

const Log = Schema.Struct({
  address: Schema.String,
  topics: Schema.Array(Schema.String),
  data: Schema.String,
});
export const Receipt = Schema.Struct({
  status: Schema.String,
  transactionHash: Schema.String,
  blockNumber: Schema.String,
  logs: Schema.Array(Log),
});
export type Receipt = typeof Receipt.Type;
export type ReceiptLog = typeof Log.Type;

/** A transaction's receipt, waited for: the world's chain mines at once, so a few tries are enough. */
export const receiptOf = (hash: string) =>
  Effect.gen(function* () {
    const chain = yield* WorldChain;
    const found = yield* chain.rpc("eth_getTransactionReceipt", [hash]);
    if (found === null) return yield* answerFailed("eth_getTransactionReceipt", `no receipt for ${hash} yet`);
    return yield* Schema.decodeUnknownEffect(Receipt)(found).pipe(
      Effect.mapError((error) => answerFailed("eth_getTransactionReceipt", error.message)),
    );
  }).pipe(Effect.retry(Schedule.max([Schedule.spaced("200 millis"), Schedule.recurs(50)])));

const service = privateKeyToAccount(SERVICE_KEY);

/** The service key's address. */
export const SERVICE_ADDRESS = service.address;

/**
 * True when the chain refused a send because another took its nonce first: Core's Worker isolates sign with the one
 * service key, so two sends at once can read the same pending nonce (world run 43782964738: four companies founded at
 * once, "nonce too low"). The send is then signed again at the next pending nonce.
 */
export const nonceTaken = (error: ChainFailed): boolean =>
  error.method === "eth_sendRawTransaction" &&
  /nonce too low|replacement transaction underpriced|replacement underpriced/i.test(error.message);

/**
 * How often a send whose nonce was taken is signed again, and how long it waits first: a little, and at random. Of
 * sends that read the same nonce, one lands each round, so `n` at once need at most `n` tries: eight again covers the
 * companies a run founds at once (the runner's RUNNER_SITES_AT_ONCE, 8). A queue would serialise only within one
 * isolate, and one in a Durable Object would add a hop to every send.
 */
const RESENDS = Schedule.max([Schedule.jittered(Schedule.spaced("150 millis")), Schedule.recurs(8)]);

/**
 * Sends one transaction from the service key and answers its receipt once it is in a block. A transaction that
 * reverts is a fault: Core only sends what it has checked would succeed. A send whose nonce another send took first
 * is signed again at the next pending nonce, up to eight times (`nonceTaken`); no step is declared for the resend, so
 * it is part of this span.
 */
export const sendAsService = Effect.fn("chain.send")(function* (to: string, data: Hex, gas: bigint = 8_000_000n) {
  const chain = yield* WorldChain;
  /** One try: the service key's pending nonce, signed at twice the base fee and a gwei, and sent. */
  const once = Effect.gen(function* () {
    const nonce = yield* hexOf(
      "eth_getTransactionCount",
      yield* chain.rpc("eth_getTransactionCount", [service.address, "pending"]),
    );
    // The latest block's base fee twice over and a gwei: enough to be mined at once, and never compounding as
    // eth_gasPrice, which follows the last transactions' own prices, would.
    const latest = yield* chain.rpc("eth_getBlockByNumber", ["latest", false]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ baseFeePerGas: Schema.String }))),
      Effect.mapError((error) =>
        Schema.is(ChainFailed)(error) ? error : answerFailed("eth_getBlockByNumber", error.message),
      ),
    );
    const signed = yield* Effect.tryPromise({
      try: () =>
        service.signTransaction({
          to: hex(to),
          data,
          gas,
          gasPrice: BigInt(latest.baseFeePerGas) * 2n + 1_000_000_000n,
          nonce: Number(BigInt(nonce)),
          chainId: CHAIN_ID,
          type: "legacy",
        }),
      catch: (cause) => answerFailed("eth_sendRawTransaction", `signing: ${String(cause)}`),
    });
    return yield* hexOf("eth_sendRawTransaction", yield* chain.rpc("eth_sendRawTransaction", [signed]));
  });
  const hash = yield* once.pipe(Effect.retry({ schedule: RESENDS, while: nonceTaken }));
  const receipt = yield* receiptOf(hash);
  if (receipt.status !== "0x1")
    return yield* answerFailed("eth_sendRawTransaction", `${hash} to ${to} reverted (${Str.slice(0, 10)(data)})`);
  return receipt;
});
