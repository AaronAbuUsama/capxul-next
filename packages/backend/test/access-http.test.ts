import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { db, now, config, run, publicAccess } from "./access-fixture.ts";
import { devnetMail, migrateMailSink } from "../../devnet/src/devnet/door.ts";
import { createAccessClient, AccessClientError, signInByCode } from "../../sdk/src/access/door.ts";

test("public HTTP OTP uses the durable devnet Mail sink, commits spent tries, and obtains a fresh session after revocation", async () => {
  const admin = new pg.Client({ connectionString: process.env.ACCESS_TEST_ADMIN_URL });
  await admin.connect();
  type JsonResult = pg.QueryResult<{ jsonb_build_object: Record<string, unknown> }>;
  const decode = (result: JsonResult | JsonResult[]) => (Array.isArray(result) ? result : [result])
    .flatMap((part) => part.rows.map((row) => row.jsonb_build_object));
  await migrateMailSink(async (sql) => decode(await admin.query(sql)));
  let clock = now;
  const mail = devnetMail(async (text) => {
    const connection = await db.worker.connect();
    try { return decode(await connection.query(text)); } finally { connection.release(); }
  }, async () => clock);
  const services = { personalSafe: config, mail, agent: { secret: "isolated-component", domain: "component.invalid",
    rpc: process.env.ACCESS_TEST_RPC_URL!, agentOwner: "0x0000000000000000000000000000000000000001" as const } };
  const server = await publicAccess(services, () => clock);
  const client = createAccessClient({ coreUrl: server.url });
  const email = `public-${run}@example.test`;
  const code = async () => {
    const row = (await mail.list({ to: email })).mail[0];
    assert(row && typeof row.text === "string"); return row.text.match(/\b\d{6}\b/)![0];
  };
  try {
    assert.equal((await client.sendCode({ email })).email, email);
    const delivered = await code();
    await assert.rejects(client.verifyCode({ email, code: delivered === "000000" ? "111111" : "000000", client: "public-component" }),
      (error: unknown) => error instanceof AccessClientError && error.triesLeft === 2);
    const session = await client.verifyCode({ email, code: delivered, client: "public-component" });
    const current = await client.current(session.token);
    assert.equal(current.personId, session.personId); assert.equal(current.safe, session.safe); assert.equal(current.email, email);
    assert.equal(current.kind, "person"); assert.equal(current.setupState, "setup-required");
    await client.revoke(session.token);
    await assert.rejects(client.current(session.token), /NOT_AUTHENTICATED/);
    clock += 60_001;
    await client.sendCode({ email });
    const refreshed = await client.verifyCode({ email, code: await code(), client: `fresh-${randomUUID()}` });
    assert.notEqual(refreshed.token, session.token); assert.equal(refreshed.personId, session.personId); assert.equal(refreshed.safe, session.safe);
    assert.equal((await client.current(refreshed.token)).personId, session.personId);
    // Stopped clock: a decoy message with the same sentAt must not be read as the new code.
    const actor = `actor-${run}@example.test`;
    await mail.send({ to: actor, subject: "decoy", text: "Old code 123456.", idempotencyKey: `decoy-${run}` });
    const prepared = await signInByCode(client, mail, { email: actor, client: "actor-prep" });
    assert.deepEqual([prepared.session.kind, prepared.session.email, prepared.session.personId], ["person", actor, prepared.signIn.personId]);
  } finally { await server.close(); await admin.end(); }
});
