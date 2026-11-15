// The repository's own ratchet lists and scorecard inputs, as ratchets.ts and scorecard.ts read them: the
// blueprint's registry and operations, the delta check's formats, lint's unmigrated lists, and the glossary's old
// words as generated/old-words.json counts them. That file is JSON, which only an entry or a test parses, so they hand
// its counts in. It imports the blueprint's and lint's doors by their paths (README.md says why), so the toolkit's own
// door never exports it.
import { operations, ratchets } from "../../../blueprint/src/index.ts";
import { unmigrated } from "../../../lint/src/door.ts";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Layout } from "../render/layout.ts";
import { formats } from "./formats.ts";
import { tally, type Lists, type Tally } from "./ratchets.ts";
import type { ScorecardInputs } from "./scorecard.ts";

/** The lists as they stand in the repository, given the committed counts of old-words.json. */
export const listsOf = (oldWords: Lists["oldWords"]): Lists => ({
  lint: unmigrated,
  formats: Rec.map(formats, (format) => format.unmigrated),
  oldWords,
});

/** Every ratchet of the blueprint's registry, counted now, given the committed counts of old-words.json. */
export const talliesOf = (oldWords: Lists["oldWords"]): ReadonlyArray<Tally> => tally(ratchets, listsOf(oldWords));

/** The operations whose budget is still provisional. */
const provisional: ReadonlyArray<string> = Arr.filter(
  Rec.keys(operations),
  (name) => operations[name].budget.provisional,
);

/** The scorecard's inputs, over the blueprint's things as `layout` reads them and `tallies` counted. */
export const scorecardInputs = (layout: Layout, tallies: ReadonlyArray<Tally>): ScorecardInputs => ({
  layout,
  formats,
  rawSchemaFiles: Rec.keys(unmigrated["owned-values"]),
  provisional,
  tallies,
});
