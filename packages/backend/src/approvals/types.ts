import type { Sql } from "../platform/db.ts";

export type ApprovalState = "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn";
export type Opener = "accounts" | "organizations" | "board" | "agents" | "budgets" | "payments" | "payroll" | "equity";
export type Call = { to: string; value: string; data: string };
export type Need = { token: string; holder: string; amount: string };
export type Refusal = { code: string; reason: string };
type AssetAmount = { asset: string; value: string };
export type Summary = {
  title: string; from: { label: string; address: string }; to: { label: string }; amount: AssetAmount | null;
  recipients: { label: string; amount: AssetAmount; requestedOutput: { currency: string; value: string } | null; exact: boolean; rail: "wallet" | "bank"; warning: { code: string; message: string } | null }[];
  warnings: { code: string; message: string }[];
};
/** Resolved by the authenticated access/world boundary, never decoded from the request body. */
export type ApprovalContext = { person_id: string; sender: string; site_url: string; now: Date };
export type Open = {
  org_id: string | null; opener: Opener; subject_kind: string; subject_id: string; chain_id: number;
  calls: Call[]; summary: Summary; deadline: string; send_after?: string; needs?: Need[]; gate?: string; replaces?: string;
};
export type Opened = { approval_id: string; url: string; deadline: string; opened: boolean };
export type UserOperation = {
  sender: string; nonce: string; callData: string; callGasLimit: string; verificationGasLimit: string;
  preVerificationGas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; paymaster: string;
  paymasterVerificationGasLimit: string; paymasterPostOpGasLimit: string; paymasterData: string;
};
export type Approval = {
  person_id: string; approval_id: string; state: ApprovalState; org_id: string | null; opener: Opener;
  subject_kind: string; subject_id: string; chain_id: number; sender: string; calls: Call[]; summary: Summary;
  deadline: Date; send_after: Date | null; needs: Need[]; gate: string | null; replaces: string | null;
  nonce_key: string; nonce: string | null; signer_address: string | null; user_operation: UserOperation | null;
  digest: string | null; user_op_hash: string | null; valid_after: Date | null; valid_until: Date | null;
  signature: string | null; send_error: Refusal | null; refusal: Refusal | null; transaction_hash: string | null;
  block_number: number | null; displaced_by: string | null; created_at: Date; reviewed_at: Date | null;
  signed_at: Date | null; sent_at: Date | null; ended_at: Date | null; updated_at: Date;
};
export type TerminalEvent = Pick<Approval, "approval_id" | "person_id" | "org_id" | "opener" | "subject_kind" | "subject_id" | "chain_id" | "sender" | "nonce" | "user_op_hash" | "transaction_hash" | "block_number"> & {
  outcome: Exclude<ApprovalState, "sponsoring" | "pending" | "signed" | "sending" | "sent">; observedAt: string;
};
export type Terminal = (sql: Sql, event: TerminalEvent) => Promise<void>;
