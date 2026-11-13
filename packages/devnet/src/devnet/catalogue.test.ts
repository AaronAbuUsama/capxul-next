import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cloneDatabase, psqlAdmin, migrateMailSink, devnetMail } from "./door.ts";
import { migrateCatalogue, worldCatalogue, type Command, type WorldRow } from "./catalogue.ts";
import { writeConfig, type Config } from "./supervisor.ts";

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
  const directory = await mkdtemp(join(tmpdir(), "catalogue-cli-"));
  try {
    for (const role of ["capxul_core", "capxul_worker"]) {
      const found = await maintenanceQuery(`SELECT row_to_json(r) FROM (SELECT rolname FROM pg_roles WHERE rolname='${role}') r`);
      if (!found.length) { await maintenanceQuery(`CREATE ROLE ${role} ${role === "capxul_core" ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`); ownedRoles.push(role); }
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
    const afterStart = await store.show("town1");
    assert.deepEqual([afterStart.state, afterStart.updated_at], ["running", now], "updated_at is the transition's world time, not the host clock");
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

    // Native CLI control: only this disposable database is live, and the mutation lock is already held.
    const restricted = (role: string) => { const u = new URL(maintenance!); u.username = role; u.password = "unused-trust-fixture"; return u.href; };
    const configFile = join(directory, "world.json");
    const config: Config = { version: 1, root: directory, controlDir: join(directory, "control"), snapshots: join(directory, "snapshots"), codeVersion: "no-running-build",
      world: { id: "town1", kind: "local", database, stateDir: join(directory, "state"), sites: [], epoch: 1 },
      database: { admin: maintenance!, tenant: restricted("capxul_core"), worker: restricted("capxul_worker"), ponder: restricted("capxul_ponder") },
      ports: { anvil: 20100, ponder: 20101, core: 20102, siteService: 20103, bench: 20104, socket: 20105, publicCore: 20106, publicRpc: 20107, publicBench: 20108, publicBundler: 20109 },
      secret: "private-core-secret", siteToken: "private-site-token", finality: 0, chainId: 84532,
      bench: { composeArgs: [], env: {}, dbPassword: "private-db-secret", adminPassword: "private-admin-secret", baseDomain: "localhost" } };
    await writeConfig(configFile, config);
    await mkdir(join(config.controlDir, ".operation"), { recursive: true });
    const cli = (args: string[], status = 0) => {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("../../../cli/src/main.ts", import.meta.url)), ...args, "--config", configFile, "--json"], { encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, status, result.stderr);
      return JSON.parse(status === 0 ? result.stdout : result.stderr);
    };
    const view = cli(["record", "list", "--world", "town1", "--who", "hannah@harbourline.test", "--from", String(now + 6000), "--to", String(now + 8000)]);
    assert.deepEqual(view.entries.map((e: any) => e.traceId).sort(), ["trace-6", "trace-8"], "abandoned rows are opt-in and time endpoints are inclusive");
    assert.deepEqual(cli(["record", "list", "--trace", "trace-4", "--limit", "1", "--include-abandoned"]).entries.map((e: any) => e.traceId), ["trace-4"]);
    const shown = cli(["record", "show", "--seq", String(refused.seq)]);
    assert.deepEqual(shown.entry, { worldId: "town1", epoch: 1, seq: refused.seq, kind: "command", worldTime: now + 4000,
      realTime: Date.parse(String(refused.real_time)), who: "hannah@harbourline.test", hats: ["hat-0"], surface: "cli", traceId: "trace-4",
      command: "payment send", outcome: "refused", code: "ROLE_PERMISSION_DENIED", causeSeq: null, branchAbandoned: true });
    assert.deepEqual(Object.keys(shown).sort(), ["args", "changed", "entry", "pointers", "returned"]);
    assert.equal(JSON.parse(shown.args).arbitrary, "[REDACTED]");
    assert.equal(JSON.parse(shown.returned).tx, tx);
    const snapshots = cli(["world", "snapshot", "list", "town1"]);
    assert.deepEqual(snapshots.snapshots, [
      { name: "april", worldId: "town1", epoch: 1, recordSeq: 14, clockMode: "frozen", rate: 4, worldNow: now, template: false, createdAt: now + 1000, sites: 1 },
      { name: "march", worldId: "town1", epoch: 1, recordSeq: 14, clockMode: "frozen", rate: 4, worldNow: now, template: false, createdAt: now, sites: 1 },
    ]);
    const out = join(directory, "record.jsonl"), exportedCli = cli(["record", "export", "--out", out]);
    assert.deepEqual(exportedCli, { lines: 17, bytes: Buffer.byteLength(exported.data), lineage: lines[0] });
    assert.equal(await readFile(out, "utf8"), exported.data); assert.equal((await stat(out)).mode & 0o077, 0);
    cli(["record", "export", "--out", out], 1); assert.equal(await readFile(out, "utf8"), exported.data, "existing export must not be overwritten");
    for (const args of [["record", "list", "--world", "town3"], ["record", "list", "--limit", "0"], ["record", "list", "--limit", "10001"],
      ["record", "list", "--from", "2", "--to", "1"], ["record", "show", "--seq", "1.5"]]) assert.equal(cli(args, 2).error.code, "INVALID_INPUT");
    for (const args of [["record", "list", "--all"], ["record", "list", "--who"], ["record", "list", "--limit", "1", "--limit", "2"], ["record", "export"]]) assert.equal(cli(args, 2).error.code, "CLI_USAGE");
    const absentConfig = { ...config, world: { ...config.world, id: "absent" } }; await writeConfig(configFile, absentConfig);
    assert.equal(cli(["record", "list"], 2).error.code, "INVALID_INPUT");
    await writeConfig(configFile, config);
    assert.equal((await store.records("town1", { includeAbandoned: true })).length, 16, "reads must not append command entries");
    await stat(join(config.controlDir, ".operation"));

    const projection = await admin(`SELECT to_jsonb(c) FROM information_schema.columns c WHERE table_schema='app' ORDER BY table_name,ordinal_position`);
    const expected = {
      worlds: "world_id name kind profile address template chain_id chain_instance clock_mode rate world_now epoch parent_world parent_snapshot parent_seq hosted state created_at updated_at",
      world_snapshots: "world_id name epoch record_seq chain_state_ref site_backups clock_mode rate world_now code_version template created_at",
      command_records: "world_id epoch seq prev v id trace_id kind command args actor_email actor_address actor_hats who_kind org_id site world_time world_time_end real_time duration_ms outcome error_code error_reason error_detail result changes run_id model policy_version surface cause_seq branch_abandoned",
    };
    for (const [table, columns] of Object.entries(expected)) assert.deepEqual(projection.filter((r) => r.table_name === table).map((r) => r.column_name), columns.split(" "));

    await migrateMailSink(admin);
    let mailNow = now;
    const mail = devnetMail(query, async () => mailNow);
    const message = { to: "  Hannah@Harbourline.test ", subject: "Invoice ready", text: "Read https://harbourline.test/invoice/123",
      idempotencyKey: "notice:invoice-1:hannah'\\ ", template: "invoice-ready" };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => mail.send(message)));
    assert.equal(new Set(concurrent.map((r) => r.id)).size, 1, "concurrent retries must store one accepted send");
    assert.match(concurrent[0]!.id, /^mail_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal((await mail.list()).mail.length, 1);
    const [kept] = await admin("SELECT to_jsonb(m) FROM devnet.mail_messages m");
    assert.equal(kept!.idempotency_key, message.idempotencyKey, "the exact key including whitespace and escapes must survive");
    assert.equal(Date.parse(kept!.sent_at as string), now, "mail uses world time, not wall time");
    await mail.fail({ next: 2 });
    await mail.fail({ next: 1, to: message.to });
    assert.deepEqual(await devnetMail(query, async () => now).send({ ...message, subject: "changed on retry" }), concurrent[0]);
    assert.deepEqual((await mail.fail({ list: true })).faults, [{ to: null, remaining: 2 }, { to: "hannah@harbourline.test", remaining: 1 }]);
    const retry = { ...message, idempotencyKey: "notice:invoice-2:hannah" };
    await assert.rejects(mail.send(retry), { code: "PROVIDER_ERROR" });
    assert.deepEqual((await mail.fail({ list: true })).faults, [{ to: null, remaining: 2 }], "specific fault is spent before wildcard");
    await assert.rejects(devnetMail(query, async () => now).send(retry), { code: "PROVIDER_ERROR" });
    assert.deepEqual((await mail.fail({ list: true })).faults, [{ to: null, remaining: 1 }], "failed invocation committed its fault decrement");
    await assert.rejects(mail.send(retry), { code: "PROVIDER_ERROR" });
    assert.deepEqual((await mail.fail({ list: true })).faults, []);
    mailNow += 240000;
    await mail.send(retry);
    await mail.send({ ...message, template: "sign-in-code", subject: "Sign in", text: "Code 041820", idempotencyKey: "signin-1" });
    assert.equal((await mail.list({ template: "invoice-ready", limit: 1 })).mail[0]!.subject, "Invoice ready");
    assert.equal((await mail.list({ to: " HANNAH@HARBOURLINE.TEST ", template: "sign-in-code" })).mail[0]!.text, "Code 041820");
    await mail.send({ to: message.to, subject: "HTML only", html: '<a href="https://harbourline.test/invite">Accept</a>',
      idempotencyKey: "html-only", template: "invitation" });
    const htmlMail = (await mail.list({ template: "invitation" })).mail[0]!;
    assert.equal(htmlMail.text, "Accept\nhttps://harbourline.test/invite");
    assert.deepEqual(htmlMail.links, ["https://harbourline.test/invite"]);
    for (const input of [{ next: 0 }, { next: 101 }, { next: 1.5 }, { list: true, next: 1 }, { clear: true, to: message.to }])
      await assert.rejects(mail.fail(input), { code: "INVALID_INPUT" });
    await assert.rejects(mail.send({ ...message, to: "not-an-address" }), { code: "INVALID_INPUT" });
    await assert.rejects(query("DELETE FROM devnet.mail_messages"));
    await assert.rejects(admin("SET ROLE capxul_core; INSERT INTO devnet.mail_faults VALUES ('*',1,now())"));
    await assert.rejects(devnetMail(async () => { throw new Error("credential-do-not-leak"); }, async () => now).send(message),
      { code: "PROVIDER_ERROR", message: "Devnet mail storage is unavailable" });
    await assert.rejects(devnetMail(query, async () => { throw new Error("clock-credential"); }).send(message),
      { code: "PROVIDER_ERROR", message: "World mail clock is unavailable" });
    await mail.fail({ next: 2 });
    const cut = await store.cut("town1");
    assert.equal(cut.epoch, 1); assert.equal(cut.seq, 16); assert.match(cut.head, /^[a-f0-9]{64}$/);
    await cloneDatabase(maintenanceQuery, database, copies[0]!);
    await store.append("town1", { ...command, command: "after snapshot", args: { text: "$branch$ and $integrity$ are ordinary recorded text" }, result: { abandoned: true } });
    await store.save({ ...snapshot, name: "may", chain_state_ref: "/private/$integrity$/state", created_at: now + 2000 }, { ...command, command: "world snapshot save" });
    const abandoned = await store.history("town1");
    await cloneDatabase(maintenanceQuery, copies[0]!, copies[1]!);
    await maintenanceQuery(`ALTER DATABASE "${copies[1]}" ALLOW_CONNECTIONS true`);
    const cloneUrl = new URL(url); cloneUrl.pathname = `/${copies[1]}`;
    const cloneAdmin = psqlAdmin(cloneUrl.href);
    const clone = worldCatalogue((sql) => cloneAdmin(`SET ROLE capxul_worker; ${sql}`), [known]);
    const cloneMail = devnetMail((sql) => cloneAdmin(`SET ROLE capxul_worker; ${sql}`), async () => mailNow);
    assert.deepEqual(await cloneMail.send(message), concurrent[0], "snapshot must retain mail idempotency across a new provider instance");
    assert.deepEqual((await cloneMail.fail({ list: true })).faults, [{ to: null, remaining: 2 }]);
    await cloneMail.fail({ clear: true });
    assert.deepEqual((await mail.fail({ list: true })).faults, [{ to: null, remaining: 2 }], "clone faults must not mutate source state");
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

    await mail.fail({ clear: true });
    await mail.send({ ...message, idempotencyKey: "post-cut" });
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
    assert.equal((await mail.list()).mail.length, 4, "in-place restore removes post-cut sends");
    assert.deepEqual((await mail.fail({ list: true })).faults, [{ to: null, remaining: 2 }], "in-place restore restores armed faults");
    assert.deepEqual(await mail.send(message), concurrent[0], "restored accepted send still replays before faults");
    const history = await store.records("town1", { includeAbandoned: true });
    assert.equal(history.length, 20);
    assert.deepEqual((await store.snapshots("town1")).map((s) => s.name), ["may", "april", "march"], "in-place restore must not hide retained snapshot bundles");
    assert.equal(history.find((r) => r.command === "after snapshot")!.branch_abandoned, true);
    assert.equal(JSON.parse(history.find((r) => r.command === "after snapshot")!.args as string).text, "$branch$ and $integrity$ are ordinary recorded text");
    assert.equal((await store.snapshots("town1"))[0]!.chain_state_ref, "/private/$integrity$/state");
    assert.deepEqual(history.filter((r) => r.epoch === 2).map((r) => r.seq), [1, 2]);
    assert(!(await store.records("town1")).some((r) => r.command === "after snapshot"));
    assert.equal(cli(["record", "show", "--seq", "1"]).entry.epoch, 2, "default epoch must come from the catalogue, not stale config");
    assert.equal(cli(["record", "show", "--epoch", "1", "--seq", "17"]).entry.branchAbandoned, true);
    const restoredOut = join(directory, "restored-record.jsonl");
    assert.equal(cli(["record", "export", "--out", restoredOut]).lines, 21);
    assert.deepEqual((await readFile(restoredOut, "utf8")).trimEnd().split("\n").slice(1).map((line) => JSON.parse(line)), history, "public export must retain both epochs and abandoned entries");
    const largeArgs = { text: "☃".repeat(60000) }, largeResult = { text: "☃".repeat(11000) };
    const large = await store.append("town1", { ...command, args: largeArgs, result: largeResult });
    assert.deepEqual(JSON.parse(large.args as string), largeArgs, "large SQL input must not depend on the host's argv limit");
    const summary = JSON.parse(large.result as string);
    assert.equal(summary.truncated, true); assert.equal(summary.bytes, Buffer.byteLength(JSON.stringify(largeResult)));
    assert(summary.head.length <= 2000);
    const masked = worldCatalogue(query, [known, "1234", "tail\\"]);
    const redacted = await masked.append("town1", { ...command, durationMs: 1234,
      args: { number: 1234, flag: true, empty: null, secret: "1234", path: "before tail\\ after",
        nested: JSON.stringify({ secret: "tail\\", number: 1234 }) },
      result: { ordinary: 'quoted "value" and backslash \\', secret: known } });
    assert.equal(redacted.duration_ms, 1234, "a numeric credential collision must preserve numeric envelope fields");
    const args = JSON.parse(redacted.args as string);
    assert.deepEqual(args, { number: 1234, flag: true, empty: null, secret: "[REDACTED]", path: "before [REDACTED] after",
      nested: JSON.stringify({ secret: "[REDACTED]", number: 1234 }) });
    assert.deepEqual(JSON.parse(redacted.result as string), { ordinary: 'quoted "value" and backslash \\', secret: "[REDACTED]" });
    const prose = await worldCatalogue(query, []).append("town1", { ...command,
      args: { note: 'password: "foo" tail', body: 'request body={"foo":"bar"}', nested: [{ apiKey: "key-to-hide", enabled: true }] } });
    const proseArgs = JSON.parse(prose.args as string);
    assert.equal(proseArgs.note, "password=[REDACTED] tail");
    assert.equal(proseArgs.body, "request body=[REDACTED]");
    assert.deepEqual(proseArgs.nested, [{ apiKey: "[REDACTED]", enabled: true }]);
  } finally {
    await maintenanceQuery(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    for (const copy of copies) await maintenanceQuery(`DROP DATABASE IF EXISTS "${copy}" WITH (FORCE)`);
    for (const role of ownedRoles) await maintenanceQuery(`DROP ROLE "${role}"`);
    await rm(directory, { recursive: true, force: true });
  }
});
