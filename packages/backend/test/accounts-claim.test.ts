import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../src/platform/db.ts";
import type { TransitionEvent } from "../src/platform/outbox.ts";
import { observeClaim, type PersonalSafe } from "../src/accounts/door.ts";
import { IndexerError } from "../src/shared/door.ts";

// SQL boundary control, not native PG/Ponder/chain or selected-stack proof.
function fixture() {
  let setup: PersonalSafe = { person_id: "person-claim", email: "claim@example.test",
    safe_address: `0x${"1".repeat(40)}`, signer_address: `0x${"2".repeat(40)}`, status: "claiming", attempt: 1,
    claim_tx_hash: null, claimed_at: null, claimed_block: null, collect_approval_id: null, collected: 0,
    failure_code: null, created_at: 500, updated_at: 500 };
  const initial = { ...setup }, events: TransitionEvent[] = [];
  const projection: Record<string, unknown> = { chain_id: 31337, indexed_block: "100", indexed_block_hash: `0x${"3".repeat(64)}`,
    indexed_block_time: 20_000, head_block: "105", head_seen_at: 21_000, ready: true, build_id: "sql-control", updated_at: 21_000,
    owners: [setup.signer_address], threshold: 1, deployed: true, owner_updated_block: "98",
    claim_tx_hash: null, claim_block: null, claim_block_hash: null, claim_block_time: null };
  const sql = { async query(statement: string, params: unknown[] = []) {
    if (statement.startsWith("select * from app.personal_safes")) return { rows: [{ ...setup }] };
    if (statement.includes("from app.indexer_progress")) return { rows: [{ ...projection }] };
    if (statement.startsWith("update app.personal_safes")) {
      setup = { ...setup, status: "collecting", claim_tx_hash: params[1] as string,
        claimed_at: params[2] as number, claimed_block: params[3] as number, updated_at: params[4] as number };
      return { rows: [{ ...setup }] };
    }
    if (statement.startsWith("insert into app.transition_outbox")) {
      events.push(JSON.parse(params[1] as string)); return { rows: [] };
    }
    if (statement.startsWith("select event,")) return { rows: [{ event: events.at(-1), identical: true }] };
    throw new Error("unexpected SQL in claim boundary control");
  } } as Sql;
  return { sql, initial, projection, events, current: () => ({ ...setup }) };
}

test("sole ownership without a claim stays pending; indexed finality records occurrence identity, not observation head/time", async () => {
  const f = fixture(), config = { chainId: 31337, finalityDepth: 2 }, now = 90_000;
  assert.deepEqual(await observeClaim(f.sql, f.initial.person_id, config, "claim-control", now), f.initial);
  assert.deepEqual(f.current(), f.initial); assert.equal(f.events.length, 0);
  Object.assign(f.projection, { claim_tx_hash: `0x${"4".repeat(64)}`, claim_block: "99",
    claim_block_hash: `0x${"5".repeat(64)}`, claim_block_time: 12_345 });
  assert.deepEqual(await observeClaim(f.sql, f.initial.person_id, config, "claim-control", now), f.initial,
    "the occurrence exists but its finality has not reached the indexed cutoff");
  assert.equal(f.events.length, 0);
  f.projection.indexed_block = "101";
  const expected = { ...f.initial, status: "collecting", claim_tx_hash: `0x${"4".repeat(64)}`,
    claimed_at: 12_345, claimed_block: 99, updated_at: now };
  assert.deepEqual(await observeClaim(f.sql, f.initial.person_id, config, "claim-control", now), expected);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]!.props.transition, "claim"); assert.equal(f.events[0]!.at, now);
  assert.deepEqual(await observeClaim(f.sql, f.initial.person_id, config, "claim-control", now + 1), expected);
  assert.equal(f.events.length, 1);
});

test("unready claim provider refuses without changing setup or emitting a claim", async () => {
  const f = fixture();
  f.projection.ready = false;
  await assert.rejects(observeClaim(f.sql, f.initial.person_id, { chainId: 31337, finalityDepth: 2 }, "claim-control", 90_000),
    (error: unknown) => error instanceof IndexerError && error.code === "PROVIDER_ERROR");
  assert.deepEqual(f.current(), f.initial); assert.equal(f.events.length, 0);
});
