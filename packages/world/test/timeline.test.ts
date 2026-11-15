import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { timelineOf } from "../src/parts/indexer/timeline.ts";

const METRICS = `# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.
# TYPE process_start_time_seconds gauge
process_start_time_seconds 1000.5
ponder_historical_start_timestamp_seconds{chain="world"} 1004
ponder_historical_end_timestamp_seconds{chain="world"} 1010.25
ponder_database_method_duration_sum{service="admin",method="migrate"} 1500.4
ponder_database_method_duration_count{service="admin",method="migrate"} 3
ponder_database_method_duration_sum{service="sync",method="insert_blocks"} 400
ponder_database_method_duration_count{service="sync",method="insert_blocks"} 10
ponder_database_method_duration_sum{service="user",method="insert_blocks"} 100
ponder_database_method_duration_count{service="user",method="insert_blocks"} 2
ponder_rpc_request_duration_sum{chain="world",method="eth_getLogs"} 250
ponder_rpc_request_duration_count{chain="world",method="eth_getLogs"} 5
`;

describe("an index start's timeline, from Ponder's metrics", () => {
  test("every moment is counted from the accepted start, and the database's time is summed by method", () => {
    const timeline = timelineOf(METRICS, 999_000, 1_012_000);
    assert.deepStrictEqual(timeline, {
      processMs: 1500,
      syncStartMs: 5000,
      syncEndMs: 11250,
      readyMs: 13000,
      databaseMs: 2000,
      databaseCalls: 15,
      slowestDatabaseMethods: [
        { method: "migrate", ms: 1500, calls: 3 },
        { method: "insert_blocks", ms: 500, calls: 12 },
      ],
      rpcMs: 250,
      rpcCalls: 5,
    });
  });
  test("a moment Ponder has not reached, or a metric it does not give, is none", () => {
    const timeline = timelineOf('ponder_historical_end_timestamp_seconds{chain="world"} 0\n', 0, 10);
    assert.strictEqual(timeline.syncEndMs, null);
    assert.strictEqual(timeline.processMs, null);
    assert.strictEqual(timeline.databaseMs, null);
    assert.deepStrictEqual(timeline.slowestDatabaseMethods, []);
  });
});
