// What a journey is handed: a typed client of Capxul, one function per blueprint operation, which calls a world's
// Core through its door. The SDK supplies it (`Sdk.layer(Capxul)`, roadmap step 1.9) and the runner records every call
// it makes. A journey never calls Core over HTTP itself, and never sees a trace id, a span or a timing: the runner
// keeps and checks those for every call.
import type { CallOptions, Chain, Errors, OperationName, operations, StartingWorld, Values } from "@capxul/blueprint";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/**
 * How one call is made: the blueprint's `CallOptions`. `{ as: "dana" }` acts as a person of the world's cast;
 * `{ operator: "second" }` signs in as the second operator; `{ at: view.door }` calls another world's door.
 */
export type { CallOptions };

/**
 * One function per operation, named as the blueprint names it, and the chain reads under `chain`. A call answers the
 * operation's success, or fails with one of its declared refusals, with `NotSignedIn` from sign-in, or with
 * `PayloadRejected` when its payload is not of its schema and so was never sent. A call that got no answer, or that
 * the server died in, is a defect: the journey cannot act on it, and the runner records the call as unanswered or
 * as a defect. A chain read answers its declared type or dies.
 */
export type CapxulClient = {
  readonly [Name in OperationName]: (
    payload: Rpc.PayloadConstructor<RpcOf<Name>>,
    options?: CallOptions,
  ) => Effect.Effect<Rpc.Success<RpcOf<Name>>, Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected>;
} & {
  /** Reads of a world's chain through its door's chain JSON-RPC: the journey's own world, or `at` another's. */
  readonly chain: Chain.Reader;
};

/** What `name` takes: its payload, as its client builds it. */
export type Payload<Name extends OperationName> = Rpc.PayloadConstructor<RpcOf<Name>>;

/** What a successful call of `name` answers. */
export type Success<Name extends OperationName> = Rpc.Success<RpcOf<Name>>;

/** What a call of `name` is refused with: one of its declared refusals, `NotSignedIn` or `PayloadRejected`. */
export type Refusal<Name extends OperationName> = Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected;

/** Anything a call through the door fails with: one of the blueprint's declared refusals. */
export type Failure = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Capxul, through the door of the world the journey runs in. */
export class Capxul extends Context.Service<Capxul, CapxulClient>()("@capxul/scenarios/client/Capxul") {}

/**
 * The starting world a journey was handed and its facts, as its maker kept them (encoded). A journey reads them with
 * `given` (expectation.ts), which decodes them with the starting world's own schema.
 */
export class Given extends Context.Service<
  Given,
  { readonly world: StartingWorld; readonly facts: Effect.Effect<unknown> }
>()("@capxul/scenarios/client/Given") {}

/**
 * Where a try hears the trace id of the call it makes. The client that records calls (the runner's) tells it, when a
 * try provides it, the trace id each operation call ran under: the trace Core writes the call's record entries,
 * spans and logs under. A client that does not leaves the try without one, and its checks judge as before (`ThisCall`).
 */
export class CallTraces extends Context.Service<
  CallTraces,
  { readonly heard: (trace: string) => Effect.Effect<void> }
>()("@capxul/scenarios/client/CallTraces") {}

/**
 * The call an operation's check judges: the trace id of every attempt the try made of it (a wait calls again), as the
 * client told the try, in order; none when it did not. A check judges what these attempts caused by them
 * (`support/world.ts`, `entriesOfCall`), so calls of other journeys made at the same time in the same world are not
 * its business, and an earlier attempt's side effect is not missed.
 */
export class ThisCall extends Context.Service<
  ThisCall,
  {
    readonly traces: ReadonlyArray<string>;
    /** What Core recorded under each trace, read in one batch after the try (`Observations`); null without it. */
    readonly observed: ReadonlyArray<Observed> | null;
  }
>()("@capxul/scenarios/client/ThisCall") {}

type Json = typeof Values.Json.Type;

/** One span Core recorded under a call's trace: a declared step's, or a library's (`postgres`, HTTP). */
export interface ObservedSpan {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  /** The span's status. A refusal leaves it unset and says `capxul.outcome` `refused` in its attributes. */
  readonly outcome: "ok" | "error" | "unset";
  /** When it started, in epoch milliseconds. */
  readonly startMs: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, Json>>;
}

/** One log Core wrote under a call's trace, such as the one where a refusal was decided. */
export interface ObservedLog {
  readonly level: string;
  readonly message: string;
  /** The span it was written in. */
  readonly spanId: string | null;
  /** Its declared fields. */
  readonly fields: Readonly<Record<string, Json>>;
  readonly atMs: number;
}

/** One entry of the world's record written under a call's trace. */
export interface ObservedEvent {
  readonly seq: number;
  readonly event: string;
  readonly carried: Json;
}

/** What Core recorded under one trace: its spans in start order, its logs and events in the order written. */
export interface Observed {
  readonly trace: string;
  /**
   * Whether the trace is whole: its operation's server span is in. A read answers incomplete rather than partial
   * after a short wait, and a check that needs it then fails as not observed, never judging part of a call.
   */
  readonly complete: boolean;
  readonly spans: ReadonlyArray<ObservedSpan>;
  readonly logs: ReadonlyArray<ObservedLog>;
  readonly events: ReadonlyArray<ObservedEvent>;
}

/**
 * The runner's read of what Core recorded under calls' traces, in one batch (roadmap step 4.11, observation from
 * telemetry): every trace asked has an entry. `who` reads another world's (a call `at` its door); left out, the run's
 * own. A read that fails is a defect, as a chain read's is. A run without it leaves the checks reading the world through
 * the operations, as before.
 */
export class Observations extends Context.Service<
  Observations,
  {
    readonly read: (
      traces: ReadonlyArray<string>,
      who?: Pick<CallOptions, "at" | "operator">,
    ) => Effect.Effect<ReadonlyMap<string, Observed>>;
  }
>()("@capxul/scenarios/client/Observations") {}

/**
 * Marks the calls a check makes to look at the world: what an operation's checks read before a call (`prepare`) and
 * every check's own reads (`holds`). A try provides it around those, never around the call under test, so the run can
 * retry a look whose transport failed without ever sending the call under test twice. The runner takes a call as a
 * look when this is present and `CallTraces` is not.
 */
export class Observing extends Context.Service<Observing, {}>()("@capxul/scenarios/client/Observing") {}
