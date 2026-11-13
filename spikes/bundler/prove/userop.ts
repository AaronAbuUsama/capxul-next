// One real ERC-4337 v0.7 UserOperation: the test Safe pays a test-token transfer, the Safe's owner key signs it through
// the Safe4337Module, the MockPaymaster sponsors the gas, and it goes to the world's bundler by eth_sendUserOperation.
// The signature is the module's: validAfter (6 bytes) and validUntil (6 bytes), both zero for "always", then the
// owner's raw ECDSA signature over the module's operation hash.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { concat, encodeFunctionData, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash } from "viem/account-abstraction";
import { call, chainClient, promise, RpcFailed } from "./rpc.ts";
import { ABI, ENTRY_POINT, OWNER_KEY, SAFE, type World } from "./setup.ts";

const PACKED = "(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";
const MODULE = parseAbi([
  `function getOperationHash(${PACKED} userOp) view returns (bytes32)`,
  "function executeUserOp(address to,uint256 value,bytes data,uint8 operation)",
]);
/** Fixed limits with room to spare: the paymaster pays, so over-asking costs nothing in a test world. */
const GAS = { verification: 300_000n, call: 200_000n, preVerification: 80_000n, pmVerification: 60_000n, pmPostOp: 50_000n };
const VALIDITY: Hex = pad("0x", { size: 12 });
const two128 = (hi: bigint, lo: bigint): Hex => concat([pad(toHex(hi), { size: 16 }), pad(toHex(lo), { size: 16 })]);

/** Who receives the transfer: an address with nothing on it, so its balance is the effect. */
export const RECIPIENT: Address = "0x000000000000000000000000000000000000bEEF";
export const AMOUNT = 25_000_000n; // 25 test USD

export const sendUserOperation = (rpc: string, bundler: string, world: World) =>
  Effect.gen(function* () {
    const client = chainClient(rpc);
    const balances = Effect.all({
      safe: promise("balanceOf", () => client.readContract({ address: world.token, abi: ABI.token, functionName: "balanceOf", args: [world.safe] })),
      recipient: promise("balanceOf", () => client.readContract({ address: world.token, abi: ABI.token, functionName: "balanceOf", args: [RECIPIENT] })),
      safeEth: promise("getBalance", () => client.getBalance({ address: world.safe })),
      deposit: promise("balanceOf", () => client.readContract({ address: ENTRY_POINT, abi: ABI.entryPoint, functionName: "balanceOf", args: [world.paymaster] })),
    });
    const before = yield* balances;
    const nonce = yield* promise("getNonce", () => client.readContract({ address: ENTRY_POINT, abi: ABI.entryPoint, functionName: "getNonce", args: [world.safe, 0n] }));
    // The bundler's own price for an operation to be included now.
    const price = (yield* call(bundler, "pimlico_getUserOperationGasPrice")) as { fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } };
    const fees = { max: BigInt(price.fast.maxFeePerGas), priority: BigInt(price.fast.maxPriorityFeePerGas) };
    const callData = encodeFunctionData({
      abi: MODULE,
      functionName: "executeUserOp",
      args: [world.token, 0n, encodeFunctionData({ abi: ABI.token, functionName: "transfer", args: [RECIPIENT, AMOUNT] }), 0],
    });
    const packed = {
      sender: world.safe, nonce, initCode: "0x" as Hex, callData,
      accountGasLimits: two128(GAS.verification, GAS.call), preVerificationGas: GAS.preVerification,
      gasFees: two128(fees.priority, fees.max),
      paymasterAndData: concat([world.paymaster, pad(toHex(GAS.pmVerification), { size: 16 }), pad(toHex(GAS.pmPostOp), { size: 16 })]),
      signature: VALIDITY,
    };
    const digest = yield* promise("getOperationHash", () => client.readContract({ address: SAFE.module4337, abi: MODULE, functionName: "getOperationHash", args: [packed] }));
    const signature = concat([VALIDITY, yield* promise("sign", () => privateKeyToAccount(OWNER_KEY).sign({ hash: digest }))]);
    const operation = {
      sender: world.safe, nonce: toHex(nonce), callData, signature,
      callGasLimit: toHex(GAS.call), verificationGasLimit: toHex(GAS.verification), preVerificationGas: toHex(GAS.preVerification),
      maxFeePerGas: toHex(fees.max), maxPriorityFeePerGas: toHex(fees.priority),
      paymaster: world.paymaster, paymasterVerificationGasLimit: toHex(GAS.pmVerification), paymasterPostOpGasLimit: toHex(GAS.pmPostOp), paymasterData: "0x" as Hex,
    };
    const expected = getUserOperationHash({
      chainId: 84532, entryPointAddress: ENTRY_POINT, entryPointVersion: "0.7",
      userOperation: {
        sender: world.safe, nonce, callData, signature, callGasLimit: GAS.call, verificationGasLimit: GAS.verification,
        preVerificationGas: GAS.preVerification, maxFeePerGas: fees.max, maxPriorityFeePerGas: fees.priority,
        paymaster: world.paymaster, paymasterVerificationGasLimit: GAS.pmVerification, paymasterPostOpGasLimit: GAS.pmPostOp, paymasterData: "0x",
      },
    });

    const sentAt = yield* Clock.currentTimeMillis;
    const userOpHash = (yield* call(bundler, "eth_sendUserOperation", [operation, ENTRY_POINT])) as Hex;
    const acceptedMs = (yield* Clock.currentTimeMillis) - sentAt;
    const receipt = (yield* call(bundler, "eth_getUserOperationReceipt", [userOpHash]).pipe(
      Effect.repeat({ while: (found) => found === null, schedule: Schedule.spaced("250 millis") }),
      Effect.timeoutOrElse({ duration: "120 seconds", orElse: () => Effect.fail(new RpcFailed({ method: "eth_getUserOperationReceipt", message: "no receipt in 120 s" })) }),
    )) as {
      success: boolean; actualGasCost: Hex; actualGasUsed: Hex; paymaster: Address; sender: Address; logs: ReadonlyArray<unknown>;
      receipt: { transactionHash: Hex; blockNumber: Hex; from: Address; to: Address; status: Hex };
    };
    const receiptMs = (yield* Clock.currentTimeMillis) - sentAt;
    const after = yield* balances;
    return {
      operation, userOpHash, expectedHashMatches: userOpHash.toLowerCase() === expected.toLowerCase(), acceptedMs, receiptMs,
      // The receipt's fields that say what happened; its logs are counted, not printed.
      receipt: {
        success: receipt.success, sender: receipt.sender, paymaster: receipt.paymaster, actualGasCost: receipt.actualGasCost,
        actualGasUsed: receipt.actualGasUsed, userOpLogs: receipt.logs.length, transactionHash: receipt.receipt.transactionHash,
        blockNumber: receipt.receipt.blockNumber, bundledBy: receipt.receipt.from, to: receipt.receipt.to, status: receipt.receipt.status,
      },
      effect: {
        safeTokenDelta: String(after.safe - before.safe), recipientTokenDelta: String(after.recipient - before.recipient),
        safeEthDelta: String(after.safeEth - before.safeEth), paymasterDepositDelta: String(after.deposit - before.deposit),
      },
    };
  });
