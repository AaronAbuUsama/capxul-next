// The seeded chain every world starts from, as Core's chain operations reach it: the addresses of what is deployed in
// `packages/contracts/state/core.json`, from the table `pnpm generate` writes from its deployment record
// (`@capxul/contracts`' `Seeded`), what the world adds when it is made (the faucet's test USDC, the bundler's
// EntryPoint and test paymaster, `packages/world`), and the keys Core sends with. Every key here is one of the public
// test keys of the mnemonic every Anvil chain starts with: they hold nothing outside a disposable world.
import { Seeded } from "@capxul/contracts";
import { Values } from "@capxul/blueprint";

/** The world's chain id: Base Sepolia's, as the seed is pinned to it. */
export const CHAIN_ID = Seeded.chainId;

export const SEEDED = {
  /** Companies House, the Safe whose Roles module holds the tier's claim and company roles. */
  companiesHouse: Seeded.companiesHouse,
  companiesHouseRoles: Seeded.companiesHouseRoles,
  claimer: Seeded.contracts.CompaniesHouseClaimer,
  companySafeMinter: Seeded.contracts.CompanySafeMinter,
  installer: Seeded.contracts.Installer,
  payments: Seeded.contracts.Payments,
  budgets: Seeded.contracts.Budgets,
  /** The Hats protocol, as Base Sepolia has it. */
  hats: Seeded.installer.hats,
  /** Safe 1.4.1's MultiSendCallOnly: a batch of plain calls, run by DELEGATECALL from the Safe that sends it. */
  multiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  safeProxyFactory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  safeSingleton: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  safeModuleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
  /** The Safe4337Module: every personal Safe's module and fallback handler (CompaniesHouseClaimer). */
  safe4337Module: Seeded.installer.safe4337Module,
  /** ERC-4337's EntryPoint v0.7 (packages/world, src/parts/bundler/Keys.ts, `ENTRY_POINT`). */
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  /** The world's test paymaster, which sponsors every UserOperation (packages/world, `TEST_PAYMASTER`). */
  testPaymaster: "0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8",
  /**
   * The world's test USDC, the faucet's token: the first contract the seed's first test account creates, which is the
   * faucet's first transaction (packages/world, src/parts/chain/faucet.ts, `TEST_USDC`).
   */
  usdc: Seeded.firstAccount.nextContract,
} as const;

/** The seed's one tier: its namespaces and the roles its member holds on Companies House's Roles module. */
export const TIER = {
  /** Personal Safes are claimed under this namespace, by email. */
  personalNamespace: Seeded.tiers[0].namespace,
  /** Company Safes are minted under this namespace, by the Organization's id (decisions.md, 34). */
  companyNamespace: Seeded.tiers[0].companyNamespace,
  claimRole: "capxul.claim.devnet",
  companyRole: "capxul.company.devnet",
} as const;

/** The test USDC's decimals: 1 USDC is 1,000,000 of its smallest unit. */
export const USDC_DECIMALS = 6;

/**
 * The keys Core sends with, each a public test key, by its index in `CAST_KEYS.mnemonic`:
 *
 * - `service`, index 3, the seed tier's member (deploy/devnet.json): it mints company Safes through Companies House's
 *   company role, sends the Installer's `deployMoney`, and owns the relayer.
 * - The relayer is a Safe of the service key with the Safe4337Module, made the first time it is needed. A company
 *   Safe's transaction, signed by its Directors, reaches the chain as the relayer's UserOperation, sponsored by the
 *   world's paymaster: the relayer's own signature authorises nothing in the company.
 */
export const SERVICE_KEY_INDEX = 3;
export const SERVICE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
/** The relayer Safe's salt nonce at the Safe proxy factory. */
export const RELAYER_SALT = 4337n;

/** How long an approval stays open, in world time. */
export const APPROVAL_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** What the blueprint calls the contracts of the world's chain, as this seed has them. */
export const chainContracts: typeof Values.ChainContracts.Type = {
  usdc: SEEDED.usdc,
  hats: SEEDED.hats,
  payments: SEEDED.payments,
  budgets: SEEDED.budgets,
  entryPoint: SEEDED.entryPoint,
  companySafeMinter: SEEDED.companySafeMinter,
  companiesHouse: SEEDED.companiesHouse,
  companyNamespace: TIER.companyNamespace,
};
