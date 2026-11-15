// The toolkit's one door: the language the blueprint is written in (a verb's declaration, a lifecycle, a promise, a
// starting point, how a generated index gathers its parts), the pure check of declared names, and how the blueprint's
// folders read as data. It imports nothing of the blueprint, which imports this door: what checks or renders the
// blueprint's own declarations (src/checks/formats.ts, src/checks/delta.ts, src/render/render.ts) imports the
// blueprint's door by its path and is reached only by this package's own entries and tests (README.md says why).
export {
  declare,
  declareOutcomes,
  eventNamesOf,
  isRefusal,
  outcome,
  refusalsOf,
  type Answered,
  type Budget,
  type Carried,
  type Emitted,
  type EventClass,
  type EventOf,
  type Expected,
  type Operation,
  type Outcome,
  type Several,
  type Single,
  type Unchecked,
  type Wait,
} from "./language/operation.ts";
export * as Machine from "./language/lifecycle.ts";
export {
  claim,
  dropped,
  kept,
  rewritten,
  type Claim,
  type ClaimsOf,
  type Dropped,
  type Origin,
} from "./language/promise.ts";
export { holdsFactsOf, type StartingWorld, type Step } from "./language/starting-point.ts";
export { gather, type Every } from "./language/gather.ts";
export { namesOf } from "./checks/declared-names.ts";
export {
  layoutOf,
  RESERVED,
  THING_FILES,
  verbAt,
  verbsOf,
  type Exports,
  type Layout,
  type Lifecycle,
  type Part,
  type Thing,
  type ThingFile,
  type Verb,
} from "./render/layout.ts";
