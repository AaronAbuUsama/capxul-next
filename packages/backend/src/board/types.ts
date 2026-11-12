import type { Address, Hex } from "viem";

export type Call = { to: Address; value: string; data: Hex };
export type Permission = "manage-books" | "issue-invoices" | "manage-people";
export type ProposalStatus = "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced";
export type Proposal = {
  org_id: string; proposal_id: string; chain_id: number; safe_address: Address; nonce: number;
  safe_tx_hash: Hex; kind: "transaction" | "rejection" | "scheduled_payment"; rejects: string | null;
  to: Address; value: string; data: Hex; operation: "call" | "delegatecall"; calls: Call[];
  note: string | null; opener: "board" | "agents" | "budgets" | "payments" | "payroll" | "equity";
  subject_kind: string; subject_id: string; payment: { payment_id: string; sends_at: number } | null;
  proposer_principal_id: string; proposer_safe: Address; status: ProposalStatus; approved_by: Address[];
  threshold: number | null; settled_by_safe_tx_hash: Hex | null; execution_user_op_hash: Hex | null;
  execution_tx_hash: Hex | null; settled_block: number | null; created_at: number; settled_at: number | null; updated_at: number;
};
export type OfficerChange = {
  org_id: string; change_id: string; member_id: string; party_id: string; principal_id: string | null; member_safe: Address;
  email: string | null; name: string | null; change: "grant" | "revoke"; permission: Permission; hat_id: string;
  proposal_id: string; note: string; state: "proposed" | "applied" | "ended"; waiting: true | null;
  created_at: number; settled_at: number | null; updated_at: number;
};

/** pg returns int8 as strings; reject overflow rather than silently changing a Safe nonce. */
export function integer(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("PROVIDER_RESPONSE_INVALID: invalid indexed integer");
  return n;
}
