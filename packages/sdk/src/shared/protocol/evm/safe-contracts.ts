import type { Address, Hex } from "viem";

export const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Safe 1.5.0's SafeProxyFactory: every Capxul Safe is created through it. The
 * same address on Base Sepolia and Arbitrum One (safe-deployments v1.5.0,
 * canonical). It is part of every Safe's CREATE2 address.
 */
export const SAFE_PROXY_FACTORY = "0x14F2982D601c9458F93bd70B218933A6f8165e7b";

/**
 * Safe 1.4.1's SafeProxyFactory. Capxul Safes created before the move to 1.5.0
 * (2 Nov 2026) came from it, so the indexer still watches it. Never create a
 * Safe through it.
 */
export const SAFE_PROXY_FACTORY_V141 = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";

/** Every factory whose Safes the indexer discovers: the current one first. */
export const SAFE_PROXY_FACTORIES = [SAFE_PROXY_FACTORY, SAFE_PROXY_FACTORY_V141] as const;

/** Lower bound for Safe factory discovery. */
export const SAFE_INDEXING_START_BLOCK = 39_860_173;

/** Safe 1.5.0's SafeL2 singleton: the code every Capxul Safe runs. */
export const SAFE_L2_SINGLETON = "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e";

export const SAFE_MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

/** Canonical ERC-4337 EntryPoint v0.7 address (same on every chain). */
export const ENTRY_POINT_07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export const SAFE_4337_MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";

export const MULTI_SEND = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";

/**
 * Safe's SignMessageLib v1.4.1: delegate-called, it marks a message signed by
 * the Safe itself, so `isValidSignature` (EIP-1271) answers for it. The same
 * bytecode is at this address on Base Sepolia, Arbitrum Sepolia and Arbitrum One.
 */
export const SIGN_MESSAGE_LIB = "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9";

/**
 * Canonical personal-Safe salt namespace. The derivation algorithm is still
 * v2 (PRD #462, email-only — see below); this namespace STRING was bumped to
 * `capxul:staging:email:v2` for D6 to abandon the previous staging generation.
 * The earlier `capxul:staging:email:v1` generation abandoned a Base Sepolia
 * address range with stale on-chain owners (pre-existing deployments outside
 * Convex's claim bookkeeping) that were blocking QA re-claims. Pre-launch,
 * zero real users, so a global bump was cheap; prod will mint its own
 * namespace at launch. Do not read "v3" as a derivation-version event — that
 * label stays reserved for an actual `CAPXUL_BOOTSTRAP_OWNER` change.
 * v2 derives the address from the email ONLY: the initializer's sole owner is
 * the fixed `CAPXUL_BOOTSTRAP_OWNER`, so the address exists before any user
 * signer does and can never rotate with one. The user's signer is installed
 * at claim time via `swapOwner` (see `capxulClaimOwnerCallData`).
 */
export const CAPXUL_SAFE_SALT_NAMESPACE = "capxul:staging:email:v2";

/**
 * A deployment's personal-Safe salt namespace (ADR-0044, CAP-995): one per
 * environment and epoch, so tiers that share a chain never share a Safe for
 * the same email, and a reset starts a new epoch. Staging and the devnet use
 * `CAPXUL_SAFE_SALT_NAMESPACE`; beta's first epoch is `capxul:beta:email:v1`.
 */
export const CAPXUL_SAFE_SALT_NAMESPACE_PATTERN = /^capxul:[a-z]+:email:v[1-9][0-9]*$/u;

/** Whether `value` is a well-formed deployment salt namespace. */
export const isCapxulSafeSaltNamespace = (value: string): boolean =>
  CAPXUL_SAFE_SALT_NAMESPACE_PATTERN.test(value);

/**
 * Retired v1 personal-Safe namespace (signer-in-derivation). Kept ONLY as the
 * pin for pre-v2 on-chain artifacts that must not move — today that is the
 * backend faucet Safe (`testUsdcMint.ts`), which stays owner=deployer,
 * namespace=v1 so its deployed address is unchanged. Never use for new lanes.
 */
export const CAPXUL_SAFE_SALT_NAMESPACE_V1 = "capxul:safe:email:v1";

/**
 * The Capxul bootstrap owner — the sole `setup()` owner of every unclaimed
 * personal Safe under derivation v2. This address is part of the CREATE2
 * preimage of EVERY personal Safe address: treat it exactly like
 * `SAFE_PROXY_FACTORY` (changing it is a derivation-version event → v3).
 * The private key lives backend-only (`CAPXUL_BOOTSTRAP_OWNER_PRIVATE_KEY`)
 * and signs exactly one kind of operation: the claim userOp that deploys the
 * Safe and swaps this owner out for the user's signer (PRD #462). The earlier
 * ClaimGuard derivation-v3 placeholder (#461) is closed; future mainnet-scale
 * hardening should be filed against the current payments/claim architecture.
 */
export const CAPXUL_BOOTSTRAP_OWNER = "0x425fca96f4a3e18fb80974e38096b5da460f2704";

/** Safe `OwnerManager` sentinel — `prevOwner` for the single-owner swap. */
export const SAFE_SENTINEL_OWNERS = "0x0000000000000000000000000000000000000001";

// Safe 1.5.0's `SafeProxyFactory.proxyCreationCode()`, read with `cast call`
// on Base Sepolia and Arbitrum One on 2026-11-02 (identical on both: the
// factory is deployed deterministically). 438 bytes. It differs from 1.4.1's,
// so moving to 1.5.0 moved every derived Safe address.
//
// Used by `deriveCapxulSafeAddress` below; CompaniesHouseClaimer.sol and
// CompanySafeMinter.sol pin the same hex literal — keep them in sync.
export const SAFE_PROXY_CREATION_CODE: Hex =
  "0x608060405234801561001057600080fd5b506040516101b63803806101b68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101946022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050607b806101196000396000f3fe608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd036ce65611101d072e964736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";

/** Safe 1.4.1's `proxyCreationCode()`, for the Safes Capxul created before 1.5.0. */
export const SAFE_PROXY_CREATION_CODE_V141: Hex =
  "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";

/** One Safe release's contracts: what a CREATE2 Safe address and a `setup()` depend on. */
export interface SafeDeployment {
  readonly version: "1.4.1" | "1.5.0";
  readonly factory: Address;
  readonly singleton: Address;
  readonly proxyCreationCode: Hex;
  readonly fallbackHandler: Address;
}

/** Safe 1.5.0 (SafeL2): every Safe Capxul creates. */
export const SAFE_V150: SafeDeployment = {
  version: "1.5.0",
  factory: SAFE_PROXY_FACTORY,
  singleton: SAFE_L2_SINGLETON,
  proxyCreationCode: SAFE_PROXY_CREATION_CODE,
  fallbackHandler: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4",
};

/**
 * Safe 1.4.1 (SafeL2): only for Capxul's own Safes that already exist at a
 * 1.4.1 address and must not move (the staging faucet Safe and the staging
 * Companies House). Moving them is an in-place upgrade, not a new address.
 */
export const SAFE_V141: SafeDeployment = {
  version: "1.4.1",
  factory: SAFE_PROXY_FACTORY_V141,
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  proxyCreationCode: SAFE_PROXY_CREATION_CODE_V141,
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

/**
 * The salt namespaces whose Safes live on Safe 1.4.1: the epochs created before
 * the move to 1.5.0 (2 Nov 2026), which run on the beta (pre-v4) contracts. An
 * epoch never changes release, so its addresses never move. Every other
 * namespace (the devnet's, beta's and production's first epochs, and the next
 * staging epoch) is Safe 1.5.0.
 */
const SAFE_V141_NAMESPACES: ReadonlySet<string> = new Set([
  CAPXUL_SAFE_SALT_NAMESPACE_V1,
  "capxul:staging:email:v1",
  CAPXUL_SAFE_SALT_NAMESPACE,
]);

/** The Safe release a personal-Safe salt namespace's Safes are created on. */
export function safeDeploymentForNamespace(namespace: string): SafeDeployment {
  return SAFE_V141_NAMESPACES.has(namespace) ? SAFE_V141 : SAFE_V150;
}

export const multiSendAbi = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

/** Zodiac MultiSendCallOnly module on Base Sepolia. */
export const MULTI_SEND_CALL_ONLY: Address = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";

/** Safe4337Module's user-operation entry: one call or delegatecall, reverting with its reason. */
export const SAFE_4337_EXECUTE_USER_OP_ABI = [
  {
    type: "function",
    name: "executeUserOpWithErrorString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

// --- Safe v1.5.0 + 4337 module address derivation -----------------------------

export const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";
