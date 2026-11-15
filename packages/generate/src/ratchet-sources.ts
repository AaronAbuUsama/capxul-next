// The repository's own ratchet lists and scorecard inputs, as ratchets.ts and scorecard.ts read them: the
// blueprint's registry and operations, the delta check's formats, lint's unmigrated lists, and the glossary's old
// words as generated/old-words.json counts them. That file is JSON, which only an entry or a test parses, so they hand
// its counts in. The toolkit imports nothing of the blueprint, so the lists are gathered here, beside the entries that
// read them.
import * as Blueprint from "@capxul/blueprint";
import { formats, Ratchets, type Layout, type ScorecardInputs } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { unmigrated } from "../../lint/src/door.ts";

const { operations, ratchets } = Blueprint;

/** The lists as they stand in the repository, given the committed counts of old-words.json. */
export const listsOf = (oldWords: Ratchets.Lists["oldWords"]): Ratchets.Lists => ({
  lint: unmigrated,
  formats: Rec.map(formats(Blueprint), (format) => format.unmigrated),
  oldWords,
});

/** Every ratchet of the blueprint's registry, counted now, given the committed counts of old-words.json. */
export const talliesOf = (oldWords: Ratchets.Lists["oldWords"]): ReadonlyArray<Ratchets.Tally> =>
  Ratchets.tally(ratchets, listsOf(oldWords));

/** The operations whose budget is still provisional. */
const provisional: ReadonlyArray<string> = Arr.filter(
  Rec.keys(operations),
  (name) => operations[name].budget.provisional,
);

/** The scorecard's inputs, over the blueprint's things as `layout` reads them and `tallies` counted. */
export const scorecardInputs = (layout: Layout, tallies: ReadonlyArray<Ratchets.Tally>): ScorecardInputs => ({
  layout,
  formats: formats(Blueprint),
  rawSchemaFiles: Rec.keys(unmigrated["owned-values"]),
  provisional,
  tallies,
});
