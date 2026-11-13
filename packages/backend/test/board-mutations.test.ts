import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import pg from "pg";
import { decodeFunctionData, getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { carryNonce, listProposalWaits, migrate, propose, readOfficerChange, readProposal, routeBoard, type BoardContext, type BoardDoors,
  type BoardFacts, type BoardWorld, type CarryWorld, type Execution, type Propose, type SettlementFacts } from "../src/board/door.ts";
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
  // Finalized indexed execution/Hats facts are fixtures too; carry composes the real Approvals.withdraw.
  let executions: Record<number, Execution> = {}, moves: string[] = [], fault = false;
  const settlement: SettlementFacts = { execution: async (_sql, _chain, s, nonce, finality) => (assert.equal(s, safe), assert.equal(finality, 2), executions[nonce] ?? null),
    approvalsAt: async (_sql, _chain, _safe, _hash, block, finality) => (assert.equal(block, 90), assert.equal(finality, 2), [second]),
    hatMoved: async (_sql, _chain, tx, hat, from, to, finality) => (assert.equal(finality, 2), moves.includes(`${tx}:${hat}:${from}:${to}`)) };
  const carryWorld = (): CarryWorld => ({ chainId: 84532, finality: 2, siteUrl: "https://board.test", facts: settlement,
    withdraw: async (...a) => { if (fault) throw new Error("killed mid-run"); return approvals.withdraw(...a); } });
  const facts: BoardFacts = {
    deployment: async () => ({ safe_address: safe, gate_address: address(23), director_hat: "1", books_hat: "2", invoicing_hat: "3", people_hat: "4" }),
    safe: async (_sql, _chain, requested) => ({ safe_address: requested, owners: currentOwners, threshold: indexedThreshold, nonce: 0, deployed: true }),
    wearers: async () => currentOwners,
    // A provider may answer checksummed; Board must compare Safes in one case.
    approvals: async (_sql, _chain, _safe, _hash, owners) => approved.filter((a) => owners.some((o) => o.toLowerCase() === a.toLowerCase())),
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
      executions = {}; moves = []; fault = false;
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
    await control("checksummed indexed owners and approvals neither refuse a Director nor count one twice", async () => {
      currentOwners = [getAddress(director), getAddress(second)]; assert.notEqual(currentOwners[1], second, "fixture must checksum");
      await doors.authenticate(db, tokens.second!, now);
      const p = await propose(db, { ...context, principalId: "second", safe: second }, input("case"));
      await db.query("update app.approvals set state='landed' where approval_id=$1", [p.approval_id]);
      approved = [getAddress(second)];
      await assert.rejects(call("/board/proposals/approve", { proposalId: p.proposal_id }, "second"), /WRONG_STATE: Director already approved/);
      approved = [getAddress(director)];
      const next: any = await call("/board/proposals/approve", { proposalId: p.proposal_id }, "second");
      assert.equal(next.step, "execute");
      assert.equal((await db.query("select director_safe from app.proposal_approvals where approval_id=$1", [next.approvalId])).rows[0].director_safe, second);
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
    await control("lapsed authority, missing deployment or unbound hat, office conflict and stale gate refuse without writes", async () => {
      validOwners = [second]; await assert.rejects(grant(), /director_hat_lapsed/); await empty(); validOwners = [director, second];
      for (const [deployment, why] of [[async () => null, /no deployment/], [async () => ({ ...(await facts.deployment(db, org, 84532))!, people_hat: null }), /binds no hat/]] as const) {
        await assert.rejects(call("/board/officers/grant", { member: "@agent", permission: "manage-people", note: null }, "director", { ...world, facts: { ...facts, deployment } }), why); await empty(); }
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
    const executed = (nonce: number, safe_tx_hash: `0x${string}`, success = true): Execution =>
      (executions[nonce] = { safe_tx_hash, success, tx_hash: `0x${String(nonce).repeat(64).slice(0, 64)}`, user_op_hash: null, block_number: 90, sender: director, threshold: 2 });
    const key = (nonce: number) => ({ orgId: org, chainId: 84532, safe, nonce }), state = async (id: string) => (await readProposal(db, org, id))!.status;
    await control("carry waits for its own finalized nonce, executes, applies the officer change and withdraws unsigned approvals once", async () => {
      const result: any = await grant(), change = (await readOfficerChange(db, org, result.change.changeId))!;
      const p = (await readProposal(db, org, change.proposal_id))!, other = await propose(db, context, input("other"));
      assert.deepEqual(await carryNonce(db, carryWorld(), key(0), now + 1, "carry-trace"), []); assert.equal(await state(p.proposal_id), "awaiting_approvals");
      const exec = executed(0, p.safe_tx_hash); moves = [`${exec.tx_hash}:4:0x0000000000000000000000000000000000000000:${agent}`]; executed(1, other.safe_tx_hash);
      assert.deepEqual(await carryNonce(db, carryWorld(), key(0), now + 1, "carry-trace"), [{ proposal_id: p.proposal_id, transition: "execute" }]);
      const settled = (await readProposal(db, org, p.proposal_id))!;
      assert.equal(settled.status, "executed"); assert.deepEqual(settled.approved_by, [second, director], "the executing Director's v=1 approval counts"); assert.equal(settled.threshold, 2);
      assert.equal(settled.settled_block, 90); assert.equal(settled.execution_tx_hash, exec.tx_hash); assert.equal(settled.settled_at, now + 1);
      assert.equal(await state(other.proposal_id), "awaiting_approvals", "a different nonce wakes no other instance");
      const e = (await readEvent(db, `proposal:${p.proposal_id}:execute`))!;
      assert.deepEqual([e.props.from, e.props.to, e.trace_id], ["awaiting_approvals", "executed", "carry-trace"]);
      const applied = (await readOfficerChange(db, org, change.change_id))!; assert.equal(applied.state, "applied"); assert.equal(applied.waiting, null);
      assert.deepEqual((await readEvent(db, `officer-change:${change.change_id}:apply`))!.props.to, "applied");
      assert.equal((await db.query("select state from app.approvals where approval_id=$1", [result.proposal.approvalId])).rows[0].state, "withdrawn");
      const events = (await db.query("select count(*)::int as n from app.transition_outbox")).rows[0].n; assert.deepEqual(await carryNonce(db, carryWorld(), key(0), now + 2), [], "second run changes nothing");
      assert.equal((await db.query("select count(*)::int as n from app.transition_outbox")).rows[0].n, events);
      assert.deepEqual(await listProposalWaits(db, org, 84532), [key(1)]);
    });
    await control("carry rejects by a Capxul rejection, replaces on a foreign hash, fails, and ends a change without its hat move", async () => {
      const first: any = await grant(), p = (await readProposal(db, org, (await readOfficerChange(db, org, first.change.changeId))!.proposal_id))!;
      const rejection: any = await call("/board/proposals/reject", { proposalId: p.proposal_id });
      assert.equal(rejection.nonce, 0); executed(0, rejection.safeTxHash).sender = outsider;
      const settled = await carryNonce(db, carryWorld(), key(0), now + 1);
      assert.deepEqual(new Map(settled.map((s) => [s.proposal_id, s.transition])), new Map([[p.proposal_id, "reject"], [rejection.proposalId, "execute"]]));
      assert.equal((await readOfficerChange(db, org, first.change.changeId))!.state, "ended"); for (const id of [p.proposal_id, rejection.proposalId]) assert.deepEqual((await readProposal(db, org, id))!.approved_by, [second], "no non-Director or other-hash sender");
      const foreign = await propose(db, context, input("foreign")), failing = await propose(db, context, input("failing"));
      executed(foreign.nonce, `0x${"ab".repeat(32)}`).threshold = 3; executed(failing.nonce, failing.safe_tx_hash, false);
      assert.deepEqual(await carryNonce(db, carryWorld(), key(foreign.nonce), now + 1), [{ proposal_id: foreign.proposal_id, transition: "replace" }]); const f = (await readProposal(db, org, foreign.proposal_id))!; assert.equal(f.threshold, 3); assert.deepEqual(f.approved_by, [second], "a Director executing another hash approved nothing here");
      assert.deepEqual(await carryNonce(db, carryWorld(), key(failing.nonce), now + 1), [{ proposal_id: failing.proposal_id, transition: "fail" }]);
      liveNonce = 5n; const again: any = await grant();
      const q = (await readProposal(db, org, (await readOfficerChange(db, org, again.change.changeId))!.proposal_id))!; executed(q.nonce, q.safe_tx_hash);
      assert.deepEqual(await carryNonce(db, carryWorld(), key(q.nonce), now + 1), [{ proposal_id: q.proposal_id, transition: "execute" }]);
      assert.equal((await readOfficerChange(db, org, again.change.changeId))!.state, "ended", "executed without the hat move ends"); assert(await readEvent(db, `officer-change:${again.change.changeId}:end`));
    });
    await control("carry killed mid-run writes nothing and resumes to the same settlement", async () => {
      await auth(); const p = await propose(db, context, input("resume")); executed(0, p.safe_tx_hash);
      fault = true; await db.query("savepoint run");
      await assert.rejects(carryNonce(db, carryWorld(), key(0), now + 1), /killed mid-run/); await db.query("rollback to run");
      assert.equal(await state(p.proposal_id), "awaiting_approvals"); assert.equal(await readEvent(db, `proposal:${p.proposal_id}:execute`), null);
      fault = false; assert.deepEqual(await carryNonce(db, carryWorld(), key(0), now + 1), [{ proposal_id: p.proposal_id, transition: "execute" }]); assert.equal(await state(p.proposal_id), "executed");
    });
    await control("caller failure rolls back officer intent, proposal, approval, carrier and both source events", async () => {
      await db.query("savepoint caller"); await grant(); await db.query("rollback to caller"); await empty();
      assert.equal((await db.query("select count(*)::int as n from app.approval_carriers")).rows[0].n, 0);
    });
    await db.query("rollback");
  } finally { await db.end(); }
});
