import { transaction, type Database, type Sql } from "../platform/db.ts";
import { move, read, wake } from "./store.ts";
import type { Approval, Refusal, Terminal, UserOperation } from "./types.ts";

export type Sponsorship = {
  nonce: string; signer_address: string; user_operation: UserOperation; digest: string; user_op_hash: string;
  valid_after: Date | null; valid_until: Date;
};
export type ChainFact = { chain_id: number; sender: string; nonce: string; user_op_hash: string; success: boolean; transaction_hash: string; block_number: number };
/** Deployment supplies real gateway, chain, indexed-finality and access services, never a second sending path. */
export type CarrierServices = {
  now: () => Promise<Date>;
  sponsor: (approval: Approval) => Promise<Sponsorship | Refusal>;
  send: (approval: Approval) => Promise<{ hash: string } | { refused: Refusal }>;
  lookup: (approval: Approval) => Promise<{ held: boolean }>;
  nonce: (approval: Approval) => Promise<string>;
  needsAndGate: (approval: Approval) => Promise<boolean>;
  fact: (sql: Sql, approval: Approval) => Promise<ChainFact | null>;
  terminal: Terminal;
};
const live = ["sponsoring", "pending", "signed", "sending", "sent"];
const plus = (now: Date, ms: number) => new Date(now.getTime() + ms);

/** One checked-out worker connection; every transaction finishes before any outside call. */
export async function carry(db: Database, services: CarrierServices, limit = 100): Promise<number> {
  const sql = await db.worker.connect();
  let count = 0;
  try {
    const now = await services.now();
    const due = (await sql.query("select approval_id,person_id from app.approval_carriers where wake_at<=$1 order by wake_at,approval_id limit $2", [now, limit])).rows;
    for (const key of due) {
      const lock = `approval-carrier:${key.approval_id}`;
      if (!(await sql.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])).rows[0].locked) continue;
      try {
        await step(sql, key.person_id, key.approval_id, services);
        count++;
      } finally { await sql.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]); }
    }
  } finally { sql.release(); }
  return count;
}

async function step(sql: Sql, person: string, id: string, services: CarrierServices) {
  let row = await transaction(sql, "", (client) => read(client, person, id));
  const metadata = (await sql.query("select trace_id,wake_version from app.approval_carriers where approval_id=$1", [id])).rows[0];
  if (!metadata) return;
  const trace = metadata.trace_id as string;
  let wakeVersion = metadata.wake_version;
  const now = await services.now();
  const update = async (fn: (client: Sql, current: Approval) => Promise<void>) => {
    wakeVersion = await transaction(sql, row.org_id ?? "", async (client) => {
      const current = await read(client, person, id);
      const carrier = (await client.query("select wake_version from app.approval_carriers where approval_id=$1 for update", [id])).rows[0];
      // Both signer changes and carrier-only chain wakes invalidate work based on the earlier read.
      // Hold the carrier lock until commit, so a later wake wins over this step's timer as well.
      if (current.state !== row.state || current.updated_at.getTime() !== row.updated_at.getTime() || carrier?.wake_version !== wakeVersion) return wakeVersion;
      await fn(client, current);
      return (await client.query("select wake_version from app.approval_carriers where approval_id=$1", [id])).rows[0]?.wake_version ?? wakeVersion;
    });
  };
  if (!live.includes(row.state)) {
    await transaction(sql, row.org_id ?? "", async (client) => {
      // A terminal event's same-Sql effects are guarded by the carrier deletion in this transaction.
      const removed = await client.query("delete from app.approval_carriers where approval_id=$1 returning approval_id", [id]);
      if (removed.rowCount) await services.terminal(client, {
        approval_id: row.approval_id, person_id: row.person_id, org_id: row.org_id, opener: row.opener,
        subject_kind: row.subject_kind, subject_id: row.subject_id, outcome: row.state as Parameters<Terminal>[1]["outcome"],
        chain_id: row.chain_id, sender: row.sender, nonce: row.nonce, user_op_hash: row.user_op_hash,
        transaction_hash: row.transaction_hash, block_number: row.block_number, observedAt: row.updated_at.toISOString(),
      });
    });
    return;
  }
  // Only an indexed, final fact can resolve a used nonce; receipts alone cannot settle it.
  const fact = await transaction(sql, row.org_id ?? "", (client) => services.fact(client, row));
  if (fact && live.includes(row.state) && fact.chain_id === row.chain_id &&
      fact.sender === row.sender && fact.nonce === row.nonce) {
    const own = fact.user_op_hash === row.user_op_hash;
    if (!own || row.state !== "pending") {
      await update(async (client, current) => {
        await move(client, current, own ? fact.success ? "land" : "revert" : "displace", {
          transaction_hash: fact.transaction_hash, block_number: fact.block_number,
          ...(!own ? { displaced_by: fact.user_op_hash } : {}), ended_at: now,
        }, now, trace, services.terminal);
      });
      return;
    }
  }
  const end = row.valid_until ?? row.deadline;
  if (now.getTime() >= end.getTime() + 120_000) {
    const nonce = row.nonce === null ? null : await services.nonce(row);
    if (row.nonce === null || nonce === row.nonce) {
      await update(async (client, current) => { await move(client, current, "expire", { ended_at: now }, now, trace, services.terminal); });
    } else await update(async (client, current) => { await wake(client, current, trace, plus(now, 1000)); });
    return;
  }
  if (row.state === "sponsoring") {
    let sponsor: Sponsorship | Refusal;
    try {
      sponsor = await services.sponsor(row);
      if (!("code" in sponsor)) {
        const op = sponsor.user_operation;
        if (!Number.isFinite(sponsor.valid_until.getTime()) || sponsor.valid_until <= now || sponsor.valid_until > row.deadline ||
            (sponsor.valid_after && (!Number.isFinite(sponsor.valid_after.getTime()) || sponsor.valid_after >= sponsor.valid_until)) ||
            !/^0x[0-9a-f]{40}$/.test(sponsor.signer_address) || /^0x0{40}$/.test(sponsor.signer_address) ||
            !/^0x[0-9a-f]{64}$/.test(sponsor.digest) || !/^0x[0-9a-f]{64}$/.test(sponsor.user_op_hash) ||
            !/^\d+$/.test(sponsor.nonce) || BigInt(sponsor.nonce) >> 64n !== BigInt(row.nonce_key) ||
            op.sender !== row.sender || op.nonce !== sponsor.nonce || (row.nonce !== null && row.nonce !== sponsor.nonce) ||
            !/^0x(?:[0-9a-f]{2})+$/.test(op.callData) || !/^0x[0-9a-f]{40}$/.test(op.paymaster) ||
            !/^0x(?:[0-9a-f]{2})*$/.test(op.paymasterData) ||
            [op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas,
              op.paymasterVerificationGasLimit, op.paymasterPostOpGasLimit].some((v) => !/^\d+$/.test(v))) {
          throw new Error("PROVIDER_RESPONSE_INVALID: unusable sponsorship");
        }
      }
    }
    catch {
      await update(async (client, current) => {
        const attempts = (await client.query("update app.approval_carriers set attempts=attempts+1 where approval_id=$1 returning attempts", [id])).rows[0].attempts;
        if (attempts >= 3) await move(client, current, "refuse", { refusal: { code: "PROVIDER_ERROR", reason: "sponsorship failed after bounded retries" }, ended_at: now }, now, trace, services.terminal);
        else await wake(client, current, trace, plus(now, 1000 * 2 ** attempts));
      });
      return;
    }
    await update(async (client, current) => {
      if ("code" in sponsor) await move(client, current, "refuse", { refusal: sponsor, ended_at: now }, now, trace, services.terminal);
      else await move(client, current, "sponsor", sponsor, now, trace);
    });
    return;
  }
  if (row.state === "signed") {
    if (now >= end) { await update(async (client, current) => { await wake(client, current, trace, plus(end, 120_000)); }); return; }
    const start = Math.max(row.send_after?.getTime() ?? 0, row.valid_after?.getTime() ?? 0);
    if (start > now.getTime()) { await update(async (client, current) => { await wake(client, current, trace, new Date(start)); }); return; }
    if (!await services.needsAndGate(row)) { await update(async (client, current) => { await wake(client, current, trace, new Date(Math.min(now.getTime() + 3_600_000, end.getTime() + 120_000))); }); return; }
    let claimed = false;
    await update(async (client, current) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`approval-nonce:${current.chain_id}:${current.sender}:${current.nonce}`]);
      const held = await client.query("select 1 from app.approvals where chain_id=$1 and sender=$2 and nonce=$3 and state in ('sending','sent') and approval_id<>$4 and approval_id<>coalesce($5,'')", [current.chain_id, current.sender, current.nonce, current.approval_id, current.replaces]);
      if (held.rowCount) { await wake(client, current, trace, plus(now, 1000)); return; }
      row = await move(client, current, "claim_send", {}, now, trace);
      claimed = true;
    });
    if (!claimed) return;
    // This is the only send site, strictly after sending committed. A resumed sending row only looks up.
    let sent: Awaited<ReturnType<CarrierServices["send"]>>;
    try { sent = await services.send(row); }
    catch { return; }
    if ("hash" in sent && sent.hash === row.user_op_hash) {
      await update(async (client, current) => { await move(client, current, "accept", { sent_at: now }, now, trace); });
    } else if ("refused" in sent) {
      await update(async (client, current) => { await client.query("update app.approvals set send_error=$3 where person_id=$1 and approval_id=$2", [person, id, sent.refused]); });
    }
    return;
  }
  if (row.state === "sending") {
    const lookup = await services.lookup(row);
    await update(async (client, current) => {
      if (lookup.held) await move(client, current, "accept", { sent_at: now }, now, trace);
      else if (current.send_error) {
        await move(client, current, "bounce", { send_error: null }, now, trace);
        await wake(client, current, trace, plus(now, 30_000));
      } else await wake(client, current, trace, plus(now, 1000));
    });
    return;
  }
  await update(async (client, current) => { await wake(client, current, trace, plus(end, 120_000)); });
}

/** Indexed finality wake is keyed by the chain identity, never by a caller's guessed approval id. */
export async function wakeChain(sql: Sql, key: Pick<ChainFact, "chain_id" | "sender" | "nonce">, now: Date) {
  await sql.query(`update app.approval_carriers c set wake_at=$4,wake_version=c.wake_version+1 from app.approvals a
    where c.approval_id=a.approval_id and a.chain_id=$1 and a.sender=$2 and a.nonce=$3
      and a.state in ('sponsoring','pending','signed','sending','sent')`, [key.chain_id, key.sender, key.nonce, now]);
}
