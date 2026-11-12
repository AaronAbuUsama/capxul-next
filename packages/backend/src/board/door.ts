import type { Sql } from "../platform/db.ts";
import { integer, type OfficerChange, type Proposal } from "./types.ts";

export { migrate } from "./migrate.ts";
export type { Call, OfficerChange, Permission, Proposal, ProposalStatus } from "./types.ts";

/** Internal source read, scoped by the caller's company transaction. No settlement on reads. */
export async function readProposal(sql: Sql, orgId: string, proposalId: string): Promise<Proposal | null> {
  const r = (await sql.query("select * from app.board_proposals where org_id=$1 and proposal_id=$2", [orgId, proposalId])).rows[0];
  if (!r) return null;
  return { ...r, nonce: integer(r.nonce), threshold: r.threshold === null ? null : integer(r.threshold),
    settled_block: r.settled_block === null ? null : integer(r.settled_block) };
}

/** Notices resolves recipient details from this source, never from event properties. */
export async function readOfficerChange(sql: Sql, orgId: string, changeId: string): Promise<OfficerChange | null> {
  return (await sql.query("select * from app.officer_changes where org_id=$1 and change_id=$2", [orgId, changeId])).rows[0] ?? null;
}
