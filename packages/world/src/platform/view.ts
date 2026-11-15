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
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { PlatformFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { handle, WorldOutput } from "../lifecycle/handle.ts";
import type { World } from "../lifecycle/spec.ts";
import { recordedOutput } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import { emit, readFacts, type JsonValue } from "./facts.ts";
import { tokenOf } from "./operators.ts";
import { noteCall } from "./store.ts";

const failed = (step: PlatformFailed["step"]) => (cause: unknown) =>
  PlatformFailed.make({ step, message: describeFailure(cause) });

/** What a world's stage records, with its status (`parked`, or what is left of a take-down that did not finish). */
export const Recorded = Schema.Struct({ ...WorldOutput.fields, status: Schema.optional(Schema.String) });

/** A world's state as world.show answers it, from what its stage records. */
export const stateOf = (output: typeof Recorded.Type) => (output.status === "parked" ? "parked" : "running");

/** What a caller of `opened` may already hold: the world's handle, or what its stage records, read just now. */
export interface Given {
  readonly known?: World;
  readonly recorded?: unknown;
}

/** A world's handle and what its stage recorded, from the shared state (read once, unless the caller just read it). */
export const opened = (stage: string, given: Given = {}) =>
  Effect.gen(function* () {
    const recorded = given.recorded === undefined ? yield* recordedOutput(stage) : given.recorded;
    const output = yield* Schema.decodeUnknownEffect(Recorded)(recorded);
    return { output, world: given.known ?? (yield* handle(output)) };
  }).pipe(Effect.mapError(failed("facts")));

/** How a world was made, as its record's latest `world_created` says, or as the call making it now will say. */
export interface Born {
  readonly grade: typeof Values.Grade.Type;
  readonly parent: typeof Values.Parent.Type | null;
}

const Companies = Schema.Struct({ companies: Schema.Array(Values.Company) });

/**
 * The world's companies as its Core reads them (`GET /companies`, packages/core src/platform/companies.ts): Core's
 * `companiesOf`, which also moves each company's site on towards ready. A Core that does not answer so leaves the
 * companies as the world's database holds them, with a warning.
 */
const companiesThroughCore = (door: string, owner: string, held: ReadonlyArray<typeof Values.Company.Type>) =>
  Effect.gen(function* () {
    const token = yield* tokenOf(owner);
    if (Option.isNone(token)) return held;
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(`${door}/companies`).pipe(HttpClientRequest.bearerToken(Redacted.value(token.value))),
    );
    if (response.status !== 200) return yield* Effect.fail(`Core answered ${response.status}`);
    const answer = yield* HttpClientResponse.schemaBodyJson(Companies)(response);
    return answer.companies;
  }).pipe(
    Effect.scoped,
    Effect.catch((error) =>
      Effect.as(Effect.logWarning(`${door}: the companies as Core reads them: ${describeFailure(error)}`), held),
    ),
  );

/**
 * A world as world.show answers it, its clock read now. Its grade and parent are what its record's latest
 * `world_created` carried; `making` gives them for a world whose `world_created` is still to be written.
 */
export const viewOf = Effect.fn("platform.view")(function* (stage: string, making: Partial<Born> = {}, given?: Given) {
  const { output, world } = yield* opened(stage, given);
  const facts = yield* readFacts(world.database, yield* Clock.currentTimeMillis);
  const grade = making.grade ?? facts.born?.grade;
  const parent = making.parent === undefined ? (facts.born?.parent ?? null) : making.parent;
  if (grade === undefined) return yield* failed("facts")(`${stage}'s record holds no world_created`);
  const companies = Arr.isReadonlyArrayEmpty(facts.companies)
    ? facts.companies
    : yield* companiesThroughCore(output.coreUrl, output.owner, facts.companies);
  const view: typeof Values.WorldView.Type = {
    world: nameOf(stage),
    owner: output.owner,
    grade,
    state: stateOf(output),
    expiresAt: output.expiresAt,
    door: output.coreUrl,
    chainId: facts.chainId,
    contracts: facts.contracts,
    clock: facts.clock,
    recordHead: facts.recordHead,
    parent,
    cast: facts.cast,
    companies,
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
