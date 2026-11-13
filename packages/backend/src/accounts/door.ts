import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { feature, normalizeEmail, type GateCatalogue, type Principal } from "../access/door.ts";

export { startSetup, observeClaim, finishSetup } from "./setup.ts";
export { routeAccounts, accountsPaths, type AccountsServices } from "./routes.ts";

/** World creation only, after migrateAccess; never on up or restore. */
export async function migrateAccounts(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

export type Admission = { email: string; person_id: string | null; status: "waiting" | "admitted"; note: string | null;
  joined_via: "waitlist" | "operator" | "referral" | "invitation" | "escrow" | "fde-guest" | "reward";
  requested_at: number | null; admitted_at: number | null; admitted_by: string | null; updated_at: number };
export type PersonalSafe = { person_id: string; email: string; safe_address: string; signer_address: string;
  status: "claiming" | "collecting" | "ready" | "failed"; attempt: number; claim_tx_hash: string | null;
  claimed_at: number | null; claimed_block: number | null; collect_approval_id: string | null; collected: number;
  failure_code: "WRONG_STATE" | "INVALID_INPUT" | "TRANSACTION_FAILED" | "PROVIDER_ERROR" | null;
  created_at: number; updated_at: number };
export async function readAdmission(sql: Sql, email: string): Promise<Admission | null> {
  return (await sql.query<Admission>("select * from app.admissions where email=$1", [normalizeEmail(email)])).rows[0] ?? null;
}
export async function personalSafe(sql: Sql, personId: string): Promise<PersonalSafe | null> {
  return (await sql.query<PersonalSafe>("select * from app.personal_safes where person_id=$1", [personId])).rows[0] ?? null;
}
export async function eligibility(sql: Sql, principal: Principal, catalogue: GateCatalogue, now: number) {
  const row = principal.email ? await readAdmission(sql, principal.email) : null;
  const access = row?.status === "admitted" ? "admitted" : await feature(sql, "beta-access", principal, catalogue, now) ? "open" : "waiting";
  return { access, safe: await personalSafe(sql, principal.personId) } as const;
}

async function source(sql: Sql, kind: "admission" | "referral", mailbox: string): Promise<string> {
  const row = (await sql.query(`insert into app.account_event_sources(entity_id,kind,mailbox) values($1,$2,$3)
    on conflict(kind,mailbox) do nothing returning entity_id`, [randomUUID(), kind, mailbox])).rows[0];
  return row?.entity_id ?? (await sql.query("select entity_id from app.account_event_sources where kind=$1 and mailbox=$2", [kind, mailbox])).rows[0].entity_id;
}

/** Trusted source reader for committed-event consumers; restricted worker only for pre-principal rows. */
export async function readAdmissionForEvent(sql: Sql, entityId: string) {
  return (await sql.query(`select a.*,a.email as mailbox,r.referrer_email,
    coalesce(r.stage='rewarded' and r.reward_kind='invites',false) as referral_rewarded_with_invite
    from app.account_event_sources s join app.admissions a on a.email=s.mailbox
    left join app.referrals r on r.referee_email=a.email and r.stage<>'voided'
    where s.entity_id=$1 and s.kind='admission'`, [entityId])).rows[0] ?? null;
}

/** No checkout, BEGIN, COMMIT, chain or mail call: the caller's authority fact and admission are one fact. */
export async function admit(sql: Sql, input: { email: string; via: "invitation" | "escrow" | "fde-guest"; ref: string },
  trace: string, now: number): Promise<{ email: string; admitted: boolean }> {
  const email = normalizeEmail(input.email);
  if (!["invitation", "escrow", "fde-guest"].includes(input.via) || !input.ref) throw new Error("INVALID_INPUT: admission provenance");
  return { email, admitted: await admitMailbox(sql, email, input.via, `${input.via}:${input.ref}`, trace, now) };
}

/** `accounts.admission.admit`: the operator's wave, one caller transaction. The mount verifies the deployment's
 * operator key first (anything else is NOT_AUTHENTICATED); no person session or request-selected authority reaches here. */
export async function admitWave(sql: Sql, input: { emails: unknown; by: unknown }, trace: string, now: number):
Promise<{ admitted: string[]; already: string[]; invalid: string[] }> {
  if (!Array.isArray(input.emails) || input.emails.length > 200 || input.emails.some((e) => typeof e !== "string"))
    throw new Error("INVALID_INPUT: emails");
  if (typeof input.by !== "string" || !input.by.trim()) throw new Error("INVALID_INPUT: by");
  const by = input.by.trim(), invalid: string[] = [], valid = new Set<string>();
  for (const raw of input.emails as string[]) {
    try { valid.add(normalizeEmail(raw)); } catch { invalid.push(raw); }
  }
  const admitted: string[] = [], already: string[] = [];
  // Sorted advisory locks: concurrent waves sharing mailboxes cannot deadlock.
  for (const email of [...valid].sort())
    (await admitMailbox(sql, email, "operator", `operator:${by}`, trace, now) ? admitted : already).push(email);
  return { admitted, already, invalid };
}

async function admitMailbox(sql: Sql, email: string, via: Admission["joined_via"], by: string, trace: string, now: number): Promise<boolean> {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`accounts:${email}`]);
  const existing = await readAdmission(sql, email);
  if (existing?.status === "admitted") return false;
  const person = (await sql.query("select person_id from app.principals where email=$1", [email])).rows[0];
  const referral = (await sql.query("select * from app.referrals where referee_email=$1 for update", [email])).rows[0];
  await sql.query(`insert into app.admissions(email,person_id,status,note,joined_via,requested_at,admitted_at,admitted_by,updated_at)
    values($1,$2,'admitted',null,$3,null,$4,$5,$4) on conflict(email) do update set
    person_id=coalesce(app.admissions.person_id,excluded.person_id),status='admitted',
    admitted_at=excluded.admitted_at,admitted_by=excluded.admitted_by,updated_at=excluded.updated_at`,
  [email, person?.person_id ?? null, via, now, by]);
  const personId = existing?.person_id ?? person?.person_id ?? null;
  await emit(sql, { id: randomUUID(), name: "waitlist_entry_transitioned", machine: "waitlist-entry",
    entity_id: await source(sql, "admission", email), owner_kind: personId ? "person" : null, owner_id: personId,
    actor: null, trace_id: trace, at: now,
    props: { from: existing?.status ?? null, to: "admitted", transition: existing ? "admit" : "admit_unlisted",
      person_id: personId, via, referred: !!referral && referral.stage !== "voided" } });
  if (referral?.stage === "attributed") {
    await sql.query("update app.referrals set stage='admitted',admitted_at=$2 where referee_email=$1 and stage='attributed'", [email, now]);
    await emit(sql, { id: randomUUID(), name: "referral_transitioned", machine: "referral",
      entity_id: await source(sql, "referral", email), owner_kind: null, owner_id: null, actor: null, trace_id: trace, at: now,
      props: { from: "attributed", to: "admitted", transition: "admit", via: referral.via,
        reward_kind: referral.reward_kind, void_reason: referral.void_reason } });
  }
  return true;
}
