import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createPublicClient, custom, encodeAbiParameters, encodeErrorResult, parseAbi, pad, type Hex, type PublicClient } from "viem";
import { approvalSponsor, carrierSponsor, sponsorHttpTransport, SponsorError, type SponsorConfig, type SponsorshipRequest, type SponsorTransport } from "../src/approvals/sponsorship.ts";
import type { CarrierServices } from "../src/approvals/door.ts";
import type { Approval } from "../src/approvals/types.ts";
import { safeOpDigest, entryPointHash, packCalls, type SafeUserOperation } from "../../sdk/src/approvals/safe-op.ts";

const sender = "0x1111111111111111111111111111111111111111", owner = "0x2222222222222222222222222222222222222222";
const paymaster = "0x3333333333333333333333333333333333333333", module = "0x4444444444444444444444444444444444444444";
const entryPoint = "0x5555555555555555555555555555555555555555", claimOwner = "0x6666666666666666666666666666666666666666";
const multiSend = "0x7777777777777777777777777777777777777777", key = (1n << 191n) + 83n;
const nonce = (key << 64n) + 7n, now = new Date("2026-11-12T12:00:00.100Z");
const after = 1794484861n, until = 1794485100n;
const request: SponsorshipRequest = { chain_id: 84532, sender, calls: [{ to: paymaster, value: "31", data: "0x9876" }, { to: owner, value: "59", data: "0xaabbcc" }], nonce_key: key.toString(), nonce: null, deadline: new Date("2026-11-12T12:05:00.999Z"), send_after: new Date("2026-11-12T12:01:00.001Z") };

function fixture(change: { validation?: bigint; validationResponse?: Hex; owners?: string[]; nextNonce?: bigint; deployed?: boolean; enabled?: boolean; supported?: string; badHash?: boolean; final?: unknown; reject?: unknown } = {}) {
  let finalOp: SafeUserOperation;
  const gateway: SponsorTransport = { async request(method, params) {
    if (change.reject) throw change.reject;
    if (method === "eth_estimateUserOperationGas") return { callGasLimit: "0x101", verificationGasLimit: "0x203", preVerificationGas: "0x307" };
    if (method === "pm_getPaymasterStubData") return { paymaster, paymasterData: "0xdead", paymasterVerificationGasLimit: "0x409", paymasterPostOpGasLimit: "0x503" };
    assert.deepEqual(params[3], { validAfter: `0x${after.toString(16)}`, validUntil: `0x${until.toString(16)}` });
    const rpc = params[0] as Record<string, string>;
    finalOp = { sender: rpc.sender!, nonce: BigInt(rpc.nonce!).toString(), callData: rpc.callData!, paymaster, paymasterData: "0xcafecafe",
      ...Object.fromEntries(["callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"].map(k => [k, BigInt(rpc[k]!).toString()])) } as SafeUserOperation;
    return change.final ?? { paymaster, paymasterData: finalOp.paymasterData };
  } };
  const client = {
    getChainId: async () => 84532, getBlockNumber: async () => 42n,
    getCode: async () => change.deployed === false ? "0x" : "0xabcd",
    getStorageAt: async () => pad(module, { size: 32 }),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 103n, maxPriorityFeePerGas: 17n }),
    readContract: async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "getOwners": return change.owners ?? [owner];
        case "getThreshold": return 1n;
        case "isModuleEnabled": return change.enabled ?? true;
        case "SUPPORTED_ENTRYPOINT": return change.supported ?? entryPoint;
        case "getNonce": return change.nextNonce ?? nonce;
        case "getOperationHash": return change.badHash ? `0x${"00".repeat(32)}` : safeOpDigest(finalOp, { chainId: 84532, module, entryPoint, validAfter: after, validUntil: until });
        case "getUserOpHash": return entryPointHash(finalOp, 84532, entryPoint);
      }
      throw new Error("unexpected read");
    },
    call: async (input: { account: string; to: string; blockNumber: bigint }) => {
      assert.equal(input.account, entryPoint); assert.equal(input.to, paymaster); assert.equal(input.blockNumber, 42n);
      return { data: change.validationResponse ?? encodeAbiParameters([{ type: "bytes" }, { type: "uint256" }], ["0x", change.validation ?? ((after << 208n) | (until << 160n))]) };
    },
  } as unknown as PublicClient;
  const config: SponsorConfig = { client, gateway, module, entryPoint, multiSend, paymaster, claimOwner, now: () => now };
  return { sponsor: approvalSponsor(config), config };
}

test("sponsor returns current owner, full uint256 nonce, exact rounded dates and immutable ordered calls", async () => {
  const { sponsor } = fixture();
  const result = await sponsor(request);
  assert.ok("user_operation" in result);
  assert.equal(result.signer_address, owner);
  assert.equal(result.nonce, nonce.toString());
  assert.equal(result.valid_after.toISOString(), "2026-11-12T12:01:01.000Z");
  assert.equal(result.valid_until.toISOString(), "2026-11-12T12:05:00.000Z");
  assert.equal(result.user_operation.callData, packCalls(request.calls, multiSend));
  assert.deepEqual([result.user_operation.maxFeePerGas, result.user_operation.maxPriorityFeePerGas, result.user_operation.paymasterData], ["103", "17", "0xcafecafe"]);
  assert.notEqual(result.digest, result.user_op_hash);
  assert.equal((await sponsor({ ...request, nonce: nonce.toString() }) as { nonce: string }).nonce, nonce.toString());
  const mixedCaseOwner = `0x${"aBcDeF".repeat(6)}aBcD`;
  const normalized = await fixture({ owners: [mixedCaseOwner] }).sponsor(request);
  assert.ok("signer_address" in normalized);
  assert.equal(normalized.signer_address, mixedCaseOwner.toLowerCase());
});

test("sponsor uses the canonical world clock for its start and completion expiry", async () => {
  const { config } = fixture();
  const input = { ...request, send_after: null };
  const frozenNow = () => request.send_after!;
  const result = await approvalSponsor({ ...config, now: frozenNow })(input);
  assert.ok("user_operation" in result);
  assert.equal(result.valid_after.toISOString(), "2026-11-12T12:01:01.000Z");
  let reads = 0;
  const expired = await approvalSponsor({ ...config, now: () => ++reads === 1 ? frozenNow() : request.deadline })(input);
  assert.deepEqual(expired, { code: "WRONG_STATE", reason: "Approval expired during sponsorship" });
  // The same deadline already reached before sponsorship is the same state; a window empty by its own dates is input.
  assert.deepEqual(await approvalSponsor({ ...config, now: () => request.deadline })(input), { code: "WRONG_STATE", reason: "Approval expired before sponsorship" });
  assert.deepEqual(await approvalSponsor({ ...config, now: frozenNow })({ ...request, send_after: request.deadline }), { code: "INVALID_INPUT", reason: "Approval window is empty" });
});

test("sponsor refuses absent/claim-owned accounts, wrong modules/hashes, consumed or foreign nonce lanes", async () => {
  for (const [change, code] of [
    [{ deployed: false }, "SMART_ACCOUNT_MISSING"], [{ owners: [claimOwner] }, "SMART_ACCOUNT_MISSING"],
    [{ owners: [owner, claimOwner] }, "SMART_ACCOUNT_MISSING"], [{ enabled: false }, "PROVIDER_RESPONSE_INVALID"],
    [{ supported: module }, "PROVIDER_RESPONSE_INVALID"], [{ badHash: true }, "PROVIDER_RESPONSE_INVALID"],
    [{ nextNonce: ((key - 1n) << 64n) + 7n }, "WRONG_STATE"],
  ] as const) {
    const result = await fixture(change as Parameters<typeof fixture>[0]).sponsor(request);
    assert.ok("code" in result); assert.equal(result.code, code);
  }
  const result = await fixture().sponsor({ ...request, nonce: (nonce - 1n).toString() });
  assert.ok("code" in result); assert.equal(result.code, "WRONG_STATE");
});

test("sponsor refuses always-valid mocks, invalid signatures, narrowed/broadened windows and malformed final data", async () => {
  const malformed = await fixture({ validationResponse: "0xabcd" }).sponsor(request);
  assert.ok("code" in malformed); assert.equal(malformed.code, "PROVIDER_RESPONSE_INVALID");
  for (const validation of [0n, (after << 208n) | (until << 160n) | 1n, ((after - 1n) << 208n) | (until << 160n), (after << 208n) | ((until + 1n) << 160n), ((after + 1n) << 208n) | (until << 160n)]) {
    const result = await fixture({ validation }).sponsor(request);
    assert.ok("code" in result); assert.equal(result.code, "PROVIDER_RESPONSE_INVALID");
  }
  for (const final of [{ paymaster, paymasterData: "0x" }, { paymaster: owner, paymasterData: "0xaabb" }, { paymaster }, { paymaster, paymasterData: "0xz" }, { paymaster: "invalid", paymasterData: "0xab" }]) {
    const result = await fixture({ final }).sponsor(request);
    assert.ok("code" in result); assert.equal(result.code, "PROVIDER_RESPONSE_INVALID");
  }
  await assert.rejects(fixture({ reject: new SponsorError("PROVIDER_ERROR", "unavailable") }).sponsor(request), { code: "PROVIDER_ERROR" });
});

test("actual sponsor HTTP preserves custom-revert codes without leaking gateway text", async () => {
  const abi = parseAbi(["error OverBudget(uint256 id,uint128 left,uint128 requested)", "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)", "error ConditionViolation(uint8 status,bytes32 info)", "error ChildrenExceedParent(uint256 id,uint128 left,uint128 requested)", "error AmountBelowUse(uint256 id,uint128 used,uint128 requested)", "error BudgetIsClosed(uint256 id)", "error NoMembership()", "error FailedOpWithRevert(uint256 opIndex,string reason,bytes inner)"]);
  let data: Hex = "0x12345678", errorCode = -32500, raw: string | null = null;
  const server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(raw ?? JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: errorCode, message: "secret gateway URL/credential", data: { revertData: data } } })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const gateway = sponsorHttpTransport(`http://127.0.0.1:${port}`);
    const cases: [Hex, string][] = [
      [encodeErrorResult({ abi, errorName: "OverBudget", args: [3n, 7n, 11n] }), "PAYROLL_BUDGET_EXCEEDED"],
      [encodeErrorResult({ abi, errorName: "ERC20InsufficientBalance", args: [sender, 7n, 11n] }), "INSUFFICIENT_BALANCE"],
      [encodeErrorResult({ abi, errorName: "ChildrenExceedParent", args: [3n, 7n, 11n] }), "CHILDREN_EXCEED_PARENT"],
      [encodeErrorResult({ abi, errorName: "AmountBelowUse", args: [3n, 7n, 11n] }), "AMOUNT_BELOW_USE"],
      [encodeErrorResult({ abi, errorName: "BudgetIsClosed", args: [3n] }), "WRONG_STATE"],
      [encodeErrorResult({ abi, errorName: "NoMembership" }), "ROLE_PERMISSION_DENIED"],
      [encodeErrorResult({ abi, errorName: "ConditionViolation", args: [17, pad("0x", { size: 32 })] }), "PAYROLL_BUDGET_EXCEEDED"],
      [encodeErrorResult({ abi, errorName: "ConditionViolation", args: [16, pad("0x", { size: 32 })] }), "ROLE_PERMISSION_DENIED"],
      [encodeErrorResult({ abi, errorName: "FailedOpWithRevert", args: [0n, "AA33 reverted", encodeErrorResult({ abi, errorName: "OverBudget", args: [3n, 7n, 11n] })] }), "PAYROLL_BUDGET_EXCEEDED"],
      ["0x12345678", "TRANSACTION_FAILED"],
      // decodeErrorResult always knows Error(string) and Panic; neither is an authority refusal.
      [encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["Sender not EntryPoint"] }), "TRANSACTION_FAILED"],
      [encodeErrorResult({ abi: parseAbi(["error Panic(uint256)"]), errorName: "Panic", args: [0x11n] }), "TRANSACTION_FAILED"],
      ["0x", "TRANSACTION_FAILED"],
    ];
    for (const [revert, code] of cases) {
      data = revert;
      const { config } = fixture();
      const result = await approvalSponsor({ ...config, gateway })(request);
      assert.ok("code" in result); assert.equal(result.code, code, revert); assert.doesNotMatch(result.reason, /secret|credential|URL/);
    }
    data = "0x"; errorCode = 3;
    const noData = await approvalSponsor({ ...fixture().config, gateway })(request);
    assert.ok("code" in noData); assert.equal(noData.code, "TRANSACTION_FAILED", "execution reverted without data is final");
    errorCode = -32504;
    await assert.rejects(approvalSponsor({ ...fixture().config, gateway })(request), { code: "PROVIDER_ERROR" }, "a throttled or banned entity is retried");
    raw = '{"jsonrpc":"2.0","id":1,"res';
    await assert.rejects(approvalSponsor({ ...fixture().config, gateway })(request), { code: "PROVIDER_ERROR" }, "a truncated 200 body is retried");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("carrier sponsor maps the approval row and windows it on one reading of the world clock, never host time", async () => {
  const { config } = fixture();
  const { now: _hostless, ...deployment } = config;
  let readings = 0;
  // The world clock is a day behind host time, which is already past the deadline.
  assert.ok(Date.now() > request.deadline.getTime());
  const sponsor: CarrierServices["sponsor"] = carrierSponsor(deployment, async () => { readings++; return now; });
  const row = { ...request, approval_id: "approval-1", person_id: "person-1", state: "sponsoring" } as unknown as Approval;
  const result = await sponsor(row);
  assert.ok("user_operation" in result, JSON.stringify(result));
  assert.equal(readings, 1);
  assert.equal(result.nonce, nonce.toString());
  assert.equal(result.valid_after?.toISOString(), "2026-11-12T12:01:01.000Z");
  assert.equal(result.valid_until.toISOString(), "2026-11-12T12:05:00.000Z");
  assert.equal(result.user_operation.callData, packCalls(request.calls, multiSend));
});

test("chain reverts from viem reads are final refusals; only an outage is retried", async () => {
  const errorAbi = parseAbi(["error Error(string)", "error NoMembership()"]);
  const notEntryPoint = encodeErrorResult({ abi: errorAbi, errorName: "Error", args: ["Sender not EntryPoint"] });
  const cases: [string, () => unknown, string | null][] = [
    ["revert without data (sender is not a Safe)", () => { throw { code: 3, message: "execution reverted" }; }, "TRANSACTION_FAILED"],
    ["empty return data", () => "0x", "TRANSACTION_FAILED"],
    ["Error(string)", () => { throw { code: 3, message: "execution reverted", data: notEntryPoint }; }, "TRANSACTION_FAILED"],
    ["Roles NoMembership", () => { throw { code: 3, message: "execution reverted", data: encodeErrorResult({ abi: errorAbi, errorName: "NoMembership" }) }; }, "ROLE_PERMISSION_DENIED"],
    ["node outage", () => { throw new Error("socket hang up"); }, null],
    // viem wraps these node failures in ContractFunctionRevertedError too; they are outages, not reverts.
    ["node internal error -32603", () => { throw { code: -32603, message: "Internal error" }; }, null],
    ["node header not found", () => { throw { code: -32000, message: "header not found" }; }, null],
    ["node gas cap", () => { throw { code: -32000, message: "gas required exceeds allowance (30000000)" }; }, null],
  ];
  for (const [name, answer, code] of cases) {
    const chain = createPublicClient({ transport: custom({ async request({ method }) { if (method === "eth_call") return answer(); throw new Error(`unexpected ${method}`); } }, { retryCount: 0 }), cacheTime: 0 });
    const { config } = fixture();
    const fake = config.client as unknown as { readContract(x: { functionName: string }): Promise<unknown> };
    const client = { ...fake, readContract: (x: { functionName: string }) => x.functionName === "getOwners"
      ? chain.readContract({ address: sender, abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners" }) : fake.readContract(x) } as unknown as PublicClient;
    const sponsor = approvalSponsor({ ...config, client });
    if (code === null) { await assert.rejects(sponsor(request), { code: "PROVIDER_ERROR" }, name); continue; }
    const result = await sponsor(request);
    assert.ok("code" in result, name); assert.equal(result.code, code, name);
  }
});
