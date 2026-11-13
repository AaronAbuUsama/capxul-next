// The world's test USDC and its faucet. The token is the contracts package's MockERC20, whose `mint` is open: in a
// test world, whatever needs test USDC gets it by minting when the world is created, not from a pre-funded account
// (Aaron, 13 November 2026). Who is funded, and how that is booked, is the caller's business (the cast); this file
// is only the hook: put the token on the chain, mint to the addresses the caller names, and say what each holds.
//
// test-usdc.hex is MockERC20's creation code, compiled from packages/contracts/test/mocks/MockERC20.sol with
// solc 0.8.28 and the contracts package's settings (optimizer on, 200 runs, cancun, OpenZeppelin 5.6.1 from lib/).
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

/** anvil's first unlocked account. It sends the faucet's transactions; it holds no USDC and is given none. */
export const FAUCET_OPERATOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/**
 * Where the token lands: the operator's first transaction on the seeded chain is its deployment, so the address is
 * the same in every world, and the index's configuration names it (ponder/ponder.config.ts).
 */
export const TEST_USDC = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";

export interface Mint {
  /** The address that receives the test USDC. */
  readonly to: string;
  /** How much, in the token's smallest unit: 1 USDC is 1_000_000. */
  readonly amount: bigint;
}

export class FaucetFailed extends Schema.TaggedError<FaucetFailed>()("FaucetFailed", {
  step: Schema.Literals(["deploy", "mint", "read"]),
  message: Schema.String,
}) {}

/** One JSON-RPC call to the world's chain. */
export type Call<E, R> = (method: string, params: ReadonlyArray<unknown>) => Effect.Effect<unknown, E, R>;

const word = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uint = (value: bigint | number) => word(BigInt(value).toString(16));
const text = (value: string) => {
  const bytes = Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return uint(value.length) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
};

/** The constructor arguments `(string name, string symbol, uint8 decimals)`, ABI-encoded. */
export const constructorArguments = (name: string, symbol: string, decimals: number): string => {
  const first = text(name);
  return uint(96) + uint(96 + first.length / 2) + uint(decimals) + first + text(symbol);
};

/** The calldata of `mint(address to, uint256 amount)`. */
export const mintCall = (mint: Mint): string => `0x40c10f19${word(mint.to)}${uint(mint.amount)}`;

/** The calldata of `balanceOf(address account)`. */
export const balanceOfCall = (account: string): string => `0x70a08231${word(account)}`;

const Receipt = Schema.Struct({ status: Schema.String, contractAddress: Schema.NullOr(Schema.String) });

const receiptOf = <E, R>(call: Call<E, R>, step: FaucetFailed["step"], hash: unknown) =>
  call("eth_getTransactionReceipt", [hash]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
    Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
    Effect.mapError((error) => new FaucetFailed({ step, message: `no receipt: ${String(error).slice(0, 160)}` })),
    Effect.flatMap((receipt) =>
      receipt.status === "0x1"
        ? Effect.succeed(receipt)
        : Effect.fail(new FaucetFailed({ step, message: `the transaction reverted (status ${receipt.status})` })),
    ),
  );

/** Puts the token on the chain unless it is already there, as it is in a world made from another. */
export const ensureToken = <E, R>(call: Call<E, R>) =>
  Effect.gen(function* () {
    if ((yield* call("eth_getCode", [TEST_USDC, "latest"])) !== "0x")
      return { deployed: false as const, address: TEST_USDC };
    const fs = yield* FileSystem.FileSystem;
    const code = (yield* fs.readFileString(`${import.meta.dirname}/test-usdc.hex`)).trim();
    const data = `0x${code}${constructorArguments("World test USD", "USDC", 6)}`;
    const hash = yield* call("eth_sendTransaction", [{ from: FAUCET_OPERATOR, data, gas: "0x2dc6c0" }]);
    const { contractAddress } = yield* receiptOf(call, "deploy", hash);
    if (contractAddress?.toLowerCase() !== TEST_USDC.toLowerCase()) {
      return yield* new FaucetFailed({
        step: "deploy",
        message: `the token landed at ${contractAddress}, not at ${TEST_USDC}: the operator had already sent a transaction`,
      });
    }
    return { deployed: true as const, address: TEST_USDC };
  });

/** What an address holds, in the token's smallest unit. */
export const balanceOf = <E, R>(call: Call<E, R>, account: string) =>
  call("eth_call", [{ to: TEST_USDC, data: balanceOfCall(account) }, "latest"]).pipe(
    Effect.map((answer) => BigInt(String(answer))),
  );

/** Mints to each address through the token's open `mint`, one transaction each, and says what each then holds. */
export const mintAll = <E, R>(call: Call<E, R>, mints: ReadonlyArray<Mint>) =>
  Effect.forEach(mints, (mint) =>
    Effect.gen(function* () {
      const tx = yield* call("eth_sendTransaction", [
        { from: FAUCET_OPERATOR, to: TEST_USDC, data: mintCall(mint), gas: "0x30d40" },
      ]);
      yield* receiptOf(call, "mint", tx);
      return {
        to: mint.to,
        minted: mint.amount.toString(),
        tx: String(tx),
        holds: (yield* balanceOf(call, mint.to)).toString(),
      };
    }),
  );
