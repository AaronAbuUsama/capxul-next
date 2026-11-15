// What `pnpm generate` writes, and from what. Each output's owner is named beside it (AGENTS.md, "Who owns each
// fact"); nothing here is a fact of its own, only where each derived file comes from and where it goes.

/** Every path here is relative to the repository's root. */
export const CONTRACTS = "packages/contracts";

/**
 * The compiled contracts and interfaces whose ABIs off-chain code uses, each by the name the ABI module exports it
 * under and its artifact in Foundry's `out/`. The deployed contracts are the package's own; the interfaces declare the
 * outside contracts a world's chain holds (Safe, Hats, the Roles modifier, ERC-4337's EntryPoint, the test USDC).
 */
export const ABIS = {
  CompaniesHouseClaimer: "CompaniesHouseClaimer.sol/CompaniesHouseClaimer.json",
  CompanySafeMinter: "CompanySafeMinter.sol/CompanySafeMinter.json",
  Installer: "Installer.sol/Installer.json",
  Payments: "Payments.sol/Payments.json",
  Budgets: "Budgets.sol/Budgets.json",
  IERC20Metadata: "IERC20Metadata.sol/IERC20Metadata.json",
  IHats: "IHats.sol/IHats.json",
  IHatsEvents: "IHatsEvents.sol/IHatsEvents.json",
  IHatsSignerGate: "IHatsSignerGate.sol/IHatsSignerGate.json",
  IRoles: "IRoles.sol/IRoles.json",
  ISafe: "ISafe.sol/ISafe.json",
  ISafeState: "ISafeState.sol/ISafeState.json",
  ISafeProxyFactory: "ISafe.sol/ISafeProxyFactory.json",
  ISafeModuleSetup: "ISafe.sol/ISafeModuleSetup.json",
  IMultiSend: "IMultiSend.sol/IMultiSend.json",
  IEntryPoint: "IEntryPoint.sol/IEntryPoint.json",
  ISafe4337Module: "ISafe4337Module.sol/ISafe4337Module.json",
  /** The test USDC a world's faucet deploys (test/mocks/MockERC20.sol), whose `mint` is open. */
  MockERC20: "MockERC20.sol/MockERC20.json",
} as const;

/** The outputs, each with the owner it is generated from. */
export const OUTPUTS = {
  abi: { path: `${CONTRACTS}/generated/abi.ts`, from: `forge build's out/ in ${CONTRACTS}` },
  seeded: {
    path: `${CONTRACTS}/generated/seeded.ts`,
    from: `${CONTRACTS}/deployments/devnet.json and ${CONTRACTS}/state/core.json`,
  },
  site: {
    path: "packages/frappe-app/capxul/generated/site.py",
    from: "packages/blueprint/src/documents/site.ts",
  },
  sitePackage: {
    path: "packages/frappe-app/capxul/generated/__init__.py",
    from: "packages/generate/src/sources.ts",
  },
} as const;

/** The deployment record (`deployments/devnet.json`) and the seed (`state/core.json`), relative to the root. */
export const RECORD = `${CONTRACTS}/deployments/devnet.json`;
export const SEED = `${CONTRACTS}/state/core.json`;
export const OUT = `${CONTRACTS}/out`;

/** Anvil's first test account: the account a world's faucet sends from (packages/world, src/chain/faucet.ts). */
export const FIRST_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
