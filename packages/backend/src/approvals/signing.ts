import { recoverAddress, type Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import { move, read } from "./store.ts";
import type { Approval, ApprovalContext, Terminal } from "./types.ts";

export type SigningContext = ApprovalContext & {
  network: { name: string; explorerUrl: string };
  requireFeature: (sql: Sql, key: string, scope: { personId: string; orgId?: string }) => Promise<void>;
  terminal?: Terminal;
};

function view(row: Approval, ctx: SigningContext) {
  return {
    approvalId: row.approval_id, url: `${ctx.site_url.replace(/\/$/, "")}/approve/${row.approval_id}`, state: row.state,
    opener: row.opener, subjectKind: row.subject_kind, subjectId: row.subject_id, orgId: row.org_id,
    summary: row.summary, network: { chainId: row.chain_id, ...ctx.network }, sender: row.sender, calls: row.calls,
    signer: row.signer_address ? { address: row.signer_address } : null,
    operation: row.user_operation ? { userOperation: row.user_operation, digest: row.digest, userOpHash: row.user_op_hash,
      validAfter: row.valid_after?.toISOString() ?? null, validUntil: row.valid_until!.toISOString() } : null,
    sendAfter: row.send_after?.toISOString() ?? null, expiresAt: (row.valid_until ?? row.deadline).toISOString(),
    refusal: row.refusal, sendError: row.send_error, transactionHash: row.transaction_hash, displacedBy: row.displaced_by,
    createdAt: row.created_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null,
    signedAt: row.signed_at?.toISOString() ?? null, sentAt: row.sent_at?.toISOString() ?? null, endedAt: row.ended_at?.toISOString() ?? null,
  };
}
function authenticated(ctx: ApprovalContext) {
  if (!ctx.person_id) throw new Error("NOT_AUTHENTICATED: sign in required");
}
export async function signingGet(sql: Sql, ctx: SigningContext, b: { approvalId: string }) {
  authenticated(ctx);
  return view(await read(sql, ctx.person_id, b.approvalId), ctx);
}
export async function signingReview(sql: Sql, ctx: SigningContext, b: { approvalId: string }) {
  authenticated(ctx);
  const row = await read(sql, ctx.person_id, b.approvalId);
  if (["sponsoring", "pending"].includes(row.state) && !row.reviewed_at) {
    await sql.query("update app.approvals set reviewed_at=$3,updated_at=$3 where person_id=$1 and approval_id=$2", [ctx.person_id, b.approvalId, ctx.now]);
    row.reviewed_at = ctx.now;
  }
  return view(row, ctx);
}
export async function signingSign(sql: Sql, ctx: SigningContext, b: { approvalId: string; signature: string }, trace = "") {
  authenticated(ctx);
  const row = await read(sql, ctx.person_id, b.approvalId);
  if (row.signature && row.signature === b.signature.toLowerCase()) return view(row, ctx);
  if (row.state !== "pending" || !row.valid_until || ctx.now >= row.valid_until) throw new Error(`WRONG_STATE: ${row.state}`);
  let recovered: string;
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(b.signature) || !row.digest || !row.signer_address) throw new Error("invalid signature");
    recovered = await recoverAddress({ hash: row.digest as Hex, signature: b.signature as Hex });
    if (recovered.toLowerCase() !== row.signer_address) throw new Error("wrong signer");
  } catch { throw new Error("INVALID_INPUT: signature"); }
  if (row.gate) await ctx.requireFeature(sql, row.gate, { personId: row.person_id, ...(row.org_id ? { orgId: row.org_id } : {}) });
  const signed = await move(sql, row, "sign", { signature: b.signature.toLowerCase(), signed_at: ctx.now }, ctx.now, trace, ctx.terminal);
  return view(signed, ctx);
}
export async function signingDecline(sql: Sql, ctx: SigningContext, b: { approvalId: string }, trace = "") {
  authenticated(ctx);
  const row = await read(sql, ctx.person_id, b.approvalId);
  if (row.state === "declined") return view(row, ctx);
  return view(await move(sql, row, "decline", { ended_at: ctx.now }, ctx.now, trace, ctx.terminal), ctx);
}
