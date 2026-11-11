// What the company module takes and answers. Reading this file is reading the module.

import type { Abi, Hex } from "viem";

import type { Chain } from "../chain/types.ts";
import type { DeploymentRecord } from "../protocol/types.ts";

/** The deployed protocol a company lives on: the chain, the deployment record, and the Installer's ABI (from its Foundry artifact). */
export interface Protocol {
  readonly chain: Chain;
  readonly record: DeploymentRecord;
  readonly installerAbi: Abi;
}

/** The keys a company's birth needs. Public test keys only. */
export interface BirthKeys {
  /** Holds Companies House's claim and company roles for the devnet tier. */
  readonly tierService: Hex;
  /** Pays gas for the installation and the Board's batches. */
  readonly relayer: Hex;
  /** The founder's key: the one signer of the founder's personal Safe, which owns the company Safe. */
  readonly founder: Hex;
}

export interface CreateCompany {
  /** The founder's email: Companies House derives the personal Safe from it. */
  readonly founderEmail: string;
  /** The company's name in Companies House: it derives the company Safe from it. Unique per founder. */
  readonly company: string;
  /** The token the company holds and pays in (6 decimals). */
  readonly token: Hex;
  /** The officer hats, in order (the Board's children), for example Operations, Finance. */
  readonly officers: readonly { readonly details: string; readonly maxSupply: number }[];
  /** The Roles allowance for the token (the ceiling) and the top budget's amount, in token units. */
  readonly ceiling: bigint;
  readonly topAmount: bigint;
  /** A salt for the installation, so two companies of one founder do not collide. */
  readonly salt: Hex;
}

/** A company on chain, as its birth left it. Everything else is read from the chain. */
export interface Company {
  readonly companySafe: Hex;
  readonly founderSafe: Hex;
  readonly founderKey: Hex;
  readonly relayerKey: Hex;
  readonly token: Hex;
  readonly gate: Hex;
  readonly roles: Hex;
  readonly boardTopHat: bigint;
  /** In the order of `CreateCompany.officers`. */
  readonly officerHats: readonly bigint[];
  readonly topBudget: bigint;
}

export interface Pay {
  /** The key of the hat's wearer. It sends the spend itself and pays the gas. */
  readonly key: Hex;
  readonly budget: bigint;
  readonly to: Hex;
  readonly amount: bigint;
  /** Payments' kind (1 is a supplier payment, as in the proof). */
  readonly kind: number;
  readonly documentHash: Hex;
  /** Unique per spend: Budgets refuses a repeat. */
  readonly jobNonce: Hex;
}

/** Why the chain refused a payment, in the blueprint's words; the contract's error is kept in `detail`. */
export type Refusal = "NOT_AUTHORISED" | "OVER_BUDGET" | "REVERTED";

export type PayResult =
  | { readonly ok: true; readonly txHash: Hex; readonly paymentId: Hex }
  | { readonly ok: false; readonly reason: Refusal; readonly detail: string };
