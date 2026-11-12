import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before } from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { sendCode, verifyCode, type GateCatalogue, type SignIn } from "../src/access/door.ts";

// Component regression, not selected-stack acceptance or live Mail-provider conformance.
const url = process.env.ACCESS_TEST_ADMIN_URL;
if (!url || process.env.CAPXUL_DISPOSABLE !== "true" || !new URL(url).pathname.startsWith("/access_"))
  throw new Error("ACCESS_TEST_ADMIN_URL must name a disposable /access_* Postgres database");
const admin = new pg.Client({ connectionString: url });
export let db: Database;
export const now = 1_772_442_000_000, run = randomUUID().slice(0, 8);
export const config = { companiesHouse: "0x1234567890123456789012345678901234567890" as const, namespace: "capxul:devnet:email:v1" };
export const catalogue: GateCatalogue = { "beta-access": { target: "person", money: false }, books: { target: "organization", money: true } };

before(async () => {
  await admin.connect();
  const roles = [
    { role: "capxul_core", env: "ACCESS_TEST_TENANT" },
    { role: "capxul_worker", env: "ACCESS_TEST_WORKER" },
  ];
  const existing = (await admin.query("select rolname from pg_roles where rolname=any($1)", [roles.map(({ role }) => role)])).rows;
  // Roles are cluster-wide. Refuse before migrations or role writes if an existing
  // account has no supplied credentials; never reset another database's password.
  for (const { role, env } of roles)
    if (existing.some((row) => row.rolname === role) && !process.env[env])
      throw new Error(`${env} must supply existing ${role} credentials for the disposable database`);
  for (const { role, env } of roles) {
    if (!existing.some((row) => row.rolname === role)) {
      const password = randomBytes(24).toString("hex");
      await admin.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${password}'`);
      const target: URL = new URL(url!); target.username = role; target.password = password;
      process.env[env] = target.href;
    }
    const target: URL = new URL(process.env[env]!);
    const origin: URL = new URL(url!);
    assert.equal(target.host, origin.host, `${env} must use the disposable Postgres instance`);
    assert.equal(target.pathname, origin.pathname, `${env} must use the disposable database`);
    const client = new pg.Client({ connectionString: target.href });
    try {
      await client.connect();
      const identity = (await client.query(`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user`)).rows[0];
      assert.deepEqual(identity, { role, rolsuper: false, rolbypassrls: false });
    } finally { await client.end(); }
  }
  await admin.query("begin");
  try {
    await admin.query(await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await admin.query("grant usage on schema app to capxul_core,capxul_worker");
    await migrateOutbox(admin);
    for (const name of ["access", "accounts"]) await admin.query(await readFile(new URL(`../src/${name}/schema.sql`, import.meta.url), "utf8"));
    await admin.query("commit");
  } catch (error) { await admin.query("rollback"); throw error; }
  db = new Database(process.env.ACCESS_TEST_TENANT!, process.env.ACCESS_TEST_WORKER!);
});
after(async () => { if (db) await db.close(); await admin.end(); });

export async function signIn(email: string): Promise<SignIn> {
  let code = "";
  await db.transaction("", (sql) => sendCode(sql, { email }, {
    async send(message) { code = message.text!.match(/\b\d{6}\b/)![0]; return { id: randomUUID() }; },
  }, now), true);
  const result = await db.transaction("", (sql) => verifyCode(sql, { email, code, client: "authority-component-test" }, config, now + 1), true);
  assert(result.ok); return result.value;
}
