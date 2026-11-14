// A world's company sites kept as a bench template (roadmap 1.17 and 1.18; docs/roadmap.md, "Bench templates never
// change"; src/site/Points.ts and src/site/Templates.ts): a runner that keeps one world for its run makes each starting
// world in it once, saves it as a snapshot and keeps its sites as a bench template, so a later reset whose point lost
// its sites claims them ready instead of building them. The template is named by the starting world, the code that
// made it and the world whose company facts it holds, so it is that world's alone. It is the bench's, never changed
// and never dropped by a run: the sweep removes it by age (`sweepTemplates`), long after the world is gone.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { keepTemplate } from "../site/Points.ts";
import { templateName } from "../site/Templates.ts";
import { recordedOutput } from "../stack/engine.ts";
import { nameOf } from "../stack/names.ts";
import { WorldOutput } from "./parts.ts";
import { mustExist } from "./world.ts";

/** The bench world `name` was made with; none when it has no bench. */
const benchOf = (name: string) =>
  Effect.gen(function* () {
    const stage = yield* mustExist(name);
    const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(stage));
    const bench = output.bench ?? "none";
    return { stage, bench: bench === "none" ? Option.none<string>() : Option.some(bench) };
  });

/**
 * Keeps world `name`'s sites, as its snapshot `snapshot` holds them, as the bench template of that starting world made
 * by the code `code` fingerprints (src/site/Templates.ts, `templateCode`). Answers the template's name, how long the
 * door took and whether it made it (false: this world had kept it already); nothing for a world with no bench.
 */
export const keepSitesAsTemplate = Effect.fn("world.template.keep")(function* (
  name: string,
  snapshot: string,
  code: string,
) {
  const { stage, bench } = yield* benchOf(name);
  if (Option.isNone(bench)) return Option.none();
  const template = yield* templateName(snapshot, code, nameOf(stage));
  return Option.some(yield* keepTemplate(stage, bench.value, template, snapshot));
});
