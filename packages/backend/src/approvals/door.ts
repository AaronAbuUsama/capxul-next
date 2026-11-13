import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import { record, type Sql } from "../platform/db.ts";
import type { Approval } from "./types.ts";

export { siteRequestAnswer, type SiteAnswer } from "./site-answer.ts";
export type { ApprovalContext, Open, Opened, TerminalEvent, Terminal } from "./types.ts";
export { open, withdraw } from "./store.ts";
export { migrateApprovals } from "./migrate.ts";
export { signingGet, signingReview, signingSign, signingDecline, type SigningContext } from "./signing.ts";
export { carry, wakeChain, type CarrierServices, type ChainFact, type Sponsorship } from "./carrier.ts";
export { createSigningHandler, type SigningTransport } from "./http.ts";

/** Internal command replay only: authorize the stored command first. Tenant callers see no row. */
export async function readApproval(sql: Sql, approvalId: string): Promise<Pick<Approval, "approval_id" | "deadline" | "state" | "person_id" | "sender"> | null> {
  return (await sql.query<Pick<Approval, "approval_id" | "deadline" | "state" | "person_id" | "sender">>(
    `select approval_id,deadline,state,person_id,sender from app.approvals
      where approval_id=$1 and current_user='capxul_worker'`, [approvalId])).rows[0] ?? null;
}

export type Prepare = {
  request_id: string; org: string; site: string; doctype: string; name: string; document_hash: string;
  requested_by: string; to_party: string; to_address: string; amount: string; asset: string; department?: string;
};
export async function prepare(sql: Sql, b: Prepare, trace: string) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [b.org]);
  for (const key of ["request_id", "org", "site", "doctype", "name", "document_hash", "requested_by", "to_party", "to_address", "amount"] as const) {
    if (typeof b[key] !== "string" || !b[key]) throw new Error(`INVALID_INPUT: missing ${key}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(b.document_hash) || /^0x0{64}$/.test(b.document_hash) || !/^0x[0-9a-fA-F]{40}$/.test(b.to_address)) {
    throw new Error("INVALID_INPUT: document hash and recipient must be nonzero EVM values");
  }
  if (!/^\d+(\.\d{1,6})?$/.test(b.amount) || parseUnits(b.amount, 6) <= 0n || b.asset !== "USDC") throw new Error("INVALID_INPUT: positive USDC amount required");
  const org = (await sql.query("select site from app.organizations where org_id=$1", [b.org])).rows[0];
  if (!org || org.site !== b.site) throw new Error("INVALID_INPUT: request site does not belong to company");
  const person = await sql.query("select address from app.people where org_id=$1 and email=$2", [b.org, b.requested_by]);
  if (!person.rowCount) throw new Error("FORBIDDEN: requester is not a company person");
  const normalized = { ...b, document_hash: b.document_hash.toLowerCase(), to_address: b.to_address.toLowerCase() };
  await sql.query(`insert into app.site_payment_approvals (org_id,id,request_id,request,trace) values ($1,$2,$3,$4,$5)
    on conflict (org_id,request_id) do nothing`, [b.org, `apr_${randomUUID().replaceAll("-", "")}`, b.request_id, normalized, trace]);
  const row = (await sql.query("select *, request=$3::jsonb as same from app.site_payment_approvals where org_id=$1 and request_id=$2 for update", [b.org, b.request_id, normalized])).rows[0]!;
  if (!row.same) throw new Error("IDEMPOTENCY_CONFLICT: request ID reused with different payment terms");
  // Recording only once is part of the same transaction as the approval.
  if (!(await sql.query("select 1 from app.records where org_id=$1 and kind='approval_prepared' and data->>'id'=$2", [b.org, row.id])).rowCount) {
    await record(sql, b.org, "approval_prepared", trace, { id: row.id, request_id: b.request_id, document_hash: normalized.document_hash });
  }
  return view(row);
}
export function view(row: any) {
  return { ...row.request, id: row.id, status: row.status, trace: row.trace, txHash: row.tx_hash, createdAt: row.created_at };
}
export async function get(sql: Sql, org: string, id: string) {
  const row = (await sql.query("select * from app.site_payment_approvals where org_id=$1 and id=$2", [org, id])).rows[0];
  if (!row) throw new Error("NOT_FOUND: unknown approval");
  return view(row);
}
export async function submitted(sql: Sql, org: string, id: string, hash: string, signer: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("INVALID_INPUT: transaction hash required");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const row = (await sql.query("select * from app.site_payment_approvals where org_id=$1 and id=$2 for update", [org, id])).rows[0];
  if (!row) throw new Error("NOT_FOUND: unknown approval");
  if (row.request.requested_by !== signer) throw new Error("FORBIDDEN: wrong signer");
  if (row.tx_hash && row.tx_hash !== hash.toLowerCase()) throw new Error("IDEMPOTENCY_CONFLICT: approval already names another transaction");
  if (row.status === "pending") {
    await sql.query("update app.site_payment_approvals set status='submitted',tx_hash=$3 where org_id=$1 and id=$2", [org, id, hash.toLowerCase()]);
    await sql.query(`insert into app.transaction_traces (org_id,tx_hash,trace) values ($1,$2,$3) on conflict do nothing`, [org, hash.toLowerCase(), row.trace]);
    await record(sql, org, "approval_submitted", row.trace, { id, tx_hash: hash.toLowerCase(), signer });
  }
  // A caller's report does not settle money: only a matching indexed PaymentSent can do that.
  return get(sql, org, id);
}

/** Matching indexed fact only; caller commits this with its consumed log identity and delivery. */
export async function settleSitePayment(sql: Sql, input: { org: string; document_hash: string; recipient: string; amount_raw: string; tx_hash: string; trace?: string }) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [input.org]);
  const row = (await sql.query(`select * from app.site_payment_approvals
    where org_id=$1 and request->>'document_hash'=$2 order by created_at limit 1 for update`, [input.org, input.document_hash.toLowerCase()])).rows[0];
  // prepare stores both hex values lowercase; an indexed fact's checksummed case must not break the match.
  if (!row || row.request.to_address !== input.recipient.toLowerCase() || parseUnits(row.request.amount, 6) !== BigInt(input.amount_raw)) return { matched: false as const };
  await sql.query("update app.site_payment_approvals set status='settled',tx_hash=$3 where org_id=$1 and id=$2", [input.org, row.id, input.tx_hash]);
  return { matched: true as const, approval_id: row.id as string, trace: input.trace || row.trace as string, status: "settled" as const };
}
