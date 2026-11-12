import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cloneDatabase, psqlAdmin } from "./door.ts";
import { migrateCatalogue, worldCatalogue, type Command, type WorldRow } from "./catalogue.ts";

const maintenance = process.env.WORLD_SNAPSHOT_PG;
test("native catalogue preserves command history, atomic mutations and restricted ownership", { skip: !maintenance }, async () => {
  const database = `test_catalogue_${randomUUID().replaceAll("-", "")}`;
  const maintenanceQuery = psqlAdmin(maintenance!);
  const url = new URL(maintenance!); url.pathname = `/${database}`;
  const admin = psqlAdmin(url.href);
  const ownedRoles: string[] = [];
  const query = (sql: string) => admin(`SET ROLE capxul_worker; ${sql}`);
  const known = 'a shared "secret" with a quote';
  const store = worldCatalogue(query, [known]);
  const now = Date.parse("2026-03-02T09:00:00Z");
  const copies = [`${database}_cut`, `${database}_clone`, `${database}_old`];
  const world: WorldRow = { world_id: "town1", name: "Harbour Line", kind: "simulated", profile: "full", address: "http://core-town1.localhost",
    template: null, chain_id: 84532, chain_instance: "anvil-town1", clock_mode: "frozen", rate: 4, world_now: now, epoch: 1,
    parent_world: null, parent_snapshot: null, parent_seq: null, hosted: false, state: "creating", created_at: now, updated_at: now };
  const command: Command = { trace: randomUUID(), command: "world create", args: { positional: ["town1"] }, worldTime: now, outcome: "ok", surface: "cli" };
  try {
    for (const role of ["capxul_core", "capxul_worker"]) {
      const found = await maintenanceQuery(`SELECT row_to_json(r) FROM (SELECT rolname FROM pg_roles WHERE rolname='${role}') r`);
      if (!found.length) { await maintenanceQuery(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`); ownedRoles.push(role); }
    }
    await maintenanceQuery(`CREATE DATABASE "${database}"`);
    await admin("CREATE SCHEMA app; GRANT USAGE ON SCHEMA app TO capxul_core,capxul_worker");
    await migrateCatalogue(admin);
    const first = await store.create(world, command);
    assert.equal(first.kind, "born"); assert.equal(first.seq, 1); assert.equal(first.prev, "0".repeat(64));
    assert.deepEqual(JSON.parse(first.changes as string).events, [{ event: "world_transitioned", trace_id: command.trace, from: null, to: "creating", transition: "create", world_id: "town1", kind: "simulated", epoch: 1 }]);
    assert.deepEqual(await store.show("town1"), world);
    const started = await store.transition("town1", "start", { ...command, command: "world start" });
    assert.deepEqual(JSON.parse(started.changes as string).events, [{ event: "world_transitioned", trace_id: command.trace, from: "creating", to: "running", transition: "start", world_id: "town1", kind: "simulated", epoch: 1 }]);
    await assert.rejects(store.transition("town1", "start", command), "replaying an invalid transition must not append");
    assert.equal((await store.records("town1")).length, 2);
    assert.equal((await store.show("town1")).state, "running");
    await assert.rejects(store.create(world, command));
    await assert.rejects(store.append("absent", command));
    assert.equal((await store.records("town1")).length, 2);

    const tx = `0x${"1a".repeat(32)}`;
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.append("town1", { ...command, trace: `trace-${i}`, command: "payment send",
      worldTime: now + i * 1000, actor: { email: i % 2 ? "agent@harbourline.test" : "hannah@harbourline.test", address: "0x1234", hats: [`hat-${i % 2}`], kind: i % 2 ? "agent" : "person" },
      args: { password: "do-not-store", arbitrary: known, nested: '{"private_key":"0xsecret"}' }, result: { tx, note: known },
      outcome: i === 4 ? "refused" : "ok", ...(i === 4 ? { error: { code: "ROLE_PERMISSION_DENIED", reason: "holder lacks hat", detail: { token: "opaque-bearer" } } } : {}) })));
    const entries = await store.records("town1");
    assert.deepEqual(entries.map((r) => r.seq), Array.from({ length: 14 }, (_, i) => i + 1));
    const [chain] = await admin(`SELECT row_to_json(t) FROM (SELECT count(*)::int AS broken FROM
      (SELECT seq,prev,lag(encode(sha256(convert_to((to_jsonb(r)-'branch_abandoned')::text,'UTF8')),'hex')) OVER (ORDER BY seq) AS expected
      FROM app.command_records r WHERE world_id='town1' AND epoch=1) c WHERE prev<>coalesce(expected,repeat('0',64))) t`);
    assert.equal(chain!.broken, 0, "concurrent appends link to the preceding committed row");
    const hannah = await store.records("town1", { who: "hannah@harbourline.test", from: now + 3000, to: now + 8500 });
    assert.deepEqual(hannah.map((r) => r.trace_id).sort(), ["trace-4", "trace-6", "trace-8"]);
    const refused = (await store.records("town1", { trace: "trace-4" }))[0]!;
    assert.equal(refused.outcome, "refused"); assert.equal(refused.error_code, "ROLE_PERMISSION_DENIED");
    assert.deepEqual(await store.record("town1", 1, refused.seq as number), refused);
    assert.equal(JSON.parse(refused.result as string).tx, tx, "public transaction evidence must survive redaction");
    assert.equal(JSON.parse(refused.result as string).note, "[REDACTED]");
    assert.equal(JSON.parse(refused.args as string).arbitrary, "[REDACTED]");
    assert.equal(refused.error_reason, "holder lacks hat");
    for (const hidden of [known, "do-not-store", "0xsecret", "opaque-bearer"]) assert(!JSON.stringify(entries).includes(hidden), "credential material reached the record");
    await assert.rejects(store.records("town1", { limit: -1 }));
    await assert.rejects(store.records("town1", { epoch: 0 }));
    await assert.rejects(store.show("town1' OR true--"));

    const snapshot = { world_id: "town1", name: "march", epoch: 1, record_seq: 14, chain_state_ref: "/private/march/state",
      site_backups: [{ org_id: "harbourline", backup_ref: "/private/march/sites/harbourline" }], clock_mode: "frozen" as const, rate: 4,
      world_now: now, code_version: "build-1", template: false, created_at: now };
    await store.save(snapshot, { ...command, command: "world snapshot save" });
    await store.save({ ...snapshot, name: "april", created_at: now + 1000 }, { ...command, command: "world snapshot save" });
    assert.deepEqual((await store.snapshots("town1")).map((r) => r.name), ["april", "march"]);
    await assert.rejects(store.save(snapshot, command));
    assert.equal((await store.records("town1")).length, 16, "refused snapshot insert must roll back its command append");
    await assert.rejects(store.save({ ...snapshot, name: "bad", rate: 0 }, command));
    assert.equal((await store.snapshots("town1")).length, 2);

    for (const sql of ["UPDATE app.command_records SET command='tampered'", "DELETE FROM app.command_records", "DELETE FROM app.worlds"])
      await assert.rejects(query(sql));
    for (const sql of ["INSERT INTO app.worlds SELECT * FROM app.worlds", "UPDATE app.worlds SET name='changed'", "UPDATE app.world_snapshots SET name='changed'", "UPDATE app.command_records SET branch_abandoned=true"])
      await assert.rejects(admin(`SET ROLE capxul_core; ${sql}`));
    await query("UPDATE app.command_records SET branch_abandoned=true WHERE trace_id='trace-4'");
    assert.equal((await store.records("town1")).length, 15);
    assert.equal((await store.records("town1", { includeAbandoned: true })).length, 16);
    const exported = await store.export("town1");
    const lines = exported.data.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines[0], { parentWorld: null, parentSnapshot: null, parentSeq: null });
    assert.equal(exported.lines, 17); assert.equal(exported.bytes, Buffer.byteLength(exported.data));
    assert.deepEqual(lines.slice(1), await store.records("town1", { includeAbandoned: true }));

    const projection = await admin(`SELECT to_jsonb(c) FROM information_schema.columns c WHERE table_schema='app' ORDER BY table_name,ordinal_position`);
    const expected = {
      worlds: "world_id name kind profile address template chain_id chain_instance clock_mode rate world_now epoch parent_world parent_snapshot parent_seq hosted state created_at updated_at",
      world_snapshots: "world_id name epoch record_seq chain_state_ref site_backups clock_mode rate world_now code_version template created_at",
      command_records: "world_id epoch seq prev v id trace_id kind command args actor_email actor_address actor_hats who_kind org_id site world_time world_time_end real_time duration_ms outcome error_code error_reason error_detail result changes run_id model policy_version surface cause_seq branch_abandoned",
    };
    for (const [table, columns] of Object.entries(expected)) assert.deepEqual(projection.filter((r) => r.table_name === table).map((r) => r.column_name), columns.split(" "));

    const cut = await store.cut("town1");
    assert.equal(cut.epoch, 1); assert.equal(cut.seq, 16); assert.match(cut.head, /^[a-f0-9]{64}$/);
    await cloneDatabase(maintenanceQuery, database, copies[0]!);
    await store.append("town1", { ...command, command: "after snapshot", result: { abandoned: true } });
    await store.save({ ...snapshot, name: "may", created_at: now + 2000 }, { ...command, command: "world snapshot save" });
    const abandoned = await store.history("town1");
    await cloneDatabase(maintenanceQuery, copies[0]!, copies[1]!);
    await maintenanceQuery(`ALTER DATABASE "${copies[1]}" ALLOW_CONNECTIONS true`);
    const cloneUrl = new URL(url); cloneUrl.pathname = `/${copies[1]}`;
    const cloneAdmin = psqlAdmin(cloneUrl.href);
    const clone = worldCatalogue((sql) => cloneAdmin(`SET ROLE capxul_worker; ${sql}`), [known]);
    const target = { ...world, world_id: "town3", name: "Harbour clone", chain_instance: "anvil-town3", parent_world: "town1", parent_snapshot: "march", parent_seq: cut.seq };
    const saved = { sourceWorld: "town1", snapshot: "march", cut };
    await assert.rejects(clone.rewrite(target, { ...saved, cut: { ...cut, seq: cut.seq - 1 } }, command));
    await assert.rejects(clone.rewrite(target, { ...saved, cut: { ...cut, head: "0".repeat(64) } }, command));
    await clone.rewrite(target, saved, { ...command, command: "world snapshot restore" });
    assert.equal((await clone.show("town3")).state, "creating");
    const birth = (await clone.records("town3"))[0]!;
    assert.equal(birth.kind, "born");
    assert.deepEqual(JSON.parse(birth.changes as string).lineage, { snapshot: "march", fromWorld: "town1", ...cut, head: `0x${cut.head}` });
    await clone.transition("town3", "start", { ...command, kind: "event", command: null });
    assert.equal((await clone.show("town3")).state, "running");
    assert.deepEqual((await clone.export("town3")).lineage, { parentWorld: "town1", parentSnapshot: "march", parentSeq: 16 });
    assert.equal((await store.cut("town1")).seq, 18, "clone mutation changed the source");

    await maintenanceQuery(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false; ALTER DATABASE "${database}" RENAME TO "${copies[2]}"`);
    await cloneDatabase(maintenanceQuery, copies[0]!, database);
    await maintenanceQuery(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
    await assert.rejects(store.rewrite({ ...world, epoch: 2 }, { ...saved, abandoned: { ...abandoned, records: abandoned.records.map((r) => r.seq === 1 ? { ...r, command: "forged prefix" } : r) } }, command));
    await assert.rejects(store.rewrite({ ...world, epoch: 2 }, { ...saved, abandoned: { ...abandoned, records: abandoned.records.filter((r) => r.seq !== 17) } }, command));
    await assert.rejects(store.rewrite({ ...world, epoch: 2 }, { ...saved, abandoned: { ...abandoned, records: abandoned.records.map((r) => r.seq === 17 ? { ...r, prev: "0".repeat(64) } : r) } }, command));
    await assert.rejects(store.rewrite({ ...world, epoch: 2 }, { ...saved, abandoned: { ...abandoned, snapshots: abandoned.snapshots.map((s) => ({ ...s, code_version: "forged" })) } }, command));
    assert.equal((await store.show("town1")).epoch, 1, "refused import partially rewrote the saved world");
    const restored = await store.rewrite({ ...world, epoch: 2 }, { ...saved, abandoned }, { ...command, command: "world snapshot restore" });
    assert.equal(restored.kind, "restore");
    assert.deepEqual(JSON.parse(restored.changes as string).events, [{ event: "world_transitioned", trace_id: command.trace, from: "running", to: "restoring", transition: "restore", world_id: "town1", kind: "simulated", epoch: 2 }]);
    const resumed = await store.transition("town1", "restored", { ...command, command: "world restored" });
    assert.deepEqual(JSON.parse(resumed.changes as string).events, [{ event: "world_transitioned", trace_id: command.trace, from: "restoring", to: "running", transition: "restored", world_id: "town1", kind: "simulated", epoch: 2 }]);
    assert.equal((await store.show("town1")).epoch, 2);
    assert.equal((await store.show("town1")).state, "running");
    const history = await store.records("town1", { includeAbandoned: true });
    assert.equal(history.length, 20);
    assert.deepEqual((await store.snapshots("town1")).map((s) => s.name), ["may", "april", "march"], "in-place restore must not hide retained snapshot bundles");
    assert.equal(history.find((r) => r.command === "after snapshot")!.branch_abandoned, true);
    assert.deepEqual(history.filter((r) => r.epoch === 2).map((r) => r.seq), [1, 2]);
    assert(!(await store.records("town1")).some((r) => r.command === "after snapshot"));
    const largeArgs = { text: "☃".repeat(60000) }, largeResult = { text: "☃".repeat(11000) };
    const large = await store.append("town1", { ...command, args: largeArgs, result: largeResult });
    assert.deepEqual(JSON.parse(large.args as string), largeArgs, "large SQL input must not depend on the host's argv limit");
    const summary = JSON.parse(large.result as string);
    assert.equal(summary.truncated, true); assert.equal(summary.bytes, Buffer.byteLength(JSON.stringify(largeResult)));
    assert(summary.head.length <= 2000);
  } finally {
    await maintenanceQuery(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    for (const copy of copies) await maintenanceQuery(`DROP DATABASE IF EXISTS "${copy}" WITH (FORCE)`);
    for (const role of ownedRoles) await maintenanceQuery(`DROP ROLE "${role}"`);
  }
});
