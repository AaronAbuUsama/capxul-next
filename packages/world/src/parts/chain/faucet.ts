// The world's test USDC and its faucet. The token is the contracts package's MockERC20, whose `mint` is open: in a
// test world, whatever needs test USDC gets it by minting when the world is created, not from a pre-funded account
// (Aaron, 13 November 2026). Who is funded, and how that is booked, is the caller's business (the cast); this file
// is only the hook: put the token on the chain, mint to the addresses the caller names, and say what each holds.
//
// test-usdc.hex is MockERC20's creation code, compiled from packages/contracts/test/mocks/MockERC20.sol with
// solc 0.8.28 and the contracts package's settings (optimizer on, 200 runs, cancun, OpenZeppelin 5.6.1 from lib/).
import { Seeded } from "@capxul/contracts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { FaucetFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";

/** anvil's first unlocked account. It sends the faucet's transactions; it holds no USDC and is given none. */
export const FAUCET_OPERATOR = Seeded.firstAccount.address;

/**
 * Where the token lands: the operator's first transaction on the seeded chain is its deployment, so the address is
 * the same in every world (the seed's next contract of anvil's first account, as `pnpm generate` works it out from
 * the seed), and the index's configuration names it (ponder/ponder.config.ts).
 */
export const TEST_USDC = Seeded.firstAccount.nextContract;

export interface Mint {
  /** The address that receives the test USDC. */
  readonly to: string;
  /** How much, in the token's smallest unit: 1 USDC is 1_000_000. */
  readonly amount: bigint;
}

/** What the faucet minted to one address when the world was created. */
export interface Funded {
  readonly to: string;
  readonly minted: string;
  readonly holds: string;
  readonly tx: string;
}

/** One JSON-RPC call to the world's chain. */
export type Call<E, R> = (method: string, params: ReadonlyArray<unknown>) => Effect.Effect<unknown, E, R>;

/** A hex string as one 32-byte ABI word. */
export const word = (hex: string): string => pipe(hex, Str.replace(/^0x/, ""), Str.toLowerCase, Str.padStart(64, "0"));
const uint = (value: bigint): string => word(value.toString(16));
const byteHex = (byte: number): string => pipe(byte.toString(16), Str.padStart(2, "0"));

/** A string as ABI-encoded dynamic bytes: its length, then its bytes padded to whole words. */
const text = (value: string): string => {
  const bytes = Arr.join(Arr.map(Arr.fromIterable(new TextEncoder().encode(value)), byteHex), "");
  return uint(BigInt(Str.length(value))) + Str.padEnd(Math.ceil(Str.length(bytes) / 64) * 64, "0")(bytes);
};

/** The constructor arguments `(string name, string symbol, uint8 decimals)`, ABI-encoded. */
export const constructorArguments = (name: string, symbol: string, decimals: number): string => {
  const first = text(name);
  return uint(96n) + uint(BigInt(96 + Str.length(first) / 2)) + uint(BigInt(decimals)) + first + text(symbol);
};

/** The calldata of `mint(address to, uint256 amount)`. */
export const mintCall = (mint: Mint): string => `0x40c10f19${word(mint.to)}${uint(mint.amount)}`;

/** The calldata of `balanceOf(address account)`. */
export const balanceOfCall = (account: string): string => `0x70a08231${word(account)}`;

const Receipt = Schema.Struct({ status: Schema.String, contractAddress: Schema.NullOr(Schema.String) });
const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));
const decodeHex = Schema.decodeUnknownEffect(Hex);

const receiptOf = <E, R>(call: Call<E, R>, step: FaucetFailed["step"], hash: string) =>
  call("eth_getTransactionReceipt", [hash]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
    Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
    Effect.mapError((error) => FaucetFailed.make({ step, message: `no receipt: ${describeFailure(error)}` })),
    Effect.filterOrFail(
      (receipt) => receipt.status === "0x1",
      (receipt) => FaucetFailed.make({ step, message: `the transaction reverted (status ${receipt.status})` }),
    ),
  );

/** Sends one transaction from the faucet's operator and gives back its hash. */
const send = <E, R>(call: Call<E, R>, step: FaucetFailed["step"], transaction: Record<string, string>) =>
  call("eth_sendTransaction", [{ from: FAUCET_OPERATOR, ...transaction }]).pipe(
    Effect.flatMap(decodeHex),
    Effect.mapError((error) => FaucetFailed.make({ step, message: describeFailure(error) })),
  );

const sameAddress = (a: string | null, b: string): boolean =>
  Predicate.isNotNull(a) && Str.toLowerCase(a) === Str.toLowerCase(b);

/** Puts the token on the chain unless it is already there, as it is in a world made from another. */
export const ensureToken = <E, R>(call: Call<E, R>) =>
  Effect.gen(function* () {
    if ((yield* call("eth_getCode", [TEST_USDC, "latest"])) !== "0x")
      return { deployed: false as const, address: TEST_USDC };
    const fs = yield* FileSystem.FileSystem;
    const code = Str.trim(yield* fs.readFileString(`${import.meta.dirname}/test-usdc.hex`));
    const data = `0x${code}${constructorArguments("World test USD", "USDC", 6)}`;
    const hash = yield* send(call, "deploy", { data, gas: "0x2dc6c0" });
    const { contractAddress } = yield* receiptOf(call, "deploy", hash);
    if (!sameAddress(contractAddress, TEST_USDC)) {
      return yield* FaucetFailed.make({
        step: "deploy",
        message: `the token landed at ${contractAddress ?? "no address"}, not at ${TEST_USDC}: the operator had already sent a transaction`,
      });
    }
    return { deployed: true as const, address: TEST_USDC };
  });

/** What an address holds, in the token's smallest unit. */
export const balanceOf = <E, R>(call: Call<E, R>, account: string) =>
  call("eth_call", [{ to: TEST_USDC, data: balanceOfCall(account) }, "latest"]).pipe(
    Effect.flatMap(decodeHex),
    Effect.mapBoth({
      onFailure: (error) => FaucetFailed.make({ step: "read", message: describeFailure(error) }),
      onSuccess: (answer) => BigInt(answer),
    }),
  );

/** Mints to each address through the token's open `mint`, one transaction each, and says what each then holds. */
export const mintAll = <E, R>(call: Call<E, R>, mints: ReadonlyArray<Mint>) =>
  Effect.forEach(mints, (mint) =>
    Effect.gen(function* () {
      const tx = yield* send(call, "mint", { to: TEST_USDC, data: mintCall(mint), gas: "0x30d40" });
      yield* receiptOf(call, "mint", tx);
      const holds = yield* balanceOf(call, mint.to);
      return { to: mint.to, minted: mint.amount.toString(), tx, holds: holds.toString() } satisfies Funded;
    }),
  );
