// One real ERC-4337 v0.7 UserOperation in a world, for the bundler proof. A Safe owned by one of Anvil's public test
// keys is made through the seeded Safe proxy factory, with the seeded Safe4337Module as its module and fallback
// handler (what a personal Safe is), and given test USDC by the faucet. It then pays a test USDC transfer as a
// UserOperation signed by its owner through the module, sponsored by the world's test paymaster, sent to the world's
// bundler. The signature is the module's: validAfter (6 bytes) and validUntil (6 bytes), both zero for "always",
// then the owner's raw ECDSA signature over the module's operation hash.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { type Address, concat, encodeFunctionData, type Hex, isAddress, isHex, pad, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash } from "viem/account-abstraction";
import { bundlerCall } from "../bundler/client.ts";
import { ENTRY_POINT } from "../bundler/Keys.ts";
import { CHAIN_ID } from "../chain/Anvil.ts";
import { balanceOf, FAUCET_OPERATOR, mintAll } from "../chain/faucet.ts";
import { ProofFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { rpc, rpcHex } from "../lifecycle/parts.ts";
import type { World } from "../lifecycle/spec.ts";

/** The seeded Safe contracts, at the addresses Base Sepolia has them (packages/contracts/state/core.json). */
export const SAFE = {
  factory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  singleton: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  module4337: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  moduleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
} as const satisfies Record<string, Address>;

/** Anvil's public test account 4. It owns the proof's Safe on a disposable chain and nothing else. */
export const OWNER_KEY: Hex = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
/** Who receives the transfer: an address with nothing on it, so its balance is the effect. */
export const RECIPIENT: Address = "0x000000000000000000000000000000000000bEEF";
/** What the faucet gives the Safe (1,000 test USDC) and what the UserOperation moves (25). */
export const SAFE_FUNDS = 1_000_000_000n;
export const AMOUNT = 25_000_000n;

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const PACKED =
  "(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";
const ABI = {
  safe: parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  ]),
  factory: parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce)"]),
  moduleSetup: parseAbi(["function enableModules(address[] modules)"]),
  module: parseAbi([
    `function getOperationHash(${PACKED} userOp) view returns (bytes32)`,
    "function executeUserOp(address to,uint256 value,bytes data,uint8 operation)",
  ]),
  token: parseAbi(["function transfer(address,uint256) returns (bool)"]),
  entryPoint: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function getNonce(address,uint192) view returns (uint256)",
  ]),
} as const;
/** Fixed limits with room to spare: the paymaster pays, so over-asking costs nothing in a test world. */
const GAS = {
  verification: 300_000n,
  call: 200_000n,
  preVerification: 80_000n,
  pmVerification: 60_000n,
  pmPostOp: 50_000n,
};
const VALIDITY: Hex = pad("0x", { size: 12 });
const two128 = (hi: bigint, lo: bigint): Hex => concat([pad(toHex(hi), { size: 16 }), pad(toHex(lo), { size: 16 })]);

const proofFailed = (message: string) => ProofFailed.make({ message });
/** An address read from the world or from its handle, checked to be one. */
const addressOf = (value: string) =>
  isAddress(value, { strict: false }) ? Effect.succeed(value) : Effect.fail(proofFailed(`${value} is not an address`));
const hexOf = (value: string) =>
  isHex(value) ? Effect.succeed(value) : Effect.fail(proofFailed(`${value} is not hex`));
type Chain = Pick<World, "door">;
const call = (world: Chain) => (method: string, params: ReadonlyArray<unknown>) => rpc(world, method, params);
const read = (world: Chain, to: string, data: Hex) =>
  Effect.map(rpcHex(world, "eth_call", [{ to, data }, "latest"]), BigInt);

const Receipt = Schema.Struct({
  status: Schema.String,
  from: Schema.String,
  to: Schema.NullOr(Schema.String),
  blockNumber: Schema.String,
  transactionHash: Schema.String,
  logs: Schema.Array(Schema.Struct({ address: Schema.String, topics: Schema.Array(Schema.String) })),
});
export type ChainReceipt = typeof Receipt.Type;

/** A transaction's receipt, read from the world's chain. */
export const chainReceipt = (world: Chain, hash: string) =>
  rpc(world, "eth_getTransactionReceipt", [hash]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
    Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
  );

/** Makes the proof's Safe from the faucet's operator, has the faucet fund it, and gives back its address. */
export const makeSafe = (world: Chain) =>
  Effect.gen(function* () {
    const owner = privateKeyToAccount(OWNER_KEY).address;
    const initializer = encodeFunctionData({
      abi: ABI.safe,
      functionName: "setup",
      args: [
        [owner],
        1n,
        SAFE.moduleSetup,
        encodeFunctionData({ abi: ABI.moduleSetup, functionName: "enableModules", args: [[SAFE.module4337]] }),
        SAFE.module4337,
        ZERO,
        0n,
        ZERO,
      ],
    });
    const create = encodeFunctionData({
      abi: ABI.factory,
      functionName: "createProxyWithNonce",
      args: [SAFE.singleton, initializer, 4337n],
    });
    // The factory answers the new Safe's address when the creation is simulated first.
    const word = yield* rpcHex(world, "eth_call", [
      { from: FAUCET_OPERATOR, to: SAFE.factory, data: create },
      "latest",
    ]);
    const safe = `0x${Str.slice(-40)(word)}`;
    const tx = yield* rpcHex(world, "eth_sendTransaction", [
      { from: FAUCET_OPERATOR, to: SAFE.factory, data: create, gas: "0x989680" },
    ]);
    const made = yield* chainReceipt(world, tx);
    if (made.status !== "0x1" || (yield* rpcHex(world, "eth_getCode", [safe, "latest"])) === "0x")
      return yield* proofFailed(`the Safe was not made at ${safe} (tx status ${made.status})`);
    const [funded] = yield* mintAll(call(world), [{ to: safe, amount: SAFE_FUNDS }]);
    return { safe, owner, createdIn: tx, funded };
  });

/** What the UserOperation is about, read from the chain: the Safe's and recipient's test USDC, and who paid gas. */
const balances = (world: Chain, safe: Address, paymaster: Address) =>
  Effect.all({
    safe: balanceOf(call(world), safe),
    recipient: balanceOf(call(world), RECIPIENT),
    safeEth: Effect.map(rpcHex(world, "eth_getBalance", [safe, "latest"]), BigInt),
    deposit: read(
      world,
      ENTRY_POINT,
      encodeFunctionData({ abi: ABI.entryPoint, functionName: "balanceOf", args: [paymaster] }),
    ),
    nonce: read(
      world,
      ENTRY_POINT,
      encodeFunctionData({ abi: ABI.entryPoint, functionName: "getNonce", args: [safe, 0n] }),
    ),
  });

const GasPrice = Schema.Struct({
  fast: Schema.Struct({ maxFeePerGas: Schema.String, maxPriorityFeePerGas: Schema.String }),
});
const OperationReceipt = Schema.Struct({
  success: Schema.Boolean,
  sender: Schema.String,
  paymaster: Schema.String,
  actualGasCost: Schema.String,
  actualGasUsed: Schema.String,
  receipt: Schema.Struct({ transactionHash: Schema.String, blockNumber: Schema.String }),
});

/**
 * Signs and sends one UserOperation from the Safe, sponsored by the world's paymaster, and waits for its receipt from
 * the bundler. Gives back the operation's hash, the bundler's receipt, the chain's balances before and after, and
 * how long the bundler took to accept it and to have it in a block.
 */
export const sendUserOperation = (world: Pick<World, "door" | "bundlerUrl" | "paymaster" | "testUsdc">, safe: string) =>
  Effect.gen(function* () {
    const sender = yield* addressOf(safe);
    const paymaster = yield* addressOf(world.paymaster);
    const token = yield* addressOf(world.testUsdc);
    const before = yield* balances(world, sender, paymaster);
    const price = yield* bundlerCall(world, "pimlico_getUserOperationGasPrice").pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(GasPrice)),
    );
    const fees = { max: BigInt(price.fast.maxFeePerGas), priority: BigInt(price.fast.maxPriorityFeePerGas) };
    const transfer = encodeFunctionData({ abi: ABI.token, functionName: "transfer", args: [RECIPIENT, AMOUNT] });
    const callData = encodeFunctionData({
      abi: ABI.module,
      functionName: "executeUserOp",
      args: [token, 0n, transfer, 0],
    });
    const paymasterAndData = concat([
      paymaster,
      pad(toHex(GAS.pmVerification), { size: 16 }),
      pad(toHex(GAS.pmPostOp), { size: 16 }),
    ]);
    const packed = {
      sender,
      nonce: before.nonce,
      initCode: "0x" as Hex,
      callData,
      accountGasLimits: two128(GAS.verification, GAS.call),
      preVerificationGas: GAS.preVerification,
      gasFees: two128(fees.priority, fees.max),
      paymasterAndData,
      signature: VALIDITY,
    };
    const digest = yield* rpcHex(world, "eth_call", [
      {
        to: SAFE.module4337,
        data: encodeFunctionData({ abi: ABI.module, functionName: "getOperationHash", args: [packed] }),
      },
      "latest",
    ]);
    const hash = yield* hexOf(digest);
    const signed = yield* Effect.tryPromise({
      try: () => privateKeyToAccount(OWNER_KEY).sign({ hash }),
      catch: (cause) => proofFailed(`signing: ${describeFailure(cause)}`),
    });
    const signature = concat([VALIDITY, signed]);
    const operation = {
      sender,
      nonce: toHex(before.nonce),
      callData,
      signature,
      callGasLimit: toHex(GAS.call),
      verificationGasLimit: toHex(GAS.verification),
      preVerificationGas: toHex(GAS.preVerification),
      maxFeePerGas: toHex(fees.max),
      maxPriorityFeePerGas: toHex(fees.priority),
      paymaster,
      paymasterVerificationGasLimit: toHex(GAS.pmVerification),
      paymasterPostOpGasLimit: toHex(GAS.pmPostOp),
      paymasterData: "0x" as Hex,
    };
    const expectedHash = getUserOperationHash({
      chainId: CHAIN_ID,
      entryPointAddress: ENTRY_POINT,
      entryPointVersion: "0.7",
      userOperation: {
        sender,
        nonce: before.nonce,
        callData,
        signature,
        callGasLimit: GAS.call,
        verificationGasLimit: GAS.verification,
        preVerificationGas: GAS.preVerification,
        maxFeePerGas: fees.max,
        maxPriorityFeePerGas: fees.priority,
        paymaster,
        paymasterVerificationGasLimit: GAS.pmVerification,
        paymasterPostOpGasLimit: GAS.pmPostOp,
        paymasterData: "0x",
      },
    });

    const sentAt = yield* Clock.currentTimeMillis;
    const userOpHash = yield* bundlerCall(world, "eth_sendUserOperation", [operation, ENTRY_POINT]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
    );
    const acceptedMs = (yield* Clock.currentTimeMillis) - sentAt;
    const receipt = yield* bundlerCall(world, "eth_getUserOperationReceipt", [userOpHash]).pipe(
      Effect.repeat({ while: (found) => found === null, schedule: Schedule.spaced("250 millis") }),
      Effect.timeoutOrElse({
        duration: "120 seconds",
        orElse: () => Effect.fail(proofFailed("no UserOperation receipt in 120 s")),
      }),
      Effect.flatMap(Schema.decodeUnknownEffect(OperationReceipt)),
    );
    const receiptMs = (yield* Clock.currentTimeMillis) - sentAt;
    const after = yield* balances(world, sender, paymaster);
    return { userOpHash, expectedHash, digest, acceptedMs, receiptMs, receipt, before, after };
  });
