import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Effect } from "effect";
import pg from "pg";
import { decodeEventLog, encodeFunctionData, keccak256, parseAbi, stringToHex, type Abi, type Hex } from "viem";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { board, createCompany, ERC20, type Protocol } from "../../devnet/src/modules/company/service.ts";
import { THIRD_PARTY } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { digest } from "../src/access/door.ts";
import { departmentsHandler, settleChange, type CarrierInput, type DepartmentServices } from "../src/budgets/door.ts";
import { BUDGETS_ABI, hatHex } from "../src/budgets/departments.ts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";

// Real v4 Budgets and Hats on an isolated Anvil (packages/contracts/state/core.json), a dedicated departments_test
// PostgreSQL, and the actual public handler. Indexed views are stand-in tables filled from the real receipts; the Board
// carrier is devnet's founder approve-and-execute. Component evidence, not Ponder/ERPNext/selected-stack proof.
const url = process.env.DEPARTMENTS_TEST_ADMIN_URL, rpc = process.env.DEPARTMENTS_TEST_RPC;
const local = (v: string | undefined) => !!v && ["localhost", "127.0.0.1"].includes(new URL(v).hostname);
if (!local(url) || new URL(url!).pathname !== "/departments_test" || !local(rpc)) throw new Error("loopback departments_test PG and core-state Anvil required");
const admin = new pg.Client({ connectionString: url });
const role = (name: string) => { const u = new URL(url!); u.username = name; u.password = `${name}-local`; return u.href; };
const contracts = new URL("../../contracts/", import.meta.url);
const artifact = async (file: string) => JSON.parse(await readFile(new URL(`out/${file}.sol/${file}.json`, contracts), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const HATS = parseAbi(["function isWearerOfHat(address user,uint256 hatId) view returns (bool)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 amount)"]);
const org = "north-works", at = 1_790_000_000_000;
const people = { director: { id: "director", bearer: randomBytes(32).toString("base64url") }, holder: { id: "holder", bearer: randomBytes(32).toString("base64url") } };
let db: Database, server: ReturnType<typeof createServer>, base = "";
let protocol: Protocol, company: Awaited<ReturnType<typeof createCompany>>;
const carried: CarrierInput[] = [];

const call = async (who: { bearer: string } | null, path: string, body: unknown) => {
  const res = await fetch(`${base}/budgets/departments/${path}`, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who.bearer}` } : {}) } });
  return { status: res.status, body: await res.json() as any };
};
const create = (requestKey: string, extra: Record<string, unknown> = {}) => ({ orgId: org, requestKey, note: null, name: "Operations",
  parent: company.topBudget.toString(), amount: "500", period: "month", token: null, holders: ["holder@north.test"], ...extra });

test.before(async () => {
  const chain = await connect(rpc!);
  const record = JSON.parse(await readFile(new URL("deployments/devnet.json", contracts), "utf8"));
  protocol = { chain, record, installerAbi: (await artifact("Installer")).abi };
  const token = await artifact("MockERC20"), deployer = testKey("deployer");
  const tx = await chain.walletFor(deployer.key).deployContract({ abi: token.abi, bytecode: token.bytecode.object, args: ["Test USD", "USDC", 6] });
  const usdc = (await chain.client.waitForTransactionReceipt({ hash: tx })).contractAddress!;
  const name = `Departments ${randomUUID()}`;
  company = await createCompany(protocol, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: "director@north.test", company: name, token: usdc, officers: [{ details: "People", maxSupply: 2 }],
    ceiling: 1_000_000_000n, topAmount: 1_000_000_000n, salt: keccak256(stringToHex(name)) });
  await send(chain, { from: deployer.key, to: usdc, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [company.companySafe, 900_000_000n] }) });
  const holderSafe = testKey("second").address.toLowerCase();
  await admin.connect();
  for (const name of ["capxul_core", "capxul_worker"]) {
    if (!(await admin.query("select 1 from pg_roles where rolname=$1", [name])).rowCount) await admin.query(`create role ${name} login nosuperuser nobypassrls noinherit`);
    await admin.query(`alter role ${name} password '${name}-local'`);
  }
  const sql = (p: string) => readFile(new URL(`../src/${p}`, import.meta.url), "utf8");
  await admin.query(await sql("schema.sql"));
  await admin.query("grant usage on schema app to capxul_core,capxul_worker; grant select on app.world,app.organizations to capxul_core,capxul_worker");
  for (const name of ["parties", "access", "organizations", "budgets"]) await admin.query(await sql(`${name}/schema.sql`));
  await migrateOutbox(admin);
  await admin.query(`create table app.chain_budgets (budget_id text primary key, company_safe text, parent_budget_id text, token text, hat_id text, closed boolean);
    create table app.hat_wearers (hat_id text, wearer text, wearing boolean);
    create table app.chain_logs (chain_id integer, tx_hash text, tx_log_ordinal integer, contract text, event text, args jsonb);
    grant select on app.chain_budgets,app.hat_wearers,app.chain_logs to capxul_core,capxul_worker`);
  await admin.query("insert into app.world(world_id,clock) values('departments',$1)", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);
  await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token) values($1,$1,$2,'north.localhost','director@north.test',$3)",
    [org, company.companySafe.toLowerCase(), usdc.toLowerCase()]);
  for (const [who, safe] of [[people.director, company.founderSafe.toLowerCase()], [people.holder, holderSafe]] as const) {
    await admin.query("insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at) values($1,'person',$2,$3,null,$4)",
      [who.id, `${who.id}@north.test`, safe, new Date(at)]);
    await admin.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
      values($1,$1,$2,'code','active','component',$3,$4)`, [who.id, digest(who.bearer), new Date(at), new Date(at + 3_600_000)]);
    await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values($1,'person','active',$2,'person',$3,$4,$4)`, [`party-${who.id}`, safe, who.id, at]);
    await admin.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
      values($1,$2,$3,$2,'human',$4,'seat','active',$5,$5)`, [org, who.id, `party-${who.id}`, safe, at]);
  }
  // The founder wears the (unnamed) officer hat in the indexed view: any officer hat counts until People is named.
  await admin.query("insert into app.hat_wearers values($1,$2,true)", [hatHex(company.officerHats[0]!), company.founderSafe.toLowerCase()]);
  await admin.query("insert into app.chain_budgets values($1,$2,null,$3,$4,false)",
    [company.topBudget.toString(), company.companySafe.toLowerCase(), usdc.toLowerCase(), hatHex(company.boardTopHat)]);
  db = new Database(role("capxul_core"), role("capxul_worker"));
  const carrier = (kind: string) => async (_: unknown, input: CarrierInput) => {
    carried.push(input); return { approval_id: `approval_${carried.length}`, proposal_id: kind === "board" ? `proposal_${carried.length}` : null, url: `http://approvals/${carried.length}`, proposal: null };
  };
  const services: DepartmentServices = { client: chain.client, budgets: record.contracts.Budgets.address, hats: THIRD_PARTY.hats,
    deployment: async () => ({ safe_address: company.companySafe, officer_hats: company.officerHats.map(String) }),
    isDirector: async (_, __, principal) => principal.personId === people.director.id,
    board: carrier("board"), office: carrier("office"),
    carried: async (_, change) => ({ approval_id: change.approval_id, proposal_id: change.proposal_id, url: "http://approvals/repeat", proposal: null }) };
  const handler = departmentsHandler(db, services, (build) => Effect.runPromise(build({ traceId: randomUUID().replaceAll("-", ""), callId: randomUUID() }) as any));
  server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.after(async () => { server?.close(); await db?.close(); await admin.end(); });

test("a Director's department is planned from the chain, carried by the Board, and lands exactly as planned", { timeout: 120_000 }, async () => {
  const first = await call(people.director, "create", create("slice0-paying-1"));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.signer, "board"); assert.equal(first.body.status, "awaiting_approvals");
  assert.equal(first.body.department.key, "operations"); assert.equal(first.body.department.amount, "500");
  assert.deepEqual(first.body.department.office.holders, [{ email: "holder@north.test", safe: testKey("second").address.toLowerCase() }]);
  assert.equal(carried.length, 1); assert.equal(carried[0]!.calls.length, 3);
  assert.deepEqual(carried[0]!.subject, { opener: "budgets", subject_kind: "budget-change", subject_id: first.body.changeId });
  const repeat = await call(people.director, "create", create("slice0-paying-1"));
  assert.equal(repeat.body.changeId, first.body.changeId); assert.equal(carried.length, 1, "a repeated request opens no second carrier");
  const listed = (await call(people.director, "list", { orgId: org })).body.items;
  assert.deepEqual(listed.map((i: any) => [i.key, i.status, i.budgetId]), [[null, "active", company.topBudget.toString()], ["operations", "proposed", null]]);

  // The Board executes the exact batch; the chain's hat and budget must be the planned ones.
  const txHash = await board(protocol, company, carried[0]!.calls.map((c) => ({ to: c.to as Hex, value: BigInt(c.value), data: c.data })));
  const planned = BigInt(first.body.department.office.hat);
  assert.equal(await protocol.chain.client.readContract({ address: THIRD_PARTY.hats, abi: HATS, functionName: "isWearerOfHat", args: [testKey("second").address, planned] }), true);
  const receipt = await protocol.chain.client.getTransactionReceipt({ hash: txHash });
  const logs = receipt.logs.flatMap((log, i) => {
    for (const [contract, abi] of [["budgets", BUDGETS_ABI], ["hats", HATS]] as const) {
      try { const e = decodeEventLog({ abi, data: log.data, topics: log.topics }) as any;
        return [[contract, e.eventName, JSON.parse(JSON.stringify(e.args, (_k, v) => typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : v)), i]]; } catch { /* other contract */ }
    }
    return [];
  });
  for (const [contract, event, args, i] of logs) await admin.query("insert into app.chain_logs values(84532,$1,$2,$3,$4,$5)", [txHash.toLowerCase(), i, contract, event, args]);
  const created = logs.find(([, e]) => e === "BudgetCreated")![2] as Record<string, string>;
  assert.equal(hatHex(BigInt(created.hat!)), hatHex(planned), "the planned hat id is the one Hats created");
  const settled = await db.transaction(org, (sql) => settleChange(sql, { org_id: org, change_id: first.body.changeId, chain_id: 84532,
    transaction_hash: txHash, outcome: "executed" }, { at: at + 1, traceId: "board-end", actor: null }));
  assert.deepEqual(settled, { state: "applied", outcome: null, repeated: false });
  await admin.query("insert into app.chain_budgets values($1,$2,$3,$4,$5,false)", [created.id, company.companySafe.toLowerCase(), company.topBudget.toString(), created.token, hatHex(planned)]);
  await admin.query("insert into app.hat_wearers values($1,$2,true)", [hatHex(planned), testKey("second").address.toLowerCase()]);
  const operations = (await call(people.director, "list", { orgId: org })).body.items.find((i: any) => i.key === "operations");
  assert.equal(operations.status, "active"); assert.equal(operations.budgetId, created.id); assert.equal(operations.amount, "500");
  assert.equal(operations.left, "500"); assert.deepEqual(operations.office.holders.map((h: any) => h.email), ["holder@north.test"]);
});

test("refusals are exact and open no carrier; the office holder's own Safe carries a team under its office", { timeout: 60_000 }, async () => {
  const before = carried.length;
  for (const [who, body, code] of [
    [null, create("r1"), "NOT_AUTHENTICATED"],
    [people.holder, create("r2"), "ROLE_PERMISSION_DENIED"],
    [people.director, create("r3", { name: "Marketing", amount: "600" }), "CHILDREN_EXCEED_PARENT"],
    [people.director, create("r4", { name: "Operations", amount: "1" }), "WRONG_STATE"],
    [people.director, create("r5", { name: "Sales", holders: ["stranger@north.test"] }), "INVALID_INPUT"],
    [people.director, create("r6", { name: "Sales", period: "year" }), "INVALID_INPUT"],
    [people.director, create("r7", { name: "Sales", token: "USDC" }), "INVALID_INPUT"],
    [people.director, create("r8", { name: "Sales", holders: ["director@north.test"] }), "ROLE_CONFLICT"],
  ] as const) {
    const result = await call(who, "create", body);
    assert.equal(result.body.error?.code, code, `${body.requestKey}: ${JSON.stringify(result.body)}`);
  }
  assert.equal(carried.length, before, "no refusal opened a carrier");
  const team = await call(people.holder, "create", create("team-1", { name: "Field", parent: "operations", amount: "100", holders: [] }));
  assert.equal(team.status, 200, JSON.stringify(team.body)); assert.equal(team.body.signer, "office");
  assert.equal(carried.at(-1)!.safe, testKey("second").address.toLowerCase());
});
