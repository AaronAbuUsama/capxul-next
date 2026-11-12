import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Database, type Sql } from "../src/platform/db.ts";
import { emit } from "../src/platform/outbox.ts";
import { worldNow } from "../src/devnet/door.ts";
import { personalSafeAddress } from "../src/platform/safe.ts";
import { getProfile, lookup, requireProfile, resolveRecipient, routeProfiles, saveProfile } from "../src/parties/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("named disposable migrated Postgres required");
// Published source dependencies stay isolated until the integrator composes them into the wave.
const access = await import(new URL(process.env.CAPXUL_ACCESS_MODULE ?? "../src/access/door.ts", import.meta.url).href);
const media = await import(new URL(process.env.CAPXUL_MEDIA_MODULE ?? "../src/media/door.ts", import.meta.url).href);
assert.equal(typeof media.requireImage, "function", "published Media ownership admission is required, not anonymous image serving");
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
const config = { companiesHouse: "0x1234567890123456789012345678901234567890" as const, namespace: "profiles-native" };
const services = { personalSafe: config, requireImage: media.requireImage };
const instant = 946684800321, suffix = randomBytes(6).toString("hex");
const people = ["fresh", "provisional", "outside", "rollback", "other", "invalid", "concurrent", "agent"].map(name => {
  const email = `${name}-${suffix}@example.test`;
  return { id: `principal-${name}-${suffix}`, email, safe: personalSafeAddress(config, email),
    token: randomBytes(32).toString("base64url"), agent: name === "agent" };
});
const fresh = people[0]!, provisional = people[1]!, outside = people[2]!, rollback = people[3]!;
const other = people[4]!, invalid = people[5]!, concurrent = people[6]!, agent = people[7]!;
const input = { display_name: "  Directory person  ", country: "gb" };
const as = <T>(person: typeof fresh, run: (sql: Sql, now: number) => Promise<T>, worker = true) => db.transaction("", async sql => {
  const now = await worldNow(sql);
  await access.authenticate(sql, person.token, now);
  return run(sql, now);
}, worker);
const events = async (partyId: string) => (await db.worker.query("select data,at from app.party_events where party_id=$1 order by id", [partyId])).rows;
const snapshot = async (person: typeof fresh) => ({
  parties: (await db.worker.query("select * from app.parties where safe_address=$1", [person.safe])).rows,
  profiles: (await db.worker.query("select * from app.profiles where person_id=$1", [person.id])).rows,
});
let ownImage: string, otherImage: string, privateImage: string;
test.before(async () => {
  await db.worker.query("update app.world set clock=$1", [{ nowMs: instant, clockMode: "stopped", rate: 1 }]);
  for (const pool of [db.tenant, db.worker]) {
    assert.deepEqual((await pool.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0],
      { rolsuper: false, rolbypassrls: false });
  }
  await db.transaction("", async sql => {
    for (const p of people) {
      await sql.query(`insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at)
        values($1,$2,$3,$4,$5,$6)`, [p.id, p.agent ? "agent" : "person", p.agent ? null : p.email, p.safe,
        p.agent ? `0x${randomBytes(20).toString("hex")}` : null, new Date(instant)]);
      await sql.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
        values($1,$1,$2,'code','active','profiles-native',$3,$4)`,
      [p.id, access.digest(p.token), new Date(instant), new Date(instant + 3600000)]);
    }
  }, true);
  // Real Media upload admission and transactional outbox, not fabricated file metadata or permission callbacks.
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
  async function upload(person: typeof fresh, purpose: "image" | "document") {
    return as(person, async sql => media.upload(sql, { purpose, content_type: "image/png", bytes }, {
      now: worldNow,
      transitioned: async (tx: Sql, props: Record<string, unknown>, at: number) => {
        await emit(tx, { id: `profile-file-${props.file_id}`, name: "file_transitioned", machine: "file", entity_id: String(props.file_id),
          owner_kind: "person", owner_id: person.id, actor: person.id, trace_id: suffix, at, props });
      },
    }), false);
  }
  ownImage = (await upload(fresh, "image")).file_id;
  otherImage = (await upload(other, "image")).file_id;
  privateImage = (await upload(fresh, "document")).file_id;
});
test.after(() => db.close());

test("only an authenticated person can read, write or require their profile", async () => {
  for (const worker of [false, true]) await db.ownerTransaction({ kind: "person", id: fresh.id }, async sql => {
    await assert.rejects(getProfile(sql), /NOT_AUTHENTICATED/);
    await assert.rejects(requireProfile(sql), /NOT_AUTHENTICATED/);
    await assert.rejects(saveProfile(sql, input, services, instant), /NOT_AUTHENTICATED/);
  }, worker);
  await as(agent, async sql => {
    await assert.rejects(getProfile(sql), /NOT_AUTHENTICATED/);
    await assert.rejects(saveProfile(sql, input, services, instant), /NOT_AUTHENTICATED/);
  });
  await as(fresh, async sql => {
    assert.equal(await getProfile(sql), null);
    await assert.rejects(requireProfile(sql), /PROFILE_NOT_FOUND/);
  });
});

test("onboarding uses the frozen world instant and exact repeats preserve identity, timestamps and one event", async () => {
  const saved = await as(fresh, (sql, now) => saveProfile(sql, { ...input, photo_file_id: ownImage }, services, now));
  assert.notEqual(saved.party_id, fresh.id);
  assert.deepEqual(saved, { party_id: saved.party_id, display_name: "Directory person", photo_file_id: ownImage,
    country: "GB", safe_address: fresh.safe, created_at: instant, updated_at: instant });
  assert.notEqual(saved.created_at, Date.now());
  const row = (await db.worker.query("select * from app.parties where party_id=$1", [saved.party_id])).rows[0];
  assert.equal(row.owner_kind, "person"); assert.equal(row.owner_id, fresh.id);
  assert.equal(Number(row.created_at), instant); assert.equal(Number(row.updated_at), instant);
  assert.deepEqual(await events(saved.party_id), [{ at: String(instant), data: { from: null, to: "active", transition: "onboard",
    party_id: saved.party_id, kind: "person", owner_kind: "person", owner_id: fresh.id } }]);
  assert.deepEqual(await as(fresh, (sql, now) => saveProfile(sql, { ...input, photo_file_id: ownImage }, services, now)), saved);
  assert.deepEqual(await as(fresh, sql => requireProfile(sql), false), saved);
  assert.equal((await events(saved.party_id)).length, 1);
});

test("provisional mailbox and outside Safe claims preserve the original canonical Party and its creation time", async () => {
  for (const p of [provisional, outside]) {
    const named = await db.transaction("", sql => resolveRecipient(sql, p === provisional ? { _tag: "mailbox", mailbox: p.email }
      : { _tag: "address", address: p.safe }, config, instant - 5000), true);
    assert(named.resolved);
    const saved = await as(p, (sql, now) => saveProfile(sql, input, services, now));
    assert.equal(saved.party_id, named.party_id);
    const row = (await lookup(db.worker, saved.party_id))!;
    assert.equal(Number(row.created_at), instant - 5000); assert.equal(Number(row.updated_at), instant);
    assert.equal(row.kind, "person"); assert.equal(row.owner_id, p.id);
    const log = await events(row.party_id);
    assert.equal(log.length, 2); assert.equal(log[1]!.data.transition, "claim");
    assert.equal(log[1]!.data.from, p === provisional ? "provisional" : "outside");
    assert.equal(Number(log[1]!.at), instant);
  }
});

test("all validation and Media uploader/purpose checks precede profile and Party writes", async () => {
  const before = await snapshot(invalid);
  for (const bad of [{ ...input, display_name: " " }, { ...input, display_name: "x".repeat(81) },
    ...["ZZ", "EU", "UN", "XK", "UK", "USA"].map(country => ({ ...input, country })),
    ...[otherImage, privateImage, "missing-file", ""].map(photo_file_id => ({ ...input, photo_file_id }))]) {
    await assert.rejects(as(invalid, (sql, now) => saveProfile(sql, bad, services, now)), /INVALID_INPUT/);
    assert.deepEqual(await snapshot(invalid), before);
  }
  // A person's own private file is still not a public profile image.
  const original = await snapshot(fresh);
  await assert.rejects(as(fresh, (sql, now) => saveProfile(sql, { ...input, photo_file_id: privateImage }, services, now)), /INVALID_INPUT/);
  assert.deepEqual(await snapshot(fresh), original);
  await assert.rejects(as(invalid, (sql, now) => saveProfile(sql, input,
    { ...services, personalSafe: { ...config, namespace: "wrong-namespace" } }, now)), /INVALID_INPUT/);
  assert.deepEqual(await snapshot(invalid), before);
  assert.equal((await as(invalid, (sql, now) => saveProfile(sql, { display_name: "x".repeat(80), country: "BQ" }, services, now))).display_name.length, 80);
});

test("updates preserve an omitted photo, null clears it, and explicit clock advance never emits another state transition", async () => {
  await db.worker.query("update app.world set clock=$1", [{ nowMs: instant + 45000, clockMode: "stopped", rate: 1 }]);
  const saved = await as(fresh, (sql, now) => saveProfile(sql, { display_name: "Changed", country: "AQ" }, services, now));
  assert.equal(saved.photo_file_id, ownImage); assert.equal(saved.created_at, instant); assert.equal(saved.updated_at, instant + 45000);
  const cleared = await as(fresh, (sql, now) => saveProfile(sql, { display_name: "Changed", country: "AQ", photo_file_id: null }, services, now));
  assert.equal(cleared.photo_file_id, null);
  await db.worker.query("update app.world set clock=$1", [{ nowMs: instant + 90000, clockMode: "stopped", rate: 1 }]);
  assert.deepEqual(await as(fresh, (sql, now) => saveProfile(sql, { display_name: "Changed", country: "AQ", photo_file_id: null }, services, now)), cleared);
  assert.equal((await events(saved.party_id)).length, 1);
});

test("rollback removes the claim, private profile and event together; concurrent retries create one identity", async () => {
  const named = await db.transaction("", sql => resolveRecipient(sql, { _tag: "address", address: rollback.safe }, config, instant), true);
  assert(named.resolved);
  const before = await snapshot(rollback), beforeEvents = await events(named.party_id);
  await assert.rejects(as(rollback, async (sql, now) => {
    await saveProfile(sql, input, services, now);
    assert.equal((await requireProfile(sql)).party_id, named.party_id);
    throw new Error("abort-profile");
  }), /abort-profile/);
  assert.deepEqual(await snapshot(rollback), before); assert.deepEqual(await events(named.party_id), beforeEvents);
  const results = await Promise.all([0, 1, 2].map(() => as(concurrent, (sql, now) => saveProfile(sql, input, services, now))));
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
  assert.equal((await events(results[0]!.party_id)).length, 1);
});

test("tenant profile reads stay private and route input cannot supply another identity or world instant", async () => {
  await as(other, (sql, now) => saveProfile(sql, { display_name: "Other", country: "US" }, services, now));
  await as(fresh, async sql => {
    assert.deepEqual((await sql.query("select person_id from app.profiles")).rows, [{ person_id: fresh.id }]);
  }, false);
  await assert.rejects(as(fresh, sql => sql.query("update app.profiles set country='US' where person_id=$1", [fresh.id]), false), /permission denied/);
  await as(fresh, async (sql, now) => {
    const result = await routeProfiles(sql, "/parties/profiles/get", { person_id: other.id, safe: other.safe, now: 1 }, services, now);
    assert.equal(result!.body!.safe_address, fresh.safe);
    assert.equal(await routeProfiles(sql, "/unowned", {}, services, now), null);
    const saved = await routeProfiles(sql, "/parties/profiles/save", { ...input, person_id: other.id, now: 1 }, services, now);
    assert.equal(saved!.body!.safe_address, fresh.safe); assert.equal(saved!.body!.updated_at, now);
  });
});
