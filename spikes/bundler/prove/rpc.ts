// JSON-RPC to a world's door and the chain helpers the proof needs. A chain call goes to <door>/rpc (it wakes the
// chain and keeps it awake), a bundler call to <door>/bundler. Nothing here prints the door's token.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { createPublicClient, http, type Address, type Hex, type TransactionReceipt } from "viem";

export class RpcFailed extends Data.TaggedError("RpcFailed")<{ readonly method: string; readonly message: string }> {}

/** Anvil's first unlocked account, funded in the seed: it deploys and funds the test contracts. */
export const FUNDER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** One JSON-RPC call; an answer with an error fails with that error's text. */
export const call = (url: string, method: string, params: ReadonlyArray<unknown> = []) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      const body = JSON.parse(text) as { result?: unknown; error?: unknown };
      if (body.error !== undefined) throw new Error(JSON.stringify(body.error));
      if (!("result" in body)) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      return body.result;
    },
    catch: (cause) => new RpcFailed({ method, message: describe(cause) }),
  });

export const chainClient = (url: string) => createPublicClient({ transport: http(url, { timeout: 120_000 }) });
export type ChainClient = ReturnType<typeof chainClient>;

export const promise = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new RpcFailed({ method, message: describe(cause) }) });

/** The receipt of a transaction anvil mines at once; polled briefly in case it has not answered yet. */
export const receiptOf = (client: ChainClient, hash: Hex) =>
  promise("eth_getTransactionReceipt", () => client.getTransactionReceipt({ hash })).pipe(
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 20 }),
  );

/** Sends a transaction from the unlocked funder and insists it succeeded. */
export const sendFromFunder = (url: string, tx: { readonly to?: Address; readonly data?: Hex; readonly value?: bigint }) =>
  Effect.gen(function* () {
    const hash = (yield* call(url, "eth_sendTransaction", [
      {
        from: FUNDER,
        ...(tx.to ? { to: tx.to } : {}),
        data: tx.data ?? "0x",
        value: `0x${(tx.value ?? 0n).toString(16)}`,
        gas: "0x989680",
      },
    ])) as Hex;
    const receipt: TransactionReceipt = yield* receiptOf(chainClient(url), hash);
    if (receipt.status !== "success") return yield* new RpcFailed({ method: "eth_sendTransaction", message: `${hash} reverted` });
    return receipt;
  });
