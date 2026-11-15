// Every format an operation's declaration must have, by name (docs/roadmap.md, steps 3.5 and 3.10; docs/design/
// blueprint.md, part 14, part 1): `pnpm delta:check` fails an operation that lacks one, unless the blueprint lists it in
// that format's `unmigrated` list. The registry is built from the blueprint it is given (`formats(blueprint)`), so the
// toolkit imports nothing of the blueprint: the blueprint passes itself, its declarations and its lists, in.
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import { refusalsOf, type EventClass, type Operation } from "../language/operation.ts";
import type { ClaimsOf } from "../language/promise.ts";
import type { Format } from "./format.ts";
import { machineFormat, type Declared, type DomainShape, type MachineShape } from "./machine-format.ts";
import {
  allowedFormat,
  budgetFormat,
  logsFormat,
  promisesFormat,
  spansFormat,
  telemetryFormat,
  type Declarations,
} from "./operation-formats.ts";

/** The name of every format, in the order the scorecard shows them. */
export const FORMATS = ["machine", "allowed", "spans", "logs", "budget", "promises", "telemetry"] as const;

export type FormatName = (typeof FORMATS)[number];

/** One of the blueprint's domains, as the formats read it. */
export interface Domain {
  readonly operations: { readonly [operation: string]: Operation };
  readonly machines: { readonly [machine: string]: MachineShape };
  readonly stateless?: unknown;
}

/** What the formats read of the blueprint, which passes its door in. */
export interface Source {
  readonly domains: { readonly [folder: string]: Domain };
  readonly operations: { readonly [name: string]: Operation };
  readonly allClaims: { readonly [name: string]: ClaimsOf };
  /** Every role, declared once (roadmap item 5.1). */
  readonly roles: { readonly [role: string]: string };
  readonly StepKinds: { readonly STEP_KINDS: { readonly [kind: string]: string } };
  /** The refusals no handler decides: a payload its schema rejects, an operation not switched on yet. */
  readonly undecided: ReadonlyArray<EventClass>;
  /** Each format's `unmigrated` list: the existing operations allowed to lack it today. Each may only shrink. */
  readonly unmigrated: { readonly [format in FormatName]?: ReadonlyArray<string> };
}

const isReasons = (value: unknown): value is { readonly [operation: string]: string } =>
  Predicate.isReadonlyObject(value) && Arr.every(Rec.values(value), Predicate.isString);

/** The domain shape of one of the blueprint's domains. */
const shapeOf = (domain: Domain): DomainShape => ({
  operations: Rec.map(domain.operations, (operation) =>
    Arr.map(refusalsOf(operation), (refusal) => refusal.identifier),
  ),
  machines: domain.machines,
  stateless: isReasons(domain.stateless) ? domain.stateless : undefined,
});

/** Every format over `blueprint`, by name, each allowing its `unmigrated` list to lack it. */
export const formats = (blueprint: Source): { readonly [format in FormatName]: Format } => {
  const declared: Declared = Rec.map(blueprint.domains, shapeOf);
  const given: Declarations = {
    operations: blueprint.operations,
    roles: Rec.values(blueprint.roles),
    stepKinds: Rec.keys(blueprint.StepKinds.STEP_KINDS),
    promises: blueprint.allClaims,
    undecided: Arr.map(blueprint.undecided, (refusal) => refusal.identifier),
  };
  const listed = (format: FormatName): ReadonlyArray<string> => blueprint.unmigrated[format] ?? [];
  return {
    machine: machineFormat(declared, listed("machine")),
    allowed: allowedFormat(given, listed("allowed")),
    spans: spansFormat(given, listed("spans")),
    logs: logsFormat(given, listed("logs")),
    budget: budgetFormat(given, listed("budget")),
    promises: promisesFormat(given, listed("promises")),
    telemetry: telemetryFormat(given, listed("telemetry")),
  };
};
