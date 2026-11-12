import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logKey } from "../src/log-key.ts";

const TX = "0xAbC0000000000000000000000000000000000000000000000000000000000001";

test("a payment re-mined in a new block keeps its event key (indexing.log-identity)", () => {
  // First mined: the tx's receipt holds a USDC Transfer (log 7) then PaymentSent (log 8) in block A.
  const first = logKey(84532, TX, [{ logIndex: 7 }, { logIndex: 8 }], 8);
  // After a reorg the same tx lands in block B, behind other transactions: the block hash and the block-global
  // indexes change, its place in its own receipt does not.
  const reMined = logKey(84532, TX, [{ logIndex: 41 }, { logIndex: 42 }], 42);
  assert.equal(first, reMined);
  assert.equal(first, `84532:${TX.toLowerCase()}:1`);
  assert.notEqual(logKey(84532, TX, [{ logIndex: 7 }, { logIndex: 8 }], 7), first);
  assert.throws(() => logKey(84532, TX, [{ logIndex: 7 }], 8));
});

test("the outbox queues a re-mined payment once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "log-key-"));
  const saved = process.env.STATE_DIR;
  process.env.STATE_DIR = dir;
  try {
    const { enqueue, ensureOrg, getOrg } = await import("../src/outbox.ts");
    ensureOrg("acme", "0x01");
    const data = { payment_id: "1", amount: "500" };
    const a = enqueue("acme", logKey(84532, TX, [{ logIndex: 7 }, { logIndex: 8 }], 8), "payment_sent", data);
    const b = enqueue("acme", logKey(84532, TX, [{ logIndex: 41 }, { logIndex: 42 }], 42), "payment_sent", data);
    assert.equal(b.seq, a.seq);
    assert.equal(getOrg("acme")!.events.length, 1);
  } finally {
    if (saved === undefined) delete process.env.STATE_DIR; else process.env.STATE_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
