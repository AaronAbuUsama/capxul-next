// Acceptance claim 4 (../contract/README.md):
//
//   Export of a fresh world returns no entries.
//
// Nothing is appended. The export must answer (a failure is not "no entries") and its answer must hold an empty
// list of entries. A second export of the still untouched world must say the same.
import * as Effect from "effect/Effect";
import { expect, scenario } from "../runner/scenario.ts";
import { exported, show } from "./record.ts";

export default scenario(
  "claim 4: export of a fresh world returns no entries",
  Effect.gen(function* () {
    const entries = yield* exported;
    yield* expect(entries.length === 0, `export of a fresh world returned ${entries.length} entries, expected none: ${show(entries)}`);
    const again = yield* exported;
    yield* expect(again.length === 0, `a second export of the fresh world returned ${again.length} entries, expected none: ${show(again)}`);
  }),
);
