import assert from "node:assert/strict";
import test from "node:test";
import { boardFacts, settlementFacts, type BoardReaders } from "../src/board/door.ts";
import type { Sql } from "../src/platform/db.ts";

// DB-free mapping of the source owners' readers onto Board's facts; the readers themselves are Core's and Organizations'.
const sql = {} as Sql, safe = "0x00000000000000000000000000000000000000Aa", A = "0x000000000000000000000000000000000000000A", B = "0x000000000000000000000000000000000000000b";
const calls: { name: string; input: unknown }[] = [];
const readers = (): BoardReaders => {
  const log = <T>(name: string, value: T) => async (_sql: Sql, input: unknown) => { calls.push({ name, input }); return value; };
  return {
    readAdmittedDeployment: log("deployment", { safe_address: safe, gate_address: "0x00000000000000000000000000000000000000Bb", director_hat: "7" }),
    readSafeOwnersAt: async (_sql, input) => {
      calls.push({ name: "owners", input });
      return { safe_address: safe, deployed: true, owners: [A, B], threshold: 2, nonce: "5" };
    },
    readHatAt: log("hat", { company_safe: safe.toLowerCase(), supply: "1", max_supply: "4294967295" }),
    readHatWearersAt: log("wearers", [{ wearer: A.toLowerCase(), wearing: true }, { wearer: B, wearing: false }]),
    readSafeApprovals: log("approvals", [{ owner: A }, { owner: A.toLowerCase() }, { owner: "0x00000000000000000000000000000000000000cc" }]),
    readSafeExecution: log("execution", { safe_tx_hash: `0x${"AB".repeat(32)}`, success: true, tx_hash: `0x${"cd".repeat(32)}`, block_number: "91",
      msg_sender: A, threshold: 2 }),
    readHatTransfersInTx: log("transfers", [{ from: "0x0000000000000000000000000000000000000000", to: B, value: "1" }]),
    readWearerHatsAt: async (_sql, input) => { calls.push({ name: "worn", input }); return input.wearer === A
      ? [{ details: "allowance:x", wearing: true }, { details: "office:finance", wearing: false }]
      : [{ details: "allowance:y", wearing: true }, { details: "office:ops", wearing: true }]; },
  };
};

test("planning facts are lowercase, current and never bind an officer hat", async () => {
  calls.length = 0;
  const f = boardFacts(readers());
  assert.deepEqual(await f.deployment(sql, "org", 84532), { safe_address: safe.toLowerCase(), gate_address: "0x00000000000000000000000000000000000000bb",
    director_hat: "7", books_hat: null, invoicing_hat: null, people_hat: null });
  assert.deepEqual((await f.safe(sql, 84532, safe as never))!.owners, [A.toLowerCase(), B.toLowerCase()]);
  assert.deepEqual(await f.wearers(sql, 84532, "7", [B, A] as never), [A.toLowerCase()]);
  assert.deepEqual(await f.approvals(sql, 84532, safe as never, "0x01", [A, B] as never), [A.toLowerCase()]);
  assert.deepEqual(await f.hat(sql, 84532, "8", safe as never), { supply: 1n, max_supply: 4294967295n });
  assert.equal(await f.hat(sql, 84532, "8", B as never), null, "another company's hat");
  assert.equal(await f.hasOffice(sql, 84532, safe as never, A as never), false, "an allowance or an office no longer worn is no office");
  assert.equal(await f.hasOffice(sql, 84532, safe as never, B as never), true);
  assert.deepEqual(calls.at(-1)!.input, { chainId: 84532, wearer: B, companySafe: safe, finality: 0 });
  assert(calls.filter((c) => c.name !== "deployment").every((c) => (c.input as { finality: number }).finality === 0));
});

test("settlement facts use one finality, dedupe approvals, and take sender and threshold from the execution itself", async () => {
  calls.length = 0;
  const f = settlementFacts(readers());
  assert.deepEqual(await f.execution(sql, 84532, safe as never, 5, 3), { safe_tx_hash: `0x${"ab".repeat(32)}`, success: true,
    tx_hash: `0x${"cd".repeat(32)}`, user_op_hash: null, block_number: 91, sender: A.toLowerCase(), threshold: 2 });
  assert(!calls.some((c) => c.name === "owners"), "no later Safe-state projection stands in for the execution's threshold");
  assert.deepEqual(await f.approvalsAt(sql, 84532, safe as never, "0x01", 91, 3), [A.toLowerCase(), "0x00000000000000000000000000000000000000cc"]);
  assert.equal(await f.hatMoved(sql, 84532, "0x01", "8", "0x0000000000000000000000000000000000000000", B.toLowerCase() as never, 3), true);
  assert.equal(await f.hatMoved(sql, 84532, "0x01", "8", B as never, "0x0000000000000000000000000000000000000000", 3), false);
  assert(calls.every((c) => (c.input as { finality: number }).finality === 3));
});
