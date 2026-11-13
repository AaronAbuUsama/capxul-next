import { randomUUID } from "node:crypto";
import { encodeFunctionData, parseAbi, zeroHash, type Address, type PublicClient } from "viem";
import type { Sql } from "../platform/db.ts";
import { readProposal } from "./door.ts";
import { proposalEvent } from "./events.ts";
import { approvalCalls, cleanupThreshold, transaction, transactionHash } from "./transactions.ts";
import type { ApprovalContext, BoardDoors, BoardFacts, GateCatalogue, Summary } from "./runtime.ts";
import { integer, type Call, type Proposal } from "./types.ts";

export type BoardContext = {
  principalId: string; safe: Address; kind: "human" | "agent"; chainId: number; siteUrl: string; now: number;
  multiSend: Address; client: PublicClient; doors: BoardDoors; facts: BoardFacts; catalogue: GateCatalogue;
};
export type Propose = Pick<Proposal, "org_id" | "opener" | "subject_kind" | "subject_id" | "kind" | "rejects" | "note" | "payment">
  & { calls: Call[]; summary: Summary };
export type Proposed = { proposal_id: string; nonce: number; safe_tx_hash: `0x${string}`;
  approval_id: string; url: string; step: "approve" | "execute"; opened: boolean };

const safeAbi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function nonce() view returns (uint256)"]);
const gateAbi = parseAbi(["function isValidSigner(address account) view returns (bool)",
  "function thresholdConfig() view returns ((uint8 thresholdType,uint120 min,uint120 target) config)"]);

export async function requireMember(sql: Sql, org: string, context: BoardContext) {
  await context.doors.requireSeat(sql, org, context);
  // Access deliberately clears org scope. Admit the actual Seat before changing it, even for workers.
  await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)`, [org]);
}

export async function deployment(sql: Sql, org: string, context: BoardContext) {
  const r = await context.facts.deployment(sql, org, context.chainId);
  if (!r) throw new Error("WRONG_STATE: Organization has no deployment");
  return r;
}

const lower = (list: readonly string[]) => list.map((a) => a.toLowerCase() as Address);

export async function directors(sql: Sql, org: string, context: BoardContext) {
  const d = await deployment(sql, org, context);
  const safe = await context.facts.safe(sql, context.chainId, d.safe_address);
  if (!safe) throw new Error("WRONG_STATE: company Safe is not indexed");
  // Compare Safes in one case: indexed and provider addresses may arrive checksummed.
  const owners = lower(safe.owners), valid = lower(await context.facts.wearers(sql, context.chainId, d.safe_address, d.director_hat, owners));
  return { deployment: d, safe: { ...safe, owners }, valid, lapsed: owners.filter((s) => !valid.includes(s)),
    executionThreshold: integer(safe.threshold), blockNumber: undefined as bigint | undefined };
}

export async function requireDirector(sql: Sql, org: string, context: BoardContext, live = false) {
  await requireMember(sql, org, context);
  await context.doors.requireFeature(sql, "owner-safe-proposals", { personId: context.principalId, orgId: org }, context.catalogue, context.now);
  let state = await directors(sql, org, context);
  if (live) {
    // Pin every live read to one block, not different RPC heads between owner and hat reads.
    try {
      const blockNumber = await context.client.getBlockNumber({ cacheTime: 0 });
      const address = state.deployment.safe_address as Address;
      const [owners, threshold, nonce, config] = await Promise.all([
        context.client.readContract({ address, abi: safeAbi, functionName: "getOwners", blockNumber }),
        context.client.readContract({ address, abi: safeAbi, functionName: "getThreshold", blockNumber }),
        context.client.readContract({ address, abi: safeAbi, functionName: "nonce", blockNumber }),
        context.client.readContract({ address: state.deployment.gate_address, abi: gateAbi, functionName: "thresholdConfig", blockNumber }),
      ]);
      const validity = await Promise.all(owners.map((owner) => context.client.readContract({ address: state.deployment.gate_address,
        abi: gateAbi, functionName: "isValidSigner", args: [owner], blockNumber })));
      const normalized = owners.map((owner) => owner.toLowerCase() as Address);
      const valid = normalized.filter((_, i) => validity[i]), lapsed = normalized.filter((_, i) => !validity[i]);
      // Validate config even if no cleanup is needed; retain its uint120 values as bigint.
      const cleanedThreshold = cleanupThreshold(config, valid.length);
      state = { ...state, blockNumber, safe: { ...state.safe, owners: normalized, threshold: integer(threshold), nonce: integer(nonce) },
        valid, lapsed, executionThreshold: lapsed.length ? cleanedThreshold : integer(threshold) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PROVIDER_RESPONSE_INVALID")) throw error;
      throw new Error("PROVIDER_ERROR: could not read current Board signers");
    }
  }
  const me = context.safe.toLowerCase() as Address;
  if (context.kind !== "human" || !state.safe.owners.includes(me)) throw new Error("ROLE_PERMISSION_DENIED: current Director required");
  if (!state.valid.includes(me)) throw new Error("ROLE_PERMISSION_DENIED: director_hat_lapsed");
  return state;
}

export function approvalContext(c: BoardContext): ApprovalContext {
  return { person_id: c.principalId, sender: c.safe.toLowerCase(), site_url: c.siteUrl, now: new Date(c.now) };
}

async function openApproval(sql: Sql, c: BoardContext, p: Proposal, state: Awaited<ReturnType<typeof directors>>, summary: Summary, trace: string) {
  const live = (await sql.query(`select a.approval_id,a.step,r.deadline from app.proposal_approvals a
    join app.approvals r on r.person_id=a.director_principal_id and r.approval_id=a.approval_id
    where a.org_id=$1 and a.proposal_id=$2 and a.director_principal_id=$3
      and r.state in ('sponsoring','pending','signed','sending','sent') order by a.created_at desc limit 1`,
  [p.org_id, p.proposal_id, c.principalId])).rows[0];
  if (live) return { ...live, url: `${c.siteUrl.replace(/\/$/, "")}/approve/${live.approval_id}`, opened: false };
  const me = c.safe.toLowerCase() as Address, approved = lower(await c.facts.approvals(sql, c.chainId, p.safe_address, p.safe_tx_hash, state.valid));
  const execute = new Set([...approved, me]).size >= state.executionThreshold && p.nonce === integer(state.safe.nonce);
  if (!execute && approved.includes(me)) throw new Error("WRONG_STATE: Director already approved; wait for other Directors");
  const step = execute ? "execute" : "approve";
  const sendAfter = execute && p.payment && p.payment.sends_at > c.now ? p.payment.sends_at : c.now;
  const opened = await c.doors.open(sql, approvalContext(c), { org_id: p.org_id, opener: "board", subject_kind: "proposal", subject_id: p.proposal_id,
    chain_id: c.chainId, calls: approvalCalls(p, me, approved, state.lapsed, state.deployment.gate_address, execute),
    summary, deadline: new Date(sendAfter + 10 * 60_000).toISOString(),
    ...(sendAfter > c.now ? { send_after: new Date(sendAfter).toISOString() } : {}), gate: "owner-safe-proposals" }, trace);
  await sql.query(`insert into app.proposal_approvals (org_id,proposal_id,approval_id,director_principal_id,director_safe,step,created_at)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`, [p.org_id, p.proposal_id, opened.approval_id, c.principalId, me, step, c.now]);
  return { ...opened, step };
}

/** Called only after a trusted principal has been admitted to this Organization. No external effects. */
export async function propose(sql: Sql, context: BoardContext, input: Propose, trace = ""): Promise<Proposed> {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [input.org_id]);
  const state = await requireDirector(sql, input.org_id, context);
  return createProposal(sql, context, input, state, trace);
}

/** Internal public-mutation path: retain the live authority and nonce already read by the RPC. */
export async function createProposal(sql: Sql, context: BoardContext, input: Propose, state: Awaited<ReturnType<typeof directors>>, trace = ""): Promise<Proposed> {
  if (!input.subject_id || !input.subject_kind || !["board", "agents", "budgets", "payments", "payroll", "equity"].includes(input.opener) ||
      !["transaction", "rejection", "scheduled_payment"].includes(input.kind) ||
      (input.kind === "scheduled_payment") !== (input.payment !== null) ||
      (input.payment && (!input.payment.payment_id || !Number.isSafeInteger(input.payment.sends_at) || input.payment.sends_at < 0 ||
        input.payment.sends_at > 8_640_000_000_000_000 - 600_000))) {
    throw new Error("INVALID_INPUT: proposal subject, kind and payment terms required");
  }
  const prior = (await sql.query(`select proposal_id from app.board_proposals
    where org_id=$1 and opener=$2 and subject_kind=$3 and subject_id=$4`, [input.org_id, input.opener, input.subject_kind, input.subject_id])).rows[0];
  // Retrying a subject answers its proposal and the proposer's first approval as they stand. Openers own their
  // subjects, so a different caller or changed calls cannot reach here today; neither is compared.
  if (prior) {
    const p = (await readProposal(sql, input.org_id, prior.proposal_id))!;
    const a = (await sql.query(`select approval_id,step from app.proposal_approvals where org_id=$1 and proposal_id=$2
      and director_principal_id=$3 order by created_at limit 1`, [input.org_id, p.proposal_id, p.proposer_principal_id])).rows[0]!;
    return { proposal_id: p.proposal_id, nonce: p.nonce, safe_tx_hash: p.safe_tx_hash, approval_id: a.approval_id,
      url: `${context.siteUrl.replace(/\/$/, "")}/approve/${a.approval_id}`, step: a.step, opened: false };
  }
  const tx = transaction(input.calls, context.multiSend);
  const calls = input.calls.map(({ to, value, data }) => ({ to: to.toLowerCase() as Address, value, data: data.toLowerCase() as Call["data"] }));
  if (calls.some((call) => call.to.toLowerCase() === state.safe.safe_address.toLowerCase())) throw new Error("INVALID_INPUT: proposal cannot call the company Safe");
  let nonce = integer(state.safe.nonce);
  if (input.rejects) {
    const rejected = await readProposal(sql, input.org_id, input.rejects);
    if (input.kind !== "rejection" || !rejected || rejected.kind === "rejection" || rejected.status !== "awaiting_approvals") throw new Error("WRONG_STATE: only a waiting transaction may be rejected");
    nonce = rejected.nonce;
  } else {
    if (input.kind === "rejection") throw new Error("INVALID_INPUT: rejection must name its proposal");
    const waiting = (await sql.query("select max(nonce) as nonce from app.board_proposals where org_id=$1 and status='awaiting_approvals'", [input.org_id])).rows[0];
    if (waiting?.nonce !== null && waiting?.nonce !== undefined) nonce = Math.max(nonce, integer(waiting.nonce) + 1);
  }
  integer(nonce);
  const id = `sp_${randomUUID().replaceAll("-", "")}`;
  const hash = transactionHash(context.chainId, state.safe.safe_address, nonce, tx);
  await sql.query(`insert into app.board_proposals
    (org_id,proposal_id,chain_id,safe_address,nonce,safe_tx_hash,kind,rejects,"to",value,data,operation,calls,note,opener,
     subject_kind,subject_id,payment,proposer_principal_id,proposer_safe,status,approved_by,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'awaiting_approvals','{}',$21,$21)`,
  [input.org_id, id, context.chainId, state.safe.safe_address, nonce, hash, input.kind, input.rejects,
    tx.to, tx.value, tx.data, tx.operation, JSON.stringify(calls), input.note, input.opener, input.subject_kind, input.subject_id,
    input.payment && JSON.stringify(input.payment), context.principalId, context.safe.toLowerCase(), context.now]);
  const p = (await readProposal(sql, input.org_id, id))!;
  const approval = await openApproval(sql, context, p, state, input.summary, trace);
  await proposalEvent(sql, p, null, "propose", trace, context.now);
  return { proposal_id: id, nonce, safe_tx_hash: hash, approval_id: approval.approval_id, url: approval.url, step: approval.step, opened: true };
}

export async function approve(sql: Sql, context: BoardContext, org: string, id: string, trace = "") {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const state = await requireDirector(sql, org, context, true);
  const p = await readProposal(sql, org, id);
  if (!p) throw new Error("INVALID_INPUT: unknown proposal");
  if (p.status !== "awaiting_approvals") throw new Error("WRONG_STATE: proposal no longer waits");
  const opened = await openApproval(sql, context, p, state, { title: p.note ?? "Board proposal", from: { label: org, address: p.safe_address },
    to: { label: "Board" }, amount: null, recipients: [], warnings: [] }, trace);
  const a = (await sql.query("select * from app.approvals where person_id=$1 and approval_id=$2", [context.principalId, opened.approval_id])).rows[0]!;
  const company = (await sql.query("select name from app.organizations where org_id=$1", [org])).rows[0]!;
  const time = (value: string | Date | null) => value === null ? null : new Date(value).getTime();
  return { proposalId: id, step: opened.step, approvalId: opened.approval_id, url: opened.url, kind: "safe_proposal" as const,
    state: ["signed", "sending", "sent"].includes(a.state) ? "approved" as const : "pending" as const,
    actor: { orgId: org, name: company.name as string }, summary: a.summary,
    operation: a.user_operation && a.digest ? { userOperation: a.user_operation, digest: a.digest } : null,
    signer: a.signer_address ? { address: a.signer_address } : null, expiresAt: time(a.valid_until ?? a.deadline)!,
    createdAt: time(a.created_at)!, reviewedAt: time(a.reviewed_at), decidedAt: time(a.signed_at), consumedAt: time(a.ended_at) };
}

export async function reject(sql: Sql, context: BoardContext, org: string, id: string, payments: Address, trace = "") {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const state = await requireDirector(sql, org, context, true);
  const p = await readProposal(sql, org, id);
  if (!p) throw new Error("INVALID_INPUT: unknown proposal");
  if (p.status !== "awaiting_approvals" || p.kind === "rejection") throw new Error("WRONG_STATE: only a waiting transaction may be rejected");
  const prior = (await sql.query("select proposal_id from app.board_proposals where org_id=$1 and rejects=$2 and status='awaiting_approvals'", [org, id])).rows[0];
  if (prior) return prior.proposal_id as string;
  const result = await createProposal(sql, context, { org_id: org, opener: "board", subject_kind: "rejection", subject_id: id,
    kind: "rejection", rejects: id, calls: [{ to: payments, value: "0", data: encodeFunctionData({
      abi: parseAbi(["function paid(bytes32 id) view returns (bool)"]), functionName: "paid", args: [zeroHash] }) }],
    note: `Reject ${id}`, payment: null, summary: { title: `Reject ${id}`, from: { label: org, address: p.safe_address },
      to: { label: "Board" }, amount: null, recipients: [], warnings: [] } }, state, trace);
  return result.proposal_id;
}
