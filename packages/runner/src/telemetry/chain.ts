// The chain reads a journey makes (roadmap 4.7): every JSON-RPC request the scenarios' `capxul.chain` sends to a
// world's chain, each in a span of its own (`journey.run.chain`) with its method and, for `eth_getLogs`, its block
// range, and each heard by the step it was made in (`ChainReads`, provided by steps.ts), so a step's record shows
// where its chain time went. The reads are not operations: no span of Core's, no event, nothing the generic checks
// judge. The SDK sends them (packages/sdk, `ReachDoors`); the client wraps what it reaches with `recordedRpc`.
import { Envelope, Pipeline } from "@capxul/blueprint";
import type * as Sdk from "@capxul/sdk";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { stepOptions } from "./step.ts";

const SPAN = Pipeline.journeyRun.spans.chain;
const ATTRIBUTES = Envelope.attributes;

/** One chain read as a step's record keeps it: its method, its block range for a read of logs, its time, its outcome. */
export const ChainRead = Schema.Struct({
  method: Envelope.RpcMethod,
  from: Schema.NullOr(Envelope.BlockRef),
  to: Schema.NullOr(Envelope.BlockRef),
  ms: Envelope.TookMs,
  /** `ok` when an answer came back; `error` when the read died. */
  outcome: Envelope.Outcome,
});
export type ChainRead = typeof ChainRead.Type;

/** Where a chain read is heard: the step open when it was made. Without it, a read is only its span. */
export class ChainReads extends Context.Service<
  ChainReads,
  { readonly heard: (read: ChainRead) => Effect.Effect<void> }
>()("@capxul/runner/telemetry/chain/ChainReads") {}

/** The block range of an `eth_getLogs`, as its filter names it; none for any other method. */
export const rangeOf = (
  method: string,
  params: ReadonlyArray<unknown>,
): { readonly from: string | null; readonly to: string | null } => {
  const filter = params[0];
  if (method !== "eth_getLogs" || !Predicate.isObject(filter)) return { from: null, to: null };
  const block = (key: string) =>
    Predicate.hasProperty(filter, key) && Predicate.isString(filter[key]) ? filter[key] : null;
  return { from: block("fromBlock"), to: block("toBlock") };
};

/** One JSON-RPC request through `rpc`, in its span, heard by the open step. */
const read = Effect.fn(
  SPAN.name,
  stepOptions(SPAN),
)(function* (rpc: Sdk.JsonRpc, method: string, params: ReadonlyArray<unknown>) {
  const range = rangeOf(method, params);
  yield* Effect.annotateCurrentSpan({
    [ATTRIBUTES.rpcSystem.name]: "jsonrpc",
    [ATTRIBUTES.rpcMethod.name]: method,
    ...(range.from === null ? {} : { [ATTRIBUTES.chainBlockFrom.name]: range.from }),
    ...(range.to === null ? {} : { [ATTRIBUTES.chainBlockTo.name]: range.to }),
  });
  const [took, exit] = yield* rpc(method, params).pipe(Effect.exit, Effect.timed);
  const reads = yield* Effect.serviceOption(ChainReads);
  if (Option.isSome(reads))
    yield* reads.value.heard({
      method,
      ...range,
      ms: Duration.toMillis(took),
      outcome: Exit.isSuccess(exit) ? "ok" : "error",
    });
  return yield* exit;
});

/** `rpc`, each request recorded: its span, and the open step's record. */
export const recordedRpc =
  (rpc: Sdk.JsonRpc): Sdk.JsonRpc =>
  (method, params) =>
    read(rpc, method, params);
