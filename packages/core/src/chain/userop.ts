// One ERC-4337 v0.7 UserOperation from a Safe through the Safe4337Module, sponsored by the world's test paymaster and
// sent to the world's bundler. It is prepared first, which fixes everything the signature covers and gives the digest
// its signer signs (decisions.md, 23 and 42: the module's operation hash, signed as it is), and sent later with that
// signature. The module's signature is validAfter and validUntil (6 bytes each, both zero: the approval's own expiry
// is Core's to enforce, in world time, never alto's wall clock) and then the owner's 65 bytes.
//
// Each prepared operation has its own nonce key, so two operations of one Safe never wait on each other.
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { concat, encodeFunctionData, type Hex, keccak256, pad, stringToHex, toHex } from "viem";
import { ENTRY_POINT, SAFE_4337_MODULE } from "./abi.ts";
import { hexOf, readContract } from "./calls.ts";
import { ChainFailed } from "./failures.ts";
import { SEEDED } from "./seeded.ts";
import { WorldChain } from "./WorldChain.ts";

const Uint = Schema.String.check(Schema.isPattern(/^\d+$/));
const HexText = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));

/** A UserOperation as it was prepared: every field its digest covers. Kept as JSON values until it is sent. */
export const Prepared = Schema.Struct({
  sender: HexText,
  nonce: Uint,
  callData: HexText,
  callGasLimit: Uint,
  verificationGasLimit: Uint,
  preVerificationGas: Uint,
  maxFeePerGas: Uint,
  maxPriorityFeePerGas: Uint,
  paymasterVerificationGasLimit: Uint,
  paymasterPostOpGasLimit: Uint,
  /** The module's operation hash: what the sender's owner signs. */
  digest: HexText,
});
export type Prepared = typeof Prepared.Type;

const VALIDITY: Hex = pad("0x", { size: 12 });
const two128 = (high: bigint, low: bigint): Hex => concat([pad(toHex(high), { size: 16 }), pad(toHex(low), { size: 16 })]);
const hex = (text: string): Hex => (text.startsWith("0x") ? (text as Hex) : "0x");

/** A nonce key of 192 bits, from a name that is the operation's own (an approval's subject). */
export const nonceKeyOf = (name: string): bigint => BigInt(keccak256(stringToHex(name))) >> 64n;

const GasPrice = Schema.Struct({
  fast: Schema.Struct({ maxFeePerGas: Schema.String, maxPriorityFeePerGas: Schema.String }),
});

/** The fields the module hashes, packed as the EntryPoint takes them. */
const packed = (op: Omit<Prepared, "digest">, signature: Hex) => ({
  sender: hex(op.sender),
  nonce: BigInt(op.nonce),
  initCode: "0x" as Hex,
  callData: hex(op.callData),
  accountGasLimits: two128(BigInt(op.verificationGasLimit), BigInt(op.callGasLimit)),
  preVerificationGas: BigInt(op.preVerificationGas),
  gasFees: two128(BigInt(op.maxPriorityFeePerGas), BigInt(op.maxFeePerGas)),
  paymasterAndData: concat([
    SEEDED.testPaymaster,
    pad(toHex(BigInt(op.paymasterVerificationGasLimit)), { size: 16 }),
    pad(toHex(BigInt(op.paymasterPostOpGasLimit)), { size: 16 }),
  ]),
  signature,
});

/**
 * Prepares the Safe `sender`'s UserOperation that makes one call (`operation` 0) or one DELEGATECALL (1) through the
 * module. Its nonce is the EntryPoint's next for `nonceKey`; its fees are the bundler's fast price, four times over
 * for the most it may pay, which the paymaster pays.
 */
export const prepare = Effect.fn("userop.prepare")(function* (input: {
  readonly sender: string;
  readonly to: string;
  readonly data: Hex;
  readonly operation: 0 | 1;
  readonly nonceKey: bigint;
  readonly callGas: bigint;
}) {
  const chain = yield* WorldChain;
  const nonce = yield* readContract({
    address: SEEDED.entryPoint,
    abi: ENTRY_POINT,
    functionName: "getNonce",
    args: [hex(input.sender), input.nonceKey],
  });
  const price = yield* chain.bundler("pimlico_getUserOperationGasPrice", []).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(GasPrice)),
    Effect.mapError((error) =>
      Schema.is(ChainFailed)(error)
        ? error
        : ChainFailed.make({ reach: "answer", method: "pimlico_getUserOperationGasPrice", message: error.message }),
    ),
  );
  const op = {
    sender: input.sender,
    nonce: nonce.toString(),
    callData: encodeFunctionData({
      abi: SAFE_4337_MODULE,
      functionName: "executeUserOp",
      args: [hex(input.to), 0n, input.data, input.operation],
    }),
    callGasLimit: input.callGas.toString(),
    verificationGasLimit: "400000",
    preVerificationGas: "120000",
    maxFeePerGas: (BigInt(price.fast.maxFeePerGas) * 4n).toString(),
    maxPriorityFeePerGas: BigInt(price.fast.maxPriorityFeePerGas).toString(),
    paymasterVerificationGasLimit: "60000",
    paymasterPostOpGasLimit: "50000",
  };
  const digest = yield* readContract({
    address: SEEDED.safe4337Module,
    abi: SAFE_4337_MODULE,
    functionName: "getOperationHash",
    args: [packed(op, VALIDITY)],
  });
  return { ...op, digest } satisfies Prepared;
});

const Landed = Schema.Struct({
  success: Schema.Boolean,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  receipt: Schema.Struct({
    transactionHash: Schema.String,
    blockNumber: Schema.String,
    logs: Schema.Array(Schema.Struct({ address: Schema.String, topics: Schema.Array(Schema.String), data: Schema.String })),
  }),
});
export type Landed = typeof Landed.Type;

/** How long a sent UserOperation may take to be in a block before it is a fault. */
const LANDS_WITHIN = "60 seconds";

/** Sends a prepared UserOperation with its owner's signature and answers its receipt once it is in a block. */
export const send = Effect.fn("userop.send")(function* (op: Prepared, ownerSignature: Hex) {
  const chain = yield* WorldChain;
  const operation = {
    sender: op.sender,
    nonce: toHex(BigInt(op.nonce)),
    callData: op.callData,
    signature: concat([VALIDITY, ownerSignature]),
    callGasLimit: toHex(BigInt(op.callGasLimit)),
    verificationGasLimit: toHex(BigInt(op.verificationGasLimit)),
    preVerificationGas: toHex(BigInt(op.preVerificationGas)),
    maxFeePerGas: toHex(BigInt(op.maxFeePerGas)),
    maxPriorityFeePerGas: toHex(BigInt(op.maxPriorityFeePerGas)),
    paymaster: SEEDED.testPaymaster,
    paymasterVerificationGasLimit: toHex(BigInt(op.paymasterVerificationGasLimit)),
    paymasterPostOpGasLimit: toHex(BigInt(op.paymasterPostOpGasLimit)),
    paymasterData: "0x",
  };
  const userOpHash = yield* hexOf(
    "eth_sendUserOperation",
    yield* chain.bundler("eth_sendUserOperation", [operation, SEEDED.entryPoint]),
  );
  const receipt = yield* chain.bundler("eth_getUserOperationReceipt", [userOpHash]).pipe(
    Effect.repeat({ while: (found) => found === null, schedule: Schedule.spaced("200 millis") }),
    Effect.timeoutOrElse({
      duration: LANDS_WITHIN,
      orElse: () =>
        Effect.fail(
          ChainFailed.make({ reach: "bundler", method: "eth_getUserOperationReceipt", message: `${userOpHash} not in a block within ${LANDS_WITHIN}` }),
        ),
    }),
    Effect.flatMap(Schema.decodeUnknownEffect(Landed)),
    Effect.mapError((error) =>
      Schema.is(ChainFailed)(error)
        ? error
        : ChainFailed.make({ reach: "answer", method: "eth_getUserOperationReceipt", message: error.message }),
    ),
  );
  return { userOpHash, ...receipt };
});
