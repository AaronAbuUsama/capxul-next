import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import type { OfficerChange, Proposal, ProposalStatus } from "./types.ts";

export async function proposalEvent(sql: Sql, p: Proposal, from: ProposalStatus | null, transition: string, trace: string, at: number) {
  return emit(sql, { id: `proposal:${p.proposal_id}:${transition}`, name: "proposal_transitioned", machine: "proposal",
    entity_id: p.proposal_id, owner_kind: "organization", owner_id: p.org_id, actor: p.proposer_principal_id, trace_id: trace, at,
    props: { from, to: p.status, transition, proposal_id: p.proposal_id, org_id: p.org_id, kind: p.kind,
      nonce: p.nonce, opener: p.opener, subject_kind: p.subject_kind, subject_id: p.subject_id } });
}

export async function officerEvent(sql: Sql, c: OfficerChange, proposer: string, from: "proposed" | null, transition: string, trace: string, at: number) {
  return emit(sql, { id: `officer-change:${c.change_id}:${transition}`, name: "officer_change_transitioned", machine: "officer-change",
    entity_id: c.change_id, owner_kind: "organization", owner_id: c.org_id, actor: proposer, trace_id: trace, at,
    props: { from, to: c.state, transition, change_id: c.change_id, org_id: c.org_id,
      change: c.change, permission: c.permission, proposal_id: c.proposal_id } });
}
