export type RequestState = "open" | "paying" | "paid" | "declined" | "cancelled" | "expired";
export type RequestIdentity = { owner_kind: "person" | "organization"; owner_id: string; request_id: string };
export type Request = RequestIdentity & {
  request_key: string; kind: "request" | "invoice" | "purchase"; status: RequestState;
  issuer_party_id: string; issuer_safe: string; payer_kind: "capxul" | "outside" | "none";
  payer_party_id: string | null; payer_email: string | null; payer_safe: string | null;
  asset_id: string; token_address: string; decimals: number; amount_raw: string; reference: string; note: string | null;
  invoice: { due_at: number | null; lines: { description: string; quantity: number; unit_amount_raw: string }[] } | null;
  document_id: string | null; document_hash: string | null; expires_at: number | null;
  service_id: string | null; service_revision: number | null; quantity: number | null;
  escrow_address: string | null; escrow_salt: string | null; escrow_received_raw: string | null;
  escrow_checked_at: number | null; payout_tx_hash: string | null; payment_id: string | null;
  chain_payment_id: string | null; pay_key: string | null; deposit_id: string | null;
  income: { account: string | null; sales_invoice: string | null } | null;
  billed_logs: { timesheet_id: string; idx: number; hours: string; amount_raw: string }[] | null;
  decided_by: string | null; decided_at: number | null; created_at: number; updated_at: number;
};
