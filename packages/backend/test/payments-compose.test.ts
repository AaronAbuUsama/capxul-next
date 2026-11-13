import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Database } from "../src/platform/db.ts";
import { paymentsWork } from "../src/payments/compose.ts";

const safe = `0x${"aa".repeat(20)}`, token = `0x${"bb".repeat(20)}`;
// The real indexerState reads Ponder's /ready, the chain head over RPC and two worker rows. Ponder's own row always
// looks ready here (is_ready and is_locked, a head), as it does after Ponder is killed while locked.
async function world(t: { ready: number; chainHead: number; indexed: number; advancedMsAgo: number; due?: number; route?: string }) {
  const server = createServer((req, res) => {
    if (req.url === "/ready") { res.writeHead(t.ready); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${t.chainHead.toString(16)}` }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const calls: string[] = [];
  const sql = { query: async (text: string) => {
    calls.push(text.trim().split(/\s+/).slice(0, 6).join(" "));
    if (/where wake_at<=\$1/.test(text))
      return { rows: Array.from({ length: t.due ?? 0 }, (_, i) => ({ owner_kind: "organization", owner_id: "org-1", payment_id: `pay-${i}`, chain_id: 84532, trace_id: "tr" })), rowCount: t.due ?? 0 };
    // A Payment row for readPayment and reconcile's lock; reconcile then finds no due wait and returns it as is.
    if (/from app\.payments where owner_kind/.test(text))
      return { rows: [{ id: "pay", route: t.route ?? "personal", status: "scheduled", chain_id: 84532, payer_safe: safe, token_address: token }], rowCount: 1 };
    if (/from app\.payment_processes/.test(text)) return { rows: [{ wake_at: null }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
  const reconciled: string[] = [], reads: { address: string; args: readonly string[]; blockNumber: bigint }[] = [];
  const db = {
    worker: { query: async (text: string) => {
      calls.push(`worker ${text.trim().split(/\s+/).slice(0, 4).join(" ")}`);
      if (/ponder\.indexer_progress/.test(text)) return { rows: [{ chain_id: 84532, indexed_block: String(t.indexed), indexed_block_hash: "0x01" }] };
      if (/indexer_observation/.test(text)) return { rows: [{ last_advance_at: new Date(Date.now() - t.advancedMsAgo) }] };
      throw new Error(`unexpected worker read: ${text}`);
    } },
    transaction: async (_org: string, run: (s: typeof sql) => Promise<unknown>) => { calls.push("transaction"); return run(sql); },
    ownerTransaction: async (_owner: unknown, run: (s: typeof sql) => Promise<unknown>) => { calls.push("ownerTransaction"); reconciled.push("x"); return run(sql); },
  } as unknown as Database;
  const work = paymentsWork(db, { ponder: origin, rpc: origin, chainId: 84532, finality: 2 }, async () => 1_767_225_600_000,
    async (input) => { reads.push(input); return 7_000_000n; });
  return { work, calls, reconciled, reads, close: () => new Promise<void>((done) => server.close(() => done())) };
}

test("Ponder's row reads ready but indexerState does not: the payments tick opens no transaction and reconciles nothing", async () => {
  for (const [label, t, reason] of [
    ["failing /ready", { ready: 503, chainHead: 100, indexed: 100, advancedMsAgo: 0, due: 3 }, /readiness endpoint/],
    ["stale head while the chain moves", { ready: 200, chainHead: 150, indexed: 100, advancedMsAgo: 120_000, due: 3 }, /not advanced/],
  ] as const) {
    const w = await world(t);
    try {
      const out = await w.work.tick();
      assert.match("skipped" in out ? out.skipped : "", reason, label);
      assert.deepEqual(w.calls.filter((c) => !c.startsWith("worker ")), [], `${label}: no wake, no work list, no reconcile`);
      assert.deepEqual(w.reconciled, [], label);
      assert.deepEqual(w.reads, [], `${label}: no balance read`);
    } finally { await w.close(); }
  }
});

test("a ready indexer lets the tick wake, list and reconcile each due Payment in its own owner transaction", async () => {
  const w = await world({ ready: 200, chainHead: 100, indexed: 100, advancedMsAgo: 0, due: 2 });
  try {
    assert.deepEqual(await w.work.tick(), { woken: 0, reconciled: 2, blocked: 0, failed: 0 });
    // Per Payment: a read of its row, then its reconcile, each in its own owner transaction.
    assert.deepEqual(w.calls.filter((c) => c === "transaction" || c === "ownerTransaction"),
      ["transaction", "transaction", "transaction", "ownerTransaction", "ownerTransaction", "ownerTransaction", "ownerTransaction"]);
    // A scheduled personal Payment's paying Safe balance is read at the finalized block (indexed 100 minus finality 2).
    assert.deepEqual(w.reads.map((r) => [r.address, r.args[0], r.blockNumber]), [[token, safe, 98n], [token, safe, 98n]]);
  } finally { await w.close(); }
});

test("a budget Payment needs no paying-Safe balance read", async () => {
  const w = await world({ ready: 200, chainHead: 100, indexed: 100, advancedMsAgo: 0, due: 1, route: "budget" });
  try {
    assert.deepEqual(await w.work.tick(), { woken: 0, reconciled: 1, blocked: 0, failed: 0 });
    assert.deepEqual(w.reads, []);
  } finally { await w.close(); }
});
