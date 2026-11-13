// What a test world needs on its chain before the bundler can carry a sponsored UserOperation, made in one pass:
//   - the test paymaster (MockPaymaster against the seeded EntryPoint v0.7), with 1 ETH deposited at the EntryPoint
//   - a test token (MockERC20 "Test USD", 6 decimals)
//   - a Safe owned by one test key, created through the seeded Safe proxy factory with the seeded Safe4337Module as
//     its module and fallback handler (exactly what a personal Safe is), holding 1,000 test USD
//   - the bundler's executor and utility accounts, given 10 ETH each by anvil_setBalance (the chain's faucet)
import * as Effect from "effect/Effect";
import { concat, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compile } from "./contracts.ts";
import { BUNDLER_KEYS, ENTRY_POINT } from "../src/bundler/Keys.ts";
import { call, chainClient, promise, sendFromFunder } from "./rpc.ts";

export { ENTRY_POINT } from "../src/bundler/Keys.ts";
/** The seeded Safe contracts, at the addresses Base Sepolia has them (packages/contracts/state). */
export const SAFE = {
  factory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  singleton: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  module4337: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  moduleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
} as const satisfies Record<string, Address>;

/** A key made for this proof only. It owns a Safe on a disposable chain and nothing else. */
export const OWNER_KEY: Hex = keccak256(toBytes("capxul spike bundler: the Safe's test owner"));
export const ABI = {
  paymaster: parseAbi(["function deposit() payable", "function entryPoint() view returns (address)"]),
  entryPoint: parseAbi(["function balanceOf(address) view returns (uint256)", "function getNonce(address,uint192) view returns (uint256)"]),
  token: parseAbi(["function mint(address,uint256)", "function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]),
  safe: parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
    "function getOwners() view returns (address[])",
    "function isModuleEnabled(address) view returns (bool)",
  ]),
  factory: parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address)"]),
  moduleSetup: parseAbi(["function enableModules(address[] modules)"]),
} as const;

export interface World {
  readonly paymaster: Address;
  readonly token: Address;
  readonly safe: Address;
  readonly owner: Address;
}

const created = (receipt: { readonly contractAddress?: Address | null | undefined }) => receipt.contractAddress as Address;

export const setup = (rpc: string) =>
  Effect.gen(function* () {
    const client = chainClient(rpc);
    const code = yield* compile;
    const owner = privateKeyToAccount(OWNER_KEY).address;

    const paymaster = created(
      yield* sendFromFunder(rpc, { data: concat([code.MockPaymaster, encodeAbiParameters([{ type: "address" }], [ENTRY_POINT])]) }),
    );
    yield* sendFromFunder(rpc, { to: paymaster, data: encodeFunctionData({ abi: ABI.paymaster, functionName: "deposit" }), value: 10n ** 18n });

    const tokenArgs = encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint8" }], ["Test USD", "tUSD", 6]);
    const token = created(yield* sendFromFunder(rpc, { data: concat([code.MockERC20, tokenArgs]) }));

    const initializer = encodeFunctionData({
      abi: ABI.safe,
      functionName: "setup",
      args: [
        [owner], 1n, SAFE.moduleSetup,
        encodeFunctionData({ abi: ABI.moduleSetup, functionName: "enableModules", args: [[SAFE.module4337]] }),
        SAFE.module4337, "0x0000000000000000000000000000000000000000", 0n, "0x0000000000000000000000000000000000000000",
      ],
    });
    const create = encodeFunctionData({ abi: ABI.factory, functionName: "createProxyWithNonce", args: [SAFE.singleton, initializer, 4337n] });
    const safe = yield* promise("eth_call", () =>
      client.simulateContract({ address: SAFE.factory, abi: ABI.factory, functionName: "createProxyWithNonce", args: [SAFE.singleton, initializer, 4337n], account: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }),
    ).pipe(Effect.map((simulated) => simulated.result));
    yield* sendFromFunder(rpc, { to: SAFE.factory, data: create });
    yield* sendFromFunder(rpc, { to: token, data: encodeFunctionData({ abi: ABI.token, functionName: "mint", args: [safe, 1_000_000_000n] }) });

    for (const key of Object.values(BUNDLER_KEYS)) {
      yield* call(rpc, "anvil_setBalance", [privateKeyToAccount(key).address, "0x8ac7230489e80000"]);
    }

    const read = <A>(what: string, run: () => Promise<A>) => promise(what, run);
    const check = yield* Effect.all({
      safeOwners: read("getOwners", () => client.readContract({ address: safe, abi: ABI.safe, functionName: "getOwners" })),
      module4337Enabled: read("isModuleEnabled", () => client.readContract({ address: safe, abi: ABI.safe, functionName: "isModuleEnabled", args: [SAFE.module4337] })),
      paymasterEntryPoint: read("entryPoint", () => client.readContract({ address: paymaster, abi: ABI.paymaster, functionName: "entryPoint" })),
      paymasterDepositWei: read("balanceOf", () => client.readContract({ address: ENTRY_POINT, abi: ABI.entryPoint, functionName: "balanceOf", args: [paymaster] })).pipe(Effect.map(String)),
      safeTokenBalance: read("balanceOf", () => client.readContract({ address: token, abi: ABI.token, functionName: "balanceOf", args: [safe] })).pipe(Effect.map(String)),
      executorWei: read("getBalance", () => client.getBalance({ address: privateKeyToAccount(BUNDLER_KEYS.executor).address })).pipe(Effect.map(String)),
    });
    const world: World = { paymaster, token, safe, owner };
    return { world, check };
  });
