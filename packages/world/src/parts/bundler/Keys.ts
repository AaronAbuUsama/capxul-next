// What the world's bundler, its test paymaster and whoever sends a UserOperation agree on. Nothing here touches the
// outside world, and nothing here imports another package: the Workers' bundles include this file.

/** The ERC-4337 EntryPoint v0.7, at its canonical address in the seeded chain (packages/contracts/state/core.json). */
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** The deterministic deployment proxy, in the seed: CREATE2 through it puts the same code at the same address. */
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

/**
 * The test paymaster: the contracts package's MockPaymaster, which sponsors every UserOperation from its deposit at
 * the EntryPoint. It is put on the chain when the world is created, through CREATE2_DEPLOYER with a zero salt and
 * ENTRY_POINT as its constructor argument, so it is at this address in every world (test/bundler.test.ts derives it
 * from test-paymaster.hex). Never on a real chain.
 */
export const TEST_PAYMASTER = "0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8";

/** What the paymaster holds at the EntryPoint when the world is created: 1 ETH, in wei. */
export const PAYMASTER_DEPOSIT = 10n ** 18n;

/**
 * The bundler's two keys: Anvil's public test accounts 9 and 10, as the other line used (packages/devnet on main).
 * They are well-known test keys for a disposable chain, never real ones. The executor sends the bundles; the utility
 * key deploys alto's simulation contracts on its first start. Account 9 is in the seed with no code, so it carries
 * none of the EIP-7702 delegation it has on Base Sepolia; account 10 is not in the seed at all.
 */
export const BUNDLER_KEYS = {
  executor: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
  utility: "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
} as const;

/** The addresses of BUNDLER_KEYS (test/bundler.test.ts derives them from the keys). */
export const BUNDLER_ACCOUNTS = {
  executor: "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  utility: "0xBcd4042DE499D14e55001CcbB24a551F3b954096",
} as const;

/** What each bundler account is given at creation, from the chain's faucet (`anvil_setBalance`): 10 ETH. */
export const BUNDLER_FUNDS = 10n * 10n ** 18n;

/** Where the bundler answers, under the world's door and its token: beside the chain's `/rpc`. */
export const BUNDLER_PATH = "/bundler";
