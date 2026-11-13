import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import pg from "pg";
import { decodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { migrate, propose, readOfficerChange, readProposal, routeBoard, type BoardContext, type BoardDoors, type BoardFacts, type BoardWorld, type Propose } from "../src/board/door.ts";
import { migrateOutbox, readEvent } from "../src/platform/outbox.ts";
import { THIRD_PARTY } from "../../devnet/src/modules/protocol/service.ts";

// Actual published peer source is supplied explicitly for an isolated composition. Never a selected-world verdict.
// Only chain/deployment facts and RPC below are fixtures; no fake bearer, Seat, feature guard or Approval.open.
test("Board public adapter composes real auth/Seat/approval doors atomically", {
  skip: !process.env.BOARD_TEST_DATABASE_URL || !process.env.BOARD_PEER_SOURCE,
}, async (t) => {
  assert.equal(process.env.CAPXUL_DISPOSABLE, "true");
  const database = new URL(process.env.BOARD_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(database.hostname));
  assert.equal(database.pathname, "/board_proof", "only the dedicated component database may be mutated");
  const source = process.env.BOARD_PEER_SOURCE!;
  const load = (file: string) => import(pathToFileURL(join(source, file)).href);
  const access = await load("access/door.ts"), organizations = await load("organizations/door.ts"), approvals = await load("approvals/door.ts");
  const doors: BoardDoors = { authenticate: access.authenticate, requireSeat: organizations.requireSeat,
    requireFeature: access.requireFeature, open: approvals.open };
  const db = new pg.Client({ connectionString: process.env.BOARD_TEST_DATABASE_URL });
  const now = 1794481200123, org = "board-mutation";
  const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
  const safe = address(10), director = address(11), second = address(12), outsider = address(13), agent = address(14), lapsed = address(15);
  const tokens = Object.fromEntries(["director", "second", "outsider", "agent"].map((id) => [id, randomBytes(32).toString("base64url")]));
  const catalogue = { "owner-safe-proposals": { target: "organization", money: true }, books: { target: "organization", money: true } } as const;
  let approved: Address[] = [], currentOwners = [director, second], liveOwners = [director, second], liveNonce = 0n, liveThreshold = 2n, indexedThreshold = 2;
  let validOwners = [director, second], config = { thresholdType: 0, min: 1n, target: 2n }, wears = false, office = false;
  const reads: { functionName: string; blockNumber?: bigint }[] = [];
  const facts: BoardFacts = {
    deployment: async () => ({ safe_address: safe, gate_address: address(23), director_hat: "1", books_hat: "2", invoicing_hat: "3", people_hat: "4" }),
    safe: async (_sql, _chain, requested) => ({ safe_address: requested, owners: currentOwners, threshold: indexedThreshold, nonce: 0, deployed: true }),
    wearers: async () => currentOwners,
    approvals: async (_sql, _chain, _safe, _hash, owners) => approved.filter((a) => owners.includes(a)),
    hat: async () => ({ supply: 1n, max_supply: 1n }), hasOffice: async () => office,
  };
  const client = {
    getBlockNumber: async () => 71n,
    readContract: async (call: { functionName: string; blockNumber?: bigint; args?: unknown[] }) => {
      reads.push(call);
      switch (call.functionName) {
        case "getOwners": return liveOwners;
        case "getThreshold": return liveThreshold;
        case "nonce": return liveNonce;
        case "thresholdConfig": return config;
        case "isValidSigner": return validOwners.includes(call.args![0] as Address);
        case "isWearerOfHat": return wears;
        default: throw new Error("unexpected chain call");
      }
    },
  } as unknown as PublicClient;
  const world: BoardWorld = { chainId: 84532, siteUrl: "https://board.test", worldNow: async () => now,
    multiSend: THIRD_PARTY.multiSendCallOnly, hats: THIRD_PARTY.hats, payments: address(22), client, catalogue, doors, facts };
  const context: BoardContext = { ...world, now, principalId: "director", safe: director, kind: "human" };
  const input = (subject: string): Propose => ({ org_id: org, opener: "budgets", subject_kind: "budget-change", subject_id: subject,
    kind: "transaction", rejects: null, calls: [{ to: address(25), value: "7", data: "0x1234" }], note: "private intent", payment: null,
    summary: { title: "Budget change", from: { label: org, address: safe }, to: { label: "Budgets" }, amount: null, recipients: [], warnings: [] } });
  const auth = () => doors.authenticate(db, tokens.director!, now);
  const call = (path: string, body: object, who = "director", mounted = world) => routeBoard(db, `Bearer ${tokens[who]}`, path, { orgId: org, ...body }, mounted, "board-trace");
  const grant = () => call("/board/officers/grant", { member: "@agent", permission: "manage-people", note: null });
  const control = async (name: string, check: () => Promise<void>) => t.test(name, async () => {
    await db.query("savepoint control");
    try { await check(); } finally {
      await db.query("rollback to control"); approved = []; currentOwners = liveOwners = validOwners = [director, second];
      liveNonce = 0n; liveThreshold = 2n; indexedThreshold = 2; config = { thresholdType: 0, min: 1n, target: 2n }; wears = office = false; reads.length = 0;
    }
  });
  const empty = async () => {
    for (const table of ["officer_changes", "board_proposals", "proposal_approvals", "approvals", "transition_outbox"]) {
      assert.equal((await db.query(`select count(*)::int as n from app.${table}`)).rows[0].n, 0, table);
    }
  };
  await db.connect();
  try {
    await db.query("begin");
    for (const role of ["capxul_core", "capxul_worker"]) if (!(await db.query("select 1 from pg_roles where rolname=$1", [role])).rowCount) {
      await db.query(`create role ${role} nosuperuser nobypassrls`);
    }
    await db.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await db.query("grant usage on schema app to capxul_core,capxul_worker");
    await db.query(`alter table app.organizations enable row level security; alter table app.organizations force row level security;
      create policy tenant on app.organizations to capxul_core,capxul_worker using(org_id=current_setting('app.org_id',true) or current_user='capxul_worker')
      with check(org_id=current_setting('app.org_id',true) or current_user='capxul_worker');
      grant select,insert,update on app.organizations to capxul_core,capxul_worker`);
    await db.query(readFileSync(join(source, "access/schema.sql"), "utf8"));
    await db.query(readFileSync(join(source, "parties/schema.sql"), "utf8"));
    await organizations.migrate(db); await approvals.migrateApprovals(db); await migrateOutbox(db); await migrate(db);
    await db.query(`insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,$1,$2,$1,'fixture@board.test',$2)`, [org, safe]);
    for (const [id, addr] of [["director", director], ["second", second], ["outsider", outsider], ["agent", agent]] as const) {
      await db.query("insert into app.principals values($1,$2,$3,$4,$5,$6)", [id, id === "agent" ? "agent" : "person", id === "agent" ? null : `${id}@board.test`, addr, id === "agent" ? address(16) : null, new Date(now)]);
      await db.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
        values($1,$1,$2,'code','active','fixture',$3,$4)`, [id, access.digest(tokens[id]), new Date(now), new Date(now + 3600000)]);
      await db.query(`insert into app.parties(party_id,kind,state,handle,display_name,safe_address,owner_kind,owner_id,created_at,updated_at)
        values($1,$2,'active',$1,$1,$3,'person',$1,$4,$4)`, [id, id === "agent" ? "agent" : "person", addr, now]);
      if (id !== "outsider") await db.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
        values($1,$2,$2,$3,$4,$5,'seat','active',$6,$6)`, [org, id, id === "agent" ? null : id, id === "agent" ? "agent" : "human", addr, now]);
    }
    for (const key of Object.keys(catalogue)) await db.query("insert into app.feature_flags values($1,true,'organization',$2,null,$3)", [key, JSON.stringify([{ ids: [org], rollout: 100 }]), new Date(now)]);
    await db.query("set local role capxul_worker");

    await control("opaque bearer/real Seat ignores body actor and refuses outsiders, agents and revoked sessions", async () => {
      await assert.rejects(routeBoard(db, "Bearer body-actor", "/board/proposals/list", { orgId: org, status: null, actor: "director" }, world), /NOT_AUTHENTICATED/);
      await assert.rejects(call("/board/officers/grant", { member: "@agent", permission: "manage-people", note: null, actor: "director" }, "outsider"), /ROLE_PERMISSION_DENIED/);
      await assert.rejects(call("/board/officers/grant", { member: "@agent", permission: "manage-people", note: null }, "agent"), /ROLE_PERMISSION_DENIED/);
      await db.query("update app.sessions set status='revoked' where person_id='director'");
      await assert.rejects(grant(), /NOT_AUTHENTICATED/); await empty();
    });
    await control("proposal and first real approval share subject identity, nonce allocation and canonical outbox", async () => {
      await auth(); const p = await propose(db, context, input("first"), "board-trace");
      assert.equal(p.step, "approve"); assert.equal(p.nonce, 0); assert.equal(p.opened, true);
      const stored = (await readProposal(db, org, p.proposal_id))!;
      assert.equal(stored.proposer_principal_id, "director"); assert.equal(stored.calls[0]!.value, "7");
      const a = (await db.query("select * from app.approvals where approval_id=$1", [p.approval_id])).rows[0];
      assert.equal(a.sender, director); assert.equal(a.subject_id, p.proposal_id); assert.equal(a.created_at.getTime(), now);
      assert.equal((await propose(db, context, input("first"))).approval_id, p.approval_id);
      assert.equal((await propose(db, context, input("second"))).nonce, 1);
      const e = (await readEvent(db, `proposal:${p.proposal_id}:propose`))!;
      assert.equal(e.trace_id, "board-trace"); assert.equal(e.props.subject_id, "first"); assert.equal(JSON.stringify(e.props).includes("private intent"), false);
      const reused: any = await call("/board/proposals/approve", { proposalId: p.proposal_id });
      assert.equal(reused.approvalId, p.approval_id);
      await db.query("update app.approvals set state='landed' where approval_id=$1", [p.approval_id]);
      approved = [second];
      const next: any = await call("/board/proposals/approve", { proposalId: p.proposal_id });
      assert.equal(next.step, "execute"); assert.notEqual(next.approvalId, p.approval_id);
    });
    await control("live grant retains live nonce and post-cleanup threshold, exact Hats calls and private event", async () => {
      liveNonce = 7n; liveOwners = [director, second, lapsed]; liveThreshold = 3n; approved = [second];
      const result: any = await grant();
      const change = (await readOfficerChange(db, org, result.change.changeId))!;
      assert.equal(change.principal_id, null); assert.equal(change.member_safe, agent); assert.equal(change.email, null);
      const p = (await readProposal(db, org, change.proposal_id))!;
      assert.equal(p.nonce, 7); assert.equal(p.calls.length, 2);
      assert(p.calls.every((c) => c.to === THIRD_PARTY.hats.toLowerCase()));
      assert.equal(p.to, THIRD_PARTY.multiSendCallOnly.toLowerCase());
      const abi = parseAbi(["function changeHatMaxSupply(uint256 hat,uint32 maxSupply)", "function mintHat(uint256 hat,address wearer)"]);
      assert.deepEqual(decodeFunctionData({ abi, data: p.calls[0]!.data }).args, [4n, 2]);
      const minted = decodeFunctionData({ abi, data: p.calls[1]!.data }).args!;
      assert.equal(minted[0], 4n); assert.equal(String(minted[1]).toLowerCase(), agent);
      const a = (await db.query("select * from app.approvals where approval_id=$1", [result.proposal.approvalId])).rows[0];
      assert.equal(a.calls.length, 2); // removeSigner then execTransaction, not approveHash against stale threshold=3.
      assert.equal(String(decodeFunctionData({ abi: parseAbi(["function removeSigner(address signer)"]), data: a.calls[0].data }).args![0]).toLowerCase(), lapsed);
      const e = (await readEvent(db, `officer-change:${change.change_id}:propose`))!;
      assert.deepEqual(Object.keys(e.props).sort(), ["change", "change_id", "from", "org_id", "permission", "proposal_id", "to", "transition"]);
      assert(reads.length > 6); assert(reads.every((r) => r.blockNumber === 71n));
      await assert.rejects(grant(), /WRONG_STATE/);
    });
    await control("public revoke removes eligibility without putting the wearer in bad standing", async () => {
      const body = { member: "@agent", permission: "manage-people", note: null };
      await assert.rejects(call("/board/officers/revoke", body), /WRONG_STATE/); await empty();
      wears = true;
      const result: any = await call("/board/officers/revoke", body);
      const change = (await readOfficerChange(db, org, result.change.changeId))!;
      assert.equal(change.change, "revoke"); assert.equal(change.member_safe, agent);
      const p = (await readProposal(db, org, change.proposal_id))!;
      assert.equal(p.calls.length, 1);
      assert.equal(p.to, THIRD_PARTY.hats.toLowerCase()); assert.equal(p.calls[0]!.to, p.to);
      const decoded = decodeFunctionData({ abi: parseAbi([
        "function setHatWearerStatus(uint256 hat,address wearer,bool eligible,bool standing) returns (bool)",
      ]), data: p.calls[0]!.data });
      assert.equal(decoded.args![0], 4n); assert.equal(String(decoded.args![1]).toLowerCase(), agent);
      assert.deepEqual(decoded.args!.slice(2), [false, true]);
    });
    await control("lapsed authority, missing deployment, office conflict and stale gate refuse without writes", async () => {
      validOwners = [second]; await assert.rejects(grant(), /director_hat_lapsed/); await empty(); validOwners = [director, second];
      await assert.rejects(call("/board/officers/grant", { member: "@agent", permission: "manage-people", note: null }, "director",
        { ...world, facts: { ...facts, deployment: async () => null } }), /WRONG_STATE/); await empty();
      office = true; await assert.rejects(grant(), /ROLE_CONFLICT/); await empty(); office = false;
      await db.query("update app.feature_flags set checked_at=$1", [new Date(now - 600001)]);
      await assert.rejects(grant(), /FEATURE_NOT_AVAILABLE/); await empty();
    });
    await control("future execute uses real Approval.open send-after; approvals alone are not held", async () => {
      await auth(); currentOwners = [director]; indexedThreshold = 1;
      const dated = { ...input("dated"), kind: "scheduled_payment" as const, payment: { payment_id: "payment", sends_at: now + 86400000 } };
      const p = await propose(db, context, dated);
      assert.equal(p.step, "execute");
      const a = (await db.query("select send_after,deadline from app.approvals where approval_id=$1", [p.approval_id])).rows[0];
      assert.equal(a.send_after.getTime(), dated.payment.sends_at); assert.equal(a.deadline.getTime(), dated.payment.sends_at + 600000);
      indexedThreshold = 2; currentOwners = [director, second];
      const q = await propose(db, context, { ...dated, subject_id: "later-dated" });
      assert.equal(q.step, "approve");
      assert.equal((await db.query("select send_after from app.approvals where approval_id=$1", [q.approval_id])).rows[0].send_after, null);
    });
    await control("public rejection takes the original nonce and reuses its waiting rejection without another event", async () => {
      await auth(); const p = await propose(db, context, input("reject"));
      const r: any = await call("/board/proposals/reject", { proposalId: p.proposal_id });
      assert.equal(r.kind, "rejection"); assert.equal(r.nonce, p.nonce); assert.equal(r.rejects, p.proposal_id);
      const retry: any = await call("/board/proposals/reject", { proposalId: p.proposal_id });
      assert.equal(retry.proposalId, r.proposalId);
      assert.equal((await db.query("select count(*)::int as n from app.board_proposals")).rows[0].n, 2);
      await assert.rejects(call("/board/proposals/reject", { proposalId: r.proposalId }), /WRONG_STATE/);
    });
    await control("procedure refuses empty/company-Safe calls and never stores an opener's extra operation", async () => {
      await auth(); await assert.rejects(propose(db, context, { ...input("empty"), calls: [] }), /INVALID_INPUT/); await empty();
      await assert.rejects(propose(db, context, { ...input("self"), calls: [{ to: safe, value: "0", data: "0x" }] }), /INVALID_INPUT/); await empty();
      const badChecksum = THIRD_PARTY.hats.replace("A", "a").replace("b", "B");
      for (const to of [THIRD_PARTY.hats.slice(0, -1), `0xg${"0".repeat(39)}`, badChecksum]) {
        await assert.rejects(propose(db, context, { ...input("invalid"), calls: [{ to: to as Address, value: "0", data: "0x" }] }), /INVALID_INPUT/); await empty();
      }
      const extra = { ...input("call-only").calls[0]!, operation: "delegatecall" };
      const p = await propose(db, context, { ...input("call-only"), calls: [extra] });
      const stored = (await readProposal(db, org, p.proposal_id))!;
      assert.equal(stored.operation, "call"); assert.deepEqual(Object.keys(stored.calls[0]!).sort(), ["data", "to", "value"]);
    });
    await control("cleanup threshold preserves uint120, proportional ceiling, minimum and remaining-owner cap", async () => {
      for (const [kind, min, target, expected] of [
        [0, 1n, 2n, "execute"], [0, 1n, 3n, "approve"],
        [1, 1n, 6666n, "execute"], [1, 1n, 6667n, "approve"],
        [1, 3n, 1n, "approve"], [0, 1n << 100n, (1n << 100n) + 1n, "approve"],
      ] as const) {
        await db.query("savepoint sample");
        liveOwners = [director, second, outsider, lapsed]; validOwners = [director, second, outsider];
        liveThreshold = 4n; approved = [second]; config = { thresholdType: kind, min, target };
        const result: any = await grant();
        const a = (await db.query("select step from app.proposal_approvals where approval_id=$1", [result.proposal.approvalId])).rows[0];
        assert.equal(a.step, expected, `${kind}/${min}/${target}`);
        await db.query("rollback to sample");
      }
      config = { thresholdType: 1, min: 1n, target: 10001n };
      await assert.rejects(grant(), /PROVIDER_RESPONSE_INVALID/); await empty();
    });
    await control("caller failure rolls back officer intent, proposal, approval, carrier and both source events", async () => {
      await db.query("savepoint caller"); await grant(); await db.query("rollback to caller"); await empty();
      assert.equal((await db.query("select count(*)::int as n from app.approval_carriers")).rows[0].n, 0);
    });
    await db.query("rollback");
  } finally { await db.end(); }
});
