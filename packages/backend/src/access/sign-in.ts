import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createPublicClient, http, parseAbi, recoverMessageAddress, type Address, type Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { personalSafeAddress } from "../platform/safe.ts";
import type { Mail } from "../shared/door.ts";
import { authenticate, digest, normalizeEmail } from "./door.ts";

export type AccessConfig = { companiesHouse: Address; namespace: string };
export type SignIn = { token: string; personId: string; safe: string; expiresAt: string };
const lock = (sql: Sql, key: string) => sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`access:${key}`]);

export async function sendCode(sql: Sql, input: { email: string }, mail: Mail, now: number) {
  const email = normalizeEmail(input.email);
  await lock(sql, email);
  const prior = (await sql.query("select sent_at from app.sign_in_codes where email=$1", [email])).rows[0];
  if (prior && now - prior.sent_at.getTime() < 60_000)
    throw Object.assign(new Error("RATE_LIMITED: sign-in resend cooldown"), { retryAfterMs: 60_000 - (now - prior.sent_at.getTime()) });
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0"), hash = digest(`${email}:${code}`);
  try {
    await mail.send({ to: email, subject: "Your Capxul sign-in code", text: `Your sign-in code is ${code}. It expires in five minutes.`, idempotencyKey: hash });
  } catch { throw new Error("PROVIDER_ERROR: sign-in mail unavailable"); }
  await sql.query(`insert into app.sign_in_codes(email,code_hash,attempts_left,expires_at,sent_at) values($1,$2,3,$3,$4)
    on conflict(email) do update set code_hash=excluded.code_hash,attempts_left=3,expires_at=excluded.expires_at,sent_at=excluded.sent_at`,
  [email, hash, new Date(now + 300_000), new Date(now)]);
  return { email, expiresAt: new Date(now + 300_000).toISOString(), resendAfter: new Date(now + 60_000).toISOString() };
}

async function openSession(sql: Sql, personId: string, safe: string, method: "code" | "key", client: string,
  now: number, nonce: string | null, trace = ""): Promise<SignIn> {
  const token = randomBytes(32).toString("base64url"), id = randomUUID();
  const expiresAt = new Date(now + (method === "code" ? 30 : 1) * 86_400_000);
  await sql.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,challenge_nonce,client,created_at,expires_at)
    values($1,$2,$3,$4,'active',$5,$6,$7,$8)`, [personId, id, digest(token), method, nonce, client, new Date(now), expiresAt]);
  await emit(sql, { id: randomUUID(), name: "session_transitioned", machine: "session", entity_id: id,
    owner_kind: "person", owner_id: personId, actor: personId, trace_id: trace || id, at: now,
    props: { from: null, to: "active", transition: "open", session_id: id, person_id: personId, method } });
  return { token, personId, safe, expiresAt: expiresAt.toISOString() };
}

/** A wrong-code result must commit its spent try; the HTTP adapter renders the error AFTER the transaction. */
/** `trace` is the request's trace when Core has one; the session id stands in otherwise. */
export async function verifyCode(sql: Sql, input: { email: string; code: string; client: string }, config: AccessConfig, now: number, trace = ""):
Promise<{ ok: true; value: SignIn & { email: string } } | { ok: false; error: string; triesLeft?: number }> {
  const email = normalizeEmail(input.email);
  if (!/^\d{6}$/.test(input.code)) return { ok: false, error: "INVALID_INPUT" };
  await lock(sql, email);
  const row = (await sql.query("select * from app.sign_in_codes where email=$1 for update", [email])).rows[0];
  if (!row) return { ok: false, error: "INVALID_INPUT" };
  if (row.expires_at.getTime() <= now) return { ok: false, error: "OTP_EXPIRED" };
  if (!row.attempts_left) return { ok: false, error: "RATE_LIMITED" };
  if (!timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(digest(`${email}:${input.code}`)))) {
    await sql.query("update app.sign_in_codes set attempts_left=attempts_left-1 where email=$1", [email]);
    return { ok: false, error: "INVALID_INPUT", triesLeft: row.attempts_left - 1 };
  }
  const safe = personalSafeAddress(config, email).toLowerCase();
  await sql.query(`insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at)
    values($1,'person',$2,$3,null,$4) on conflict(email) do nothing`, [randomUUID(), email, safe, new Date(now)]);
  const p = (await sql.query("select person_id,safe_address from app.principals where email=$1", [email])).rows[0];
  await sql.query("delete from app.sign_in_codes where email=$1", [email]);
  return { ok: true, value: { ...await openSession(sql, p.person_id, p.safe_address, "code", input.client, now, null, trace), email } };
}

export function challenge(secret: string, domain: string, safe: Address, now: number) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) throw new Error("INVALID_INPUT: safe");
  const body = Buffer.from(JSON.stringify({ domain, safe: safe.toLowerCase(), nonce: randomUUID(), at: now })).toString("base64url");
  return { challenge: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`, expiresAt: new Date(now + 300_000).toISOString() };
}
export async function withKey(sql: Sql, input: { safe: string; challenge: string; signature: Hex; client: string },
  config: { secret: string; domain: string; rpc: string; agentOwner: Address }, now: number, trace = ""): Promise<SignIn & { signer: string; owner: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.safe)) throw new Error("INVALID_INPUT: safe");
  const reject = () => { throw new Error("NOT_AUTHENTICATED: invalid or spent agent proof"); };
  const [body, mac, extra] = input.challenge.split(".");
  if (!body || !mac || extra) return reject();
  const expected = createHmac("sha256", config.secret).update(body).digest("base64url");
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return reject();
  let proof: { domain: string; safe: Address; nonce: string; at: number };
  try { proof = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return reject(); }
  if (proof.domain !== config.domain || !Number.isSafeInteger(proof.at) || proof.at > now || now - proof.at >= 300_000 ||
    !/^0x[0-9a-fA-F]{40}$/.test(proof.safe) || proof.safe !== input.safe.toLowerCase() || typeof proof.nonce !== "string") return reject();
  let signer: Address;
  try { signer = await recoverMessageAddress({ message: input.challenge, signature: input.signature }); } catch { return reject(); }
  const chain = createPublicClient({ transport: http(config.rpc) });
  const [agent, owners] = await Promise.all([
    chain.readContract({ address: config.agentOwner, abi: parseAbi(["function agentOf(address safe) view returns (address owner, address signer, bool frozen, bool removed)"]), functionName: "agentOf", args: [proof.safe] }),
    chain.readContract({ address: proof.safe, abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners" }),
  ]).catch(() => { throw new Error("PROVIDER_ERROR: agent authority unavailable"); });
  if (/^0x0{40}$/i.test(agent[0]) || agent[2] || agent[3] || agent[1].toLowerCase() !== signer.toLowerCase() ||
    owners.length !== 1 || owners[0]!.toLowerCase() !== signer.toLowerCase()) return reject();
  await lock(sql, proof.safe);
  if ((await sql.query("select 1 from app.sessions where challenge_nonce=$1", [proof.nonce])).rowCount) return reject();
  const existing = (await sql.query("select * from app.principals where safe_address=$1", [proof.safe])).rows[0];
  if (existing && existing.kind !== "agent") return reject();
  const personId = existing?.person_id ?? randomUUID();
  await sql.query(`insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at)
    values($1,'agent',null,$2,$3,$4) on conflict(person_id) do update set signer_address=excluded.signer_address`,
  [personId, proof.safe, signer.toLowerCase(), new Date(now)]);
  return { ...await openSession(sql, personId, proof.safe, "key", input.client, now, proof.nonce, trace), signer: signer.toLowerCase(), owner: agent[0].toLowerCase() };
}

export async function currentSession(sql: Sql, bearer: string, config: { rpc: string; companiesHouse: Address }, now: number) {
  const p = await authenticate(sql, bearer, now);
  const session = (await sql.query("select expires_at from app.sessions where token_hash=$1 and person_id=$2", [digest(bearer), p.personId])).rows[0];
  let setupState: "ready" | "setup-required" = "ready";
  if (p.kind === "person") {
    const chain = createPublicClient({ transport: http(config.rpc) });
    try {
      const code = await chain.getCode({ address: p.safeAddress as Address });
      if (!code || code === "0x") setupState = "setup-required";
      else {
        const owners = await chain.readContract({ address: p.safeAddress as Address,
          abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners" });
        if (!owners.length || owners.some((owner) => owner.toLowerCase() === config.companiesHouse.toLowerCase())) setupState = "setup-required";
      }
    } catch { throw new Error("PROVIDER_ERROR: Safe ownership unavailable"); }
  }
  return { personId: p.personId, kind: p.kind, email: p.email, safe: p.safeAddress,
    expiresAt: session.expires_at.toISOString() as string, setupState };
}

export async function revoke(sql: Sql, bearer: string, now: number, trace = "") {
  const actor = await authenticate(sql, bearer, now);
  const row = (await sql.query(`update app.sessions set status='revoked',ended_at=$2
    where token_hash=$1 and status='active' returning session_id,method`, [digest(bearer), new Date(now)])).rows[0];
  if (row) await emit(sql, { id: randomUUID(), name: "session_transitioned", machine: "session", entity_id: row.session_id,
    owner_kind: "person", owner_id: actor.personId, actor: actor.personId, trace_id: trace || row.session_id, at: now,
    props: { from: "active", to: "revoked", transition: "revoke", session_id: row.session_id, person_id: actor.personId, method: row.method } });
  if (!row) throw new Error("NOT_AUTHENTICATED: session ended");
  return { sessionId: row.session_id as string, endedAt: new Date(now).toISOString() };
}
