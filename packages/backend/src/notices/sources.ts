import type { Sql } from "../platform/db.ts";
import type { TransitionEvent } from "../platform/outbox.ts";

export type Owner = { kind: "person" | "organization"; id: string };
export type Principal = { personId: string; kind: "person" | "agent"; email: string | null; safeAddress: string };
export type Payment = {
  id: string; owner_kind: Owner["kind"]; owner_id: string; command_id: string | null; chain_id: number;
  route: string; status: string; outcome: string | null; pay_at: number | null; budget_id: string | null;
  payer_label: string; payee_kind: Owner["kind"] | null; payee_id: string | null; payee_mailbox: string | null;
  amount_raw: string; decimals: number; asset: string; escrow_address: string | null; shortfall: string | null;
};
export type Proposal = { proposer_safe: string; safe_address: string; note: string | null; opener: string; subject: unknown; proposer_principal_id: string };
export type OfficerChange = { change: string; permission: string; email: string | null; principal_id: string | null; note: string | null };
export type Request = {
  kind: string; owner_kind: Owner["kind"]; owner_id: string; reference: string;
  payer_kind: string; payer_email: string | null; payer_safe: string | null; escrow_address: string | null; payout_tx_hash: string | null;
  amount_raw: string; decimals: number; asset_id: string;
};

/** Source-owned doors, all on the caller's Sql. Implementations never copy source storage into notices. */
export interface Sources {
  admission(sql: Sql, event: TransitionEvent): Promise<{ email: string; admitted_by: string | null; referrer_email: string | null; referral_rewarded_with_invite: boolean }>;
  principal(sql: Sql, personId: string): Promise<Principal | null>;
  principalBySafe(sql: Sql, safe: string): Promise<Principal | null>;
  principalByEmail(sql: Sql, email: string): Promise<Principal | null>;
  partyName(sql: Sql, owner: Owner): Promise<string | null>;
  organization(sql: Sql, id: string): Promise<{ name: string; safe: string }>;
  proposal(sql: Sql, org: string, id: string): Promise<Proposal>;
  officerChange(sql: Sql, org: string, id: string): Promise<OfficerChange>;
  payment(sql: Sql, owner: Owner, id: string): Promise<Payment>;
  commandPayments(sql: Sql, owner: Owner, command: string): Promise<Payment[]>;
  hatWearers(sql: Sql, options: { orgId: string; chainId: number; budgetId: string }): Promise<string[]>;
  request(sql: Sql, owner: Owner, id: string): Promise<Request>;
  safeOwners(safe: string): Promise<readonly string[]>;
}

export async function person(sources: Sources, sql: Sql, id: string): Promise<Principal[]> {
  const p = await sources.principal(sql, id);
  return p?.kind === "person" && p.email ? [p] : [];
}
export async function directors(sources: Sources, sql: Sql, org: string, exclude?: string): Promise<Principal[]> {
  const company = await sources.organization(sql, org);
  // Safe owners are read NOW through chain-rpc, never a saved directory membership list.
  const safes = await sources.safeOwners(company.safe);
  const result: Principal[] = [];
  for (const safe of safes) {
    if (safe.toLowerCase() === exclude?.toLowerCase()) continue;
    const p = await sources.principalBySafe(sql, safe.toLowerCase());
    if (p?.kind === "person" && p.email) result.push(p);
  }
  return result;
}
export async function payer(sources: Sources, sql: Sql, payment: Payment): Promise<Principal[]> {
  if (payment.owner_kind === "person") return person(sources, sql, payment.owner_id);
  if (!payment.budget_id) return directors(sources, sql, payment.owner_id);
  const result: Principal[] = [];
  for (const safe of await sources.hatWearers(sql, { orgId: payment.owner_id, chainId: payment.chain_id, budgetId: payment.budget_id })) {
    const p = await sources.principalBySafe(sql, safe.toLowerCase());
    if (p?.kind === "person" && p.email) result.push(p);
  }
  return result;
}
