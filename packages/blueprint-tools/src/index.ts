// The toolkit's one door: the language the blueprint is written in (a verb, a refusal, an event, work no door serves,
// a lifecycle, a promise, a starting point, a ratchet, how a generated index gathers its parts), the checks (the
// formats and the delta check, declared names, old words, ratchets and the scorecard), the pages it renders, and how
// the blueprint's folders read as data. It imports nothing of the blueprint, which imports this door: the blueprint
// passes itself to what checks or renders it (`formats(blueprint)`, `renderPages(layout, blueprint)`), from its own
// tests and from packages/generate's entries.
export {
  verb,
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
  type Formats,
  type Operation,
  type Outcome,
  type Several,
  type Single,
  type Unchecked,
  type Wait,
} from "./language/operation.ts";
export { event, kindOf, refusal, type ExitCode, type Kind } from "./language/kinds.ts";
export type { Counter, Ratchet } from "./language/ratchet.ts";
export * as Machine from "./language/lifecycle.ts";
export {
  claim,
  dropped,
  kept,
  promise,
  promisesOf,
  rewritten,
  type Claim,
  type ClaimsOf,
  type Dropped,
  type Origin,
  type PromisesOf,
} from "./language/promise.ts";
export { holdsFactsOf, type StartingWorld, type Step } from "./language/starting-point.ts";
export {
  log,
  logsOf,
  shareTotal,
  span,
  spansOf,
  work,
  type Log,
  type Share,
  type Span,
  type Work,
  type WorkDeclaration,
} from "./language/work.ts";
export { gather, type Every } from "./language/gather.ts";
export {
  code,
  keyOf,
  oldWordOf,
  uncounted,
  words,
  type Code,
  type Entry,
  type Exception,
  type OldWord,
  type Scope,
  type Uncounted,
  type Words,
} from "./language/glossary.ts";
export { countOldWords, grown, OLD_WORDS, whereOf, type Counts } from "./checks/old-words.ts";
export * as Ratchets from "./checks/ratchets.ts";
export { renderScorecard, type ScorecardInputs } from "./checks/scorecard.ts";
export { wordFiles, type Disk } from "./checks/word-files.ts";
export { renderGlossary } from "./render/glossary.ts";
export { namesOf } from "./checks/declared-names.ts";
export { deltaCheck, type DeltaInputs, type Finding } from "./checks/delta.ts";
export type { Format, Stray } from "./checks/format.ts";
export { FORMATS, formats, type Domain, type FormatName, type Source } from "./checks/formats.ts";
export { WAITS } from "./checks/operation-formats.ts";
export { renderPages, type Pages, type Rendered } from "./render/render.ts";
export {
  layoutOf,
  RESERVED,
  THING_FILES,
  verbAt,
  verbsOf,
  worksOf,
  type Exports,
  type Layout,
  type Lifecycle,
  type Part,
  type Thing,
  type ThingFile,
  type Verb,
  type WorkVerb,
} from "./render/layout.ts";
