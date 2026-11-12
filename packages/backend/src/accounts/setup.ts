import { randomUUID } from "node:crypto";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import type { GateCatalogue, Principal } from "../access/door.ts";
import { eligibility, personalSafe, type PersonalSafe } from "./door.ts";

async function transition(sql: Sql, row: PersonalSafe, from: PersonalSafe["status"] | null, name: string, trace: string, now: number) {
  await emit(sql, { id: randomUUID(), name: "personal_safe_transitioned", machine: "personal-safe", entity_id: row.person_id,
    owner_kind: "person", owner_id: row.person_id, actor: row.person_id, trace_id: trace, at: now,
    props: { from, to: row.status, transition: name, person_id: row.person_id, safe: row.safe_address,
      attempt: row.attempt, failure_code: row.failure_code } });
}

/** The web runtime supplies the parties profile guard, not a boolean accepted from a request. */
export async function startSetup(sql: Sql, principal: Principal, signer: string, config: {
  companiesHouse: string; catalogue: GateCatalogue; requireProfile: (sql: Sql, personId: string) => Promise<void>;
}, trace: string, now: number): Promise<PersonalSafe> {
  if (principal.kind !== "person" || !principal.email) throw new Error("NOT_AUTHENTICATED: person required");
  await config.requireProfile(sql, principal.personId);
  if ((await eligibility(sql, principal, config.catalogue, now)).access === "waiting") throw new Error("FEATURE_NOT_AVAILABLE: beta access required");
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer) || /^0x0{40}$/i.test(signer) || signer.toLowerCase() === config.companiesHouse.toLowerCase())
    throw new Error("INVALID_INPUT: signer");
  signer = signer.toLowerCase();
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`personal-safe:${principal.personId}`]);
  const old = await personalSafe(sql, principal.personId);
  if (old && old.status !== "failed") {
    if (old.signer_address !== signer) throw new Error("WRONG_STATE: Safe has another signer");
    return old;
  }
  const row = (await sql.query<PersonalSafe>(`insert into app.personal_safes
    (person_id,email,safe_address,signer_address,status,attempt,collected,created_at,updated_at)
    values($1,$2,$3,$4,'claiming',1,0,$5,$5) on conflict(person_id) do update set
    signer_address=excluded.signer_address,status='claiming',attempt=app.personal_safes.attempt+1,
    claim_tx_hash=null,claimed_at=null,claimed_block=null,collect_approval_id=null,collected=0,failure_code=null,updated_at=$5 returning *`,
  [principal.personId, principal.email, principal.safeAddress, signer, now])).rows[0]!;
  await transition(sql, row, old?.status ?? null, old ? "retry" : "start", trace, now);
  return row;
}

/** Chain proof, not a setup caller's assertion, admits the claiming -> collecting transition. */
export async function observeClaim(sql: Sql, personId: string, rpc: string, trace: string, now: number): Promise<PersonalSafe> {
  const old = (await sql.query<PersonalSafe>("select * from app.personal_safes where person_id=$1 for update", [personId])).rows[0];
  if (!old) throw new Error("SMART_ACCOUNT_MISSING: no setup");
  if (["collecting", "ready"].includes(old.status)) return old;
  if (old.status !== "claiming") throw new Error("WRONG_STATE: setup is not claiming");
  const chain = createPublicClient({ transport: http(rpc) }), block = await chain.getBlockNumber();
  const [code, owners] = await Promise.all([
    chain.getCode({ address: old.safe_address as Address, blockNumber: block }),
    chain.readContract({ address: old.safe_address as Address, abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners", blockNumber: block }),
  ]);
  if (!code || code === "0x" || owners.length !== 1 || owners[0]!.toLowerCase() !== old.signer_address)
    throw new Error("WRONG_STATE: Safe is not claimed by exactly this signer");
  const row = (await sql.query<PersonalSafe>(`update app.personal_safes set status='collecting',claimed_at=$2,claimed_block=$3,updated_at=$2
    where person_id=$1 and status='claiming' returning *`, [personId, now, Number(block)])).rows[0]!;
  await transition(sql, row, "claiming", "claim", trace, now);
  return row;
}

/** The collection owner verifies its actual approval/escrows; declining or expiring may still finish setup. */
export async function finishSetup(sql: Sql, personId: string,
  collection: (sql: Sql, setup: PersonalSafe) => Promise<{ ended: boolean; collected: number }>, trace: string, now: number) {
  const old = (await sql.query<PersonalSafe>("select * from app.personal_safes where person_id=$1 for update", [personId])).rows[0];
  if (!old) throw new Error("SMART_ACCOUNT_MISSING: no setup");
  if (old.status === "ready") return old;
  if (old.status !== "collecting") throw new Error("WRONG_STATE: setup is not collecting");
  const result = await collection(sql, old);
  if (!result.ended || !Number.isSafeInteger(result.collected) || result.collected < 0) throw new Error("WRONG_STATE: collection is unfinished");
  const row = (await sql.query<PersonalSafe>("update app.personal_safes set status='ready',collected=$2,updated_at=$3 where person_id=$1 returning *",
    [personId, result.collected, now])).rows[0]!;
  await transition(sql, row, "collecting", "finish", trace, now);
  return row;
}
