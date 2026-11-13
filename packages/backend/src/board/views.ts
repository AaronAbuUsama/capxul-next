import type { Sql } from "../platform/db.ts";
import { readOfficerChange, readProposal } from "./door.ts";
import { integer, type Proposal } from "./types.ts";
import type { BoardFacts } from "./runtime.ts";

async function approvals(sql: Sql, p: Proposal, facts: BoardFacts) {
  if (p.status !== "awaiting_approvals") return { threshold: integer(p.threshold), approvals: p.approved_by.map((owner) => ({ owner, label: null as string | null, state: "approved" as const })) };
  const owners = await facts.safe(sql, p.chain_id, p.safe_address);
  if (!owners) throw new Error("WRONG_STATE: company Safe is not indexed");
  const list = owners.owners.map((o) => o.toLowerCase());
  const approved = (await facts.approvals(sql, p.chain_id, p.safe_address, p.safe_tx_hash, list as typeof owners.owners)).map((a) => a.toLowerCase());
  const parties = (await sql.query(`select safe_address,case when kind='agent' then '@'||handle else display_name end as label
    from app.parties where safe_address=any($1::text[]) and state<>'released'`, [approved])).rows;
  const indexed = approved.map((owner) => ({ owner, label: parties.find((p) => p.safe_address === owner)?.label ?? null }));
  const sent = (await sql.query(`select distinct a.director_safe as owner,case when p.kind='agent' then '@'||p.handle else p.display_name end as label
    from app.proposal_approvals a join app.approvals r on r.approval_id=a.approval_id and r.person_id=a.director_principal_id
    left join app.parties p on p.safe_address=a.director_safe and p.state<>'released'
    where a.org_id=$1 and a.proposal_id=$2 and r.state in ('signed','sending','sent') and a.director_safe=any($3::text[])`,
  [p.org_id, p.proposal_id, list])).rows.filter((r) => !indexed.some((i) => i.owner === r.owner));
  return { threshold: integer(owners.threshold), approvals: [
    ...indexed.map((r) => ({ owner: r.owner as string, label: r.label as string | null, state: "approved" as const })),
    ...sent.map((r) => ({ owner: r.owner as string, label: r.label as string | null, state: "sent" as const })),
  ] };
}

export async function proposalView(sql: Sql, org: string, id: string, facts: BoardFacts) {
  const p = await readProposal(sql, org, id);
  if (!p) throw new Error("INVALID_INPUT: unknown proposal");
  return { proposalId: p.proposal_id, orgId: org, chainId: p.chain_id, safeAddress: p.safe_address, nonce: p.nonce,
    safeTxHash: p.safe_tx_hash, kind: p.kind, rejects: p.rejects, transaction: { to: p.to, value: p.value, data: p.data, operation: p.operation },
    calls: p.calls, note: p.note, proposer: p.proposer_safe, status: p.status, ...await approvals(sql, p, facts),
    executionUserOpHash: p.execution_user_op_hash, ...(p.payment ? { payment: { id: p.payment.payment_id, sendsAt: p.payment.sends_at } } : {}), createdAt: p.created_at };
}

export async function officerView(sql: Sql, org: string, id: string, siteUrl: string, facts: BoardFacts) {
  const c = await readOfficerChange(sql, org, id);
  if (!c) throw new Error("INVALID_INPUT: unknown officer change");
  const p = (await readProposal(sql, org, c.proposal_id))!;
  const a = (await sql.query(`select approval_id from app.proposal_approvals where org_id=$1 and proposal_id=$2
    and director_principal_id=$3 order by created_at limit 1`, [org, p.proposal_id, p.proposer_principal_id])).rows[0]!;
  const state = await approvals(sql, p, facts);
  return { change: { changeId: c.change_id, change: c.change, permission: c.permission, email: c.email, name: c.name, state: c.state },
    proposal: { proposalId: p.proposal_id, nonce: p.nonce, status: p.status, threshold: state.threshold,
      approvals: state.approvals.filter((a) => a.state === "approved").map((a) => a.owner), note: c.note, approvalId: a.approval_id as string,
      url: `${siteUrl.replace(/\/$/, "")}/approve/${a.approval_id}` } };
}
