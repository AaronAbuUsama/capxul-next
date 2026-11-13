import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { createTestClient, decodeFunctionData, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi, type Abi, type Hex } from "viem";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { board } from "../../devnet/src/modules/company/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { carry, migrateApprovals, withdraw, type CarrierServices } from "../src/approvals/door.ts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { approvalTerminal, migratePayments, readCommandPayments } from "../src/payments/door.ts";
import { prepareCommand, type PrepareCommand, type PrepareContext } from "../src/payments/prepare.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment command controls require a named disposable real Ponder/v4 world");

test("same-Sql command birth, original terminal replay and exact v4 IDs/calldata", async (t) => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const artifacts = JSON.parse(await readFile(new URL("../../contracts/abi/abi.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const control = createTestClient({ mode: "anvil", transport: http(process.env.RPC_URL!) });
  const block = await chain.client.getBlock(), at = Number(block.timestamp) * 1000;
  const adminUrl = new URL(process.env.PG_ADMIN_URL!); adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await admin.connect(); await sql.connect();
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const owner = { kind: "organization", id: `command-${crypto.randomUUID()}` } as const;
  const person = { kind: "person", id: `personal-${crypto.randomUUID()}` } as const;
  const context: PrepareContext = { owner, approval: { person_id: "current-wearer", sender: testKey("second").address,
    site_url: "https://component.invalid", now: new Date(at) }, payments: record.contracts.Payments.address,
    budgets: record.contracts.Budgets.address, deadline: at + 7_200_000, traceId: "prepare-component-control" };
  const input: PrepareCommand = { owner_kind: owner.kind, owner_id: owner.id, requested_by: context.approval.person_id,
    request_key: "invoice-and-fee", purpose: "request", route: "budget", payer_safe: fixture.safe, payer_label: "Company",
    budget_id: fixture.department, chain_id: chain.chainId, funding: { raw: "3000000", block_number: Number(block.number), of: "budget_left" },
    items: [1234567, 234567].map((amount, i) => ({ payee_party_id: `${owner.id}-payee`, payee_safe: testKey("payee").address,
      payee_label: "Supplier", payee_kind: null, payee_id: null, token_address: fixture.token, asset: "USDC", decimals: 6,
      amount_raw: String(amount), kind: 1, document_id: `invoice-${i}`, document_hash: fixture.documentHash, fee_raw: i ? "123" : "0" })),
    summary: "Two supplier payments", pay_at: null, not_after: at + 3_600_000, resume: false };
  input.funding.raw = String(await chain.client.readContract({ address: context.budgets as Hex,
    abi: artifacts.contracts.Budgets.abi as Abi, functionName: "leftOf", args: [BigInt(fixture.department)] }));
  const token = parseAbi(["function mint(address to,uint256 amount)", "function balanceOf(address owner) view returns (uint256)"]);
  await send(chain, { from: testKey("deployer").key, to: fixture.token,
    data: encodeFunctionData({ abi: token, functionName: "mint", args: [fixture.founderSafe, 2_000_000n] }) });
  const personalFunding = await chain.client.readContract({ address: fixture.token, abi: token, functionName: "balanceOf", args: [fixture.founderSafe] });
  const fundingBlock = Number(await chain.client.getBlockNumber());
  try {
    const installer = JSON.parse(await readFile(new URL("../../contracts/out/Installer.sol/Installer.json", import.meta.url), "utf8"));
    const budgetAbi = artifacts.contracts.Budgets.abi as Abi;
    const parent = await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi,
      functionName: "budgetOf", args: [BigInt(fixture.department)] }) as { parent: bigint };
    const root = await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi,
      functionName: "budgetOf", args: [parent.parent] }) as { hat: bigint };
    await board({ chain, record, installerAbi: installer.abi as Abi }, {
      companySafe: fixture.safe, founderSafe: fixture.founderSafe, founderKey: testKey("founder").key, relayerKey: testKey("deployer").key,
    }, [{ to: context.budgets as Hex, data: encodeFunctionData({ abi: budgetAbi, functionName: "createChildBudget",
      args: [BigInt(fixture.department), 10_000_000n, root.hat] }) }]);
    const child = await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi, functionName: "budgetCount" }) as bigint;
    assert.equal(await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi,
      functionName: "authorised", args: [child, testKey("second").address] }), true);
    const boardCalls = async (functionName: string, args: readonly unknown[]) => board({ chain, record, installerAbi: installer.abi as Abi }, {
      companySafe: fixture.safe, founderSafe: fixture.founderSafe, founderKey: testKey("founder").key, relayerKey: testKey("deployer").key,
    }, [{ to: context.budgets as Hex, data: encodeFunctionData({ abi: budgetAbi, functionName, args }) }]);
    await boardCalls("createChildBudget", [child, 5_000_000n, BigInt(fixture.hat)]);
    const grandchild = await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi, functionName: "budgetCount" }) as bigint;
    let indexed = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      indexed = Boolean((await sql.query("select 1 from app.chain_budgets where budget_id=$1", [child.toString()])).rowCount);
      if (indexed) break;
      await setTimeout(100);
    }
    assert(indexed, "the actual child budget must reach Ponder before authority is read");
    await admin.query("begin"); await migrateOutbox(admin); await migrateApprovals(admin); await migratePayments(admin); await admin.query("commit");
    await sql.query("begin");
    await sql.query("select set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true),set_config('app.org_id',$1,true)", [owner.id]);
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values
      ($1,'organization','active',$2,'organization',$3,$4,$4),($5,'address','outside',$6,null,null,$4,$4)`,
    [owner.id, fixture.safe.toLowerCase(), owner.id, at, `${owner.id}-payee`, testKey("payee").address.toLowerCase()]);
    const bornRows = async () => (await sql.query("select * from app.payment_commands where owner_kind='organization' and owner_id=$1", [owner.id])).rows;
    const refuses = async (body: PrepareCommand, ctx = context, error = /INVALID_INPUT/) => {
      await sql.query("savepoint refusal");
      try { await assert.rejects(prepareCommand(sql, body, ctx), error); }
      finally { await sql.query("rollback to savepoint refusal"); }
      assert.deepEqual(await bornRows(), []);
    };
    await refuses({ ...input, funding: { ...input.funding, raw: "1469133" } }, context, /PAYROLL_BUDGET_EXCEEDED/);
    await refuses({ ...input, pay_at: at + 3_599_999 });
    await refuses({ ...input, items: [{ ...input.items[0]!, document_hash: `0x${"0".repeat(64)}` }] });
    await refuses(input, { ...context, owner: { kind: "person", id: owner.id } });
    await refuses(input, { ...context, approval: { ...context.approval, sender: testKey("stranger").address } }, /FORBIDDEN/);
    // Unmapped payroll provenance is refused before any approval could move money it can never book.
    const approvals = async () => (await sql.query("select count(*)::int as n from app.approvals")).rows[0].n;
    const approvalsBefore = await approvals();
    await refuses({ ...input, purpose: "payroll", items: [{ ...input.items[0]!, source: { kind: "salary-slip", id: "slip-component" } }, ...input.items.slice(1)] },
      context, /WRONG_STATE: payroll Books provenance mapping is not available/);
    assert.equal(await approvals(), approvalsBefore);
    await t.test("a child-authorized wearer cannot prepare through a closed ancestor", async () => {
      await boardCalls("close", [child]);
      try {
        let closed = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          closed = (await sql.query("select closed from app.chain_budgets where budget_id=$1", [child.toString()])).rows[0]?.closed;
          if (closed) break;
          await setTimeout(100);
        }
        assert(closed, "actual ancestor closure must reach Ponder");
        assert.equal((await sql.query("select closed from app.chain_budgets where budget_id=$1", [grandchild.toString()])).rows[0].closed, false);
        assert.equal(await chain.client.readContract({ address: context.budgets as Hex, abi: budgetAbi,
          functionName: "authorised", args: [grandchild, testKey("second").address] }), true);
        const args = [grandchild, testKey("payee").address, 1_234_567n, 1] as const;
        for (const [functionName, terms] of [["spend", [...args, fixture.documentHash, `0x${"11".repeat(32)}`]],
          ["schedule", [...args, BigInt(at / 1000 + 14_400), fixture.documentHash, `0x${"22".repeat(32)}`]]] as const)
          await assert.rejects(chain.client.simulateContract({ address: context.budgets as Hex, abi: budgetAbi,
            functionName, args: terms, account: testKey("second").address }), /BudgetIsClosed/);
        const funding = { ...input.funding, raw: String(await chain.client.readContract({ address: context.budgets as Hex,
          abi: budgetAbi, functionName: "leftOf", args: [grandchild] })) };
        await refuses({ ...input, budget_id: grandchild.toString(), funding }, context, /WRONG_STATE:.*closed/);
        await refuses({ ...input, budget_id: grandchild.toString(), funding, pay_at: at + 14_400_000,
          not_after: at + 18_000_000 }, context, /WRONG_STATE:.*closed/);
      } finally {
        await boardCalls("reopen", [child]);
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((await sql.query("select closed from app.chain_budgets where budget_id=$1", [child.toString()])).rows[0]?.closed === false) break;
          await setTimeout(100);
        }
      }
    });
    assert.equal((await sql.query(`select 1 from app.hat_wearers where hat_id=$1 and wearer=$2 and wearing`,
      [`0x${root.hat.toString(16).padStart(64, "0")}`, testKey("second").address.toLowerCase()])).rowCount, 0);
    await sql.query("savepoint ancestor_authority");
    await prepareCommand(sql, { ...input, budget_id: child.toString(), request_key: "ancestor-authority" }, context);
    assert.equal((await bornRows()).length, 1, "an ancestor's current wearer may pay from the child");
    await sql.query("rollback to savepoint ancestor_authority");
    await sql.query("savepoint caller_rollback");
    const rolled = await prepareCommand(sql, input, context);
    assert.equal((await readCommandPayments(sql, owner, rolled.command_id)).length, 2);
    await sql.query("rollback to savepoint caller_rollback");
    assert.deepEqual(await bornRows(), []);
    assert.equal((await sql.query("select * from app.approvals where subject_id=$1", [rolled.command_id])).rowCount, 0);
    assert.equal((await sql.query("select * from app.transition_outbox where event->>'owner_id'=$1", [owner.id])).rowCount, 0);
    const first = await prepareCommand(sql, input, context);
    assert.equal(first.expires_at, input.not_after);
    assert.deepEqual(await prepareCommand(sql, input, context), { ...first, replayed: true });
    const payments = await readCommandPayments(sql, owner, first.command_id);
    const approval = (await sql.query("select calls from app.approvals where approval_id=$1", [first.approval_id])).rows[0];
    for (const payment of payments) {
      const call = approval.calls.find((c: { data: Hex }) => {
        const decoded = decodeFunctionData({ abi: artifacts.contracts.Budgets.abi as Abi, data: c.data });
        return decoded.functionName === "spend" && decoded.args?.[5] === payment.job_nonce;
      });
      assert(call);
      const decoded = decodeFunctionData({ abi: artifacts.contracts.Budgets.abi as Abi, data: call.data });
      assert.deepEqual(decoded.args, [BigInt(fixture.department), testKey("payee").address, BigInt(payment.amount_raw), 1, fixture.documentHash, payment.job_nonce]);
      // Independently ask the real Payments contract to derive the ID from its executable item.
      const job = keccak256(encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [context.budgets as Hex, BigInt(fixture.department), payment.job_nonce as Hex]));
      assert.equal(await chain.client.readContract({ address: context.payments as Hex, abi: artifacts.contracts.Payments.abi as Abi,
        functionName: "paymentId", args: [{ paymentId: `0x${"0".repeat(64)}`, recipient: payment.payee_safe, token: payment.token_address, amount: BigInt(payment.amount_raw),
          kind: payment.kind, documentHash: payment.document_hash, jobNonce: job, executor: fixture.safe }] }), payment.chain_payment_id);
    }
    await sql.query("savepoint conflict");
    await assert.rejects(prepareCommand(sql, { ...input, summary: "altered terms" }, context), /IDEMPOTENCY_CONFLICT/);
    await sql.query("rollback to savepoint conflict");
    await withdraw(sql, context.approval, { approval_id: first.approval_id, reason: "component terminal replay" });
    const later = { ...context, deadline: context.deadline + 900_000, approval: { ...context.approval,
      person_id: "different-wearer", sender: testKey("founder").address, now: new Date(at + 5000) } };
    assert.deepEqual(await prepareCommand(sql, { ...input, requested_by: "different-wearer" }, later), { ...first, replayed: true });
    assert.equal((await sql.query("select * from app.approvals where subject_id=$1", [first.command_id])).rowCount, 1);
    assert.equal((await sql.query("select state from app.approvals where approval_id=$1", [first.approval_id])).rows[0].state, "withdrawn");
    const dated = await prepareCommand(sql, { ...input, request_key: "dated-budget", pay_at: at + 14_400_000, not_after: at + 18_000_000 }, context);
    const scheduled = (await sql.query("select calls from app.approvals where approval_id=$1", [dated.approval_id])).rows[0].calls;
    assert(scheduled.every((call: { data: Hex }) => {
      const decoded = decodeFunctionData({ abi: artifacts.contracts.Budgets.abi as Abi, data: call.data });
      return decoded.functionName === "schedule" && decoded.args?.[4] === BigInt(at / 1000 + 14_400);
    }));
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values ($1,'person','active',$2,'person',$1,$3,$3)`, [person.id, fixture.founderSafe.toLowerCase(), at]);
    const personalContext = { ...context, owner: person, approval: { ...context.approval, person_id: person.id, sender: fixture.founderSafe } };
    const personalInput: PrepareCommand = { ...input, owner_kind: person.kind, owner_id: person.id, requested_by: person.id,
      route: "personal", payer_safe: fixture.founderSafe, budget_id: null,
      funding: { raw: String(personalFunding), block_number: fundingBlock, of: "balance" },
      pay_at: at + 3_600_000, not_after: at + 18_000_000 };
    const personal = await prepareCommand(sql, personalInput, personalContext);
    const personalApproval = (await sql.query("select calls,send_after from app.approvals where approval_id=$1", [personal.approval_id])).rows[0];
    assert.equal(personalApproval.send_after.getTime(), at + 3_600_000);
    assert.equal(personalApproval.calls.length, 2);
    const allowance = decodeFunctionData({ abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]), data: personalApproval.calls[0].data });
    assert.deepEqual(allowance.args, [context.payments, 1_469_134n]);
    const batch = decodeFunctionData({ abi: artifacts.contracts.Payments.abi as Abi, data: personalApproval.calls[1].data });
    assert.equal(batch.functionName, "sendBatch");
    assert.equal((batch.args?.[0] as unknown[]).length, 2);
    for (const item of batch.args?.[0] as any[]) {
      assert.equal(item.executor.toLowerCase(), fixture.founderSafe.toLowerCase());
      assert.equal(await chain.client.readContract({ address: context.payments as Hex, abi: artifacts.contracts.Payments.abi as Abi,
        functionName: "paymentId", args: [item] }), item.paymentId);
    }
    await sql.query("commit");
    const expiredAt = new Date(context.deadline + 121_000);
    await control.setNextBlockTimestamp({ timestamp: BigInt(expiredAt.getTime() / 1000) });
    await control.mine({ blocks: 1 });
    const outside = async (): Promise<never> => { throw new Error("expired command must not invoke an outside signing/sending service"); };
    const services: CarrierServices = { now: async () => expiredAt, sponsor: outside, send: outside, lookup: outside,
      nonce: outside, needsAndGate: outside,
      fact: async (client, approval) => {
        const fact = (await client.query("select * from app.user_operations where chain_id=$1 and user_op_hash=$2", [approval.chain_id, approval.user_op_hash])).rows[0];
        assert.equal(fact, undefined, "these commands were never signed or submitted"); return null;
      }, terminal: async (client, event) => { await approvalTerminal(client, event, { at: Date.parse(event.observedAt), traceId: context.traceId }); } };
    await carry(db, services);
    await sql.query("begin");
    await sql.query("select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)", [owner.id]);
    assert((await readCommandPayments(sql, owner, first.command_id)).every((payment) => payment.status === "cancelled"));
    const lapsed = await readCommandPayments(sql, owner, dated.command_id);
    assert(lapsed.every((payment) => payment.status === "needs_retry" && payment.outcome === "expired"));
    const retryContext = { ...context, approval: { ...context.approval, now: expiredAt }, deadline: expiredAt.getTime() + 3_600_000 };
    const datedInput = { ...input, request_key: "dated-budget", pay_at: at + 14_400_000, not_after: at + 18_000_000, resume: true };
    const retried = await prepareCommand(sql, datedInput, retryContext);
    assert.equal(retried.command_id, dated.command_id); assert.deepEqual(retried.payment_ids, dated.payment_ids);
    assert.notEqual(retried.approval_id, dated.approval_id);
    assert.deepEqual((await readCommandPayments(sql, owner, dated.command_id)).map((p) => p.chain_payment_id), lapsed.map((p) => p.chain_payment_id));
    const future = (await sql.query("select calls from app.approvals where approval_id=$1", [retried.approval_id])).rows[0].calls;
    assert(future.every((call: { data: Hex }) => decodeFunctionData({ abi: budgetAbi, data: call.data }).functionName === "schedule"));
    await sql.query("rollback");
    await t.test("elapsed budget and personal retries preserve IDs without elapsed scheduling", async (retryTest) => {
      await control.setNextBlockTimestamp({ timestamp: BigInt(at / 1000 + 14_401) });
      await control.mine({ blocks: 1 });
      const now = new Date(Number((await chain.client.getBlock()).timestamp) * 1000);
      assert(now.getTime() > datedInput.pay_at);
      for (const [body, ctx, original] of [[datedInput, context, dated], [{ ...personalInput, resume: true }, personalContext, personal]] as const) {
        await retryTest.test(body.route, async () => {
          await sql.query("begin");
          try {
            const before = await readCommandPayments(sql, ctx.owner, original.command_id);
            if (body.route === "budget") {
              const legacy = (await sql.query("select calls from app.approvals where approval_id=$1", [original.approval_id])).rows[0].calls;
              const call = decodeFunctionData({ abi: budgetAbi, data: legacy[0].data });
              await assert.rejects(chain.client.simulateContract({ address: context.budgets as Hex, abi: budgetAbi,
                functionName: call.functionName, args: call.args, account: testKey("second").address }), /InvalidPayAt/);
            }
            const result = await prepareCommand(sql, body, { ...ctx, approval: { ...ctx.approval, now }, deadline: now.getTime() + 1_800_000 });
            assert.deepEqual(result.payment_ids, original.payment_ids); assert.equal(result.command_id, original.command_id);
            const approval = (await sql.query("select calls,send_after from app.approvals where approval_id=$1", [result.approval_id])).rows[0];
            assert.equal(approval.send_after, null);
            if (body.route === "budget") for (const encoded of approval.calls) {
              const call = decodeFunctionData({ abi: budgetAbi, data: encoded.data });
              assert.equal(call.functionName, "spend");
              const simulated = await chain.client.simulateContract({ address: context.budgets as Hex, abi: budgetAbi,
                functionName: call.functionName, args: call.args, account: testKey("second").address });
              assert.equal(simulated.result, before.find((p) => p.job_nonce === call.args?.[5])!.chain_payment_id);
            }
            const after = await readCommandPayments(sql, ctx.owner, result.command_id);
            assert.deepEqual(after.map((p) => [p.id, p.chain_payment_id, p.job_nonce, p.pay_at]),
              before.map((p) => [p.id, p.chain_payment_id, p.job_nonce, p.pay_at]));
            assert(after.every((p) => Number(p.pay_at) === body.pay_at));
          } finally { await sql.query("rollback"); }
        });
      }
    });
    await sql.query("begin");
    const ended = { ...retryContext, approval: { ...retryContext.approval, now: new Date(at + 18_000_000) } };
    await assert.rejects(prepareCommand(sql, datedInput, ended), /WRONG_STATE: payment window ended/);
  } finally {
    await sql.query("rollback"); await admin.query("rollback");
    await admin.query("delete from app.approval_carriers where approval_id in (select approval_id from app.approvals where org_id=$1 or person_id=$2)", [owner.id, person.id]);
    await admin.query("delete from app.approvals where org_id=$1 or person_id=$2", [owner.id, person.id]);
    await admin.query("delete from app.transition_outbox where event->>'owner_id'=any($1) or event->'props'->>'org_id'=$2", [[owner.id, person.id], owner.id]);
    await admin.query("delete from app.payment_processes where owner_id=any($1)", [[owner.id, person.id]]);
    await admin.query("delete from app.payments where owner_id=any($1)", [[owner.id, person.id]]);
    await admin.query("delete from app.payment_commands where owner_id=any($1)", [[owner.id, person.id]]);
    await admin.query("delete from app.parties where party_id=any($1)", [[owner.id, `${owner.id}-payee`, person.id]]);
    await db.close(); await sql.end(); await admin.end();
  }
});
