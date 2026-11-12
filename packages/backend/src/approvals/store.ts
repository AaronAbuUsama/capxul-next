import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import type { Approval, ApprovalContext, ApprovalState, Open, Opened, Terminal } from "./types.ts";

const live = ["sponsoring", "pending", "signed", "sending", "sent"];
export const sources = {
  sponsor: ["sponsoring"], refuse: ["sponsoring"], sign: ["pending"], decline: ["sponsoring", "pending"],
  withdraw: ["sponsoring", "pending"], claim_send: ["signed"], accept: ["sending"], bounce: ["sending"],
  land: ["signed", "sending", "sent"], revert: ["signed", "sending", "sent"],
  displace: ["sponsoring", "pending", "signed", "sending", "sent"], expire: ["sponsoring", "pending", "signed", "sending", "sent"],
} as const;
export const targets: Record<keyof typeof sources, ApprovalState> = {
  sponsor: "pending", refuse: "refused", sign: "signed", decline: "declined", withdraw: "withdrawn",
  claim_send: "sending", accept: "sent", bounce: "signed", land: "landed", revert: "reverted", displace: "displaced", expire: "expired",
};

export async function read(sql: Sql, person: string, id: string): Promise<Approval> {
  const row = (await sql.query("select * from app.approvals where person_id=$1 and approval_id=$2 for update", [person, id])).rows[0];
  if (!row) throw new Error("INVALID_INPUT: approvalId");
  return row;
}
export async function wake(sql: Sql, row: Approval, trace: string, at: Date) {
  await sql.query(`insert into app.approval_carriers (approval_id,person_id,trace_id,wake_at) values ($1,$2,$3,$4)
    on conflict (approval_id) do update set wake_at=excluded.wake_at,wake_version=app.approval_carriers.wake_version+1`, [row.approval_id, row.person_id, trace, at]);
}
async function event(sql: Sql, row: Approval, from: ApprovalState | null, transition: string, trace: string, now: Date) {
  await wake(sql, row, trace, now);
  const revision = (await sql.query("update app.approval_carriers set revision=revision+1 where approval_id=$1 returning revision", [row.approval_id])).rows[0].revision;
  await emit(sql, {
    id: `approval:${row.approval_id}:${revision}`, name: "approval_transitioned", machine: "approval",
    entity_id: row.approval_id, owner_kind: "person", owner_id: row.person_id, actor: row.person_id, trace_id: trace, at: now.getTime(),
    props: { from, to: row.state, transition, approval_id: row.approval_id, person_id: row.person_id, org_id: row.org_id,
      opener: row.opener, subject_kind: row.subject_kind, subject_id: row.subject_id },
  });
}

export async function open(sql: Sql, ctx: ApprovalContext, b: Open, trace = ""): Promise<Opened> {
  const deadline = new Date(b.deadline), day = b.send_after ? new Date(b.send_after) : null;
  if (!ctx.person_id || !/^0x[0-9a-fA-F]{40}$/.test(ctx.sender) || /^0x0{40}$/.test(ctx.sender) || !Number.isFinite(ctx.now.getTime()) ||
      !b.subject_id || !b.subject_kind || !Number.isSafeInteger(b.chain_id) || b.chain_id <= 0 || !b.calls.length ||
      !Number.isFinite(deadline.getTime()) || deadline <= ctx.now ||
      (day && (!Number.isFinite(day.getTime()) || day <= ctx.now || day >= deadline)) ||
      b.calls.some((c) => !/^0x[0-9a-fA-F]{40}$/.test(c.to) || !/^\d+$/.test(c.value) || !/^0x(?:[0-9a-fA-F]{2})*$/.test(c.data))) {
    throw new Error("INVALID_INPUT: approval terms");
  }
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`approval-subject:${ctx.person_id}:${b.opener}:${b.subject_id}`]);
  const old = (await sql.query("select * from app.approvals where person_id=$1 and opener=$2 and subject_id=$3 and state=any($4) order by created_at limit 1 for update",
    [ctx.person_id, b.opener, b.subject_id, live])).rows[0] as Approval | undefined;
  const output = (r: Approval, opened: boolean) => ({ approval_id: r.approval_id, url: `${ctx.site_url.replace(/\/$/, "")}/approve/${r.approval_id}`, deadline: r.deadline.toISOString(), opened });
  if (old) return output(old, false);
  let replacement: Approval | undefined;
  if (b.replaces) {
    replacement = await read(sql, ctx.person_id, b.replaces);
    if (replacement.state !== "signed" || !replacement.send_after || replacement.send_after <= ctx.now ||
        replacement.sender !== ctx.sender.toLowerCase() || replacement.chain_id !== b.chain_id || !replacement.nonce) {
      throw new Error("WRONG_STATE: replacement is not a signed held approval of this Safe");
    }
  }
  const id = `approval_${randomUUID().replaceAll("-", "")}`;
  const key = replacement?.nonce_key ?? (BigInt(keccak256(stringToHex(id))) & ((1n << 192n) - 1n) || 1n).toString();
  const row = (await sql.query(`insert into app.approvals
    (person_id,approval_id,state,org_id,opener,subject_kind,subject_id,chain_id,sender,calls,summary,deadline,send_after,needs,gate,replaces,nonce_key,nonce,created_at,updated_at)
    values ($1,$2,'sponsoring',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) returning *`,
  [ctx.person_id, id, b.org_id, b.opener, b.subject_kind, b.subject_id, b.chain_id, ctx.sender.toLowerCase(), JSON.stringify(b.calls), b.summary,
    deadline, day, JSON.stringify(b.needs ?? []), b.gate ?? null, b.replaces ?? null, key, replacement?.nonce ?? null, ctx.now])).rows[0] as Approval;
  await event(sql, row, null, "open", trace, ctx.now);
  return output(row, true);
}

type Mutable = Pick<Approval, "nonce" | "signer_address" | "user_operation" | "digest" | "user_op_hash" | "valid_after" | "valid_until" | "signature" | "send_error" | "refusal" | "transaction_hash" | "block_number" | "displaced_by" | "signed_at" | "sent_at" | "ended_at">;
export async function move(sql: Sql, row: Approval, transition: keyof typeof sources, patch: Partial<Mutable>, now: Date, trace: string, terminal?: Terminal): Promise<Approval> {
  if (!(sources[transition] as readonly string[]).includes(row.state)) throw new Error(`WRONG_STATE: ${row.state}`);
  const fields = Object.keys(patch) as (keyof Mutable)[];
  const values = fields.map((f) => patch[f]);
  const result = await sql.query(`update app.approvals set state=$3,updated_at=$4${fields.map((f, i) => `,${f}=$${i + 5}`).join("")}
    where person_id=$1 and approval_id=$2 returning *`, [row.person_id, row.approval_id, targets[transition], now, ...values]);
  const next = result.rows[0] as Approval;
  await event(sql, next, row.state, transition, trace, now);
  if (!live.includes(next.state) && terminal) {
    await terminal(sql, { approval_id: next.approval_id, person_id: next.person_id, org_id: next.org_id, opener: next.opener,
      subject_kind: next.subject_kind, subject_id: next.subject_id, outcome: next.state as Parameters<Terminal>[1]["outcome"],
      chain_id: next.chain_id, sender: next.sender, nonce: next.nonce, user_op_hash: next.user_op_hash,
      transaction_hash: next.transaction_hash, block_number: next.block_number, observedAt: now.toISOString() });
    // The opener effect and queue removal commit together; the carrier must not call it again.
    await sql.query("delete from app.approval_carriers where approval_id=$1", [next.approval_id]);
  }
  return next;
}

export async function withdraw(sql: Sql, ctx: ApprovalContext, b: { approval_id: string; reason: string }, trace = "") {
  const row = await read(sql, ctx.person_id, b.approval_id);
  if (row.state === "sponsoring" || row.state === "pending") return { state: (await move(sql, row, "withdraw", { ended_at: ctx.now }, ctx.now, trace)).state };
  return { state: row.state };
}
