// Safe transactions as Core builds them: a batch of plain calls (MultiSendCallOnly), the EIP-712 hash a Safe's owners
// approve, the digest a Director's own Safe signs for it (EIP-1271: the Safe4337Module is every personal Safe's
// fallback handler, and answers `isValidSignature` as Safe's compatibility handler does), the signatures a company
// Safe's `execTransaction` takes, and the relayer that carries a signed company transaction to the chain as one
// sponsored UserOperation.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import {
  concat,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  type Hex,
  hashTypedData,
  keccak256,
  pad,
  size,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SAFE, SAFE_MODULE_SETUP, SAFE_PROXY_FACTORY, MULTI_SEND } from "./abi.ts";
import { hexOf, sendAsService } from "./calls.ts";
import { ChainFailed } from "./failures.ts";
import { CHAIN_ID, RELAYER_SALT, SEEDED, SERVICE_KEY } from "./seeded.ts";
import { nonceKeyOf, prepare, send } from "./userop.ts";
import { WorldChain } from "./WorldChain.ts";

/** One call of a batch: to, value and data. */
export interface Call {
  readonly to: string;
  readonly value?: bigint;
  readonly data: Hex;
}

const hex = (text: string): Hex => (text.startsWith("0x") ? (text as Hex) : "0x");

/** MultiSendCallOnly's `multiSend` of `calls`, each a plain call: run by DELEGATECALL from the Safe that sends it. */
export const multiSend = (calls: ReadonlyArray<Call>): Hex =>
  encodeFunctionData({
    abi: MULTI_SEND,
    functionName: "multiSend",
    args: [
      concat(
        Arr.map(calls, (call) =>
          encodePacked(
            ["uint8", "address", "uint256", "uint256", "bytes"],
            [0, hex(call.to), call.value ?? 0n, BigInt(size(call.data)), call.data],
          ),
        ),
      ),
    ],
  });

/** A Safe transaction with no gas refund: what a company's proposal is. */
export interface SafeTransaction {
  readonly safe: string;
  readonly to: string;
  readonly data: Hex;
  readonly operation: 0 | 1;
  readonly nonce: bigint;
}

/** The EIP-712 hash of a Safe transaction (Safe 1.3 and later), which its owners approve. */
export const safeTxHash = (tx: SafeTransaction): Hex =>
  hashTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: hex(tx.safe) },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: hex(tx.to),
      value: 0n,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: tx.nonce,
    },
  });

/**
 * What a Director signs, with their own key, to approve `hash` as their Safe `owner`: that Safe's message hash of it
 * (EIP-712 `SafeMessage`, the domain the owner's Safe). The Safe then answers `isValidSignature(hash, signature)`.
 */
export const safeMessageDigest = (owner: string, hash: Hex): Hex =>
  hashTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: hex(owner) },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "SafeMessage",
    message: { message: hash },
  });

/** The approval of a Safe whose owner is the transaction's sender: Safe's "approved by msg.sender" (v = 1). */
export const approvedBySender = (owner: string): Hex => concat([pad(hex(owner), { size: 32 }), pad("0x", { size: 32 }), "0x01"]);

/**
 * The signatures of contract owners (v = 0), in the order Safe requires (ascending owner): each owner's static part
 * points at its signature, which follows all the static parts.
 */
export const contractSignatures = (signed: ReadonlyArray<{ readonly owner: string; readonly signature: Hex }>): Hex => {
  const sorted = Arr.sort(signed, Order.mapInput(Order.BigInt, (each: { readonly owner: string }) => BigInt(each.owner)));
  const statics: Array<Hex> = [];
  const dynamics: Array<Hex> = [];
  let offset = 65n * BigInt(sorted.length);
  for (const each of sorted) {
    statics.push(concat([pad(hex(each.owner), { size: 32 }), pad(toHex(offset), { size: 32 }), "0x00"]));
    const part = concat([pad(toHex(BigInt(size(each.signature))), { size: 32 }), each.signature]);
    dynamics.push(part);
    offset += BigInt(size(part));
  }
  return concat([...statics, ...dynamics]);
};

/** `execTransaction` of `tx` with `signatures`. */
export const execTransaction = (tx: SafeTransaction, signatures: Hex): Hex =>
  encodeFunctionData({
    abi: SAFE,
    functionName: "execTransaction",
    args: [hex(tx.to), 0n, tx.data, tx.operation, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures],
  });

// The relayer: a Safe owned by the service key, with the Safe4337Module, as a personal Safe is.
const relayerKey = privateKeyToAccount(SERVICE_KEY);
const relayerSetup = encodeFunctionData({
  abi: SAFE,
  functionName: "setup",
  args: [
    [relayerKey.address],
    1n,
    SEEDED.safeModuleSetup,
    encodeFunctionData({ abi: SAFE_MODULE_SETUP, functionName: "enableModules", args: [[SEEDED.safe4337Module]] }),
    SEEDED.safe4337Module,
    zeroAddress,
    0n,
    zeroAddress,
  ],
});
const createRelayer = encodeFunctionData({
  abi: SAFE_PROXY_FACTORY,
  functionName: "createProxyWithNonce",
  args: [SEEDED.safeSingleton, relayerSetup, RELAYER_SALT],
});
/** Safe 1.4.1's proxy creation code, as the seeded factory has it (CompanySafeMinter's `_proxyCreationCode`). */
const PROXY_CREATION_CODE: Hex =
  "0x608060405234801561001057600080fd5b506040516101b63803806101b68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101946022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050607b806101196000396000f3fe608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd036ce65611101d072e964736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";

/** The relayer's address: the same in every world. */
export const RELAYER = getContractAddress({
  opcode: "CREATE2",
  from: SEEDED.safeProxyFactory,
  salt: keccak256(concat([keccak256(relayerSetup), pad(toHex(RELAYER_SALT), { size: 32 })])),
  bytecode: concat([PROXY_CREATION_CODE, pad(SEEDED.safeSingleton, { size: 32 })]),
});

/** Makes the relayer the first time a world needs it. The seed's EntryPoint has no SenderCreator, so no initCode. */
const ensureRelayer = Effect.gen(function* () {
  const chain = yield* WorldChain;
  const code = yield* hexOf("eth_getCode", yield* chain.rpc("eth_getCode", [RELAYER, "latest"]));
  if (code !== "0x") return;
  yield* sendAsService(SEEDED.safeProxyFactory, createRelayer, 1_000_000n);
  const made = yield* hexOf("eth_getCode", yield* chain.rpc("eth_getCode", [RELAYER, "latest"]));
  if (made === "0x")
    return yield* ChainFailed.make({ reach: "answer", method: "eth_getCode", message: `the relayer is not at ${RELAYER}` });
});

/**
 * Carries a company Safe's signed transaction to the chain: one UserOperation from the relayer that calls the
 * company Safe's `execTransaction`, signed by the service key and sponsored by the paymaster.
 */
export const relay = Effect.fn("userop.relay")(function* (tx: SafeTransaction, signatures: Hex, name: string) {
  yield* ensureRelayer;
  const op = yield* prepare({
    sender: RELAYER,
    to: tx.safe,
    data: execTransaction(tx, signatures),
    operation: 0,
    nonceKey: nonceKeyOf(name),
    callGas: 1_500_000n,
  });
  const signature = yield* Effect.tryPromise({
    try: () => relayerKey.sign({ hash: hex(op.digest) }),
    catch: (cause) => ChainFailed.make({ reach: "answer", method: "eth_sendUserOperation", message: `signing: ${String(cause)}` }),
  });
  return yield* send(op, signature);
});
