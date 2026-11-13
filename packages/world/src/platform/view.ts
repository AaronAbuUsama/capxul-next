// What the platform answers of a world, and the events it writes into a world's record. A world's view is put
// together from the shared state (its owner, its expiry, whether it is parked, its door) and its own database (its
// grade, contracts, parent, clock, record head, cast and companies). The events are the blueprint's own: what a
// successful call's operation declares it emits, computed by the declaration from the call (decisions.md, 6).
import { CurrentCall, operations, Values, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { PlatformFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { handle, WorldOutput } from "../lifecycle/parts.ts";
import { recordedOutput } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import { emit, readFacts, type JsonValue } from "./facts.ts";
import { noteCall } from "./store.ts";

const failed = (step: PlatformFailed["step"]) => (cause: unknown) =>
  PlatformFailed.make({ step, message: describeFailure(cause) });

const Recorded = Schema.Struct({ ...WorldOutput.fields, status: Schema.optional(Schema.String) });

/** A world's handle and what its stage recorded, from the shared state. */
export const opened = (stage: string) =>
  Effect.gen(function* () {
    const output = yield* Schema.decodeUnknownEffect(Recorded)(yield* recordedOutput(stage));
    return { output, world: yield* handle(output) };
  }).pipe(Effect.mapError(failed("facts")));

/** A world as world.show answers it, its clock read now. */
export const viewOf = Effect.fn("platform.view")(function* (stage: string) {
  const { output, world } = yield* opened(stage);
  const facts = yield* readFacts(world.database, yield* Clock.currentTimeMillis);
  const view: typeof Values.WorldView.Type = {
    world: nameOf(stage),
    owner: output.owner,
    grade: facts.grade,
    state: output.status === "parked" ? "parked" : "running",
    expiresAt: output.expiresAt,
    door: output.coreUrl,
    chainId: facts.chainId,
    contracts: facts.contracts,
    clock: facts.clock,
    recordHead: facts.recordHead,
    parent: facts.parent,
    cast: facts.cast,
    companies: facts.companies,
  };
  return { view, world, facts };
});

/** A JSON value as the platform writes it, or a fault: an event never carries a list. */
const asJson = (value: unknown): Effect.Effect<JsonValue, PlatformFailed> => {
  if (value === null || Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value))
    return Effect.succeed(value);
  if (Predicate.isObject(value) && !Arr.isArray(value))
    return Effect.map(
      Effect.forEach(Rec.toEntries({ ...value }), ([key, inner]) =>
        Effect.map(asJson(inner), (json) => [key, json] as const),
      ),
      (entries): JsonValue => Rec.fromEntries(entries),
    );
  return Effect.fail(failed("facts")(`an event cannot carry ${describeFailure(value)}`));
};

/**
 * Writes the events a successful call of `operation` declares into the record of the world it acted on, under the
 * call's trace, at the world's time, and notes the world against the trace for whoever checks the call.
 */
export const emitDeclared = Effect.fn("platform.emit")(function* (
  operation: OperationName,
  call: { readonly payload: unknown; readonly success: unknown },
  stage: string,
  database: Redacted.Redacted,
  atMs: number,
) {
  const current = yield* CurrentCall;
  const expected = yield* Effect.fromOption(operations[operation].expected(call)).pipe(
    Effect.mapError(() => failed("facts")(`the answer is no successful ${operation}`)),
  );
  const events = yield* Effect.forEach(expected, (each) =>
    Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Struct(Struct.omit(each.event.fields, ["_tag"]))))(
      each.carried,
    ).pipe(
      Effect.mapError(failed("facts")),
      Effect.flatMap(asJson),
      Effect.map((carried) => ({ event: each.event.identifier, carried })),
    ),
  );
  yield* emit(database, current, events, atMs);
  yield* noteCall(current.traceId, stage);
});
