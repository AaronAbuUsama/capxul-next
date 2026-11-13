// organizations.setups.begin, .get and .resume (blueprint/organizations/setups.ts). Each takes the caller's Sql
// after Access.authenticate, inside the request's worker transaction, and never opens or commits one.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { companySafeAddress, type PersonalSafeConfig } from "../platform/safe.ts";
import { lookupBySafe, newId, normalizeHandle, register } from "../parties/door.ts";

/** blueprint/organizations/data.ts FUNDAMENTAL_APPS and HEAD_APPS. */
export const FUNDAMENTAL_APPS = [
  { app: "frappe", modules: ["core"] }, { app: "erpnext", modules: ["accounts", "projects"] },
  { app: "hrms", modules: ["payroll"] }, { app: "crm", modules: ["fcrm"] },
] as const;
export const HEAD_APPS = ["helpdesk", "insights", "lms", "wiki", "drive", "gameplan", "builder", "print_designer", "lending",
  "education", "healthcare", "webshop", "ecommerce_integrations"] as const;
/** Frappe 16.54 geo/country_info.json (currency, first zone) and ERPNext 16.54 setup_wizard.js fiscal years, by alpha-2. */
const COUNTRIES: Record<string, { currency: string | null; zone: string | null; fiscalYearStart: string }> =
  JSON.parse(readFileSync(new URL("./countries.json", import.meta.url), "utf8"));
export const SEATS_AT_BIRTH = 10;

export type SetupStatus = "processing" | "awaiting_authorization" | "needs_attention" | "ready" | "failed";
export type SetupIssue = { reason: string; code: string; at: number };
export type Board = { directors: number; threshold: number; nonce: number; waitingProposals: number };
export type SetupView = {
  orgId: string; safe: string; setup: SetupStatus; steps: ("safe_minted" | "money_deployed" | "installed")[];
  issue: SetupIssue | null; recovery: "authorize" | "checkAgain" | "none"; approvalId: string | null; checkedAt: number;
  board: Board | null; fde: { partyId: string; safe: string } | null;
};
export type BeginInput = {
  name: string; handle: string; country: string; bio?: string; size?: string; logoFileId?: string;
  currency?: string; timeZone?: string; fiscalYearStart?: string; apps?: string[]; fde?: boolean;
};
export type SetupServices = {
  chainId: number;
  /** Companies House and the company-Safe namespace: the minter's pure companySafeAddressFor, no RPC. */
  companySafe: PersonalSafeConfig;
  /** Accounts.eligibility bound by composition to the authenticated principal, its gate catalogue and instant. */
  eligibility(sql: Sql): Promise<{ access: "admitted" | "open" | "waiting"; safe: { status: string; safe_address: string } | null }>;
  /** Media.requireImage on this Sql: the caller's own kept image, else it throws. */
  requireImage(sql: Sql, fileId: string): Promise<unknown>;
  /** ISO 4217 currencies with a USD price pair in the deployment; USD is always allowed. */
  pricedCurrencies: readonly string[];
  /** Indexing's Board read for a ready Organization's Safe. */
  board(sql: Sql, chainId: number, safe: string): Promise<Board | null>;
};

const invalid = (what: string) => new Error(`INVALID_INPUT: ${what}`);
async function principal(sql: Sql) {
  const row = (await sql.query<{ person_id: string; email: string; safe_address: string }>(`select person_id,email,safe_address
    from app.principals where kind='person' and person_id=nullif(current_setting('app.person_id',true),'')
    and email=nullif(current_setting('app.email',true),'') and safe_address=nullif(current_setting('app.safe_address',true),'')`)).rows[0];
  if (!row) throw new Error("NOT_AUTHENTICATED: person session required");
  return row;
}
function text(value: unknown, what: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw invalid(what);
  return value.trim() || null;
}
function zone(value: string, what: string) {
  try { if (/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value) && new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone) return value; }
  catch { /* RangeError: not an IANA zone */ }
  throw invalid(what);
}
function monthDay(value: string) {
  const m = /^(\d\d)-(\d\d)$/.exec(value), days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!m || +m[1]! < 1 || +m[1]! > 12 || +m[2]! < 1 || +m[2]! > days[+m[1]! - 1]!) throw invalid("fiscalYearStart");
  return value;
}
/** ERPNext's setup wizard abbreviation: each word's first letter or digit, upper case, here at most five. */
function abbreviation(name: string) {
  const abbr = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0]).filter(Boolean).join("").toUpperCase().slice(0, 5);
  if (!abbr) throw invalid("name needs a letter or digit");
  return abbr;
}

/** Every input is checked before any write; the result is the intent the hash covers. */
async function intent(sql: Sql, input: BeginInput, services: SetupServices) {
  if (!input || typeof input !== "object") throw invalid("begin");
  const name = text(input.name, "name"), handle = typeof input.handle === "string" ? normalizeHandle(input.handle) : "";
  if (!name || name.length > 140) throw invalid("name");
  if (!/^[a-z0-9_-]{3,30}$/.test(handle)) throw invalid("handle");
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  const defaults = COUNTRIES[country];
  if (!defaults) throw invalid("country");
  const bio = text(input.bio, "bio"), size = text(input.size, "size"), logo = text(input.logoFileId, "logoFileId");
  if (bio && bio.length > 280) throw invalid("bio over 280 characters");
  const priced = new Set(["USD", ...services.pricedCurrencies]);
  const chosen = text(input.currency, "currency")?.toUpperCase() ?? null;
  if (chosen !== null && (!/^[A-Z]{3}$/.test(chosen) || !priced.has(chosen))) throw invalid("currency has no USD price pair");
  const currency = chosen ?? (defaults.currency && priced.has(defaults.currency) ? defaults.currency : "USD");
  const timeZone = zone(text(input.timeZone, "timeZone") ?? defaults.zone ?? "", "timeZone");
  const fiscalYearStart = monthDay(text(input.fiscalYearStart, "fiscalYearStart") ?? defaults.fiscalYearStart);
  if (input.apps !== undefined && (!Array.isArray(input.apps) || input.apps.some((a) => !(HEAD_APPS as readonly unknown[]).includes(a)))) throw invalid("apps");
  const apps = [...new Set(input.apps ?? [])].sort();
  if (input.fde !== undefined && typeof input.fde !== "boolean") throw invalid("fde");
  const withFde = input.fde !== false;
  if (logo) {
    try { await services.requireImage(sql, logo); }
    catch (error) {
      if (/^(INVALID_INPUT|NOT_FOUND|FORBIDDEN|WRONG_STATE|ROLE_PERMISSION_DENIED)\b/.test(String((error as Error).message))) throw invalid("logoFileId");
      throw error;
    }
  }
  const choices = { name, handle, country, bio, size, logo, currency, timeZone, fiscalYearStart, apps, withFde };
  return { ...choices, abbr: abbreviation(name), hash: createHash("sha256").update(JSON.stringify(choices)).digest("hex") };
}

/** A transition event's id: one per occurrence, even when the clock has not moved (app.org_transition_seq). */
export async function transitionId(sql: Sql, prefix: string) {
  return `${prefix}:${(await sql.query("select nextval('app.org_transition_seq') as n")).rows[0].n}`;
}

async function transitioned(sql: Sql, orgId: string, actor: string | null, trace: string, now: number,
  from: SetupStatus | null, to: SetupStatus, transition: string, personId: string, issue: string | null) {
  await emit(sql, { id: await transitionId(sql, `org-setup:${orgId}:${transition}`), name: "org_setup_transitioned", machine: "org-setup", entity_id: orgId,
    owner_kind: "organization", owner_id: orgId, actor, trace_id: trace, at: now,
    props: { from, to, transition, org_id: orgId, person_id: personId, issue_reason: issue } });
}

export async function view(sql: Sql, orgId: string, services: Pick<SetupServices, "board">): Promise<SetupView> {
  const row = (await sql.query(`select s.*,o.safe_address,o.chain_id from app.org_setups s join app.organizations o using(org_id)
    where s.org_id=$1`, [orgId])).rows[0];
  if (!row) throw new Error("ROLE_PERMISSION_DENIED: setup");
  const status = row.status as SetupStatus;
  return {
    orgId, safe: row.safe_address, setup: status, steps: row.steps, issue: row.issue ?? null,
    recovery: status === "awaiting_authorization" ? "authorize" : status === "needs_attention" ? "checkAgain" : "none",
    approvalId: status === "awaiting_authorization" ? row.install_approval_id : null, checkedAt: Number(row.checked_at),
    board: status === "ready" ? await services.board(sql, Number(row.chain_id), row.safe_address) : null,
    fde: row.fde_party_id && row.fde_safe ? { partyId: row.fde_party_id, safe: row.fde_safe } : null,
  };
}

/** One transaction: the Organization, its ten seats, its setup, its apps and its pending Party, or the same intent's. */
export async function begin(sql: Sql, input: BeginInput, services: SetupServices, now: number, trace: string) {
  if (!trace) throw invalid("trace_id required");
  const founder = await principal(sql);
  const eligible = await services.eligibility(sql);
  if (eligible.access === "waiting") throw new Error("FEATURE_NOT_AVAILABLE: still on the beta waitlist");
  const own = eligible.safe;
  if (!own || !["collecting", "ready"].includes(own.status) || own.safe_address.toLowerCase() !== founder.safe_address.toLowerCase())
    throw new Error("WRONG_STATE: your account is not deployed and claimed yet");
  const founderParty = await lookupBySafe(sql, founder.safe_address);
  if (!founderParty || founderParty.kind !== "person" || founderParty.state !== "active" || founderParty.owner_id !== founder.person_id)
    throw new Error("WRONG_STATE: your account is not deployed and claimed yet");
  const i = await intent(sql, input, services);
  // Held to commit: a concurrent same-intent begin waits, then resumes this one instead of racing the handle.
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 11))", [`org-handle:${i.handle}`]);
  const held = (await sql.query(`select p.kind,p.owner_kind,p.owner_id,s.founder_principal_id,s.intent_hash from app.parties p
    left join app.org_setups s on p.kind='organization' and p.owner_kind='organization' and s.org_id=p.owner_id where p.handle=$1`, [i.handle])).rows[0];
  if (held) {
    if (held.founder_principal_id !== founder.person_id) throw invalid("handle is taken");
    if (held.intent_hash !== i.hash) throw new Error("WRONG_STATE: this handle was begun with a different intent");
    return { orgId: held.owner_id as string, resumed: true, setup: await view(sql, held.owner_id, services) };
  }
  const orgId = newId("org"), safe = companySafeAddress(services.companySafe, i.handle, founder.safe_address as `0x${string}`);
  const party = await register(sql, { kind: "organization", handle: i.handle, display_name: i.name, safe_address: safe,
    owner_kind: "organization", owner_id: orgId }, now, trace);
  await sql.query(`insert into app.organizations(org_id,party_id,name,country,bio,size,logo_file_id,chain_id,safe_address,founder_party_id,
    founder_safe,seat_limit,abbr,default_currency,time_zone,fiscal_year_start,created_at,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
  [orgId, party.party_id, i.name, i.country, i.bio, i.size, i.logo, services.chainId, safe, founderParty.party_id,
    founder.safe_address.toLowerCase(), SEATS_AT_BIRTH, i.abbr, i.currency, i.timeZone, i.fiscalYearStart, now]);
  await sql.query(`insert into app.org_setups(org_id,founder_principal_id,intent_hash,with_fde,status,steps,checked_at,created_at,updated_at)
    values($1,$2,$3,$4,'processing','{}',$5,$5,$5)`, [orgId, founder.person_id, i.hash, i.withFde, now]);
  await transitioned(sql, orgId, founder.person_id, trace, now, null, "processing", "begin", founder.person_id, null);
  const apps = [...FUNDAMENTAL_APPS.map((a) => ({ app: a.app, modules: [...a.modules], native: true })),
    ...i.apps.map((app) => ({ app, modules: [], native: false }))];
  for (const a of apps) {
    await sql.query(`insert into app.org_apps(org_id,app,modules,native,status,added_by,installed_at,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [orgId, a.app, a.modules, a.native, a.native ? "installed" : "wanted",
      a.native ? null : founder.person_id, a.native ? now : null, now]);
    const transition = a.native ? "install_native" : "want";
    await emit(sql, { id: `org-app:${orgId}:${a.app}:${transition}`, name: "org_app_transitioned", machine: "org-app", entity_id: `${orgId}:${a.app}`,
      owner_kind: "organization", owner_id: orgId, actor: founder.person_id, trace_id: trace, at: now,
      props: { from: null, to: a.native ? "installed" : "wanted", transition, org_id: orgId, app: a.app, native: a.native } });
  }
  return { orgId, resumed: false, setup: await view(sql, orgId, services) };
}

/** Committed-source read for another concept's own authorization (Sites' provisioning): who founded it and how far it got. */
export async function readSetupFounder(sql: Sql, orgId: string) {
  const row = (await sql.query(`select s.org_id,s.founder_principal_id,s.status,s.steps,o.founder_safe,o.safe_address
    from app.org_setups s join app.organizations o using(org_id) where s.org_id=$1`, [orgId])).rows[0];
  return row ? { orgId: row.org_id as string, founderPrincipalId: row.founder_principal_id as string, founderSafe: row.founder_safe as string,
    safe: row.safe_address as string, status: row.status as SetupStatus, steps: row.steps as SetupView["steps"] } : null;
}

export type AdmittedDeployment = {
  org_id: string; chain_id: number; log_id: string; safe_address: string; gate_address: string; roles_address: string;
  board_top_hat: string; shareholders_top_hat: string; director_hat: string; officer_hats: string[];
  deploy_tx_hash: string; block_number: number; admitted_at: number;
};
/** The MoneyDeployed occurrence this Organization's setup admitted at finality, or null until then. Officer hats are
 * numeric, in `MoneyDeploy.officers` order: naming them waits on organizations.admitted-deployment. Tenants read it only
 * as a current member (RLS); the worker reads any. Hat ids are decimal strings, addresses lowercase. */
export async function readAdmittedDeployment(sql: Sql, input: { orgId: string; chainId: number }): Promise<AdmittedDeployment | null> {
  const r = (await sql.query(`select org_id, chain_id, log_id, safe_address, gate_address, roles_address, board_top_hat,
    shareholders_top_hat, director_hat, officer_hats, deploy_tx_hash, block_number, created_at
    from app.org_deployments where org_id=$1 and chain_id=$2`, [input.orgId, input.chainId])).rows[0];
  return r ? { org_id: r.org_id, chain_id: Number(r.chain_id), log_id: r.log_id, safe_address: r.safe_address,
    gate_address: r.gate_address, roles_address: r.roles_address, board_top_hat: r.board_top_hat,
    shareholders_top_hat: r.shareholders_top_hat, director_hat: r.director_hat, officer_hats: r.officer_hats,
    deploy_tx_hash: r.deploy_tx_hash, block_number: Number(r.block_number), admitted_at: Number(r.created_at) } : null;
}

/** A current member, or the setup's founder; anyone else, and an unknown id, read the same refusal. */
export async function get(sql: Sql, input: { orgId: string }, services: Pick<SetupServices, "board">): Promise<SetupView> {
  const person = await principal(sql);
  const orgId = typeof input?.orgId === "string" ? input.orgId : "";
  const row = (await sql.query("select founder_principal_id,app.current_member(org_id) as member from app.org_setups where org_id=$1", [orgId])).rows[0];
  if (!row || (row.founder_principal_id !== person.person_id && !row.member)) throw new Error("ROLE_PERMISSION_DENIED: setup");
  return view(sql, orgId, services);
}

/** The setup process's signal: needs_attention moves back to processing; other live states are returned as they are. */
export async function resume(sql: Sql, input: { orgId: string }, services: Pick<SetupServices, "board">, now: number, trace: string) {
  if (!trace) throw invalid("trace_id required");
  const person = await principal(sql);
  const orgId = typeof input?.orgId === "string" ? input.orgId : "";
  const row = (await sql.query("select status from app.org_setups where org_id=$1 and founder_principal_id=$2 for update", [orgId, person.person_id])).rows[0];
  if (!row) throw invalid("orgId names no setup you founded");
  if (row.status === "failed") throw new Error("WRONG_STATE: this setup failed and nothing can finish it");
  if (row.status === "needs_attention") {
    await sql.query("update app.org_setups set status='processing',issue=null,updated_at=$2 where org_id=$1", [orgId, now]);
    await transitioned(sql, orgId, person.person_id, trace, now, "needs_attention", "processing", "resume", person.person_id, null);
  }
  return view(sql, orgId, services);
}
