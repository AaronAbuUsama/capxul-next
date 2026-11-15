// The formats an operation's own declaration meets (docs/design/blueprint.md, parts 9, 10 and 14, part 1; roadmap
// item 3.10), beside the machine format (./machine-format.ts): who may call it, its spans, its logs and the log of each
// refusal it decides, its budget, its promises, and its telemetry names. Each is a `Format` the delta check runs
// (./delta.ts). Pure: ./formats.ts gives each the blueprint's declarations and its `unmigrated` list.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { refusalsOf, type EventClass, type Operation, type Wait } from "../language/operation.ts";
import type { ClaimsOf } from "../language/promise.ts";
import type { Format } from "./format.ts";

/** The waits a budget may leave out: the toolkit's `Wait`, as values. */
export const WAITS: ReadonlyArray<Wait> = [
  "waking a parked world",
  "a person signing",
  "chain confirmation on a public chain",
];

/** What the operation formats read of the blueprint. */
export interface Declarations {
  readonly operations: { readonly [name: string]: Operation };
  /** Every role, declared once. */
  readonly roles: ReadonlyArray<string>;
  /** Every step kind a span may have. */
  readonly stepKinds: ReadonlyArray<string>;
  /** Each operation's promises, by its name. */
  readonly promises: { readonly [name: string]: ClaimsOf };
  /** The refusals no handler decides (a payload its schema rejects, an operation not switched on), by their tags. */
  readonly undecided: ReadonlyArray<string>;
}

/** A format over `given`, from what it finds missing in one operation's declaration. */
const formatOf = (
  given: Declarations,
  unmigrated: ReadonlyArray<string>,
  missing: (operation: Operation, name: string) => ReadonlyArray<string>,
): Format => ({
  missing: (name) =>
    Option.match(Option.fromNullishOr(given.operations[name]), {
      onNone: () => [`${name} is no operation`],
      onSome: (operation) => missing(operation, name),
    }),
  unmigrated,
});

/** The refusals of `operation` a handler decides. */
const decided = (given: Declarations, operation: Operation): ReadonlyArray<EventClass> =>
  Arr.filter(refusalsOf(operation), (refusal) => !Arr.contains(given.undecided, refusal.identifier));

/** Who may call: the roles it allows, each declared, and the refusal anyone else gets, one it declares, or null. */
export const allowedFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, (operation) => {
    if (operation.allowed === undefined) return ["it declares no `allowed`: the roles that may call it"];
    const others = operation.refusesOthers;
    return [
      ...(operation.allowed.length === 0 ? ["its `allowed` names no role"] : []),
      ...Arr.flatMap(operation.allowed, (role) =>
        Arr.contains(given.roles, role) ? [] : [`it allows ${role}, which is no declared role`],
      ),
      ...(others === undefined
        ? ["it declares no `refusesOthers`: the refusal a caller of no allowed role gets, or null"]
        : others !== null && !Arr.contains(refusalsOf(operation), others)
          ? [`it refuses others with ${others.identifier}, which it does not declare`]
          : []),
    ];
  });

/** Its spans: at least one, each named and of a kind. */
export const spansFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, (operation) =>
    operation.spans === undefined || Rec.size(operation.spans) === 0
      ? ["it declares no `spans`: the steps it takes, each of a kind"]
      : [],
  );

/** Its logs, each with a schema, and the log written where each refusal it decides is decided, one of its own. */
export const logsFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, (operation) => {
    if (operation.logs === undefined) return ["it declares no `logs`"];
    if (operation.refusals === undefined)
      return ["it declares no `refusals`: the log written where each refusal it decides is decided"];
    const logs = Rec.values(operation.logs);
    const deciding = operation.refusals;
    const tags = Arr.map(decided(given, operation), (refusal) => refusal.identifier);
    return [
      ...Arr.flatMap(tags, (tag) => {
        const log = deciding[tag];
        if (log === undefined) return [`no log is written where ${tag} is decided`];
        return Arr.contains(logs, log) ? [] : [`${tag}'s log is not one of its own logs`];
      }),
      ...Arr.flatMap(Rec.keys(deciding), (tag) =>
        Arr.contains(tags, tag) ? [] : [`a log for ${tag}, a refusal it does not decide`],
      ),
    ];
  });

/** Its budget: a target in milliseconds, its basis, and only waits left out. */
export const budgetFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, ({ budget }) => [
    ...(budget.ms > 0 ? [] : [`a budget of ${String(budget.ms)} ms`]),
    ...(Str.trim(budget.basis).length > 0 ? [] : ["a budget with no basis"]),
    ...Arr.flatMap(budget.excludes, (wait) => (Arr.contains(WAITS, wait) ? [] : [`it leaves out ${wait}, no wait`])),
  ]);

/** Its promises: at least one, and every refusal it decides named in one of them. */
export const promisesFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, (operation, name) =>
    Option.match(Option.fromNullishOr(given.promises[name]), {
      onNone: () => ["it has no promises"],
      onSome: (declared) => {
        const promised = Arr.flatMap(declared.claims, (each) => each.refusals);
        return [
          ...(declared.claims.length === 0 ? ["it promises nothing"] : []),
          ...Arr.flatMap(decided(given, operation), (refusal) =>
            Arr.contains(promised, refusal) ? [] : [`no promise names ${refusal.identifier}`],
          ),
        ];
      },
    }),
  );

/** Its telemetry names: each span of a declared step kind, and each span and log named under it. */
export const telemetryFormat = (given: Declarations, unmigrated: ReadonlyArray<string>): Format =>
  formatOf(given, unmigrated, (operation, name) => {
    const spans = Rec.values(operation.spans ?? {});
    const named = [
      ...Arr.map(spans, (each) => each.name),
      ...Arr.map(Rec.values(operation.logs ?? {}), (each) => each.name),
    ];
    return [
      ...Arr.flatMap(spans, (each) =>
        Arr.contains(given.stepKinds, each.kind) ? [] : [`${each.name} is of kind ${each.kind}, no step kind`],
      ),
      ...Arr.flatMap(named, (each) => (Str.startsWith(`${name}.`)(each) ? [] : [`${each} is not named under ${name}`])),
      ...Arr.flatMap(Arr.dedupe(named), (each) =>
        Arr.filter(named, (other) => other === each).length > 1 ? [`${each} is declared twice`] : [],
      ),
    ];
  });
