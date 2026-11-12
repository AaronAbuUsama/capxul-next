import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Admin } from "./postgres.ts";

export type MailSend = {
  to: string; subject: string; html?: string; text?: string; idempotencyKey: string;
  template?: string; from?: string; replyTo?: string; messageId?: string; inReplyTo?: string; references?: string[];
};
export type MailFail = { next?: number; to?: string; clear?: boolean; list?: boolean };
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const error = (code: "INVALID_INPUT" | "PROVIDER_ERROR", message: string) => Object.assign(new Error(message), { code });
const address = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw error("INVALID_INPUT", "A valid mail recipient is required");
  return normalized;
};
/** Only fresh local/simulated worlds migrate test controls, never up/restore or production. */
export async function migrateMailSink(admin: Admin): Promise<void> {
  await admin(await readFile(new URL("./mail.sql", import.meta.url), "utf8"));
}

/** One world-targeted worker query; now reads the authoritative world clock in milliseconds. No network sender. */
export function devnetMail(query: Admin, now: () => Promise<number>) {
  const transaction = async (sql: string) => {
    try {
      // A DO statement emits no non-JSON row through the shared psql transport.
      return await query(`BEGIN; DO $mail$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('capxul.devnet.mail',0)); END $mail$; ${sql}; COMMIT;`);
    } catch {
      throw error("PROVIDER_ERROR", "Devnet mail storage is unavailable");
    }
  };
  const instant = async () => {
    let time: number;
    try { time = await now(); } catch { throw error("PROVIDER_ERROR", "World mail clock is unavailable"); }
    if (!Number.isSafeInteger(time) || time < 0 || time > 281474976710655) throw error("PROVIDER_ERROR", "World mail clock is unavailable");
    return time;
  };
  return {
    async send(input: MailSend): Promise<{ id: string }> {
      const to = address(input.to);
      if (!input.idempotencyKey.trim() || !input.subject.trim() || (input.text === undefined && input.html === undefined))
        throw error("INVALID_INPUT", "Mail requires a subject, body and idempotency key");
      const time = await instant();
      // A world-time ULID: 48 timestamp bits and 80 random bits, Crockford base32.
      let bits = (BigInt(time) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`), ulid = "";
      for (let i = 0; i < 26; i++) { ulid = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Number(bits & 31n)]! + ulid; bits >>= 5n; }
      const id = `mail_${ulid}`;
      const body = input.text ?? input.html!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const links = [...new Set(`${input.text ?? ""} ${input.html ?? ""}`.match(/https?:\/\/[^\s<>"']+/g) ?? [])];
      const plainText = [body, ...links.filter((link) => !body.includes(link))].join("\n");
      const row = { mail_id: id, direction: "out", to, from: input.from ?? "Capxul <no-reply@devnet.test>",
        reply_to: input.replyTo ?? null, message_id: input.messageId ?? `<${id}@devnet.test>`, in_reply_to: input.inReplyTo ?? null,
        references: input.references ?? [], subject: input.subject, template: input.template ?? "mail", text: plainText, links,
        idempotency_key: input.idempotencyKey, sent_at: new Date(time).toISOString() };
      const [result] = await transaction(`WITH existing AS MATERIALIZED (
          SELECT mail_id FROM devnet.mail_messages WHERE idempotency_key=${literal(input.idempotencyKey)}
        ), fault AS MATERIALIZED (
          SELECT address,remaining FROM devnet.mail_faults WHERE address IN (${literal(to)},'*') AND NOT EXISTS (SELECT FROM existing)
          ORDER BY (address=${literal(to)}) DESC LIMIT 1
        ), spent AS (
          DELETE FROM devnet.mail_faults f USING fault WHERE f.address=fault.address AND fault.remaining=1 RETURNING f.address
        ), decreased AS (
          UPDATE devnet.mail_faults f SET remaining=f.remaining-1 FROM fault WHERE f.address=fault.address AND fault.remaining>1 RETURNING f.address
        ), inserted AS (
          INSERT INTO devnet.mail_messages SELECT r.* FROM jsonb_populate_record(NULL::devnet.mail_messages,${literal(JSON.stringify(row))}::jsonb) r
          WHERE NOT EXISTS (SELECT FROM existing) AND NOT EXISTS (SELECT FROM fault) RETURNING mail_id
        ) SELECT jsonb_build_object('id',coalesce((SELECT mail_id FROM existing),(SELECT mail_id FROM inserted)),'failed',EXISTS(SELECT FROM fault))`);
      // transaction resolves only after COMMIT: a retry observes the spent fault even after a crash here.
      if (result?.failed) throw error("PROVIDER_ERROR", "Devnet mail send was refused by an armed fault");
      if (typeof result?.id !== "string") throw error("PROVIDER_ERROR", "Devnet mail send was not recorded");
      return { id: result.id };
    },
    async fail(input: MailFail = {}) {
      if ((input.list && (input.clear || input.next !== undefined || input.to !== undefined)) ||
          (input.clear && (input.next !== undefined || input.to !== undefined)))
        throw error("INVALID_INPUT", "Mail fail list/clear cannot be combined with other controls");
      let change = "";
      if (input.clear) change = "DELETE FROM devnet.mail_faults;";
      else if (!input.list) {
        if (!Number.isInteger(input.next) || input.next! < 1 || input.next! > 100) throw error("INVALID_INPUT", "Mail fail next must be from 1 to 100");
        const to = input.to === undefined ? "*" : address(input.to);
        change = `INSERT INTO devnet.mail_faults VALUES (${literal(to)},${input.next},${literal(new Date(await instant()).toISOString())})
          ON CONFLICT (address) DO UPDATE SET remaining=EXCLUDED.remaining,armed_at=EXCLUDED.armed_at;`;
      }
      const [result] = await transaction(`${change} SELECT jsonb_build_object('cleared',${!!input.clear},'faults',coalesce(jsonb_agg(
        jsonb_build_object('to',nullif(address,'*'),'remaining',remaining) ORDER BY address),'[]'::jsonb)) FROM devnet.mail_faults`);
      return result as { cleared: boolean; faults: { to: string | null; remaining: number }[] };
    },
    async list(input: { to?: string; template?: string; limit?: number } = {}) {
      const to = input.to === undefined ? null : address(input.to), limit = input.limit ?? 200;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw error("INVALID_INPUT", "Mail list limit must be from 1 to 200");
      const rows = await transaction(`SELECT jsonb_build_object('mailId',mail_id,'to',"to",'from',"from",'subject',subject,
        'template',template,'text',text,'links',links,'sentAt',sent_at) FROM devnet.mail_messages WHERE direction='out'
        ${to === null ? "" : `AND "to"=${literal(to)}`} ${input.template === undefined ? "" : `AND template=${literal(input.template)}`}
        ORDER BY sent_at DESC,mail_id DESC LIMIT ${limit}`);
      return { to, mail: rows };
    },
  };
}
export type DevnetMail = ReturnType<typeof devnetMail>;
