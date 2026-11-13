// The handlers of every operation in the contract: one per operation, each a thin line over the concept that
// owns it (record.ts).
//
// `CoreRpcs.toLayer` takes one handler per declared operation: delete one and this file no longer compiles
// (README.md shows the error).
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { isSqlError, type SqlError } from "effect/sql/SqlError";
import { CoreRpcs } from "../contract/door.ts";
import { RecordStore, RecordStoreLive } from "./record.ts";

/**
 * A failure of the database, or a row that is not what the schema says, is not something a caller can act on and
 * is not a refusal the contract declares: the call dies with it, and the caller sees a defect with its name and
 * message. Only the operation's declared refusals stay in the error channel.
 */
const orDefect = <A, E, R>(self: Effect.Effect<A, E | SqlError | Schema.SchemaError, R>) =>
  self.pipe(Effect.catchIf((failure): failure is SqlError | Schema.SchemaError => isSqlError(failure) || Schema.isSchemaError(failure), Effect.die));

export const HandlersLive = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const record = yield* RecordStore;
    return {
      "record.append": (payload) => record.append(payload).pipe(orDefect),
      "record.export": () => record.entries.pipe(Effect.map((entries) => ({ entries })), orDefect),
    };
  }),
).pipe(Layer.provide(RecordStoreLive));
