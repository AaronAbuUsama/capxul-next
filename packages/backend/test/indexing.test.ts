import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { concat, decodeEventLog, encodeFunctionData, pad, parseAbi, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connect } from "../../devnet/src/modules/chain/service.ts";
import { board } from "../../devnet/src/modules/company/service.ts";
import { buildUserOp, ENTRY_POINT, ENTRY_POINT_V07, viaEntryPoint } from "../../devnet/src/modules/company/internal/user-op.ts";
import { prepareBundler } from "../../devnet/src/modules/bundler/service.ts";
import { THIRD_PARTY } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { bindIndexer } from "../src/bind-indexer.ts";
import { readChainFact, readHatTransfer, readMoneyDeployment } from "../src/indexing/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("indexing checks require a named disposable real Ponder/v4 world");
const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
const adminUrl = new URL(process.env.PG_ADMIN_URL!);
adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;

test("real Ponder projections retain initial execution nonce, provenance and exact Party admission", async () => {
  const sql = new pg.Client({ connectionString: adminUrl.href });
  await sql.connect();
  try {
    await sql.query("begin");
    await bindIndexer(sql);
    for (const [table, columns] of Object.entries({
      transfers: ["log_id","chain_id","block_number","block_hash","block_time","tx_hash","tx_log_ordinal","log_index","token","from_address","to_address","amount"],
      user_operations: ["log_id","chain_id","block_number","block_hash","block_time","tx_hash","tx_log_ordinal","log_index","user_op_hash","sender","paymaster","nonce_key","nonce_sequence","success","actual_gas_cost","actual_gas_used"],
    })) {
      const fields = (await sql.query("select column_name from information_schema.columns where table_schema='app' and table_name=$1 order by ordinal_position", [table])).rows;
      assert.deepEqual(fields.map((r) => r.column_name), columns);
    }
    const safe = fixture.safe.toLowerCase(), founder = fixture.founderSafe.toLowerCase();
    const rows = (await sql.query("select * from ponder.safe_owners where safe_address=any($1)", [[safe, founder]])).rows;
    assert.equal(rows.length, 2);
    const company = rows.find((r) => r.safe_address === safe)!;
    assert.deepEqual(company.owners, [founder]);
    assert.equal(company.threshold, 1);
    assert.equal(company.kind, "company");
    const executions = (await sql.query("select safe_nonce from ponder.safe_executions where safe_address=$1 order by safe_nonce", [safe])).rows;
    assert(executions.length >= 5);
    assert.deepEqual(executions.slice(0, 5).map((r) => r.safe_nonce), ["0", "1", "2", "3", "4"]);
    const setup = (await sql.query("select args from ponder.chain_logs where contract='safe' and event='SafeSetup' and contract_address=$1", [safe])).rows;
    assert.equal(setup.length, 1, "birth-before-admission setup must be retained for exact occurrence reads");
    const l2 = (await sql.query("select args from ponder.chain_logs where contract='safe' and event='SafeMultiSigTransaction' and contract_address=$1", [safe])).rows;
    assert(l2.length >= 5);
    assert(l2.every((r) => r.args.additionalInfo && r.args.signatures));
    const agent = (await sql.query("select * from ponder.chain_logs where contract='agent-owner' and event='AgentCreated' and tx_hash=$1", [fixture.agentTx.toLowerCase()])).rows;
    assert.equal(agent.length, 1);
    assert.equal(agent[0].args.safe, fixture.agentSafe.toLowerCase());
    assert.equal(agent[0].args.owner, safe);
    assert.equal(agent[0].args.signer, fixture.agentSigner.toLowerCase());
    const budget = (await sql.query("select * from ponder.chain_budgets where budget_id=$1", [fixture.department])).rows[0];
    assert.equal(budget.company_safe, safe);
    assert.equal(budget.amount, "600000000");
    assert.equal(budget.committed, "0");
    assert.equal(budget.closed, false);
    assert.equal((await sql.query("select count(*)::int as n from ponder.chain_hats where company_safe=$1", [safe])).rows[0].n, 4);
    const mint = (await sql.query("select * from ponder.chain_logs where contract='hats' and event='TransferSingle' and args->>'id'=$1 and args->>'to'=$2", [fixture.hat, testKey("second").address.toLowerCase()])).rows[0];
    assert(mint);
    await sql.query("set local role capxul_worker");
    const handoff = await readHatTransfer(sql, { chainId: mint.chain_id, logId: mint.log_id, companySafe: safe, finality: 0 });
    assert.deepEqual(handoff, { log_id: mint.log_id, chain_id: mint.chain_id, block_number: String(mint.block_number), block_hash: mint.block_hash,
      block_time: Number(mint.block_time), tx_hash: mint.tx_hash, tx_log_ordinal: mint.tx_log_ordinal, log_index: mint.log_index,
      company_safe: safe, hat_id: fixture.hat, operator: mint.args.operator, from: mint.args.from, to: mint.args.to, value: mint.args.value });
    assert.equal(await readHatTransfer(sql, { chainId: mint.chain_id, logId: mint.log_id, companySafe: founder, finality: 0 }), null);
    assert.equal(await readHatTransfer(sql, { chainId: mint.chain_id, logId: mint.log_id, companySafe: safe, finality: 1_000_000 }), null);
    const deployed = (await sql.query("select * from app.chain_logs where contract='installer' and event='MoneyDeployed' and args->>'safe'=$1", [safe])).rows[0];
    assert(deployed, "the actual admitted Installer receipt is retained");
    const deploymentFact = await readMoneyDeployment(sql, { chainId: deployed.chain_id, logId: deployed.log_id, companySafe: safe, finality: 0 });
    assert(deploymentFact);
    assert.equal(deploymentFact.founder_safe, founder);
    assert.equal(deploymentFact.officer_hats[0], fixture.hat);
    assert.equal(deploymentFact.tx_hash, deployed.tx_hash);
    assert.equal(deploymentFact.block_hash, deployed.block_hash);
    assert.equal(deploymentFact.tx_log_ordinal, deployed.tx_log_ordinal);
    const receipt = await (await connect(process.env.RPC_URL!)).client.getTransactionReceipt({ hash: deployed.tx_hash });
    assert.equal(receipt.logs[deploymentFact.tx_log_ordinal]?.logIndex, deploymentFact.log_index);
    const actual = decodeEventLog({ abi: parseAbi(["event MoneyDeployed(address indexed safe,address indexed founderSafe,(uint256 boardTopHat,uint256 shareholdersTopHat,uint256 directorHat,uint256[] officerHats,address roles,address gate) deployment)"]),
      data: receipt.logs[deploymentFact.tx_log_ordinal]!.data, topics: receipt.logs[deploymentFact.tx_log_ordinal]!.topics }).args;
    assert.deepEqual([deploymentFact.board_top_hat, deploymentFact.shareholders_top_hat, deploymentFact.director_hat],
      [actual.deployment.boardTopHat, actual.deployment.shareholdersTopHat, actual.deployment.directorHat].map(String));
    assert.equal(deploymentFact.roles, actual.deployment.roles.toLowerCase());
    assert.equal(deploymentFact.gate, actual.deployment.gate.toLowerCase());
    assert.equal(await readMoneyDeployment(sql, { chainId: deployed.chain_id, logId: deployed.log_id, companySafe: founder, finality: 0 }), null);
    assert.equal(await readMoneyDeployment(sql, { chainId: deployed.chain_id, logId: deployed.log_id, companySafe: safe, finality: 1_000_000 }), null);
    await sql.query("reset role");
    for (const table of ["safe_owners", "chain_hats", "hat_wearers", "chain_budgets"]) {
      assert.equal((await sql.query(`select count(*)::int as n from ponder.${table} where created_log_id='' or last_log_id='' or updated_block<=0`)).rows[0].n, 0);
    }
    // Isolate each real Safe against this transaction's temporary directory, not copies in people/organizations.
    await sql.query("delete from app.party_events; delete from app.parties");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values ('index-company','organization','active',$1,'organization','same-id',0,0),
      ('index-founder','person','active',$2,'person','same-id',0,0)`, [safe, founder]);
    const scoped = async (kind: string, id: string, table: string) => {
      await sql.query("set local role capxul_core");
      try {
        await sql.query("select set_config('app.owner_kind',$1,true),set_config('app.owner_id',$2,true)", [kind, id]);
        return (await sql.query(`select * from app.${table}`)).rows;
      } finally { await sql.query("reset role"); }
    };
    const held = await scoped("organization", "same-id", "safe_owners");
    assert.deepEqual(held.map((r) => r.safe_address).sort(), [safe, fixture.agentSafe.toLowerCase()].sort(), "agent-owner admission is independent of the Safe's own owner");
    const owned = await scoped("person", "same-id", "safe_owners");
    assert.deepEqual(owned.filter((r) => [safe, founder, fixture.agentSafe.toLowerCase()].includes(r.safe_address)).map((r) => r.safe_address).sort(),
      [safe, founder].sort(), "owners-array admission is independent of the Safe's own owner");
    assert(owned.every((r) => r.safe_address === founder || r.owners.includes(founder) || r.agent_owner === founder),
      "additional native companies are readable only through the person's actual Safe relationship");
    for (const table of ["safe_owners", "safe_approvals", "safe_executions", "chain_hats", "hat_wearers", "chain_budgets", "chain_logs"]) {
      assert((await scoped("organization", "same-id", table)).length > 0, `${table} has real company rows`);
      assert.equal((await scoped("person", "outsider", table)).length, 0, `${table} denies a different owner`);
      assert.equal((await scoped("", "", table)).length, 0, `${table} denies empty session`);
    }
    await sql.query("update app.parties set state='released' where party_id='index-company'");
    assert.equal((await scoped("organization", "same-id", "safe_owners")).length, 0, "released Safe grants no admission");
    assert.equal((await scoped("organization", "same-id", "chain_budgets")).length, 0);
    assert.equal((await scoped("person", "same-id", "chain_budgets")).length, 0, "founder ownership is not company ownership");
    const progress = await scoped("", "", "indexer_progress");
    assert.equal(progress.length, 1);
    assert.deepEqual(Object.keys(progress[0]), ["chain_id","indexed_block","indexed_block_hash","indexed_block_time","head_block","head_seen_at","ready","build_id","updated_at"]);
    assert.equal(progress[0].ready, true);
    assert(progress[0].build_id);
    assert(Number(progress[0].head_block) >= Number(progress[0].indexed_block));
    await sql.query("set local role capxul_core");
    const permission = async (query: string) => {
      await sql.query("savepoint denied");
      await assert.rejects(sql.query(query), { code: "42501" });
      await sql.query("rollback to savepoint denied");
    };
    await permission("select * from ponder.safe_owners");
    await permission("update app.safe_owners set threshold=999");
    await permission("delete from app.chain_budgets");
    await sql.query("reset role");
  } finally { await sql.query("rollback"); await sql.end(); }
});

test("carrier reader retains a real high-key nonce and foreign hash, gated by indexed finality", async () => {
  const chain = await connect(process.env.RPC_URL!);
  const artifact = JSON.parse(await readFile(new URL("../../contracts/out/MockPaymaster.sol/MockPaymaster.json", import.meta.url), "utf8"));
  // Direct EntryPoint plus MockPaymaster is a component source control, never public Alto acceptance.
  const { paymaster } = await prepareBundler({ chain, fundingKey: testKey("deployer").key, paymasterArtifact: artifact });
  const op = await buildUserOp(chain, { safe: fixture.founderSafe, ownerKey: testKey("founder").key,
    module: THIRD_PARTY.safe4337Module, paymaster, to: fixture.token,
    data: encodeFunctionData({ abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]),
      functionName: "approve", args: [testKey("payee").address, 47n] }) });
  op.nonce = await chain.client.readContract({ address: ENTRY_POINT_V07, abi: ENTRY_POINT, functionName: "getNonce",
    args: [fixture.founderSafe, (1n << 192n) - 1n] });
  op.signature = pad("0x", { size: 12 });
  const module = parseAbi(["function getOperationHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)"]);
  const digest = await chain.client.readContract({ address: THIRD_PARTY.safe4337Module, abi: module, functionName: "getOperationHash", args: [op] });
  op.signature = concat([op.signature, await privateKeyToAccount(testKey("founder").key).sign({ hash: digest })]);
  const tx = await viaEntryPoint(chain, testKey("deployer").key)(op);
  const receipt = await chain.client.getTransactionReceipt({ hash: tx });
  const actual = receipt.logs.flatMap((log) => {
    try { const e = decodeEventLog({ abi: ENTRY_POINT, topics: log.topics, data: log.data }); return e.eventName === "UserOperationEvent" ? [e.args] : []; }
    catch { return []; }
  })[0]!;
  assert.equal(actual.nonce, op.nonce); assert.equal(actual.success, true);
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await sql.connect();
  try {
    const input = { chainId: chain.chainId, sender: op.sender, nonce: op.nonce.toString(), finality: 0 };
    let fact;
    for (let n = 0; n < 200; n++) { fact = await readChainFact(sql, input); if (fact) break; await setTimeout(100); }
    assert(fact);
    assert.equal(fact.nonce, actual.nonce.toString()); assert.equal(fact.user_op_hash, actual.userOpHash.toLowerCase());
    assert.notEqual(fact.user_op_hash, `0x${"ab".repeat(32)}`, "lookup must expose the actual foreign hash, not filter by an expected one");
    assert.equal(fact.transaction_hash, tx.toLowerCase());
    assert.equal(await readChainFact(sql, { ...input, nonce: (op.nonce + 1n).toString() }), null);
    assert.equal(await readChainFact(sql, { ...input, finality: 1_000_000 }), null);
  } finally { await sql.end(); }
});

test("real same-Safe nested module starts and ends retain full receipt order without broader tenant history", async () => {
  const safeAbi = parseAbi([
    "function enableModule(address module)", "function disableModule(address prevModule,address module)",
    "function execTransactionFromModule(address to,uint256 value,bytes data,uint8 operation) returns (bool)",
    "event SafeModuleTransaction(address module,address to,uint256 value,bytes data,uint8 operation)",
    "event ExecutionFromModuleSuccess(address indexed module)", "event ExecutionFromModuleFailure(address indexed module)",
  ]);
  const tokenAbi = parseAbi(["function transfer(address to,uint256 amount) returns (bool)"]);
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const installer = JSON.parse(await readFile(new URL("../../contracts/out/Installer.sol/Installer.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const safe = fixture.safe.toLowerCase() as Hex;
  const transfer = (amount: bigint) => encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [testKey("payee").address, amount] });
  const moduleCall = (to: Hex, data: Hex) => encodeFunctionData({ abi: safeAbi, functionName: "execTransactionFromModule", args: [to, 0n, data, 0] });
  // Board-authorized, temporary self-module: two nested frames plus an asymmetric sibling in one Safe/transaction.
  const txHash = await board({ chain, record, installerAbi: installer.abi as Abi }, {
    companySafe: safe, founderSafe: fixture.founderSafe, founderKey: testKey("founder").key, relayerKey: testKey("deployer").key,
  }, [
    { to: safe, data: encodeFunctionData({ abi: safeAbi, functionName: "enableModule", args: [safe] }) },
    { to: safe, data: moduleCall(safe, moduleCall(fixture.token, transfer(11n))) },
    { to: safe, data: moduleCall(fixture.token, transfer(23n)) },
    { to: safe, data: encodeFunctionData({ abi: safeAbi, functionName: "disableModule", args: ["0x0000000000000000000000000000000000000001", safe] }) },
  ]);
  const receipt = await chain.client.getTransactionReceipt({ hash: txHash });
  const expected = receipt.logs.flatMap((log, ordinal) => {
    if (log.address.toLowerCase() !== safe) return [];
    try {
      const event = decodeEventLog({ abi: safeAbi, topics: log.topics, data: log.data });
      return [{ event: event.eventName, args: JSON.parse(JSON.stringify(event.args, (_key, value) => typeof value === "bigint" ? value.toString() : typeof value === "string" ? value.toLowerCase() : value)),
        log_index: log.logIndex, tx_log_ordinal: ordinal, log_id: `${chain.chainId}:${txHash.toLowerCase()}:${ordinal}` }];
    } catch { return []; }
  });
  assert.deepEqual(expected.map((row) => row.event), ["SafeModuleTransaction", "SafeModuleTransaction", "ExecutionFromModuleSuccess", "ExecutionFromModuleSuccess", "SafeModuleTransaction", "ExecutionFromModuleSuccess"]);
  assert.deepEqual(expected.filter((row) => row.event === "SafeModuleTransaction").map((row) => row.args.to), [safe, fixture.token.toLowerCase(), fixture.token.toLowerCase()]);
  const sql = new pg.Client({ connectionString: adminUrl.href });
  await sql.connect();
  try {
    await sql.query("set role capxul_worker");
    let rows: any[] = [];
    for (let attempt = 0; attempt < 200; attempt++) {
      rows = (await sql.query(`select event,args,log_index,tx_log_ordinal,log_id,safes from app.chain_logs
        where chain_id=$1 and tx_hash=$2 and contract_address=$3 and event=any($4) order by block_number,log_index`,
      [chain.chainId, txHash.toLowerCase(), safe, ["SafeModuleTransaction", "ExecutionFromModuleSuccess", "ExecutionFromModuleFailure"]])).rows;
      if (rows.length === expected.length) break;
      await setTimeout(100);
    }
    assert.deepEqual(rows.map(({ safes, ...row }) => row), expected, "all full decoded args and occurrence keys must equal the native receipt");
    assert(rows.every((row) => JSON.stringify(row.safes) === JSON.stringify([safe])));
    await sql.query("reset role");
    await sql.query("begin");
    await sql.query("delete from app.party_events; delete from app.parties");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values ('module-founder','person','active',$1,'person','module-person',0,0)`, [fixture.founderSafe.toLowerCase()]);
    await sql.query("set local role capxul_core");
    await sql.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id','module-person',true)");
    assert.equal((await sql.query("select * from app.chain_logs where tx_hash=$1 and contract_address=$2", [txHash.toLowerCase(), safe])).rowCount, 0,
      "person's ownership of the company is not blanket company history access");
  } finally { await sql.query("rollback"); await sql.end(); }
});
