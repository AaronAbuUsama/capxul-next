import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { PublicClient } from "viem";
import { carrierChain, worldChainConfig } from "../src/approvals/door.ts";
import type { Approval } from "../src/approvals/types.ts";
import type { RpcTransport } from "../src/shared/door.ts";
import { ENTRY_POINT_07_ADDRESS, validitySignature } from "../../sdk/src/approvals/safe-op.ts";

const record = JSON.parse(readFileSync(fileURLToPath(new URL("../../contracts/deployments/devnet.json", import.meta.url)), "utf8"));
// The shape devnet world create writes to <stateDir>/deployment.json, copied from the trusted record.
const deploymentFile = join(mkdtempSync(join(tmpdir(), "carrier-chain-")), "deployment.json");
writeFileSync(deploymentFile, JSON.stringify({ chainId: record.chainId, companiesHouse: record.companiesHouse, installer: record.contracts.Installer.address }));
const address = (byte: string) => `0x${byte.repeat(20)}` as `0x${string}`;
const paymaster = address("34"), token = address("56"), holder = address("78");
const signature = `0x${"9a".repeat(65)}`, hash = `0x${"cd".repeat(32)}`;
const reads: { functionName: string; args: readonly unknown[] }[] = [];
const client = { readContract: async (input: { functionName: string; args: readonly unknown[] }) => {
  reads.push(input);
  return input.functionName === "getNonce" ? (5n << 64n) + 9n : 100n;
} } as unknown as PublicClient;
const approval = (patch: Partial<Approval> = {}) => ({
  sender: `0x${"12".repeat(20)}`, nonce_key: "5", gate: null, needs: [], user_op_hash: hash, signature,
  valid_after: new Date("2026-11-12T12:01:01Z"), valid_until: new Date("2026-11-12T12:05:00Z"),
  user_operation: { sender: `0x${"12".repeat(20)}`, nonce: ((5n << 64n) + 9n).toString(), callData: "0x1234", callGasLimit: "256",
    verificationGasLimit: "512", preVerificationGas: "768", maxFeePerGas: "5", maxPriorityFeePerGas: "2", paymaster,
    paymasterVerificationGasLimit: "16", paymasterPostOpGasLimit: "32", paymasterData: "0xcafe" },
  ...patch,
}) as unknown as Approval;

test("world config takes Companies House as the claim owner and refuses another world's deployment", () => {
  const base = { deploymentFile, chainId: record.chainId, entryPoint: ENTRY_POINT_07_ADDRESS, paymaster };
  const config = worldChainConfig(base, { client, gatewayUrl: "http://gateway.test" });
  assert.equal(config.claimOwner, record.companiesHouse.toLowerCase());
  assert.notEqual(config.claimOwner, record.contracts.CompaniesHouseClaimer.address.toLowerCase());
  assert.throws(() => worldChainConfig({ ...base, chainId: 1 }, { client, gatewayUrl: "x" }), /WORLD_DEPLOYMENT/);
  assert.throws(() => worldChainConfig({ ...base, entryPoint: paymaster }, { client, gatewayUrl: "x" }), /WORLD_DEPLOYMENT/);
});

test("send packs the signed window before the owner's signature and expects the signed hash", async () => {
  const sent: unknown[][] = [];
  const bundlerTransport: RpcTransport = { async request(method, params) { sent.push([method, ...params]); return hash; } };
  const chain = carrierChain({ client, gatewayUrl: "http://gateway.test", paymaster, claimOwner: holder, bundlerTransport })(async () => new Date());
  assert.deepEqual(await chain.send(approval()), { hash });
  const [method, op, entryPoint] = sent[0] as [string, { signature: string; nonce: string }, string];
  assert.equal(method, "eth_sendUserOperation"); assert.equal(entryPoint, ENTRY_POINT_07_ADDRESS);
  assert.equal(op.signature, validitySignature(1794484861n, 1794485100n, signature as `0x${string}`));
  assert.equal(BigInt(op.nonce), (5n << 64n) + 9n);
});

test("nonce reads the approval's own key; a gated operation fails closed; needs compare live balances", async () => {
  const chain = carrierChain({ client, gatewayUrl: "x", paymaster, claimOwner: holder })(async () => new Date());
  reads.length = 0;
  assert.equal(await chain.nonce(approval()), ((5n << 64n) + 9n).toString());
  assert.deepEqual(reads[0]!.args, [`0x${"12".repeat(20)}`, 5n]);
  reads.length = 0;
  assert.equal(await chain.needsAndGate(approval({ gate: "payments" })), false);
  assert.equal(reads.length, 0);
  assert.equal(await chain.needsAndGate(approval({ needs: [{ token, holder, amount: "100" }] })), true);
  assert.equal(await chain.needsAndGate(approval({ needs: [{ token, holder, amount: "100" }, { token, holder, amount: "101" }] })), false);
});
