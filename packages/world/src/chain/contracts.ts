// What every world's chain holds before anything is sent to it: the seeded chain's last block and the addresses of
// the contracts a world's claims read, as packages/contracts records them. The deployment record
// (packages/contracts/deployments/devnet.json), its configuration (deploy/devnet.json) and the seed (state/core.json)
// own these facts; test/contracts.test.ts fails when this file and they differ. Nothing here touches the outside
// world, and nothing here imports another package: the Workers' bundles may include this file.
import { TEST_USDC } from "./faucet.ts";

/** The seeded chain's last block (packages/contracts/state/core.json): a world's clock cannot start before it. */
export const SEED_HEAD = { number: 47_893_259, timestamp: 1_791_554_819 } as const;

/**
 * How long after the seed's last block a world may start at the earliest: the room for the blocks that make the
 * world (the test token, the cast's Safes and their funds, the bundler), all sent before the world's start block.
 */
export const SETUP_ROOM_SECONDS = 3600;

/** The contracts a world's claims read (the blueprint's `ChainContracts`), at their addresses on every world's chain. */
export const CONTRACTS = {
  usdc: TEST_USDC,
  hats: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137",
  payments: "0x468241C0CFaB01eD410D8f9A281Ace9b8D4E30e3",
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  companySafeMinter: "0x27e3faE904527BcA73C39683D2a1239020915c71",
  companiesHouse: "0x38d9772b87a52Ed4615E2c804414f0cDD4854F2F",
  companyNamespace: "capxul:devnet:company:v1",
} as const;

/**
 * How a personal Safe is claimed on a world's chain: Companies House's Roles modifier lets its devnet service, one
 * of the chain's test accounts, delegatecall the claimer with the devnet tier's email namespace
 * (src/companies-house/CompaniesHouseClaimer.sol).
 */
export const CLAIMS = {
  roles: "0x4b4810f262447DDd0f9De4D13ca0de04823B3dc5",
  claimer: "0x4244EfF941473B8F839A0f23ad1eBA650B37426E",
  /** The service: test account 3, the devnet tier's member. */
  service: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  /** The role key `capxul.claim.devnet`, as a bytes32. */
  role: "0x63617078756c2e636c61696d2e6465766e657400000000000000000000000000",
  namespace: "capxul:devnet:email:v1",
} as const;
