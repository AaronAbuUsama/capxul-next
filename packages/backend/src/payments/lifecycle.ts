import { randomUUID } from "node:crypto";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import type { TerminalEvent } from "../approvals/door.ts";
import { recordMoneyFact, reverseMoneyFact, type MoneySide } from "../books/door.ts";
import { lookupBySafe } from "../parties/door.ts";
import { unmappedPayrollSources, type Owner, type Payment, type PaymentStatus, type PaymentTransitionProps } from "./types.ts";
import { wakePayment } from "./work.ts";

export interface PaymentContext { at: number; traceId: string }
export interface PaymentFact {
  log_id: string; chain_id: number; block_number: string; block_hash: string; block_time: string;
  tx_hash: string; tx_log_ordinal: number; log_index: number;
  payment_id: string; sender: string; recipient: string; token: string; amount: string; kind: number; document_hash: string;
}
async function bookSides(sql: Sql, payment: Payment, fact: PaymentFact): Promise<MoneySide[]> {
  if (payment.source && unmappedPayrollSources.includes(String(payment.source.kind)))
    throw new Error("WRONG_STATE: payroll Books provenance mapping is not available");
  const payee = await lookupBySafe(sql, payment.payee_safe);
  const payer = await lookupBySafe(sql, payment.payer_safe);
  const shared = { money_key: `payment:${payment.chain_payment_id}`, reference: { kind: "payment" as const, id: payment.id },
    source: { kind: "payment" as const, id: payment.id },
    asset_id: `${payment.chain_id}:${payment.token_address}`, symbol: payment.asset, decimals: payment.decimals,
    amount_raw: payment.amount_raw, priced: false, chain_id: payment.chain_id, block_number: Number(fact.block_number),
    block_time: Number(fact.block_time), tx_hash: fact.tx_hash, log_index: fact.log_index, actor: { kind: "system" as const, id: null } };
  const sides: MoneySide[] = [];
  if (payment.owner_kind === "organization") sides.push({ ...shared, org_id: payment.owner_id, kind: "payment_settled", direction: "out",
    safe_address: payment.payer_safe, counterparty: payment.payee_safe, party_id: payee?.party_id ?? null,
    ...(payment.fee_raw === null ? {} : { fee_raw: payment.fee_raw }), against: payment.against as MoneySide["against"] });
  if (payment.payee_kind === "organization" && payment.payee_id && (payment.owner_kind !== "organization" || payment.payee_id !== payment.owner_id)) sides.push({ ...shared,
    org_id: payment.payee_id, kind: "payment_received", direction: "in", safe_address: payment.payee_safe,
    counterparty: payment.payer_safe, party_id: payer?.party_id ?? null, against: payment.payee_against as MoneySide["against"] });
  return sides;
}

const eligible: PaymentStatus[] = ["prepared", "scheduled", "due", "escrowed", "submitted"];
const lock = async (sql: Sql, owner: Owner, id: string) =>
  (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and id=$3 for update", [owner.kind, owner.id, id])).rows[0];

export async function change(sql: Sql, payment: Payment, transition: string, to: PaymentStatus, patch: Partial<Payment>, context: PaymentContext) {
  if (!Number.isSafeInteger(context.at) || context.at < 0) throw new Error("INVALID_INPUT: authoritative transition time required");
  const values = { ...patch, status: to, updated_at: context.at };
  const keys = Object.keys(values) as (keyof typeof values)[];
  const next = (await sql.query<Payment>(`update app.payments set ${keys.map((key, i) => `${key}=$${i + 4}`).join(",")}
    where owner_kind=$1 and owner_id=$2 and id=$3 returning *`,
  [payment.owner_kind, payment.owner_id, payment.id, ...keys.map((key) => values[key])])).rows[0]!;
  const props: PaymentTransitionProps = { from: payment.status, to, transition, payment_id: payment.id,
    owner_kind: payment.owner_kind, owner_id: payment.owner_id, command_id: payment.command_id, route: payment.route, outcome: next.outcome };
  await emit(sql, { id: randomUUID(), name: "payment_transitioned", machine: "payment", entity_id: payment.id,
    owner_kind: payment.owner_kind, owner_id: payment.owner_id, actor: null, trace_id: context.traceId, at: context.at, props: { ...props } });
  await wakePayment(sql, next, context.at, context.traceId);
  return next;
}

/** Called for one durable Payment wake. Facts are read here, not accepted from an RPC or carrier answer. */
export async function followPayment(sql: Sql, owner: Owner, id: string, input: { chainId: number; finality: number }, context: PaymentContext): Promise<Payment | null> {
  if (!Number.isSafeInteger(input.finality) || input.finality < 0) throw new Error("INVALID_INPUT: finality depth");
  const payment = await lock(sql, owner, id);
  if (!payment) return null;
  if (payment.chain_id !== input.chainId) throw new Error("INVALID_INPUT: payment chain differs");
  if (payment.status === "cancelled") return payment;
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  const cutoff = BigInt(progress.indexed_block) - BigInt(input.finality);
  const fact = (await sql.query<PaymentFact>(`select * from app.chain_payments where chain_id=$1 and payment_id=$2 and block_number<=$3`,
    [input.chainId, payment.chain_payment_id, cutoff.toString()])).rows[0];
  if (payment.status === "settled" || payment.status === "mismatched") {
    if (fact && fact.tx_hash === payment.settled_tx_hash && fact.log_index === payment.settled_log_index && fact.block_hash === payment.settled_block_hash) return payment;
    // A lagging head cannot establish that a previously consumed occurrence disappeared.
    if (cutoff < BigInt(payment.settled_block_number!)) return payment;
    const reopened = await change(sql, payment, "unsettle", "submitted", { mismatch: null, settled_tx_hash: null,
      settled_log_index: null, settled_block_number: null, settled_block_hash: null, settled_at: null }, context);
    if (payment.status === "settled") await reverseMoneyFact(sql, { money_key: `payment:${payment.chain_payment_id}`,
      org_ids: [...new Set([...(payment.owner_kind === "organization" ? [payment.owner_id] : []),
        ...(payment.payee_kind === "organization" && payment.payee_id ? [payment.payee_id] : [])])],
      seen_at: context.at, reason: "reorganized" }, context);
    return reopened;
  }
  if (!fact || !eligible.includes(payment.status)) return payment;
  // Compare independently fixed terms, never infer success from a carrier's landed answer.
  const expected = { sender: payment.route === "claim_escrow" ? payment.escrow_address : payment.payer_safe,
    recipient: payment.payee_safe, token: payment.token_address, amount: payment.amount_raw, kind: payment.kind, document_hash: payment.document_hash };
  const mismatch = (Object.keys(expected) as (keyof typeof expected)[]).find((key) => key === "amount"
    ? BigInt(fact.amount) !== BigInt(expected.amount)
    : String(fact[key]).toLowerCase() !== String(expected[key]).toLowerCase());
  const next = await change(sql, payment, mismatch ? "mismatch" : "settle", mismatch ? "mismatched" : "settled", {
    mismatch: mismatch ?? null, outcome: null, shortfall: null, settled_tx_hash: fact.tx_hash, settled_log_index: fact.log_index,
    settled_block_number: Number(fact.block_number), settled_block_hash: fact.block_hash, settled_at: Number(fact.block_time),
  }, context);
  // Books takes its feed locks last. A failure rolls back the Payment and its source outbox as well.
  if (!mismatch) await recordMoneyFact(sql, { sides: await bookSides(sql, next, fact) }, context);
  return next;
}

/** Approval carrier callback in its existing transaction. A landed carrier submits, never settles money. */
export async function approvalTerminal(sql: Sql, event: TerminalEvent, context: PaymentContext): Promise<number> {
  if (event.opener !== "payments" || !["payment-command", "payment"].includes(event.subject_kind)) return 0;
  const owner: Owner = event.org_id ? { kind: "organization", id: event.org_id } : { kind: "person", id: event.person_id };
  const rows = (await sql.query<Payment>(`select * from app.payments where owner_kind=$1 and owner_id=$2 and approval_id=$3
    and chain_id=$4 and (($6='payment-command' and command_id=$5) or ($6='payment' and id=$5)) order by id for update`,
  [owner.kind, owner.id, event.approval_id, event.chain_id, event.subject_id, event.subject_kind])).rows;
  let changed = 0;
  for (const payment of rows) {
    // A landed dated budget call may only reserve. Its indexed reservation, not its carrier, schedules it.
    if (event.outcome === "landed" && payment.route === "budget" && payment.pay_at !== null) {
      await wakePayment(sql, payment, context.at, context.traceId);
      continue;
    }
    if (event.outcome === "landed" && ["prepared", "scheduled", "due"].includes(payment.status)) {
      await change(sql, payment, "submit", "submitted", { outcome: null }, context);
      changed++;
    } else if (["expired", "displaced", "reverted"].includes(event.outcome) && ["prepared", "scheduled", "due", "submitted"].includes(payment.status)) {
      await change(sql, payment, "lapse", "needs_retry", { outcome: event.outcome as "expired" | "displaced" | "reverted" }, context);
      changed++;
    } else if (["declined", "refused", "withdrawn"].includes(event.outcome) && ["prepared", "scheduled", "due"].includes(payment.status)) {
      await change(sql, payment, "cancel", "cancelled", { outcome: event.outcome as "declined" | "refused" | "withdrawn" }, context);
      changed++;
    }
  }
  return changed;
}
