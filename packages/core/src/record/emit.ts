// What the chain operations write into the world's record, and the world's time they read: both the world's own
// (src/site-ops: `WorldRecord`, `WorldClock`), so every operation records alike and reads one clock.
import { operations, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { WorldClock } from "../site-ops/clock.ts";
import { WorldRecord } from "../site-ops/record.ts";

/** Writes every event `operation` declares for this success, each once, at the world's time now. */
export const emitDeclared = (operation: OperationName, payload: unknown, success: unknown) =>
  Effect.gen(function* () {
    const record = yield* WorldRecord;
    yield* record.emit(operations[operation], { payload, success });
  });

/** The world's time now, in epoch milliseconds. */
export const worldNow = Effect.gen(function* () {
  const clock = yield* WorldClock;
  const now = yield* clock.now;
  return { timestampMs: now.nowMs };
});
