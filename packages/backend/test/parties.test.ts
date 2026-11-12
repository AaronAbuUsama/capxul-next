import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPublicClient, createWalletClient, http } from "viem";
import { Database, transaction } from "../src/platform/db.ts";
import { activate, lookup, lookupBySafe, register, release, resolveRecipient } from "../src/parties/door.ts";
import { companySafeAddress, personalSafeAddress } from "../src/platform/safe.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main") throw new Error("named disposable migrated Postgres required");
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
const config = { companiesHouse: "0x1234567890123456789012345678901234567890" as const, namespace: "party-test" };
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
test.after(() => db.close());

test("local Safe derivations equal actual v4 pure contract calls with asymmetric namespaces and founders", async () => {
  assert(process.env.RPC_URL, "local disposable Anvil RPC_URL required");
  const transport = http(process.env.RPC_URL), client = createPublicClient({ transport });
  const wallet = createWalletClient({ transport, account: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" });
  for (const [contract, fn] of [["CompaniesHouseClaimer", "safeAddressFor"], ["CompanySafeMinter", "companySafeAddressFor"]] as const) {
    const artifact = JSON.parse(await readFile(new URL(`../../contracts/out/${contract}.sol/${contract}.json`, import.meta.url), "utf8"));
    const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, chain: null }) });
    assert(receipt.contractAddress);
    for (const namespace of ["beta:email:v1", "different:company:v2"]) {
      const cfg = { ...config, namespace }, name = "unusual-company", founder = "0xabcdef1234567890abcdef1234567890abcdef12" as const;
      const args = fn === "safeAddressFor" ? [cfg.companiesHouse, namespace, "person@example.test"] : [cfg.companiesHouse, namespace, name, founder];
      const actual: unknown = await client.readContract({ address: receipt.contractAddress, abi: artifact.abi, functionName: fn, args });
      const expected = fn === "safeAddressFor" ? personalSafeAddress(cfg, " Person@Example.Test ") : companySafeAddress(cfg, name, founder);
      assert.equal(expected, String(actual).toLowerCase());
    }
  }
});

test("owner scope sets all settings and clears them after commit and rollback on the same connection", async () => {
  const client = await db.tenant.connect();
  const read = async () => (await client.query(`select current_setting('app.org_id',true) as org,
    current_setting('app.owner_kind',true) as kind,current_setting('app.owner_id',true) as id`)).rows[0];
  try {
    await transaction(client, "same-id", async () => assert.deepEqual(await read(), { org: "same-id", kind: "organization", id: "same-id" }));
    assert.deepEqual(await read(), { org: "", kind: "", id: "" });
    await assert.rejects(transaction(client, "", async () => {
      assert.deepEqual(await read(), { org: "", kind: "person", id: "same-id" }); throw new Error("abort-person");
    }, { kind: "person", id: "same-id" }), /abort-person/);
    assert.deepEqual(await read(), { org: "", kind: "", id: "" });
    await transaction(client, "", async () => assert.deepEqual(await read(), { org: "", kind: "", id: "" }));
    await client.query("select set_config('app.person_id','stale-person',false),set_config('app.email','stale@example.test',false),set_config('app.safe_address','stale-safe',false)");
    await transaction(client, "other-org", async (sql) => {
      const identity = (await sql.query("select current_setting('app.person_id') as person,current_setting('app.email') as email,current_setting('app.safe_address') as safe")).rows[0];
      assert.deepEqual(identity, { person: "", email: "", safe: "" });
    });
    await client.query("reset app.person_id; reset app.email; reset app.safe_address");
    const scoped = await db.ownerTransaction({ kind: "person", id: "other-person" }, async (sql) =>
      (await sql.query("select current_setting('app.owner_id') as id,current_setting('app.org_id') as org")).rows[0]);
    assert.deepEqual(scoped, { id: "other-person", org: "" });
  } finally { client.release(); }
});

test("registration, activation and release preserve caller atomicity, idempotency and namespace", async () => {
  const stamp = Date.now(), suffix = stamp.toString(36), handle = `org-${suffix}`;
  const now = 946684800123, advanced = now + 47_000;
  const input = { kind: "organization" as const, handle: ` @${handle.toUpperCase()} `, display_name: "Acme",
    safe_address: address(stamp), owner_kind: "organization" as const, owner_id: `org-${suffix}` };
  const eventCount = async () => Number((await db.worker.query("select count(*) from app.party_events")).rows[0].count);
  const before = await eventCount();
  await assert.rejects(db.transaction("", async (sql) => { await register(sql, input, now); throw new Error("abort-birth"); }, true), /abort-birth/);
  assert.equal((await db.worker.query("select count(*) from app.parties where handle=$1", [handle])).rows[0].count, "0");
  assert.equal(await eventCount(), before);
  const [row, replay] = await Promise.all([0, 1].map(() => db.transaction("", (sql) => register(sql, input, now), true)));
  assert.equal(row!.party_id, replay!.party_id); assert.equal(row!.state, "pending"); assert.equal(row!.handle, handle);
  assert.equal(Number(row!.created_at), now); assert.equal(Number(row!.updated_at), now);
  assert.equal(await eventCount(), before + 1);
  await assert.rejects(db.transaction("", (sql) => register(sql, { ...input, handle: `${handle}-different` }, now), true), /INVALID_INPUT/);
  await assert.rejects(db.transaction("", async (sql) => { await activate(sql, row!.party_id, advanced); throw new Error("abort-activate"); }, true), /abort-activate/);
  assert.equal((await lookup(db.worker, row!.party_id))!.state, "pending");
  assert.equal(Number((await lookup(db.worker, row!.party_id))!.updated_at), now);
  assert.equal(await eventCount(), before + 1, "rolled-back activation must not append an event");
  await db.transaction("", async (sql) => { await activate(sql, row!.party_id, advanced); await activate(sql, row!.party_id, advanced + 1); }, true);
  assert.equal(Number((await lookup(db.worker, row!.party_id))!.updated_at), advanced);
  await assert.rejects(db.transaction("", (sql) => release(sql, row!.party_id, advanced), true), /WRONG_STATE/);
  const second = await db.transaction("", (sql) => register(sql, { ...input, handle: `${handle}-two`, safe_address: address(stamp + 1) }, now), true);
  await assert.rejects(db.transaction("", async (sql) => { await release(sql, second.party_id, advanced); throw new Error("abort-release"); }, true), /abort-release/);
  assert.equal((await lookup(db.worker, second.party_id))!.state, "pending");
  await db.transaction("", async (sql) => { await release(sql, second.party_id, advanced); await release(sql, second.party_id, advanced + 1); }, true);
  assert.equal(await lookup(db.worker, second.party_id), null);
  assert.equal(await lookupBySafe(db.worker, second.safe_address), null);
  const reborn = await db.transaction("", (sql) => register(sql, { ...input, handle: `${handle}-two`, safe_address: address(stamp + 1) }, now), true);
  assert.notEqual(reborn.party_id, second.party_id);
  const beforeRead = await eventCount();
  await db.transaction("unrelated-org", async sql => {
    assert.equal((await lookupBySafe(sql, reborn.safe_address.toUpperCase()))!.party_id, reborn.party_id);
    assert.equal((await lookupBySafe(sql, row!.safe_address))!.display_name, "Acme");
    assert.equal(await lookupBySafe(sql, address(stamp + 17)), null);
  });
  assert.equal(await eventCount(), beforeRead, "name lookup must not mutate the directory or append an event");
  const events = (await db.worker.query("select data->>'transition' as transition,at from app.party_events where party_id=$1 order by id", [row!.party_id])).rows;
  assert.deepEqual(events.map((r) => r.transition), ["register", "activate"]);
  assert.deepEqual(events.map((r) => Number(r.at)), [now, advanced]);
  const released = (await db.worker.query("select updated_at from app.parties where party_id=$1", [second.party_id])).rows[0];
  assert.equal(Number(released.updated_at), advanced);
});

test("resolution names atomically, adopts outside identity and refuses malformed or released locators", async () => {
  const mailbox = `party-${Date.now()}@example.test`, safe = personalSafeAddress(config, mailbox);
  const now = 978307200456, advanced = now + 73_000;
  const before = (await db.worker.query("select count(*) from app.party_events")).rows[0].count;
  await assert.rejects(db.transaction("", async (sql) => {
    await resolveRecipient(sql, { _tag: "mailbox", mailbox }, config, now); throw new Error("abort-resolve");
  }, true), /abort-resolve/);
  assert.equal((await db.worker.query("select count(*) from app.parties where safe_address=$1", [safe])).rows[0].count, "0");
  assert.equal((await db.worker.query("select count(*) from app.party_events")).rows[0].count, before);
  const outside = await db.transaction("", (sql) => resolveRecipient(sql, { _tag: "address", address: safe }, config, now), true);
  assert(outside.resolved); assert.equal(outside.state, "outside");
  const beforeAdoption = (await db.worker.query("select count(*) from app.party_events")).rows[0].count;
  await assert.rejects(db.transaction("", async (sql) => {
    await resolveRecipient(sql, { _tag: "mailbox", mailbox }, config, advanced); throw new Error("abort-adoption");
  }, true), /abort-adoption/);
  const unchanged = (await lookup(db.worker, outside.party_id))!;
  assert.equal(unchanged.state, "outside"); assert.equal(Number(unchanged.updated_at), now);
  assert.equal((await db.worker.query("select count(*) from app.party_events")).rows[0].count, beforeAdoption);
  const person = await db.transaction("", (sql) => resolveRecipient(sql, { _tag: "mailbox", mailbox: ` ${mailbox.toUpperCase()} ` }, config, advanced), true);
  assert(person.resolved); assert.equal(person.party_id, outside.party_id); assert.equal(person.state, "provisional"); assert(person.named);
  const again = await db.transaction("", (sql) => resolveRecipient(sql, { _tag: "mailbox", mailbox }, config, advanced + 1), true);
  assert(again.resolved); assert.equal(again.named, false);
  const named = await db.transaction("", (sql) => resolveRecipient(sql, { _tag: "mailbox", mailbox: `another-${mailbox}` }, config, now), true);
  assert(named.resolved); assert.equal(named.state, "provisional");
  const asymmetric = await db.transaction("", (sql) => resolveRecipient(sql,
    { _tag: "mailbox", mailbox: `  A+B.O'C-${Date.now()}@Sub-Domain.Example.Test  ` }, config, now), true);
  assert(asymmetric.resolved); assert.equal(asymmetric.state, "provisional"); assert.equal(asymmetric.named, true);
  const counts = async () => (await db.worker.query("select (select count(*) from app.parties) as parties,(select count(*) from app.party_events) as events")).rows[0];
  const beforeMalformed = await counts();
  for (const [locator, reason] of [
    [{ _tag: "mailbox", mailbox: "bad" }, "malformed"], [{ _tag: "address", address: address(0) }, "zero-address"],
    [{ _tag: "mailbox", mailbox: "alice@example.com@evil.test" }, "malformed"],
    [{ _tag: "mailbox", mailbox: "alice@example.com/evil.test" }, "malformed"],
    [{ _tag: "mailbox", mailbox: ".alice@example.test" }, "malformed"],
    [{ _tag: "mailbox", mailbox: "alice@-example.test" }, "malformed"],
    [{ _tag: "address", address: "not-address" }, "malformed"], [{ _tag: "handle", handle: "unregistered" }, "unknown-handle"],
    [{ _tag: "party", party_id: "unknown" }, "unknown-party"],
  ] as const) assert.deepEqual(await db.transaction("", (sql) => resolveRecipient(sql, locator, config, now), true), { resolved: false, reason });
  assert.deepEqual(await counts(), beforeMalformed, "refused locators must not insert a Party or transition event");
  const persisted = (await lookup(db.worker, person.party_id))!;
  assert.equal(Number(persisted.created_at), now); assert.equal(Number(persisted.updated_at), advanced);
  const history = (await db.worker.query("select data,at from app.party_events where party_id=$1 order by id", [person.party_id])).rows;
  assert.deepEqual(history.map((r) => Number(r.at)), [now, advanced]);
  const events = history.map((r) => r.data);
  assert.deepEqual(events.map((e) => [e.from, e.to, e.transition]), [[null, "outside", "name_address"], ["outside", "provisional", "adopt_mailbox"]]);
  for (const event of events) for (const privateKey of ["handle", "mailbox", "display_name", "safe_address"]) assert(!(privateKey in event));
});

test("global reads do not grant tenant writers; event history is append-only", async () => {
  const indexes = (await db.worker.query("select indexname,indexdef from pg_indexes where schemaname='app' and tablename='parties'")).rows;
  for (const name of ["parties-by-handle", "parties-by-safe", "parties-by-mailbox", "parties-by-owner"]) assert(indexes.some((i) => i.indexname === name));
  for (const query of ["update app.parties set display_name='unauthorized'", "delete from app.parties", "insert into app.party_events(party_id,data,at) values ('bad','{}',0)"]) {
    await assert.rejects(db.transaction("unrelated-org", (sql) => sql.query(query)), /permission denied/);
  }
  await assert.rejects(db.worker.query("delete from app.party_events"), /permission denied/);
  await assert.rejects(db.worker.query("update app.party_events set at=0"), /permission denied/);
  assert((await db.transaction("unrelated-org", (sql) => sql.query("select party_id from app.parties"))).rowCount! > 0);
});
