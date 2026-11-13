import type { Sql } from "../platform/db.ts";

export type SiteAnswer =
  | { status: "collecting" }
  | { status: "answered"; approval_id: string; approval_url: string; requested_by: string; awaiting: string }
  | { status: "refused"; error: { code: string; message: string } };

/** The caller binds requested_by to its authenticated identity before invoking this door. */
export async function siteRequestAnswer(sql: Sql, input: { org: string; request_id: string; requested_by: string }): Promise<SiteAnswer> {
  if (!input.org || !input.request_id || !input.requested_by) throw new Error("INVALID_INPUT: request identity required");
  // A fresh statement only sees committed collector answers, not a speculative approval or site ACK.
  const row = (await sql.query(`select request,answer from app.site_request_answers
    where org_id=$1 and request_id=$2`, [input.org, input.request_id])).rows[0];
  if (!row) return { status: "collecting" };
  if (row.request.requested_by !== input.requested_by) throw new Error("INVALID_INPUT: request identity");
  if (row.answer.error) return { status: "refused", error: row.answer.error };
  const signer = (await sql.query("select address from app.people where org_id=$1 and email=$2", [input.org, row.request.requested_by])).rows[0];
  if (!signer) throw new Error("INVALID_INPUT: request signer is no longer in the company directory");
  return { status: "answered", approval_id: row.answer.approval_id, approval_url: row.answer.approval_url, requested_by: row.request.requested_by, awaiting: signer.address };
}
