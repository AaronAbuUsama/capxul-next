// What every world's chain holds before anything is sent to it: the seeded chain's last block and the addresses of
// the contracts a world's claims read. The deployment record (packages/contracts/deployments/devnet.json) and the seed
// (state/core.json) own these facts; they reach here through the table `pnpm generate` writes from them
// (`@capxul/contracts`' `Seeded`), never typed again. Nothing here touches the outside world, and the one package it
// imports is data only: the Workers' bundles may include this file.
import { Seeded } from "@capxul/contracts";
import { ENTRY_POINT } from "../bundler/Keys.ts";
import { TEST_USDC } from "./faucet.ts";

/** The seeded chain's last block (packages/contracts/state/core.json): a world's clock cannot start before it. */
export const SEED_HEAD = Seeded.head;

/**
 * How long after the seed's last block a world may start at the earliest: the room for the blocks that make the
 * world (the test token, the cast's Safes and their funds, the bundler), all sent before the world's start block.
 */
export const SETUP_ROOM_SECONDS = 3600;

/** The contracts a world's claims read (the blueprint's `ChainContracts`), at their addresses on every world's chain. */
export const CONTRACTS = {
  usdc: TEST_USDC,
  hats: Seeded.installer.hats,
  payments: Seeded.contracts.Payments,
  budgets: Seeded.contracts.Budgets,
  entryPoint: ENTRY_POINT,
  companySafeMinter: Seeded.contracts.CompanySafeMinter,
  companiesHouse: Seeded.companiesHouse,
  companyNamespace: Seeded.tiers[0].companyNamespace,
} as const;

/**
 * How a personal Safe is claimed on a world's chain: Companies House's Roles modifier lets its devnet service, one
 * of the chain's test accounts, delegatecall the claimer with the devnet tier's email namespace
 * (src/companies-house/CompaniesHouseClaimer.sol).
 */
export const CLAIMS = {
  roles: Seeded.companiesHouseRoles,
  claimer: Seeded.contracts.CompaniesHouseClaimer,
  /** The service: test account 3, the devnet tier's member. */
  service: Seeded.tiers[0].member,
  /** The role key `capxul.claim.devnet`, as a bytes32. */
  role: "0x63617078756c2e636c61696d2e6465766e657400000000000000000000000000",
  namespace: Seeded.tiers[0].namespace,
} as const;
