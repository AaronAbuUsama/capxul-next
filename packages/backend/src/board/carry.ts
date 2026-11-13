import type { Address, Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import { readOfficerChange, readProposal } from "./door.ts";
import { officerEvent, proposalEvent } from "./events.ts";
import type { ApprovalContext } from "./runtime.ts";
import { integer, type Proposal, type ProposalStatus } from "./types.ts";

/** The one indexed ExecutionSuccess/ExecutionFailure that used a Safe nonce, as of the deployment's finality depth. */
export type Execution = { safe_tx_hash: Hex; success: boolean; tx_hash: Hex; user_op_hash: Hex | null;
  block_number: number; threshold: number };

/** Historical, finalized source reads for settlement. Never live RPC and never current planning state. */
export type SettlementFacts = {
  execution(sql: Sql, chainId: number, safe: Address, nonce: number, finality: number): Promise<Execution | null>;
  /** Owners whose approval of `hash` was indexed at or before `block`, including the executing owner's own signature. */
  approvalsAt(sql: Sql, chainId: number, safe: Address, hash: Hex, block: number): Promise<Address[]>;
  /** Whether that transaction's indexed Hats facts move one `hat` token from `from` to `to`. */
  hatMoved(sql: Sql, chainId: number, txHash: Hex, hat: string, from: Address, to: Address): Promise<boolean>;
};

/** Composition supplies Approvals' real `withdraw`; there is no default. */
export type CarryWorld = {
  chainId: number; finality: number; siteUrl: string; facts: SettlementFacts;
  withdraw(sql: Sql, ctx: ApprovalContext, b: { approval_id: string; reason: string }, trace?: string): Promise<{ state: string }>;
};
export type NonceKey = { chainId: number; safe: Address; nonce: number };
export type Settled = { proposal_id: string; transition: "execute" | "fail" | "reject" | "replace" };

const zero = "0x0000000000000000000000000000000000000000" as Address;
const target = { execute: "executed", fail: "failed", reject: "rejected", replace: "replaced" } as const;

async function scope(sql: Sql, org: string) {
  await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)`, [org]);
}

/** Read-only enumeration of every waiting proposal's nonce key. Each key is carried in its own worker transaction. */
export async function listProposalWaits(sql: Sql, chainId: number): Promise<NonceKey[]> {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error("INVALID_INPUT: chain required");
  const keys = new Map<string, NonceKey>();
  for (const { org_id } of (await sql.query("select org_id from app.organizations order by org_id")).rows) {
    await scope(sql, org_id);
    for (const r of (await sql.query(`select distinct safe_address,nonce from app.board_proposals
      where org_id=$1 and chain_id=$2 and status='awaiting_approvals' order by safe_address,nonce`, [org_id, chainId])).rows) {
      const key = { chainId, safe: r.safe_address as Address, nonce: integer(r.nonce) };
      keys.set(`${key.safe}:${key.nonce}`, key);
    }
  }
  return [...keys.values()];
}

/**
 * board.proposals.carry: woken by safe-executions at (chain_id, safe_address, safe_nonce). Must run in the worker's
 * own transaction. Settles every proposal still waiting at exactly this key; any other key is untouched, and a second
 * run settles nothing. Before the nonce's execution is final, nothing is written.
 */
export async function carryNonce(sql: Sql, world: CarryWorld, key: NonceKey, at: number, trace = ""): Promise<Settled[]> {
  if (key.chainId !== world.chainId || !Number.isSafeInteger(key.nonce) || key.nonce < 0 || !/^0x[\da-fA-F]{40}$/.test(key.safe) ||
      !Number.isSafeInteger(world.finality) || world.finality < 0 || !Number.isSafeInteger(at) || at < 0) {
    throw new Error("INVALID_INPUT: proposal nonce key");
  }
  const safe = key.safe.toLowerCase() as Address;
  const org = (await sql.query("select org_id from app.organizations where safe=$1", [safe])).rows[0]?.org_id as string | undefined;
  if (!org) return [];
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  await scope(sql, org);
  const waiting = (await sql.query(`select proposal_id from app.board_proposals where org_id=$1 and chain_id=$2 and safe_address=$3
    and nonce=$4 and status='awaiting_approvals' order by proposal_id for update`, [org, key.chainId, safe, key.nonce])).rows;
  if (!waiting.length) return [];
  const exec = await world.facts.execution(sql, key.chainId, safe, key.nonce, world.finality);
  if (!exec) return [];
  integer(exec.block_number); integer(exec.threshold);
  const used = exec.safe_tx_hash.toLowerCase();
  // Only a Capxul rejection whose own hash used the nonce rejects; any other foreign hash replaces.
  const rejection = (await sql.query(`select rejects from app.board_proposals where org_id=$1 and safe_address=$2 and nonce=$3
    and kind='rejection' and lower(safe_tx_hash)=$4`, [org, safe, key.nonce, used])).rows[0]?.rejects as string | undefined;
  const settled: Settled[] = [];
  for (const { proposal_id } of waiting) {
    const p = (await readProposal(sql, org, proposal_id))!;
    const own = p.safe_tx_hash.toLowerCase() === used;
    const transition = own ? (exec.success ? "execute" : "fail") : rejection === p.proposal_id ? "reject" : "replace";
    await settle(sql, world, p, exec, transition, at, trace);
    settled.push({ proposal_id, transition });
  }
  return settled;
}

async function settle(sql: Sql, world: CarryWorld, p: Proposal, exec: Execution, transition: Settled["transition"], at: number, trace: string) {
  const approved = await world.facts.approvalsAt(sql, p.chain_id, p.safe_address, p.safe_tx_hash, exec.block_number);
  const status: ProposalStatus = target[transition];
  await sql.query(`update app.board_proposals set status=$3,approved_by=$4,threshold=$5,settled_by_safe_tx_hash=$6,
    execution_user_op_hash=$7,execution_tx_hash=$8,settled_block=$9,settled_at=$10,updated_at=$10
    where org_id=$1 and proposal_id=$2 and status='awaiting_approvals'`,
  [p.org_id, p.proposal_id, status, approved.map((a) => a.toLowerCase()), exec.threshold, exec.safe_tx_hash.toLowerCase(),
    exec.user_op_hash?.toLowerCase() ?? null, exec.tx_hash.toLowerCase(), exec.block_number, at]);
  await proposalEvent(sql, (await readProposal(sql, p.org_id, p.proposal_id))!, "awaiting_approvals", transition, trace, at);
  if (p.opener === "board" && p.subject_kind === "officer-change") {
    const c = await readOfficerChange(sql, p.org_id, p.subject_id);
    if (c?.state === "proposed") {
      const [from, to] = c.change === "grant" ? [zero, c.member_safe] : [c.member_safe, zero];
      const applied = transition === "execute" && await world.facts.hatMoved(sql, p.chain_id, exec.tx_hash, c.hat_id, from, to);
      const state = applied ? "applied" : "ended";
      await sql.query(`update app.officer_changes set state=$3,waiting=null,settled_at=$4,updated_at=$4
        where org_id=$1 and change_id=$2 and state='proposed'`, [p.org_id, c.change_id, state, at]);
      await officerEvent(sql, (await readOfficerChange(sql, p.org_id, c.change_id))!, p.proposer_principal_id, "proposed",
        applied ? "apply" : "end", trace, at);
    }
  }
  // Nobody may sign for a nonce already used: withdraw each Director's approval that is still unsigned.
  const unsigned = (await sql.query(`select a.approval_id,a.director_principal_id,a.director_safe from app.proposal_approvals a
    join app.approvals r on r.person_id=a.director_principal_id and r.approval_id=a.approval_id
    where a.org_id=$1 and a.proposal_id=$2 and r.state in ('sponsoring','pending') order by a.created_at,a.approval_id`,
  [p.org_id, p.proposal_id])).rows;
  for (const a of unsigned) {
    await world.withdraw(sql, { person_id: a.director_principal_id, sender: a.director_safe, site_url: world.siteUrl, now: new Date(at) },
      { approval_id: a.approval_id, reason: "nonce_used" }, trace);
  }
}
