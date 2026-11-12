export type Owner = { kind: "person" | "organization"; id: string };
export type PaymentStatus = "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled";
export type PaymentRoute = "personal" | "budget" | "board" | "claim_escrow" | "chain";
export type PaymentOutcome = "declined" | "refused" | "rejected" | "expired" | "displaced" | "reverted" | "window_closed" | "voided" | "budget_cancelled" | "refunded" | "withdrawn";

export interface Payment {
  owner_id: string; owner_kind: Owner["kind"]; id: string; command_id: string | null;
  origin: "prepared" | "chain"; route: PaymentRoute; status: PaymentStatus; outcome: PaymentOutcome | null;
  kind: number; chain_id: number; chain_payment_id: string; job_nonce: string;
  payer_safe: string; payer_label: string; payee_kind: Owner["kind"] | null; payee_id: string | null;
  payee_safe: string; payee_label: string; payee_mailbox: string | null;
  token_address: string; asset: string; decimals: number; amount_raw: string;
  document_id: string | null; document_hash: string; pay_at: number | null; budget_id: string | null; scheduled_id: string | null;
  escrow_address: string | null; funding_payment_id: string | null;
  against: Record<string, unknown> | null; payee_against: Record<string, unknown> | null; source: Record<string, unknown> | null; fee_raw: string | null;
  approval_id: string | null; proposal_id: string | null; cancel_approval_id: string | null; cancel_proposal_id: string | null;
  rescheduled_from: string | null; shortfall: "balance_too_low" | "budget_exhausted" | null; mismatch: string | null;
  settled_tx_hash: string | null; settled_log_index: number | null; settled_block_number: number | null; settled_block_hash: string | null;
  settled_at: number | null; created_at: number; updated_at: number;
}

export interface PaymentTransitionProps {
  from: PaymentStatus | null; to: PaymentStatus; transition: string; payment_id: string;
  owner_kind: Owner["kind"]; owner_id: string; command_id: string | null; route: PaymentRoute; outcome: PaymentOutcome | null;
}
