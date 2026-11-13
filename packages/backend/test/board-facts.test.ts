import assert from "node:assert/strict";
import test from "node:test";
import { boardFacts, settlementFacts, type BoardReaders } from "../src/board/door.ts";
import type { Sql } from "../src/platform/db.ts";

// DB-free mapping of the source owners' readers onto Board's facts; the readers themselves are Core's and Organizations'.
const sql = {} as Sql, safe = "0x00000000000000000000000000000000000000Aa", A = "0x000000000000000000000000000000000000000A", B = "0x000000000000000000000000000000000000000b";
const calls: { name: string; input: unknown }[] = [];
let ruled: string | null = null;
const refuse = (name: string) => { if (ruled) throw new Error(ruled === "module" ? "HISTORICAL_UNAVAILABLE: hat 7 is ruled by a module; read Hats live"
  : `HISTORICAL_UNAVAILABLE: ${name} changed after block 90`); };
const chain: { functionName: string; args: readonly unknown[]; blockNumber?: bigint }[] = [];
let down = false;
const client = { readContract: async (c: { functionName: string; args: readonly unknown[]; blockNumber?: bigint }) => {
  if (down) throw new Error("rpc down"); chain.push(c);
  return c.functionName === "isWearerOfHat" ? c.args[0] === B : ["office:x", 9, 3, A, A, "", 0, true, true]; } };
const live = { client: client as never, hats: "0x3bc1a0ad72417f2d411118085256fc53cbddd137" as const };
const readers = (): BoardReaders => {
  const log = <T>(name: string, value: T) => async (_sql: Sql, input: unknown) => { calls.push({ name, input }); return value; };
  return {
    readAdmittedDeployment: log("deployment", { safe_address: safe, gate_address: "0x00000000000000000000000000000000000000Bb", director_hat: "7" }),
    readSafeOwnersAt: async (_sql, input) => {
      calls.push({ name: "owners", input });
      return { safe_address: safe, deployed: true, owners: [A, B], threshold: 2, nonce: "5" };
    },
    // Core scopes both hat readers to companySafe: another company's hat reads null or [].
    readHatAt: async (_sql, input) => { refuse("chain-hats"); calls.push({ name: "hat", input });
      return input.companySafe === safe ? { supply: "1", max_supply: "4294967295" } : null; },
    readHatWearersAt: async (_sql, input) => { refuse("hat-wearers"); calls.push({ name: "wearers", input });
      return input.companySafe === safe ? [{ wearer: A.toLowerCase(), wearing: true }, { wearer: B, wearing: false }] : []; },
    readSafeApprovals: log("approvals", [{ owner: A }, { owner: A.toLowerCase() }, { owner: "0x00000000000000000000000000000000000000cc" }]),
    readSafeExecution: log("execution", { safe_tx_hash: `0x${"AB".repeat(32)}`, success: true, tx_hash: `0x${"cd".repeat(32)}`, block_number: "91",
      msg_sender: A, threshold: 2 }),
    readHatTransfersInTx: log("transfers", [{ from: "0x0000000000000000000000000000000000000000", to: B, value: "1" }]),
    readWearerHatsAt: async (_sql, input) => { if (ruled === "changed") refuse("hat-wearers"); calls.push({ name: "worn", input });
      if (ruled === "module") return [{ hat_id: "9", details: "office:ops", wearing: null }, { hat_id: "10", details: "allowance:z", wearing: null }];
      return input.wearer === A ? [{ hat_id: "1", details: "allowance:x", wearing: true }, { hat_id: "2", details: "office:finance", wearing: false }]
        : [{ hat_id: "3", details: "allowance:y", wearing: true }, { hat_id: "4", details: "office:ops", wearing: true }]; },
  };
};

test("planning facts are lowercase, current and never bind an officer hat", async () => {
  calls.length = 0;
  const f = boardFacts(readers(), live); ruled = null; chain.length = 0;
  assert.deepEqual(await f.deployment(sql, "org", 84532), { safe_address: safe.toLowerCase(), gate_address: "0x00000000000000000000000000000000000000bb",
    director_hat: "7", books_hat: null, invoicing_hat: null, people_hat: null });
  assert.deepEqual((await f.safe(sql, 84532, safe as never))!.owners, [A.toLowerCase(), B.toLowerCase()]);
  assert.deepEqual(await f.wearers(sql, 84532, safe as never, "7", [B, A] as never), [A.toLowerCase()]);
  assert.deepEqual(await f.wearers(sql, 84532, B as never, "7", [B, A] as never), [], "another company's Director hat");
  assert.deepEqual(await f.approvals(sql, 84532, safe as never, "0x01", [A, B] as never), [A.toLowerCase()]);
  assert.deepEqual(await f.hat(sql, 84532, "8", safe as never), { supply: 1n, max_supply: 4294967295n });
  assert.equal(await f.hat(sql, 84532, "8", B as never), null, "another company's hat");
  assert.equal(await f.hasOffice(sql, 84532, safe as never, A as never), false, "an allowance or an office no longer worn is no office");
  assert.equal(await f.hasOffice(sql, 84532, safe as never, B as never), true);
  assert.equal(chain.length, 0, "indexed answers need no live Hats read");
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

test("a module-ruled hat is read live from Hats; only unknown office hats are probed; other refusals propagate", async () => {
  const f = boardFacts(readers(), live); ruled = "module"; chain.length = 0;
  assert.deepEqual(await f.wearers(sql, 84532, safe as never, "7", [A, B] as never), [B.toLowerCase()], "live isWearerOfHat, not the indexed rows");
  assert.deepEqual(chain.map((c) => [c.functionName, c.args]), [["isWearerOfHat", [A, 7n]], ["isWearerOfHat", [B, 7n]]]);
  assert.deepEqual(await f.hat(sql, 84532, "7", safe as never, 77n), { supply: 3n, max_supply: 9n });
  assert.equal(chain.at(-1)!.blockNumber, 77n, "pinned to the mutation's block");
  chain.length = 0; assert.equal(await f.hasOffice(sql, 84532, safe as never, B as never, 77n), true, "a live-worn office");
  assert.equal(chain[0]!.blockNumber, 77n);
  assert.equal(await f.hasOffice(sql, 84532, safe as never, A as never), false, "an office not worn live");
  assert.deepEqual(chain.map((c) => [c.functionName, c.args]), [["isWearerOfHat", [B, 9n]], ["isWearerOfHat", [A, 9n]]], "allowance hats are never probed");
  down = true;
  for (const read of [() => f.wearers(sql, 84532, safe as never, "7", [A] as never), () => f.hat(sql, 84532, "7", safe as never), () => f.hasOffice(sql, 84532, safe as never, B as never)]) {
    await assert.rejects(read(), /^Error: PROVIDER_ERROR: could not read Hats live$/);
  }
  down = false;
  ruled = "changed"; chain.length = 0;
  await assert.rejects(f.wearers(sql, 84532, safe as never, "7", [A] as never), /HISTORICAL_UNAVAILABLE: hat-wearers changed/);
  await assert.rejects(f.hat(sql, 84532, "7", safe as never), /HISTORICAL_UNAVAILABLE: chain-hats changed/);
  await assert.rejects(f.hasOffice(sql, 84532, safe as never, B as never), /HISTORICAL_UNAVAILABLE: hat-wearers changed/);
  assert.equal(chain.length, 0, "only a module-ruled refusal reads live"); ruled = null;
});
