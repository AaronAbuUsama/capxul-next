// The envelope (docs/design/blueprint.md, part 10): every attribute our own records carry, each declared once with its
// name, whether the name is an OpenTelemetry convention (pinned in ./conventions.ts) or ours under `capxul.`, its
// schema, where it is stamped and who stamps it. Conventions come first (decision T4): ours only where none fits.
// Producers import these names; nothing writes them as strings. Generated from it, later: the attribute constants,
// the collector's stamping and Axiom's field descriptions. The values they carry are in ./values.ts, re-exported here.
//
// Settled by part 10: the session is the convention `session.id` (not `capxul.session`); a run's shard is
// `capxul.lane` (the decision's name; the glossary's word for it is shard). A refusal is not an error: it leaves the
// span's status unset, with `capxul.outcome` "refused" and `capxul.refusal` its tag; only what nobody declared sets
// ERROR.
import * as Schema from "effect/Schema";
import { Grade, TraceId, WorldName } from "../common/values.ts";
import { CheckLayer, CheckName } from "../things/check/values.ts";
import { StageName } from "../things/cluster/values.ts";
import { JourneyName, JourneyStep } from "../things/journey/values.ts";
import { RatchetName } from "../things/ratchet/values.ts";
import { RunId, Shard, Trusted } from "../things/run/values.ts";
import { StepKindValue } from "./step-kinds.ts";

import {
  BlockRef,
  BudgetMs,
  CallerRole,
  CostSource,
  OperationName,
  OperationVersion,
  Outcome,
  PipelineRunId,
  RefName,
  RefusalTag,
  Revision,
  RpcMethod,
  RpcSystem,
  SessionId,
  Signal,
} from "./values.ts";

export * from "./values.ts";

/** Where an attribute is stamped. */
export type Where =
  | "every record"
  | "a run's records"
  | "an operation's span"
  | "a step's span"
  | "an operation's or a step's span"
  | "a check's span"
  | "a metric";

/** One attribute of the envelope. */
export interface Attribute<S extends Schema.Top = Schema.Top> {
  readonly name: string;
  /** True for an OpenTelemetry convention of the pinned version; false for ours, under `capxul.`. */
  readonly convention: boolean;
  readonly schema: S;
  readonly on: Where;
  readonly setBy: string;
  /** A value it may carry: the tests decode it. */
  readonly example: S["Type"];
}

const attribute = <S extends Schema.Top>(declared: Attribute<S>): Attribute<S> => declared;

/** Every attribute, by a short name code uses (`Envelope.attributes.world.name`). */
export const attributes = {
  session: attribute({
    name: "session.id",
    convention: true,
    schema: SessionId,
    on: "every record",
    setBy: "the caller's resource, checked by the collector against its token",
    example: "session_01S8RF7AbsFiiHrsq8oCPyuv",
  }),
  grade: attribute({
    name: "deployment.environment.name",
    convention: true,
    schema: Grade,
    on: "every record",
    setBy: "the collector",
    example: "private",
  }),
  world: attribute({
    name: "capxul.world",
    convention: false,
    schema: WorldName,
    on: "every record",
    setBy: "the collector",
    example: "town",
  }),
  stage: attribute({
    name: "capxul.stage",
    convention: false,
    schema: StageName,
    on: "every record",
    setBy: "the collector",
    example: "staging",
  }),
  run: attribute({
    name: "capxul.run",
    convention: false,
    schema: RunId,
    on: "a run's records",
    setBy: "the runner, carried in baggage",
    example: "ci-19384756",
  }),
  lane: attribute({
    name: "capxul.lane",
    convention: false,
    schema: Shard,
    on: "a run's records",
    setBy: "the runner, carried in baggage",
    example: 1,
  }),
  journey: attribute({
    name: "capxul.journey",
    convention: false,
    schema: JourneyName,
    on: "a run's records",
    setBy: "the runner, carried in baggage",
    example: "found-northwind",
  }),
  journeyStep: attribute({
    name: "capxul.journey.step",
    convention: false,
    schema: JourneyStep,
    on: "a run's records",
    setBy: "the runner, carried in baggage",
    example: 3,
  }),
  trusted: attribute({
    name: "capxul.run.trusted",
    convention: false,
    schema: Trusted,
    on: "a run's records",
    setBy: "the runner, carried in baggage: true only in CI",
    example: false,
  }),
  revision: attribute({
    name: "vcs.ref.head.revision",
    convention: true,
    schema: Revision,
    on: "every record",
    setBy: "each producer, from its deploy",
    example: "f075d08f075d08f075d08f075d08f075d08f075d",
  }),
  ref: attribute({
    name: "vcs.ref.head.name",
    convention: true,
    schema: RefName,
    on: "every record",
    setBy: "each producer, from its deploy",
    example: "slice/blueprint",
  }),
  pipelineRun: attribute({
    name: "cicd.pipeline.run.id",
    convention: true,
    schema: PipelineRunId,
    on: "every record",
    setBy: "the gate and the runner, in CI",
    example: "43710528109",
  }),
  operation: attribute({
    name: "capxul.operation",
    convention: false,
    schema: OperationName,
    on: "an operation's span",
    setBy: "the operation's middleware",
    example: "invitation.accept",
  }),
  operationVersion: attribute({
    name: "capxul.operation.version",
    convention: false,
    schema: OperationVersion,
    on: "an operation's span",
    setBy: "the operation's middleware",
    example: 1,
  }),
  outcome: attribute({
    name: "capxul.outcome",
    convention: false,
    schema: Outcome,
    on: "an operation's or a step's span",
    setBy: "Core: the operation's middleware on the operation's span, `KeepingSpan.end` on each step's",
    example: "refused",
  }),
  refusal: attribute({
    name: "capxul.refusal",
    convention: false,
    schema: RefusalTag,
    on: "an operation's span",
    setBy: "the operation's middleware",
    example: "InvitationClosed",
  }),
  callerRole: attribute({
    name: "capxul.caller.role",
    convention: false,
    schema: CallerRole,
    on: "an operation's span",
    setBy: "the operation's middleware",
    example: "person.theInvitee",
  }),
  budget: attribute({
    name: "capxul.budget.ms",
    convention: false,
    schema: BudgetMs,
    on: "an operation's span",
    setBy: "the operation's middleware, from its declared budget",
    example: 300,
  }),
  stepKind: attribute({
    name: "capxul.step.kind",
    convention: false,
    schema: StepKindValue,
    on: "a step's span",
    setBy: "Step.fn, from the declared span",
    example: "database",
  }),
  check: attribute({
    name: "capxul.check",
    convention: false,
    schema: CheckName,
    on: "a check's span",
    setBy: "the checks",
    example: "check.call.events",
  }),
  checkLayer: attribute({
    name: "capxul.check.layer",
    convention: false,
    schema: CheckLayer,
    on: "a check's span",
    setBy: "the checks",
    example: "run time",
  }),
  trace: attribute({
    name: "capxul.trace",
    convention: false,
    schema: TraceId,
    on: "a metric",
    setBy: "the collector, on its own counts",
    example: "4bf92f3577b34da6a3ce929d0e0e4736",
  }),
  ratchet: attribute({
    name: "capxul.ratchet",
    convention: false,
    schema: RatchetName,
    on: "a metric",
    setBy: "ratchet.count",
    example: "R6",
  }),
  costSource: attribute({
    name: "capxul.cost.source",
    convention: false,
    schema: CostSource,
    on: "a metric",
    setBy: "the cost job",
    example: "neon",
  }),
  rpcSystem: attribute({
    name: "rpc.system",
    convention: true,
    schema: RpcSystem,
    on: "a step's span",
    setBy: "the runner, on each chain read a journey makes (journey.run.chain)",
    example: "jsonrpc",
  }),
  rpcMethod: attribute({
    name: "rpc.method",
    convention: true,
    schema: RpcMethod,
    on: "a step's span",
    setBy: "the runner, on each chain read a journey makes (journey.run.chain)",
    example: "eth_getLogs",
  }),
  chainBlockFrom: attribute({
    name: "capxul.chain.block.from",
    convention: false,
    schema: BlockRef,
    on: "a step's span",
    setBy: "the runner, on a chain read of logs (`eth_getLogs`): its range's first block",
    example: "0x2dad0c4",
  }),
  chainBlockTo: attribute({
    name: "capxul.chain.block.to",
    convention: false,
    schema: BlockRef,
    on: "a step's span",
    setBy: "the runner, on a chain read of logs (`eth_getLogs`): its range's last block",
    example: "latest",
  }),
  signal: attribute({
    name: "capxul.signal",
    convention: false,
    schema: Signal,
    on: "a metric",
    setBy: "the collector, on its own counts",
    example: "traces",
  }),
};

export type AttributeKey = keyof typeof attributes;
