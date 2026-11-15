// The envelope (docs/design/blueprint.md, part 10): every attribute our own records carry, each declared once with its
// name, whether the name is an OpenTelemetry convention (pinned in ./conventions.ts) or ours under `capxul.`, its
// schema, where it is stamped and who stamps it. Conventions come first (decision T4): ours only where none fits.
// Producers import these names; nothing writes them as strings. Generated from it, later: the attribute constants,
// the collector's stamping and Axiom's field descriptions.
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

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

/** What caused the work: an agent's session, a CI run's or a person's sign-in. Opaque, as its producer writes it. */
export const SessionId = pattern(/^[A-Za-z0-9_.:-]{1,128}$/);
/** A commit, as its full hash. */
export const Revision = pattern(/^[0-9a-f]{40}$/);
/** A branch or tag's name. */
export const RefName = pattern(/^[A-Za-z0-9._/-]{1,255}$/);
/** A CI run, by its provider's id. */
export const PipelineRunId = pattern(/^[0-9]{1,20}$/);
/** An operation's or a piece of work's name, as the blueprint declares it. */
export const OperationName = pattern(/^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/);
/** An operation's version; 1 until operations carry versions (roadmap item 6.1). */
export const OperationVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/** How a call ended: a declared success, a declared refusal, or what nobody declared. */
export const Outcome = Schema.Literals(["ok", "refused", "error"]);
/** A refusal, by its tag. */
export const RefusalTag = pattern(/^[A-Z][A-Za-z]+$/);
/** The caller's role, as the blueprint's roles name it (roadmap item 5.1). */
export const CallerRole = pattern(/^[a-z][a-z-]*(\.[a-z][a-zA-Z-]*)?$/);
/** A declared budget, in milliseconds. */
export const BudgetMs = Schema.Int.check(Schema.isGreaterThan(0));
/** What a cost is for. */
export const CostSource = Schema.Literals(["cloudflare", "neon", "ci", "model"]);
/** An OpenTelemetry signal, or the typed events dataset. */
export const Signal = Schema.Literals(["traces", "logs", "metrics", "events"]);

/** Where an attribute is stamped. */
export type Where =
  | "every record"
  | "a run's records"
  | "an operation's span"
  | "a step's span"
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
    on: "an operation's span",
    setBy: "the operation's middleware",
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
