import type { Sql } from "../platform/db.ts";
import type { Address } from "viem";
import type { Call } from "./types.ts";

export type Deployment = { safe_address: Address; gate_address: Address; director_hat: string;
  /** Null until the admitted deployment binds the permission's hat (board.officer-hat-unbound). */
  books_hat: string | null; invoicing_hat: string | null; people_hat: string | null };
export type SafeState = { safe_address: Address; owners: Address[]; threshold: number; nonce: number; deployed: boolean };

/** Required same-Sql source reads. Composition must admit finalized installation facts, not editable app.hats.
 * These are planning inputs, never historical execution snapshots or a settlement provider. */
export type BoardFacts = {
  deployment(sql: Sql, org: string, chainId: number): Promise<Deployment | null>;
  safe(sql: Sql, chainId: number, address: Address): Promise<SafeState | null>;
  wearers(sql: Sql, chainId: number, safe: Address, hat: string, owners: Address[]): Promise<Address[]>;
  approvals(sql: Sql, chainId: number, safe: Address, hash: `0x${string}`, owners: Address[]): Promise<Address[]>;
  /** `hat` is always one of the Organization's admitted deployment hats. `blockNumber` pins any live Hats read to the
   * mutation's one RPC block. */
  hat(sql: Sql, chainId: number, hat: string, safe: Address, blockNumber?: bigint): Promise<{ supply: bigint; max_supply: bigint } | null>;
  hasOffice(sql: Sql, chainId: number, safe: Address, wearer: Address, blockNumber?: bigint): Promise<boolean>;
};

export type Summary = {
  title: string; from: { label: string; address: string }; to: { label: string };
  amount: { asset: string; value: string } | null;
  recipients: { label: string; amount: { asset: string; value: string };
    requestedOutput: { currency: string; value: string } | null; exact: boolean; rail: "wallet" | "bank";
    warning: { code: string; message: string } | null }[];
  warnings: { code: string; message: string }[];
};
export type ApprovalContext = { person_id: string; sender: string; site_url: string; now: Date };
export type ApprovalTerms = {
  org_id: string; opener: "board"; subject_kind: "proposal"; subject_id: string; chain_id: number;
  calls: Call[]; summary: Summary; deadline: string; send_after?: string; gate: string;
};
export type GateCatalogue = Readonly<Record<string, { target: "person" | "organization"; money: boolean }>>;

/** The integrator supplies the actual Access/Organizations/Approvals doors. No defaults or local authorities. */
export type BoardDoors = {
  authenticate(sql: Sql, bearer: string, now: number): Promise<{
    personId: string; kind: "person" | "agent"; safeAddress: string;
  }>;
  requireSeat(sql: Sql, orgId: string, actor: { principalId: string; kind: "human" | "agent"; safe: string }): Promise<unknown>;
  requireFeature(sql: Sql, key: string, actor: { personId: string; orgId?: string }, catalogue: GateCatalogue, now: number): Promise<void>;
  open(sql: Sql, context: ApprovalContext, input: ApprovalTerms, trace?: string): Promise<{
    approval_id: string; url: string; deadline: string; opened: boolean;
  }>;
};
