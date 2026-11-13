import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { migratePayments, readCommandPayments, readPayment } from "../src/payments/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment storage checks require a named disposable Postgres world");

test("payment storage scopes both sides, separates owner kinds, and denies runtime direct mutation", async () => {
  const adminUrl = new URL(process.env.PG_ADMIN_URL!);
  adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const tenant = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const worker = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL });
  await Promise.all([admin.connect(), tenant.connect(), worker.connect()]);
  const tag = `payment-test-${crypto.randomUUID()}`;
  try {
    await admin.query("begin");
    await migratePayments(admin);
    await migratePayments(admin);
    await admin.query("commit");
    await worker.query(`insert into app.payments (
      owner_id,owner_kind,id,command_id,origin,route,status,kind,chain_id,chain_payment_id,job_nonce,
      payer_safe,payer_label,payee_kind,payee_id,payee_safe,payee_label,token_address,asset,decimals,amount_raw,
      document_hash,created_at,updated_at)
      values ($1,'organization',$2,$3,'prepared','budget','prepared',7,84532,$4,'0',
      '0x01','Payer','person',$5,'0x02','Recipient','0x03','USDC',6,'1234567','0x04',1234,1234)`,
    [tag, `${tag}-a`, `${tag}-command`, `${tag}-chain`, `${tag}-recipient`]);
    const scope = async (kind: string, id: string) => {
      await tenant.query("select set_config('app.owner_kind',$1,false),set_config('app.owner_id',$2,false)", [kind, id]);
    };
    const owner = { kind: "organization", id: tag } as const;
    await scope(owner.kind, owner.id);
    const held = await readPayment(tenant, owner, `${tag}-a`);
    assert.equal(held?.amount_raw, "1234567");
    assert.equal(held?.status, "prepared");
    assert.equal(held?.created_at, 1234);
    assert.deepEqual((await readCommandPayments(tenant, owner, `${tag}-command`)).map((p) => p.id), [`${tag}-a`]);
    await scope("person", tag); // Same id, different kind is not the same tenant.
    assert.equal(await readPayment(tenant, owner, `${tag}-a`), null);
    await scope("organization", `${tag}-outsider`);
    assert.equal(await readPayment(tenant, owner, `${tag}-a`), null);
    await scope("person", `${tag}-recipient`);
    assert.equal((await readPayment(tenant, owner, `${tag}-a`))?.payee_id, `${tag}-recipient`);
    assert.equal(await readPayment(tenant, { kind: "person", id: tag }, `${tag}-a`), null);
    await assert.rejects(tenant.query("update app.payments set amount_raw='9' where id=$1", [`${tag}-a`]), { code: "42501" });
    await assert.rejects(tenant.query("delete from app.payments where id=$1", [`${tag}-a`]), { code: "42501" });
    await assert.rejects(worker.query("delete from app.payments where id=$1", [`${tag}-a`]), { code: "42501" });
    await assert.rejects(worker.query(`insert into app.payments select * from app.payments where id=$1`, [`${tag}-a`]), { code: "23505" });
    assert.equal((await readPayment(worker, owner, `${tag}-a`))?.amount_raw, "1234567");
  } finally {
    await admin.query("rollback");
    await admin.query("delete from app.payments where owner_id=$1", [tag]);
    await Promise.all([admin.end(), tenant.end(), worker.end()]);
  }
});
