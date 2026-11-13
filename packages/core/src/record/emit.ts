// A successful call's declared events, written into the world's record (`app.events`, decisions.md, 8) under the
// call's trace: exactly what the operation's declaration computes from what was sent and what is answered, so the
// record and the declaration cannot disagree. Call it inside the transaction that makes the change it reports.
import { CurrentCall, operations, type OperationName } from "@capxul/blueprint";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as PgClient from "@effect/sql-pg/PgClient";

/** Writes every event `operation` declares for this success, each once. A success its declaration cannot read dies. */
export const emitDeclared = Effect.fn("record.emit")(function* (
  operation: OperationName,
  payload: unknown,
  success: unknown,
) {
  const call = yield* CurrentCall;
  const sql = yield* PgClient.PgClient;
  const expected = operations[operation].expected({ payload, success });
  if (Option.isNone(expected)) return yield* Effect.die(`${operation} answered what its declaration cannot read`);
  const declared = expected.value;
  const at = yield* Clock.currentTimeMillis;
  const rows = yield* Effect.forEach(declared, (each) =>
    Effect.map(
      Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Struct(Struct.omit(each.event.fields, ["_tag"]))))(
        each.carried,
      ),
      (carried) => ({
        trace_id: call.traceId,
        operation,
        event: each.event.identifier,
        payload: sql.json(carried),
        at_ms: at,
      }),
    ),
  ).pipe(Effect.orDie);
  yield* Effect.forEach(rows, (row) => sql`insert into app.events ${sql.insert(row)}`, { discard: true }).pipe(
    Effect.orDie,
  );
  return yield* Effect.void;
});
