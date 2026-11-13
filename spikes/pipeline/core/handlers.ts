// The handlers of every operation in the contract. THIS IS THE EMPTY IMPLEMENTATION: each operation dies as
// "not implemented", so the server compiles and deploys and does nothing. The builder replaces the bodies.
//
// `CoreRpcs.toLayer` takes one handler per declared operation: delete one and this file no longer compiles
// (README.md shows the error).
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CoreRpcs, type OperationName } from "../contract/door.ts";

/** The defect an operation with no implementation dies with. It reaches the caller with this name and message. */
export class NotImplemented extends Schema.TaggedError<NotImplemented>()("NotImplemented", {
  operation: Schema.String,
  message: Schema.String,
}) {}

const notImplemented = (operation: OperationName) =>
  Effect.die(new NotImplemented({ operation, message: `not implemented: ${operation}` }));

export const HandlersLive = CoreRpcs.toLayer({
  "record.append": () => notImplemented("record.append"),
  "record.export": () => notImplemented("record.export"),
});
