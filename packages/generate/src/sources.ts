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
    from: "packages/blueprint/src/common/site.ts",
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

/**
 * What `pnpm seed` rebuilds the seed from (the compiled contracts, the manifest, Companies House's configuration and
 * the pinned third-party state) and what it writes: the seed, the deployment record and the state's checksums.
 */
export const SEED_INPUTS = {
  manifest: `${CONTRACTS}/deploy/manifest.json`,
  house: `${CONTRACTS}/deploy/devnet.json`,
  pin: `${CONTRACTS}/state/pin.genesis.json`,
} as const;
export const CHECKSUMS = `${CONTRACTS}/state/CHECKSUMS`;

/** The chain id of every world's chain, Base Sepolia's, which the seed is deployed on. */
export const CHAIN_ID = 84532;

/**
 * The mnemonic of anvil's public test accounts, the only keys the seed signs with: the deployer is account 0 and
 * Companies House's Directors are accounts 0 to 2 (`deploy/devnet.json`). Published by Foundry; holds nothing real.
 */
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";

/** Anvil's first test account: the account a world's faucet sends from (packages/world, src/chain/faucet.ts). */
export const FIRST_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** One of today's domains of the blueprint, whose module is the package's namespace of the same name. */
export interface BlueprintDomain {
  /** The namespace the blueprint's door exports it as, such as `People`. */
  readonly namespace: string;
  /** Its verbs, `thing/verb`, in the order of its `operations` (and so of the door's `operations`). */
  readonly verbs: ReadonlyArray<string>;
  /** Its verbs in the order of the two Rpc groups, when that differs from `verbs`. */
  readonly groups?: ReadonlyArray<string>;
  /** The thing files whose names its namespace exports (`thing/values`, `thing/events`), and its lifecycles. */
  readonly parts: ReadonlyArray<string>;
}

/**
 * The blueprint's generated indexes (packages/blueprint/src/generated/), written from its thing folders. Today's
 * domains group the things into the namespaces the package exports (`People`, `World`, ...), each in the order its
 * operations had before the things were split out (15 November 2026); the glossary's renames (roadmap item 3.8)
 * retire them. A verb no domain lists, or a listed verb that is not there, stops `pnpm generate`.
 */
export const BLUEPRINT: { readonly root: string; readonly domains: { readonly [name: string]: BlueprintDomain } } = {
  root: "packages/blueprint",
  domains: {
    organizations: {
      namespace: "Organizations",
      verbs: ["company/create", "member/grant"],
      parts: ["company/values", "company/events", "member/events"],
    },
    people: {
      namespace: "People",
      verbs: ["invitation/send", "invitation/list", "invitation/accept", "invitation/decline", "member/list"],
      parts: ["invitation/values", "invitation/events", "member/values", "invitation/lifecycle"],
    },
    board: {
      namespace: "Board",
      verbs: ["director/list", "director/add", "board/set-threshold"],
      parts: ["board/values", "board/events"],
    },
    budgets: {
      namespace: "Budgets",
      verbs: ["budget/create", "budget/show", "budget/list"],
      parts: ["budget/values", "budget/events"],
    },
    documents: {
      namespace: "Documents",
      verbs: ["document/create", "document/submit"],
      parts: ["document/values", "document/events"],
    },
    approvals: { namespace: "Approvals", verbs: ["approval/sign"], parts: ["approval/values", "approval/events"] },
    reports: { namespace: "Reports", verbs: ["report/run"], parts: [] },
    world: {
      namespace: "World",
      verbs: [
        "world/create",
        "clock/warp",
        "snapshot/save",
        "snapshot/restore",
        "world/show",
        "world/list",
        "snapshot/list",
        "snapshot/delete",
      ],
      groups: [
        "world/create",
        "world/show",
        "snapshot/save",
        "snapshot/restore",
        "world/list",
        "snapshot/list",
        "snapshot/delete",
        "clock/warp",
      ],
      parts: ["world/values", "world/events", "clock/events", "snapshot/values", "snapshot/events"],
    },
    record: { namespace: "Record", verbs: ["history/export"], parts: [] },
  },
};
