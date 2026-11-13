import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, decodeAbiParameters, keccak256, encodeAbiParameters, concat, stringToHex, type Hex } from "viem";
import { packCalls, packUserOperation, safeOpDigest, entryPointHash, toRpcUserOperation, verifySafeOp, ENTRY_POINT_07_ADDRESS, SAFE_4337_MODULE, type SafeUserOperation } from "./safe-op.ts";
import { SAFE_4337_EXECUTE_USER_OP_ABI, multiSendAbi, MULTI_SEND_CALL_ONLY } from "../shared/protocol/evm/safe-contracts.ts";

const safe = "0x1111111111111111111111111111111111111111", paymaster = "0x2222222222222222222222222222222222222222";
const calls = [{ to: paymaster, value: "17", data: "0x123456" }, { to: safe, value: "29", data: "0xab" }];
const key = (1n << 190n) + 51n, nonce = ((key << 64n) + 37n).toString();
const domain = { chainId: 84532, module: SAFE_4337_MODULE, entryPoint: ENTRY_POINT_07_ADDRESS, validAfter: 1700000001n, validUntil: 1700000437n } as const;
const op: SafeUserOperation = { sender: safe, nonce, callData: packCalls(calls), callGasLimit: "101", verificationGasLimit: "203", preVerificationGas: "307", maxFeePerGas: "409", maxPriorityFeePerGas: "13", paymaster, paymasterVerificationGasLimit: "503", paymasterPostOpGasLimit: "607", paymasterData: "0xabcdee" };

test("ordered calls preserve each destination, value and bytes with CALL-only inner operations", () => {
  const single = decodeFunctionData({ abi: SAFE_4337_EXECUTE_USER_OP_ABI, data: packCalls([calls[0]!]) });
  assert.deepEqual(single.args, [paymaster, 17n, "0x123456", 0]);
  const outer = decodeFunctionData({ abi: SAFE_4337_EXECUTE_USER_OP_ABI, data: op.callData as Hex });
  assert.deepEqual([outer.args[0].toLowerCase(), outer.args[1], outer.args[3]], [MULTI_SEND_CALL_ONLY.toLowerCase(), 0n, 1]);
  const batch = decodeFunctionData({ abi: multiSendAbi, data: outer.args[2] }).args[0].slice(2);
  let offset = 0;
  for (const c of calls) {
    assert.equal(batch.slice(offset, offset += 2), "00");
    assert.equal(`0x${batch.slice(offset, offset += 40)}`, c.to);
    assert.equal(BigInt(`0x${batch.slice(offset, offset += 64)}`), BigInt(c.value));
    const length = Number(BigInt(`0x${batch.slice(offset, offset += 64)}`));
    assert.equal(`0x${batch.slice(offset, offset += length * 2)}`, c.data);
  }
  assert.equal(offset, batch.length);
});

test("SafeOp digest agrees with independently encoded v0.3.0 contract struct; domains and windows differ", () => {
  const packed = packUserOperation(op, domain.validAfter, domain.validUntil);
  const structTypes = ["bytes32", "address", "uint256", "bytes32", "bytes32", "uint128", "uint128", "uint256", "uint128", "uint128", "bytes32", "uint48", "uint48", "address"].map(type => ({ type }));
  const struct = keccak256(encodeAbiParameters(structTypes, [
    "0xc03dfc11d8b10bf9cf703d558958c8c42777f785d998c62060d85a4f0ef6ea7f", safe, BigInt(nonce), keccak256("0x"), keccak256(op.callData as Hex),
    203n, 101n, 307n, 13n, 409n, keccak256(packed.paymasterAndData), domain.validAfter, domain.validUntil, ENTRY_POINT_07_ADDRESS,
  ]));
  const separator = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(stringToHex("EIP712Domain(uint256 chainId,address verifyingContract)")), 84532n, SAFE_4337_MODULE]));
  assert.equal(safeOpDigest(op, domain), keccak256(concat(["0x1901", separator, struct])));
  assert.notEqual(safeOpDigest(op, domain), safeOpDigest(op, { ...domain, validUntil: domain.validUntil - 1n }));
  assert.notEqual(safeOpDigest(op, domain), safeOpDigest(op, { ...domain, chainId: 1 }));
  assert.notEqual(safeOpDigest(op, domain), entryPointHash(op, domain.chainId));
  assert.equal(packed.nonce.toString(), nonce);
  assert.equal(BigInt(toRpcUserOperation(op, domain.validAfter, domain.validUntil).nonce).toString(), nonce);
  assert.deepEqual(decodeAbiParameters([{ type: "uint128" }], `0x${packed.accountGasLimits.slice(2, 34).padStart(64, "0")}`), [203n]);
});

test("independent signer verifier refuses changed intent, hash, nonce lane and unbounded windows", () => {
  const check = { op, calls, sender: safe, nonceKey: key.toString(), nonce, deadline: new Date(Number(domain.validUntil) * 1000), sendAfter: new Date(Number(domain.validAfter) * 1000), digest: safeOpDigest(op, domain), userOpHash: entryPointHash(op, domain.chainId), domain };
  assert.equal(verifySafeOp(check), true);
  assert.equal(verifySafeOp({ ...check, deadline: new Date(Number(domain.validUntil) * 1000 - 1) }), false);
  assert.equal(verifySafeOp({ ...check, sendAfter: new Date(Number(domain.validAfter) * 1000 + 1) }), false);
  assert.equal(verifySafeOp({ ...check, calls: [...calls].reverse() }), false);
  assert.equal(verifySafeOp({ ...check, sender: paymaster }), false);
  assert.equal(verifySafeOp({ ...check, nonceKey: (key - 1n).toString() }), false);
  assert.equal(verifySafeOp({ ...check, nonce: (BigInt(nonce) + 1n).toString() }), false);
  assert.equal(verifySafeOp({ ...check, digest: check.userOpHash }), false);
  assert.equal(verifySafeOp({ ...check, domain: { ...domain, validUntil: 0n } }), false);
  assert.throws(() => packUserOperation({ ...op, callGasLimit: (1n << 128n).toString() }, 1n, 2n), /overflow/);
  assert.throws(() => packUserOperation({ ...op, nonce: "01" }, 1n, 2n), /decimal/);
  const signed = packUserOperation(op, domain.validAfter, domain.validUntil, `0x${"11".repeat(65)}`);
  assert.equal(signed.signature.length, 2 + (12 + 65) * 2);
  assert.equal(signed.signature.slice(2, 26), "00006553f10100006553f2b5");
});
