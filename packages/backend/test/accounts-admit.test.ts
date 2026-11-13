import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db, now, run } from "./access-fixture.ts";
import { admitWave, readAdmission } from "../src/accounts/door.ts";

// Component regression for accounts.admission.admit; the operator-key mount is composition-owned.
test("operator wave admits atomically, reports already/invalid and moves the referral, without reopening parked births", async () => {
  const waiting = `wave-waiting-${run}@example.test`, unlisted = `wave-unlisted-${run}@example.test`, trace = randomUUID();
  // Storage fixtures stand in for the parked join/attribute births; they are not driver proof.
  await db.worker.query(`insert into app.admissions(email,status,note,joined_via,requested_at,updated_at)
    values($1,'waiting',null,'waitlist',5,5)`, [waiting]);
  await db.worker.query("insert into app.referrals(referrer_email,referee_email,via,stage,attributed_at) values($1,$2,'link','attributed',3)", [`ref-${run}@example.test`, waiting]);
  await assert.rejects(db.transaction("", (sql) => admitWave(sql, { emails: Array(201).fill(unlisted), by: "ops" }, trace, now), true), /INVALID_INPUT: emails/);
  await assert.rejects(db.transaction("", (sql) => admitWave(sql, { emails: [unlisted], by: " " }, trace, now), true), /INVALID_INPUT: by/);
  await assert.rejects(db.transaction("", async (sql) => {
    await admitWave(sql, { emails: [waiting, unlisted], by: "ops" }, trace, now);
    throw new Error("wave transaction failed");
  }, true), /wave transaction failed/);
  assert.equal((await db.transaction("", (sql) => readAdmission(sql, waiting), true))!.status, "waiting");
  assert.equal(await db.transaction("", (sql) => readAdmission(sql, unlisted), true), null);
  assert.equal((await db.worker.query("select 1 from app.transition_outbox where event->>'trace_id'=$1", [trace])).rowCount, 0);
  const result = await db.transaction("", (sql) => admitWave(sql, { emails: [` ${unlisted.toUpperCase()} `, waiting, "not-mail", unlisted], by: " ops-aaron " }, trace, now + 1), true);
  assert.deepEqual(result, { admitted: [unlisted, waiting].sort(), already: [], invalid: ["not-mail"] });
  const rows = await Promise.all([waiting, unlisted].map((m) => db.transaction("", (sql) => readAdmission(sql, m), true)));
  assert.deepEqual(rows.map((r) => [r!.status, r!.joined_via, r!.admitted_by, r!.requested_at]),
    [["admitted", "waitlist", "operator:ops-aaron", 5], ["admitted", "operator", "operator:ops-aaron", null]]);
  const events = (await db.worker.query("select event from app.transition_outbox where event->>'trace_id'=$1 order by seq", [trace])).rows.map((r) => r.event);
  assert.deepEqual(events.map((e) => [e.name, e.props.transition, e.props.via]).sort(), [
    ["referral_transitioned", "admit", "link"], ["waitlist_entry_transitioned", "admit", "operator"], ["waitlist_entry_transitioned", "admit_unlisted", "operator"]].sort());
  assert.equal((await db.worker.query("select stage from app.referrals where referee_email=$1", [waiting])).rows[0].stage, "admitted");
  assert.deepEqual(await db.transaction("", (sql) => admitWave(sql, { emails: [waiting], by: "again" }, randomUUID(), now + 2), true),
    { admitted: [], already: [waiting], invalid: [] });
  assert.equal((await db.transaction("", (sql) => readAdmission(sql, waiting), true))!.admitted_by, "operator:ops-aaron");
});
