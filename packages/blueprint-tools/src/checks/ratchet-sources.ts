// The repository's own ratchet lists and scorecard inputs, as ratchets.ts and scorecard.ts read them: the
// blueprint's registry and operations, the delta check's formats, and lint's unmigrated lists. It imports the
// blueprint's and lint's doors by their paths (README.md says why), so the toolkit's own door never exports it.
import { operations, ratchets } from "../../../blueprint/src/index.ts";
import { unmigrated } from "../../../lint/src/door.ts";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Layout } from "../render/layout.ts";
import { formats } from "./formats.ts";
import { tally, type Lists, type Tally } from "./ratchets.ts";
import type { ScorecardInputs } from "./scorecard.ts";

/** The lists as they stand in the repository. */
export const lists: Lists = {
  lint: unmigrated,
  formats: Rec.map(formats, (format) => format.unmigrated),
};

/** Every ratchet of the blueprint's registry, counted now. */
export const tallies: ReadonlyArray<Tally> = tally(ratchets, lists);

/** The operations whose budget is still provisional. */
const provisional: ReadonlyArray<string> = Arr.filter(
  Rec.keys(operations),
  (name) => operations[name].budget.provisional,
);

/** The scorecard's inputs, over the blueprint's things as `layout` reads them. */
export const scorecardInputs = (layout: Layout): ScorecardInputs => ({
  layout,
  formats,
  rawSchemaFiles: Rec.keys(unmigrated["owned-values"]),
  provisional,
  tallies,
});
