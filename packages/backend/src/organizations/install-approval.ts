// The setup's install approval (organizations.approval-endings): Approvals' approval_transitioned consumer and its
// terminal callback for the approval the setup opened (opener organizations, subject the setup).
import type { Sql } from "../platform/db.ts";
import { FORGET_INSTALL, setupRow, stall, transitioned, type Reason } from "./process.ts";

const ENDINGS: Record<string, [Reason, string]> = {
  declined: ["approval_declined", "CANCELLED"], expired: ["approval_expired", "WRONG_STATE"], displaced: ["approval_displaced", "WRONG_STATE"],
  reverted: ["install_reverted", "TRANSACTION_FAILED"], refused: ["install_refused", "PROVIDER_ERROR"],
};
async function installSetup(sql: Sql, e: { opener: string; subject_kind: string; subject_id: string; approval_id: string }) {
  if (e.opener !== "organizations" || e.subject_kind !== "setup") return null;
  const row = await setupRow(sql, e.subject_id);
  return row && row.install_approval_id === e.approval_id ? row : null;
}
/** approval_transitioned consumer: the founder signed and approvals sent it, so the setup is processing again. */
export async function onApprovalTransitioned(sql: Sql, event: { props: any; at: number; trace_id: string }) {
  const row = await installSetup(sql, event.props);
  if (!row || event.props.to !== "signed" || row.status !== "awaiting_authorization") return;
  await sql.query("update app.org_setups set status='processing',checked_at=$2,updated_at=$2 where org_id=$1", [row.org_id, event.at]);
  await transitioned(sql, row, "awaiting_authorization", "processing", "authorize", null, event.at, event.trace_id);
}
/** Approvals' terminal callback for the install approval (organizations.approval-endings). Landed records the install's
 * transaction and block, which completion judges at finality (authorizing first if `signed` was not seen); every other
 * ending stalls the setup and forgets the approval, so `org retry` opens a new one. */
export async function onApprovalEnded(sql: Sql, e: { opener: string; subject_kind: string; subject_id: string; approval_id: string;
  outcome: string; refusal: { code: string } | null; transaction_hash: string | null; block_number: number | null;
  observedAt: string; trace_id: string }) {
  const row = await installSetup(sql, e), at = Date.parse(e.observedAt);
  if (!row || !["processing", "awaiting_authorization"].includes(row.status)) return;
  if (e.outcome === "landed") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(e.transaction_hash ?? "") || !Number.isSafeInteger(e.block_number)) throw new Error("INVALID_INPUT: landed install needs its transaction");
    await sql.query("update app.org_setups set status='processing',install_tx_hash=$2,install_block=$3,checked_at=$4,updated_at=$4 where org_id=$1",
      [row.org_id, e.transaction_hash!.toLowerCase(), e.block_number, at]);
    if (row.status === "awaiting_authorization") await transitioned(sql, row, "awaiting_authorization", "processing", "authorize", null, at, e.trace_id);
    return;
  }
  const ending = ENDINGS[e.outcome];
  if (!ending) return;
  const code = e.outcome === "refused" ? e.refusal?.code ?? ending[1] : ending[1];
  await stall(sql, row, ending[0], code, at, e.trace_id, FORGET_INSTALL);
}
