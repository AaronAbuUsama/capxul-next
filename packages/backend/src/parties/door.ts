import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "../platform/db.ts";
import { emit as publish } from "../platform/outbox.ts";
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
function traced(trace: string) {
  if (typeof trace !== "string" || !trace) throw new Error("INVALID_INPUT: trace_id required");
}
/** party_transitioned on the canonical outbox, in the caller's transaction; each transition happens once per Party. */
async function emit(sql: Sql, row: Party, from: Party["state"] | null, transition: string, now: number, trace: string) {
  await publish(sql, {
    id: `party:${row.party_id}:${transition}`, name: "party_transitioned", machine: "party", entity_id: row.party_id,
    owner_kind: row.owner_kind, owner_id: row.owner_id, actor: null, trace_id: trace, at: now,
    props: { from, to: row.state, transition, party_id: row.party_id, kind: row.kind, owner_kind: row.owner_kind, owner_id: row.owner_id },
  });
}
export async function lookup(sql: Sql, partyId: string): Promise<Party | null> {
  return (await sql.query("select * from app.parties where party_id=$1 and state<>'released'", [partyId])).rows[0] ?? null;
}
export async function lookupBySafe(sql: Sql, safe: string): Promise<Party | null> {
  return (await sql.query("select * from app.parties where safe_address=$1 and state<>'released'", [safe.toLowerCase()])).rows[0] ?? null;
}
/** now is the caller transaction's authoritative world instant, never request data or a host fallback; trace is the caller's. */
export async function register(sql: Sql, input: Registration, now: number, trace: string): Promise<Party> {
  traced(trace);
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
  await emit(sql, row, null, "register", now, trace); return row;
}
async function finish(sql: Sql, partyId: string, target: "active" | "released", now: number, trace: string): Promise<Party> {
  traced(trace);
  const row: Party | undefined = (await sql.query("select * from app.parties where party_id=$1 for update", [partyId])).rows[0];
  if (!row || row.state !== "pending" && row.state !== target) throw new Error("WRONG_STATE: Party birth is not pending");
  if (row.state === target) return row;
  const changed: Party = (await sql.query(`update app.parties set state=$2,handle=case when $2='released' then null else handle end,updated_at=$3
    where party_id=$1 returning *`, [partyId, target, now])).rows[0];
  await emit(sql, changed, row.state, target === "active" ? "activate" : "release", now, trace); return changed;
}
export const activate = (sql: Sql, partyId: string, now: number, trace: string) => finish(sql, partyId, "active", now, trace);
export const release = (sql: Sql, partyId: string, now: number, trace: string) => finish(sql, partyId, "released", now, trace);

export async function resolveRecipient(sql: Sql, locator: Locator, config: PersonalSafeConfig, now: number, trace: string): Promise<Resolution> {
  traced(trace);
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
      await emit(sql, row, null, email === null ? "name_address" : "name_person", now, trace); named = true;
    } else if (email !== null && row.state === "outside") {
      row = (await sql.query("update app.parties set kind='person',state='provisional',mailbox_digest=$2,updated_at=$3 where party_id=$1 returning *", [row.party_id, digest, now])).rows[0] as Party;
      await emit(sql, row, "outside", "adopt_mailbox", now, trace); named = true;
    }
  }
  if (row.state === "released") return { resolved: false, reason: "released" };
  return { resolved: true, party_id: row.party_id, kind: row.kind, state: row.state, handle: row.handle,
    display_name: row.display_name, safe_address: row.safe_address, named };
}
