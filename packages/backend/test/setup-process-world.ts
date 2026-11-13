import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { Database, type Sql } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { readPrincipal } from "../src/access/door.ts";
import { eligibility } from "../src/accounts/door.ts";
import { advance, begin, migrate, type MoneyDeploymentFact, type SetupProcessServices, type SetupServices } from "../src/organizations/door.ts";

// The harness of setup-process.pg.ts. The setup's durable process on a dedicated loopback PG, built from the concept
// migrations alone. begin, Parties, the
// outbox and RLS are real; the signer, indexing, the FDE host and Approvals are scripted stand-ins, not chain proof.
const url = process.env.SETUP_PROCESS_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/setup_process_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("SETUP_PROCESS_TEST_ADMIN_URL must name a dedicated loopback setup_process_test database");
export const admin = new pg.Client({ connectionString: url });
const role = (name: string) => { const u = new URL(url); u.username = name; u.password = "setups"; return u.href; };
export let db: Database;
export const t0 = 1_767_225_600_000, trace = "trace-setup-process-4417", hex = (n: number, len = 40) => `0x${n.toString(16).padStart(len, "0")}`;
export const founder = { id: "person_founder", email: "founder@process.test", safe: hex(0xf0), party: "party_founder" };

/** One scripted chain: sends, receipts, facts and outside answers, each overridable per test. */
export function world() {
  const w = {
    sent: [] as string[], hashes: new Map<string, string>(), opened: [] as any[], landedAt: [] as any[], receipts: new Map<string, "success" | "reverted" | "lost" | null>(),
    minted: new Map<string, { safe: string; owner: string }>(), deployed: new Map<string, MoneyDeploymentFact>(),
    installed: null as boolean | null, fail: {} as Record<string, string>, seq: 0, fdeSafeOf: [] as [string, string][],
  };
  const failing = (what: string) => { if (w.fail[what]) throw new Error(`${w.fail[what]}: ${what}`); };
  // Like shared/service-signer.ts: a key it has seen answers its stored hash and sends nothing.
  const signed = (key: string) => {
    if (!w.hashes.has(key)) { w.sent.push(key); w.hashes.set(key, hex(++w.seq, 64)); }
    return { hash: w.hashes.get(key)! };
  };
  const services: SetupProcessServices = {
    chainId: 84532, finality: 0, installWindowMs: 86_400_000,
    async mint(i) { failing("mint"); return signed(i.key); },
    async deployMoney(i) { failing("deploy"); return signed(i.key); },
    async receipt({ hash }) { failing("receipt"); return w.receipts.has(hash) ? w.receipts.get(hash)! : "success"; },
    facts: {
      async safeMinted(_sql, q) { return w.minted.get(q.txHash) ?? null; },
      async moneyDeployed(_sql, q) { return w.deployed.get(q.txHash) ?? null; },
      async installed(_sql, q) { w.landedAt.push([q.txHash, q.blockNumber]); return w.installed; },
    },
    async installCalls(i) { failing("buildMoney"); return [{ to: i.deployment.safe, value: "0", data: `0xbatch${i.fdeSigner ? "fde" : ""}` }]; },
    fdeHost: { async provision({ orgId }) { failing("fde"); return { agentId: `fde:${orgId}`, signer: hex(0xfde1) }; } },
    async fdeSafe({ signer, owner }) { w.fdeSafeOf.push([signer, owner]); return hex(0xfde5); },
    async open(sql, who, terms, tr) {
      const approval_id = `apr_${w.opened.length + 1}`;
      // Same transaction as the setup's move: an approval row written here rolls back with it.
      await sql.query("select 1");
      w.opened.push({ who, terms, tr, approval_id }); return { approval_id };
    },
  };
  const fact = (safe: string, log: string): MoneyDeploymentFact => ({ log_id: log, chain_id: 84532, block_number: "4417", tx_hash: "", safe,
    founder_safe: founder.safe, board_top_hat: "11", shareholders_top_hat: "12", director_hat: "13", officer_hats: ["16", "14", "15"],
    roles: hex(0x7a), gate: hex(0x9a) });
  return { w, services, fact };
}
export const setupServices: SetupServices = {
  chainId: 84532, companySafe: { companiesHouse: hex(0xc4a11) as `0x${string}`, namespace: "capxul:test:company:v1" }, pricedCurrencies: [],
  async eligibility(sql) {
    const p = await readPrincipal(sql, (await sql.query("select current_setting('app.person_id',true) as id")).rows[0].id);
    return eligibility(sql, p!, { "beta-access": { target: "person", money: false } }, t0);
  },
  async requireImage() { return {}; }, async board() { return null; },
};
export const asFounder = <T>(run: (sql: Sql) => Promise<T>) => db.transaction("", async (sql) => {
  await sql.query("select set_config('app.person_id',$1,true),set_config('app.email',$2,true),set_config('app.safe_address',$3,true)", [founder.id, founder.email, founder.safe]);
  return run(sql);
}, true);
export const setup = async (orgId: string) => (await admin.query("select * from app.org_setups s join app.organizations o using(org_id) where org_id=$1", [orgId])).rows[0];
export const state = async (party: string) => (await admin.query("select state from app.parties where party_id=$1", [party])).rows[0].state;
export const transitions = async (orgId: string) => (await admin.query(`select event from app.transition_outbox where event->>'name'='org_setup_transitioned'
  and event->'props'->>'org_id'=$1 order by seq`, [orgId])).rows.map((r) => r.event.props.transition);
export let n = 0;
export const created = async (fde = true) => (await asFounder((sql) => begin(sql, { name: `Acme ${++n}`, handle: `acme-${n}`, country: "GB", fde },
  setupServices, t0, trace))).orgId;
export const step = (orgId: string, s: SetupProcessServices, at = t0 + 1) => advance(db, orgId, s, at, trace);
/** Another run lands between this run's snapshot (its first transaction) and its step's transaction. */
export const interleaved = (other: () => Promise<unknown>) => {
  let n = 0;
  return new Proxy(db, { get: (target, key) => key !== "transaction" ? Reflect.get(target, key) :
    async (...args: Parameters<Database["transaction"]>) => {
      const result = await target.transaction(...args);
      if (++n === 1) await other();
      return result;
    } }) as Database;
};

test.before(async () => {
  await admin.connect();
  await admin.query(`create role capxul_core login password 'setups' nosuperuser nobypassrls;
    create role capxul_worker login password 'setups' nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker`);
  await migrateOutbox(admin);
  for (const path of ["../src/access/schema.sql", "../src/accounts/schema.sql", "../src/parties/schema.sql"])
    await admin.query(readFileSync(new URL(path, import.meta.url), "utf8"));
  await migrate(admin);
  db = new Database(role("capxul_core"), role("capxul_worker"));
  await admin.query("insert into app.principals(person_id,kind,email,safe_address,created_at) values($1,'person',$2,$3,now())", [founder.id, founder.email, founder.safe]);
  await admin.query(`insert into app.admissions(email,person_id,status,joined_via,admitted_at,admitted_by,updated_at) values($1,$2,'admitted','operator',1,'operator',1)`, [founder.email, founder.id]);
  await admin.query(`insert into app.personal_safes(person_id,email,safe_address,signer_address,status,attempt,collected,created_at,updated_at)
    values($1,$2,$3,$4,'ready',1,0,1,1)`, [founder.id, founder.email, founder.safe, hex(0x51e1)]);
  await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values($1,'person','active',$2,'person',$3,1,1)`,
    [founder.party, founder.safe, founder.id]);
});
test.after(async () => { await db?.close(); await admin.end(); });
