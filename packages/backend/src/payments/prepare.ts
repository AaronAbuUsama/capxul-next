import { randomBytes } from "node:crypto";
import { encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, stringToHex, type Abi, type Hex } from "viem";
import exported from "../../../contracts/abi/abi.json" with { type: "json" };
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { lookup } from "../parties/door.ts";
import { open, readApproval, type ApprovalContext } from "../approvals/door.ts";
import type { Owner, Payment } from "./types.ts";
import { wakePayment } from "./work.ts";

export interface PreparedItem {
  payee_party_id: string; payee_safe: string; payee_label: string; payee_kind: "person" | "organization" | null; payee_id: string | null;
  token_address: string; asset: string; decimals: number; amount_raw: string; kind: number; document_id: string | null; document_hash: string;
  against?: Record<string, unknown>; payee_against?: Record<string, unknown>; source?: Record<string, unknown>; fee_raw?: string; payee_mailbox?: string;
}
export interface PrepareCommand {
  owner_kind: "person" | "organization"; owner_id: string; requested_by: string; request_key: string;
  purpose: "request" | "bank_payout" | "payroll"; route: "personal" | "budget"; payer_safe: string; payer_label: string;
  budget_id: string | null; chain_id: number; funding: { raw: string; block_number: number; of: "balance" | "budget_left" };
  items: PreparedItem[]; summary: string; pay_at: number | null; not_after: number | null; resume: boolean;
}
/** Deployment/principal/time are resolved by the caller before entering its transaction, not from the request body. */
export interface PrepareContext {
  owner: Owner; approval: ApprovalContext; payments: string; budgets: string; deadline: number; traceId: string;
}
export interface PreparedCommand { command_id: string; payment_ids: string[]; approval_id: string; expires_at: number; replayed: boolean }

const contracts = (exported as unknown as { contracts: Record<string, { abi: Abi }> }).contracts;
const address = /^0x[0-9a-f]{40}$/;
const hash = /^0x[0-9a-f]{64}$/;
const nonzero = (s: string) => !/^0x0+$/.test(s);
const typeHash = keccak256(stringToHex("CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"));
function id(prefix: string, at: number) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let value = (BigInt(at) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`), result = "";
  for (let i = 0; i < 26; i++) { result = alphabet[Number(value & 31n)] + result; value >>= 5n; }
  return `${prefix}_${result}`;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Same-Sql K1/K2 birth; no chain, sponsor, file, pool, checkout or transaction boundary. */
export async function prepareCommand(sql: Sql, input: PrepareCommand, context: PrepareContext): Promise<PreparedCommand> {
  const at = context.approval.now.getTime();
  if (!Number.isSafeInteger(at) || at < 0 || !input.owner_id || !input.request_key || !input.items.length ||
      input.owner_kind !== context.owner.kind || input.owner_id !== context.owner.id || !["personal", "budget"].includes(input.route) ||
      !["request", "bank_payout", "payroll"].includes(input.purpose) || typeof input.resume !== "boolean" ||
      !Number.isSafeInteger(input.chain_id) || input.chain_id < 1 || !input.requested_by || input.requested_by !== context.approval.person_id ||
      !Number.isSafeInteger(input.funding.block_number) || input.funding.block_number < 0 || !/^\d+$/.test(input.funding.raw) ||
      !Number.isSafeInteger(context.deadline) ||
      (input.pay_at !== null && !Number.isSafeInteger(input.pay_at)) ||
      (input.not_after !== null && !Number.isSafeInteger(input.not_after)))
    throw new Error("INVALID_INPUT: payment command terms");
  const b = { ...input, payer_safe: input.payer_safe.toLowerCase(), items: input.items.map((item) => ({ ...item,
    payee_safe: item.payee_safe.toLowerCase(), token_address: item.token_address.toLowerCase(), document_hash: item.document_hash.toLowerCase() })) };
  if (![b.payer_safe, context.payments, context.budgets].every((s) => address.test(s.toLowerCase()) && nonzero(s.toLowerCase())) ||
      b.items.some((item) => !address.test(item.payee_safe) || !nonzero(item.payee_safe) || item.payee_safe === context.payments.toLowerCase() ||
        !address.test(item.token_address) || !nonzero(item.token_address) || !hash.test(item.document_hash) || !nonzero(item.document_hash) ||
        !/^\d+$/.test(item.amount_raw) || BigInt(item.amount_raw) <= 0n || BigInt(item.amount_raw) >= 1n << 256n ||
        (item.fee_raw !== undefined && !/^\d+$/.test(item.fee_raw)) ||
        !Number.isInteger(item.decimals) || item.decimals < 0 || item.decimals > 255 || !Number.isInteger(item.kind) || item.kind < 0 || item.kind > 65535 ||
        item.token_address !== b.items[0]!.token_address || item.decimals !== b.items[0]!.decimals))
    throw new Error("INVALID_INPUT: payment item terms");
  for (const item of b.items) item.amount_raw = BigInt(item.amount_raw).toString();
  const digest = keccak256(stringToHex(canonical({ ...b, funding: undefined, resume: undefined, requested_by: undefined })));
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 8137))", [JSON.stringify([b.owner_kind, b.owner_id, b.request_key])]);
  const old = (await sql.query("select * from app.payment_commands where owner_kind=$1 and owner_id=$2 and request_key=$3 for update", [b.owner_kind, b.owner_id, b.request_key])).rows[0];
  const previous = old ? (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and command_id=$3 order by created_at,id for update", [b.owner_kind, b.owner_id, old.id])).rows : [];
  if (old && old.request_digest !== digest) throw new Error("IDEMPOTENCY_CONFLICT: request key has different payment terms");
  if (old && !b.resume) {
    const approval = old.approval_id && await readApproval(sql, old.approval_id);
    if (!approval) throw new Error("WRONG_STATE: command approval unavailable");
    return { command_id: old.id, payment_ids: previous.map((p) => p.id), approval_id: old.approval_id, expires_at: approval.deadline.getTime(), replayed: true };
  }
  if (old) {
    const approval = old.approval_id && await readApproval(sql, old.approval_id);
    if (!previous.length || previous.some((p) => p.status !== "needs_retry") || !approval ||
        !["expired", "displaced", "reverted"].includes(approval.state)) throw new Error("WRONG_STATE: command is not retryable");
  }
  if (b.not_after !== null && b.not_after <= at) throw new Error("WRONG_STATE: payment window ended");
  if (context.deadline <= at || (!old && b.pay_at !== null && b.pay_at < at + 3_600_000) ||
      (b.pay_at !== null && b.not_after !== null && b.pay_at >= b.not_after)) throw new Error("INVALID_INPUT: payment window");
  const total = b.items.reduce((sum, item) => sum + BigInt(item.amount_raw), 0n);
  if (BigInt(b.funding.raw) < total) throw new Error(b.route === "budget" ? "PAYROLL_BUDGET_EXCEEDED: insufficient budget room" : "INSUFFICIENT_BALANCE: insufficient funds");
  const payer = (await sql.query("select 1 from app.parties where safe_address=$1 and owner_kind=$2 and owner_id=$3 and state='active'", [b.payer_safe, b.owner_kind, b.owner_id])).rowCount;
  if (!payer) throw new Error("FORBIDDEN: payer is not this owner's active Safe");
  if (b.route === "personal") {
    if (b.owner_kind !== "person" || b.owner_id !== context.approval.person_id || b.payer_safe !== context.approval.sender.toLowerCase() || b.budget_id !== null || b.funding.of !== "balance") throw new Error("INVALID_INPUT: personal payer context");
  } else {
    if (b.owner_kind !== "organization" || !b.budget_id || !/^\d+$/.test(b.budget_id) || b.funding.of !== "budget_left" || b.items.some((item) => BigInt(item.amount_raw) >= 1n << 128n || item.kind > 3)) throw new Error("INVALID_INPUT: budget terms");
    const progress = (await sql.query("select ready from app.indexer_progress where chain_id=$1", [b.chain_id])).rows[0];
    if (!progress?.ready) throw new Error("INDEXER_NOT_READY: budget authority requires canonical indexed head");
    const budget = (await sql.query(`with recursive path as (
      select b.*,1 as depth from app.chain_budgets b
        where b.budget_id=$1 and b.chain_id=$2 and b.company_safe=$3 and b.token=$4
      union all
      select b.*,p.depth+1 from app.chain_budgets b join path p on b.budget_id=p.parent_budget_id
        and b.chain_id=p.chain_id and b.company_safe=p.company_safe where p.depth<8
    ) select exists(select 1 from path where closed) as closed,
      exists(select 1 from path p where p.company_safe=$5 or exists (
      select 1 from app.hat_wearers h where h.chain_id=p.chain_id and h.company_safe=p.company_safe
        and h.hat_id=p.hat_id and h.wearer=$5 and h.wearing and h.standing)) as authorized`,
    [b.budget_id, b.chain_id, b.payer_safe, b.items[0]!.token_address, context.approval.sender.toLowerCase()])).rows[0];
    if (budget?.closed) throw new Error("WRONG_STATE: budget path is closed");
    if (!budget?.authorized) throw new Error("FORBIDDEN: current budget authority required");
  }
  for (const item of b.items) {
    const party = await lookup(sql, item.payee_party_id);
    if (!party || party.safe_address !== item.payee_safe || party.owner_kind !== item.payee_kind || party.owner_id !== item.payee_id) throw new Error("INVALID_RECIPIENT: recipient differs from Party");
    // General escrow contracts are explicitly not built; never pretend a direct send implements that route.
    if (party.state === "provisional") throw new Error("INVALID_RECIPIENT: claim escrow protocol is not available");
  }
  const commandId = old?.id ?? id("paycmd", at), deadline = Math.min(context.deadline, b.not_after ?? Infinity);
  const remaining = [...previous];
  const prepared = b.items.map((item) => {
    const match = old ? remaining.findIndex((p) => p.payee_safe === item.payee_safe && p.token_address === item.token_address && p.amount_raw === item.amount_raw && p.kind === item.kind && p.document_hash === item.document_hash) : -1;
    if (old && match < 0) throw new Error("WRONG_STATE: retry terms differ from their Payments");
    const prior = match < 0 ? undefined : remaining.splice(match, 1)[0];
    const nonce = prior?.job_nonce as Hex | undefined ?? `0x${randomBytes(32).toString("hex")}` as Hex;
    const job = b.route === "budget" ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [context.budgets as Hex, BigInt(b.budget_id!), nonce])) : nonce;
    const paymentId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint16" }, { type: "bytes32" }],
      [typeHash, BigInt(b.chain_id), context.payments as Hex, job, b.payer_safe as Hex, item.payee_safe as Hex, item.token_address as Hex, BigInt(item.amount_raw), item.kind, item.document_hash as Hex]));
    if (prior && prior.chain_payment_id !== paymentId) throw new Error("WRONG_STATE: retry deployment differs");
    return { item, id: prior?.id ?? id("payment", at), nonce, paymentId, job };
  });
  // Keep the dated intent in its digest/rows; only the replacement's executable timing changes.
  const payAt = old && b.pay_at !== null && (b.route === "budget"
    ? Math.floor(b.pay_at / 1000) <= Math.floor(at / 1000) : b.pay_at <= at) ? null : b.pay_at;
  const calls = b.route === "budget" ? prepared.map(({ item, nonce }) => ({ to: context.budgets, value: "0", data: encodeFunctionData({ abi: contracts.Budgets!.abi,
    functionName: payAt === null ? "spend" : "schedule", args: [BigInt(b.budget_id!), item.payee_safe, BigInt(item.amount_raw), item.kind,
      ...(payAt === null ? [] : [BigInt(Math.floor(payAt / 1000))]), item.document_hash, nonce] }) })) : [
    { to: b.items[0]!.token_address, value: "0", data: encodeFunctionData({ abi: [{ type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }], functionName: "approve", args: [context.payments as Hex, total] }) },
    { to: context.payments, value: "0", data: encodeFunctionData({ abi: contracts.Payments!.abi, functionName: "sendBatch", args: [prepared.map(({ item, paymentId, job }) => ({ paymentId, recipient: item.payee_safe, token: item.token_address, amount: BigInt(item.amount_raw), kind: item.kind, documentHash: item.document_hash, jobNonce: job, executor: b.payer_safe }))] }) },
  ];
  const approval = await open(sql, context.approval, { org_id: b.owner_kind === "organization" ? b.owner_id : null,
    opener: "payments", subject_kind: "payment-command", subject_id: commandId, chain_id: b.chain_id, calls,
    deadline: new Date(deadline).toISOString(), ...(b.route === "personal" && payAt !== null ? { send_after: new Date(payAt).toISOString() } : {}),
    summary: { title: b.summary, from: { label: b.payer_label, address: b.payer_safe }, to: { label: b.items.length === 1 ? b.items[0]!.payee_label : `${b.items.length} recipients` },
      amount: { asset: b.items[0]!.asset, value: formatUnits(total, b.items[0]!.decimals) }, recipients: b.items.map((item) => ({ label: item.payee_label,
        amount: { asset: item.asset, value: formatUnits(BigInt(item.amount_raw), item.decimals) }, requestedOutput: null, exact: true, rail: "wallet", warning: null })), warnings: [] } }, context.traceId);
  await sql.query(`insert into app.payment_commands(owner_id,owner_kind,id,request_key,request_digest,route,purpose,requested_by,approval_id,not_after,created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(owner_id,owner_kind,id) do update set approval_id=excluded.approval_id`,
  [b.owner_id, b.owner_kind, commandId, b.request_key, digest, b.route, b.purpose, b.requested_by, approval.approval_id, b.not_after, at]);
  for (const { item, id: paymentId, nonce, paymentId: chainPaymentId } of prepared) {
    if (old) await sql.query("update app.payments set status='prepared',outcome=null,approval_id=$4,updated_at=$5 where owner_kind=$1 and owner_id=$2 and id=$3", [b.owner_kind, b.owner_id, paymentId, approval.approval_id, at]);
    else await sql.query(`insert into app.payments(owner_id,owner_kind,id,command_id,origin,route,status,kind,chain_id,chain_payment_id,job_nonce,payer_safe,payer_label,
      payee_kind,payee_id,payee_safe,payee_label,token_address,asset,decimals,amount_raw,document_id,document_hash,pay_at,budget_id,against,payee_against,source,fee_raw,approval_id,created_at,updated_at,payee_mailbox)
      values ($1,$2,$3,$4,'prepared',$5,'prepared',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$29,$30)`,
    [b.owner_id,b.owner_kind,paymentId,commandId,b.route,item.kind,b.chain_id,chainPaymentId,nonce,b.payer_safe,b.payer_label,item.payee_kind,item.payee_id,item.payee_safe,item.payee_label,
      item.token_address,item.asset,item.decimals,item.amount_raw,item.document_id,item.document_hash,b.pay_at,b.budget_id,item.against ?? null,item.payee_against ?? null,item.source ?? null,item.fee_raw ?? null,approval.approval_id,at,item.payee_mailbox ?? null]);
    await emit(sql, { id: `payment:${paymentId}:${approval.approval_id}`, name: "payment_transitioned", machine: "payment", entity_id: paymentId,
      owner_kind: b.owner_kind, owner_id: b.owner_id, actor: b.requested_by, trace_id: context.traceId, at,
      props: { from: old ? "needs_retry" : null, to: "prepared", transition: old ? "retry" : "open", payment_id: paymentId,
        owner_kind: b.owner_kind, owner_id: b.owner_id, command_id: commandId, route: b.route, outcome: null } });
    await wakePayment(sql, { owner_kind: b.owner_kind, owner_id: b.owner_id, id: paymentId, chain_id: b.chain_id }, at, context.traceId);
  }
  return { command_id: commandId, payment_ids: prepared.map((p) => p.id).sort(), approval_id: approval.approval_id, expires_at: new Date(approval.deadline).getTime(), replayed: false };
}
