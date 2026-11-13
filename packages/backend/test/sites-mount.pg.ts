import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import pg from "pg";
import { digest } from "../src/access/door.ts";
import { rewriteRestoredSites } from "../src/devnet/door.ts";
import { migrate as migrateOrganizations } from "../src/organizations/door.ts";
import { signature } from "../src/plugs/door.ts";
import { createCore } from "../src/server.ts";
import { sitesRoutes } from "../src/sites/mount.ts";

// Real Core HTTP server on its own disposable database, migrated by migrate.ts: the document door is mounted with Access,
// Organizations' Seat, the Frappe provider, the Sites store and the collector's saved answer. Only Frappe is a fake peer.
const adminUrl = process.env.PG_ADMIN_URL;
if (!adminUrl || process.env.CAPXUL_DISPOSABLE !== "true" || !["127.0.0.1", "localhost"].includes(new URL(adminUrl).hostname))
  throw new Error("PG_ADMIN_URL must name a disposable loopback cluster and CAPXUL_DISPOSABLE=true");

test("Core's mounted document door authenticates, requires a Seat, reaches the site and records the call", async (t) => {
  const name = `sites_mount_${randomBytes(4).toString("hex")}`;
  const at = (database: string, user?: string, password?: string) => {
    const u = new URL(adminUrl); u.pathname = `/${database}`; if (user) { u.username = user; u.password = password!; } return u.href;
  };
  const root = new pg.Client({ connectionString: adminUrl }); await root.connect();
  await root.query(`create database ${name}`);
  // Cleanups run last-registered first, so the database is dropped after Core and every client have closed.
  const cleanups: (() => unknown)[] = [async () => { await root.query(`drop database if exists ${name} with (force)`); await root.end(); }];
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
  const env = { ...process.env, PG_ADMIN_URL: at(name), DATABASE_URL: at(name, "capxul_core", "corepw"),
    WORKER_DATABASE_URL: at(name, "capxul_worker", "workerpw"), PONDER_DATABASE_URL: at(name, "capxul_ponder", "ponderpw"), CAPXUL_WORLD: "town1" };
  const migrated = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("../src/migrate.ts", import.meta.url).pathname], { env, encoding: "utf8" });
  assert.equal(migrated.status, 0, migrated.stderr);
  const admin = new pg.Client({ connectionString: at(name) }); await admin.connect();
  cleanups.push(() => admin.end());
  // Live worlds get this from the Organizations cut-over (migrateOrganizations); until it lands, apply it here.
  await migrateOrganizations(admin);

  const now = 1_791_555_000_000, org = "acme", host = "acme-town1.localhost";
  const safe = (n: number) => `0x${String(n).repeat(40)}`;
  await admin.query("update app.world set clock=$1", [{ nowMs: now, clockMode: "stopped", rate: 1 }]);
  await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,'Acme',$2,$3,'director@acme.test',$4)", [org, safe(1), host, safe(9)]);
  await admin.query("insert into app.people(org_id,address,email,name) values($1,$2,'director@acme.test','Director')", [org, safe(2)]);
  const tokens: Record<string, string> = {};
  for (const [i, person] of ["director", "outsider"].entries()) {
    tokens[person] = randomBytes(32).toString("base64url");
    await admin.query("insert into app.principals values($1,'person',$2,$3,null,$4)", [person, `${person}@acme.test`, safe(3 + i), new Date(now)]);
    await admin.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
      values($1,$1,$2,'code','active','fixture',$3,$4)`, [person, digest(tokens[person]!), new Date(now), new Date(now + 3_600_000)]);
    await admin.query(`insert into app.parties(party_id,kind,state,handle,display_name,safe_address,owner_kind,owner_id,created_at,updated_at)
      values($1,'person','active',$1,$1,$2,'person',$1,$3,$3)`, [person, safe(3 + i), now]);
  }
  // A Seat admits only in a live Organization with its own live Party (app.current_member).
  await admin.query(`insert into app.parties(party_id,kind,state,handle,display_name,safe_address,owner_kind,owner_id,created_at,updated_at)
    values('org-acme','organization','active','acme','Acme',$1,'organization',$2,$3,$3)`, [safe(1), org, now]);
  await admin.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
    values($1,'director','director','director','human',$2,'seat','active',$3,$3)`, [org, safe(3), now]);
  await admin.query(`insert into app.sites(org_id,site_id,world_id,slug,host,state,bench,app_version,map_version,created_at,ready_at,updated_at)
    values($1,$1,'town1',$1,$2,'ready','town1','1','sha256:map',$3,$3,$3)`, [org, host, now]);
  // The collector's committed answer for the held payment request below.
  await admin.query("insert into app.site_request_answers values($1,'REQ-1',$2,$3)", [org,
    { request_id: "REQ-1", requested_by: "director@acme.test" }, { approval_id: "A-1", approval_url: "http://core.test/approve/A-1" }]);

  const secret = randomBytes(16).toString("hex"), seen: { site: string; user: string; verb: string }[] = [];
  const frappe = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
    const body = JSON.parse(raw);
    const user = JSON.parse(Buffer.from(String(req.headers["x-capxul-assertion"]).split(".")[0]!, "base64url").toString()).u;
    seen.push({ site: String(req.headers["x-frappe-site-name"]), user, verb: body.verb });
    const data = body.verb === "submit" ? { safe: true, status: "Requesting", approval_url: null, request: "REQ-1" }
      : { doctype: body.doctype, name: body.name ?? "SUP-1", docstatus: 0, fields: { supplier_name: "Harbourline" } };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { ok: true, data } }));
  });
  await new Promise<void>((done) => frappe.listen(0, "127.0.0.1", done));
  cleanups.push(() => { frappe.close(); });
  const frappeUrl = `http://127.0.0.1:${(frappe.address() as { port: number }).port}`;

  const core = createCore({ database: env.DATABASE_URL, workerDatabase: env.WORKER_DATABASE_URL, secret, port: 0, host: "127.0.0.1",
    url: "http://127.0.0.1", frappe: frappeUrl, ponder: "http://127.0.0.1:1", rpc: "http://127.0.0.1:1", chainId: 84532,
    socket: "http://127.0.0.1:1", startPaused: false, finality: 0, world: "town1" },
  sitesRoutes({ world: "town1", frappe: frappeUrl, secret, provisioning: { publicOrigin: "http://127.0.0.1", rpcUrl: "http://127.0.0.1:1",
    coreUrl: "http://127.0.0.1:1", coreSecret: secret, siteServiceUrl: "http://127.0.0.1:1", siteServiceToken: "unused" } }));
  const base = `http://127.0.0.1:${((await core.start()) as { port: number }).port}`;
  cleanups.push(() => core.stop());
  const call = async (body: Record<string, unknown>, person?: string) => {
    const response = await fetch(`${base}/org/site/document`, { method: "POST", body: JSON.stringify({ orgId: org, ...body }),
      headers: { "content-type": "application/json", ...(person ? { authorization: `Bearer ${tokens[person]}` } : {}) } });
    return { status: response.status, body: await response.json() as any };
  };

  const signedOut = await call({ verb: "get", doctype: "Supplier", name: "SUP-1" });
  assert.equal(signedOut.status, 401); assert.equal(signedOut.body.error.code, "NOT_AUTHENTICATED");
  const forged = await call({ verb: "get", doctype: "Supplier", name: "SUP-1" }, "nobody");
  assert.equal(forged.status, 401); assert.equal(forged.body.error.code, "NOT_AUTHENTICATED");
  const outsider = await call({ verb: "get", doctype: "Supplier", name: "SUP-1" }, "outsider");
  assert.equal(outsider.status, 403); assert.equal(outsider.body.error.code, "ROLE_PERMISSION_DENIED");
  assert.equal(seen.length, 0, "no refused caller reaches the site");

  const got = await call({ verb: "get", doctype: "Supplier", name: "SUP-1" }, "director");
  assert.equal(got.status, 200, JSON.stringify(got.body)); assert.equal(got.body.name, "SUP-1");
  assert.deepEqual(seen, [{ site: host, user: "director@acme.test", verb: "get" }]);
  const held = await call({ verb: "submit", doctype: "Purchase Invoice", name: "PINV-1", callId: "pay-1" }, "director");
  assert.equal(held.status, 200, JSON.stringify(held.body));
  assert.deepEqual(held.body, { held: true, requestId: "REQ-1", approvalId: "A-1", awaiting: safe(2) });

  const calls = (await admin.query("select person_id,verb,doctype,docname,outcome,created_at from app.door_calls where org_id=$1 order by verb", [org])).rows;
  assert.deepEqual(calls, [{ person_id: "director", verb: "get", doctype: "Supplier", docname: "SUP-1", outcome: "ok", created_at: now },
    { person_id: "director", verb: "submit", doctype: "Purchase Invoice", docname: "PINV-1", outcome: "held", created_at: now }]);
  assert.equal((await admin.query("select count(*)::int n from app.records where org_id=$1 and kind='document_door_call'", [org])).rows[0].n, 2);

  // Pause covers the mounted door, before its body is read.
  const pause = JSON.stringify({});
  assert.equal((await fetch(`${base}/admin/snapshot/pause`, { method: "POST", body: pause, headers: { "x-capxul-signature": signature(pause, secret) } })).status, 200);
  const paused = await fetch(`${base}/org/site/document`, { method: "POST", body: "{}", headers: { authorization: `Bearer ${tokens.director}` } });
  assert.equal(paused.status, 503); assert.deepEqual(await paused.json(), { error: "SNAPSHOT_PAUSED" });

  // Restore rebinds the saved site to the target world's host and bench on the admin connection; a missing host refuses.
  await assert.rejects(rewriteRestoredSites(at(name), { worldId: "town2", sites: {} }), { code: "INVALID_INPUT" });
  await rewriteRestoredSites(at(name), { worldId: "town2", sites: { [org]: "acme-town2.localhost", other: "other-town2.localhost" } });
  assert.deepEqual((await admin.query("select host,world_id,bench,state from app.sites where org_id=$1", [org])).rows,
    [{ host: "acme-town2.localhost", world_id: "town2", bench: "town2", state: "ready" }]);
});
