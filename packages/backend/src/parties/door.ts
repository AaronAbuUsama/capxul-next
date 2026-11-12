import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import { personalSafeAddress, type PersonalSafeConfig } from "../platform/safe.ts";

export type Party = {
  party_id: string; kind: "person" | "agent" | "organization" | "address";
  state: "provisional" | "outside" | "pending" | "active" | "released";
  handle: string | null; display_name: string | null; photo_file_id: string | null;
  safe_address: string; mailbox_digest: string | null;
  owner_kind: "person" | "organization" | null; owner_id: string | null;
  created_at: string; updated_at: string;
};
export type Registration = {
  kind: "organization" | "agent"; handle: string; display_name: string; safe_address: string;
  owner_kind: "person" | "organization"; owner_id: string;
};
export type Locator = { _tag: "handle"; handle: string } | { _tag: "mailbox"; mailbox: string }
  | { _tag: "address"; address: string } | { _tag: "party"; party_id: string };
export type Resolution = { resolved: false; reason: "malformed" | "zero-address" | "unknown-handle" | "unknown-party" | "released" }
  | { resolved: true; party_id: string; kind: Party["kind"]; state: Exclude<Party["state"], "released">;
      handle: string | null; display_name: string | null; safe_address: string; named: boolean };

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const zero = `0x${"0".repeat(40)}`;
const reserved = new Set(["admin", "api", "capxul", "help", "root", "support", "system", "www"]);
export const normalizeHandle = (value: string) => value.trim().toLowerCase().replace(/^@/, "");
export function validSafe(value: string) { return addressPattern.test(value) && value.toLowerCase() !== zero; }
export function newId(prefix: string) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let n = (BigInt(Date.now()) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`), result = "";
  for (let i = 0; i < 26; i++) { result = alphabet[Number(n & 31n)] + result; n >>= 5n; }
  return `${prefix}_${result}`;
}
async function lock(sql: Sql, key: string) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 7))", [key]);
}
async function emit(sql: Sql, row: Party, from: Party["state"] | null, transition: string, now: number) {
  await sql.query("insert into app.party_events(party_id,data,at) values ($1,$2,$3)", [row.party_id,
    { from, to: row.state, transition, party_id: row.party_id, kind: row.kind, owner_kind: row.owner_kind, owner_id: row.owner_id }, now]);
}
export async function lookup(sql: Sql, partyId: string): Promise<Party | null> {
  return (await sql.query("select * from app.parties where party_id=$1 and state<>'released'", [partyId])).rows[0] ?? null;
}
export async function lookupBySafe(sql: Sql, safe: string): Promise<Party | null> {
  return (await sql.query("select * from app.parties where safe_address=$1 and state<>'released'", [safe.toLowerCase()])).rows[0] ?? null;
}
/** now is the caller transaction's authoritative world instant, never request data or a host fallback. */
export async function register(sql: Sql, input: Registration, now: number): Promise<Party> {
  const handle = normalizeHandle(input.handle), safe = input.safe_address.toLowerCase();
  if (!/^[a-z0-9_-]{3,30}$/.test(handle) || reserved.has(handle) || !validSafe(safe) || !input.owner_id
    || !["person", "organization"].includes(input.owner_kind) || !["agent", "organization"].includes(input.kind)) throw new Error("INVALID_INPUT: Party registration");
  if (handle.endsWith("-fde") || handle.startsWith("fde-")) {
    const org = (await sql.query("select handle from app.parties where kind='organization' and owner_kind='organization' and owner_id=$1 and state<>'released'", [input.owner_id])).rows[0];
    if (input.kind !== "agent" || input.owner_kind !== "organization" ||
      (handle.endsWith("-fde") && handle !== `${org?.handle?.slice(0, 26)}-fde`) ||
      (handle.startsWith("fde-") && handle !== `fde-${input.owner_id.slice(-10).toLowerCase()}`)) throw new Error("INVALID_INPUT: reserved FDE handle");
  }
  // Always lock the namespace before the Safe: concurrent births cannot reserve either twice.
  await lock(sql, `handle:${handle}`); await lock(sql, `safe:${safe}`);
  const existing: Party | undefined = (await sql.query("select * from app.parties where handle=$1 or (safe_address=$2 and state<>'released')", [handle, safe])).rows[0];
  if (existing) {
    if (existing.state === "pending" && existing.handle === handle && existing.safe_address === safe && existing.kind === input.kind
      && existing.owner_kind === input.owner_kind && existing.owner_id === input.owner_id) return existing;
    throw new Error("INVALID_INPUT: handle or Safe already held");
  }
  const row: Party = (await sql.query(`insert into app.parties(party_id,kind,state,handle,display_name,safe_address,owner_kind,owner_id,created_at,updated_at)
    values ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$8) returning *`, [newId("party"), input.kind, handle, input.display_name, safe, input.owner_kind, input.owner_id, now])).rows[0];
  await emit(sql, row, null, "register", now); return row;
}
async function finish(sql: Sql, partyId: string, target: "active" | "released", now: number): Promise<Party> {
  const row: Party | undefined = (await sql.query("select * from app.parties where party_id=$1 for update", [partyId])).rows[0];
  if (!row || row.state !== "pending" && row.state !== target) throw new Error("WRONG_STATE: Party birth is not pending");
  if (row.state === target) return row;
  const changed: Party = (await sql.query(`update app.parties set state=$2,handle=case when $2='released' then null else handle end,updated_at=$3
    where party_id=$1 returning *`, [partyId, target, now])).rows[0];
  await emit(sql, changed, row.state, target === "active" ? "activate" : "release", now); return changed;
}
export const activate = (sql: Sql, partyId: string, now: number) => finish(sql, partyId, "active", now);
export const release = (sql: Sql, partyId: string, now: number) => finish(sql, partyId, "released", now);

export async function resolveRecipient(sql: Sql, locator: Locator, config: PersonalSafeConfig, now: number): Promise<Resolution> {
  let row: Party | undefined, named = false;
  if (locator._tag === "party" || locator._tag === "handle") {
    const column = locator._tag === "party" ? "party_id" : "handle";
    const value = locator._tag === "party" ? locator.party_id : normalizeHandle(locator.handle);
    row = (await sql.query(`select * from app.parties where ${column}=$1`, [value])).rows[0];
    if (!row) return { resolved: false, reason: locator._tag === "party" ? "unknown-party" : "unknown-handle" };
  } else {
    const email = locator._tag === "mailbox" ? locator.mailbox.trim().toLowerCase() : null;
    if (email !== null && (email.length > 254 || email.split("@")[0]!.length > 64 ||
      !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email))) return { resolved: false, reason: "malformed" };
    const safe = email !== null ? personalSafeAddress(config, email) : (locator as { address: string }).address.toLowerCase();
    if (!addressPattern.test(safe)) return { resolved: false, reason: "malformed" };
    if (safe === zero) return { resolved: false, reason: "zero-address" };
    const digest = email === null ? null : createHash("sha256").update(email).digest("hex");
    await lock(sql, `safe:${safe}`);
    row = (await sql.query("select * from app.parties where (safe_address=$1 and state<>'released') or ($2::text is not null and mailbox_digest=$2) for update", [safe, digest])).rows[0];
    if (!row) {
      row = (await sql.query(`insert into app.parties(party_id,kind,state,safe_address,mailbox_digest,created_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,$6) returning *`, [newId("party"), email === null ? "address" : "person", email === null ? "outside" : "provisional", safe, digest, now])).rows[0] as Party;
      await emit(sql, row, null, email === null ? "name_address" : "name_person", now); named = true;
    } else if (email !== null && row.state === "outside") {
      row = (await sql.query("update app.parties set kind='person',state='provisional',mailbox_digest=$2,updated_at=$3 where party_id=$1 returning *", [row.party_id, digest, now])).rows[0] as Party;
      await emit(sql, row, "outside", "adopt_mailbox", now); named = true;
    }
  }
  if (row.state === "released") return { resolved: false, reason: "released" };
  return { resolved: true, party_id: row.party_id, kind: row.kind, state: row.state, handle: row.handle,
    display_name: row.display_name, safe_address: row.safe_address, named };
}

export type Profile = {
  party_id: string; display_name: string; photo_file_id: string | null; country: string;
  safe_address: string; created_at: number; updated_at: number;
};
export type ProfileInput = { display_name: string; country: string; photo_file_id?: string | null };
export type ProfileServices = {
  personalSafe: PersonalSafeConfig;
  /** Composition supplies Media.requireImage, on this same Sql, never anonymous Media.get. */
  requireImage(sql: Sql, fileId: string): Promise<{ file_id: string; content_type: string; size: number }>;
};
/** Privileged provisioning only, after Access and the Party directory. */
export async function migrateProfiles(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./profiles.sql", import.meta.url), "utf8"));
}

// ISO 3166-1 alpha-2 assigned codes; not CLDR groups, user-assigned or reserved region codes.
const countries = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
async function profilePerson(sql: Sql) {
  const person = (await sql.query<{ person_id: string; email: string; safe_address: string }>(`select person_id,email,safe_address
    from app.principals where kind='person' and person_id=nullif(current_setting('app.person_id',true),'')
    and email=nullif(current_setting('app.email',true),'') and safe_address=nullif(current_setting('app.safe_address',true),'')`)).rows[0];
  if (!person) throw new Error("NOT_AUTHENTICATED: person session required");
  return person;
}
async function profileFor(sql: Sql, personId: string): Promise<Profile | null> {
  const row = (await sql.query(`select p.party_id,p.display_name,p.photo_file_id,p.safe_address,
    f.country,f.created_at,f.updated_at from app.profiles f join app.parties p using(party_id)
    where f.person_id=$1 and p.kind='person' and p.state='active' and p.owner_kind='person' and p.owner_id=$1`, [personId])).rows[0];
  return row ? { ...row, created_at: Number(row.created_at), updated_at: Number(row.updated_at) } : null;
}
export async function getProfile(sql: Sql): Promise<Profile | null> {
  return profileFor(sql, (await profilePerson(sql)).person_id);
}
export async function requireProfile(sql: Sql): Promise<Profile> {
  const profile = await getProfile(sql);
  if (!profile) throw new Error("PROFILE_NOT_FOUND: complete your profile");
  return profile;
}

/** Access authenticates first; now is the authoritative transaction world instant, not body data. */
export async function saveProfile(sql: Sql, input: ProfileInput, services: ProfileServices, now: number): Promise<Profile> {
  const person = await profilePerson(sql);
  if (typeof input.display_name !== "string" || !input.display_name.trim() || input.display_name.trim().length > 80)
    throw new Error("INVALID_INPUT: display_name");
  if (typeof input.country !== "string" || !countries.has(input.country.trim().toUpperCase())) throw new Error("INVALID_INPUT: country");
  if (input.photo_file_id !== undefined && input.photo_file_id !== null &&
    (typeof input.photo_file_id !== "string" || !input.photo_file_id)) throw new Error("INVALID_INPUT: photo_file_id");
  const name = input.display_name.trim(), country = input.country.trim().toUpperCase();
  if (typeof input.photo_file_id === "string") await services.requireImage(sql, input.photo_file_id);
  const safe = personalSafeAddress(services.personalSafe, person.email);
  if (safe !== person.safe_address) throw new Error("INVALID_INPUT: personal Safe configuration");
  const digest = createHash("sha256").update(person.email).digest("hex");
  await lock(sql, `safe:${safe}`);
  const candidates = (await sql.query<Party>(`select * from app.parties where (safe_address=$1 and state<>'released')
    or mailbox_digest=$2 for update`, [safe, digest])).rows;
  let row = candidates[0];
  if (candidates.length > 1 || row && (row.safe_address !== safe ||
    !(row.state === "outside" && row.kind === "address" && row.owner_id === null ||
      row.state === "provisional" && row.kind === "person" && row.owner_id === null ||
      row.state === "active" && row.kind === "person" && row.owner_kind === "person" && row.owner_id === person.person_id)))
    throw new Error("INVALID_INPUT: Party identity conflict");
  const before = await profileFor(sql, person.person_id);
  const photo = input.photo_file_id === undefined ? row?.photo_file_id ?? null : input.photo_file_id;
  const changed = !before || before.display_name !== name || before.photo_file_id !== photo || before.country !== country;
  if (!row) {
    row = (await sql.query<Party>(`insert into app.parties(party_id,kind,state,display_name,photo_file_id,safe_address,
      mailbox_digest,owner_kind,owner_id,created_at,updated_at) values($1,'person','active',$2,$3,$4,$5,'person',$6,$7,$7) returning *`,
    [newId("party"), name, photo, safe, digest, person.person_id, now])).rows[0]!;
    await emit(sql, row, null, "onboard", now);
  } else if (row.state !== "active" || row.display_name !== name || row.photo_file_id !== photo) {
    const from = row.state;
    row = (await sql.query<Party>(`update app.parties set kind='person',state='active',display_name=$2,photo_file_id=$3,
      mailbox_digest=$4,owner_kind='person',owner_id=$5,updated_at=$6 where party_id=$1 returning *`,
    [row.party_id, name, photo, digest, person.person_id, now])).rows[0]!;
    if (from !== "active") await emit(sql, row, from, "claim", now);
  }
  if (changed) await sql.query(`insert into app.profiles(person_id,party_id,country,created_at,updated_at) values($1,$2,$3,$4,$4)
    on conflict(person_id) do update set country=excluded.country,updated_at=excluded.updated_at`, [person.person_id, row.party_id, country, now]);
  return (await profileFor(sql, person.person_id))!;
}

export const profilePaths = ["/parties/profiles/save", "/parties/profiles/get"] as const;
/** Mounted after Access.authenticate inside the caller's drained transaction; errors must roll back. */
export async function routeProfiles(sql: Sql, path: string, input: Record<string, unknown>, services: ProfileServices, now: number) {
  if (path === "/parties/profiles/get") return { status: 200, body: await getProfile(sql) };
  if (path === "/parties/profiles/save") return { status: 200, body: await saveProfile(sql, input as ProfileInput, services, now) };
  return null;
}
