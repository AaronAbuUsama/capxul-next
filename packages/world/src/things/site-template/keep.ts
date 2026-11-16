// A world's company sites kept as a bench template (roadmap 1.17 and 1.18; docs/roadmap.md, "Bench templates never
// change"; src/things/site/reset.ts and src/things/site-template/sweep.ts): a runner that keeps one world for its run makes each starting
// world in it once, saves it as a snapshot and keeps its sites as a bench template, so a later reset whose point lost
// its sites claims them ready instead of building them. The template is named by the starting world, the code that
// made it and the world whose company facts it holds, so it is that world's alone. It is the bench's, never changed
// and never dropped by a run: the sweep removes it by age (`sweepTemplates`), long after the world is gone.
import { Pipeline } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { keepTemplate } from "../site/reset.ts";
import { templateName } from "./sweep.ts";
import { recordedOutput } from "../../stack/engine.ts";
import { nameOf } from "../../stack/names.ts";
import { WorldOutput } from "../world/handle.ts";
import { mustExist } from "../world/take-down.ts";

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
 * by the code `code` fingerprints (src/things/site-template/sweep.ts, `templateCode`). Answers the template's name, how long the
 * door took and whether it made it (false: this world had kept it already); nothing for a world with no bench.
 */
export const keepSitesAsTemplate = Effect.fn(Pipeline.siteSave.spans.template.name)(function* (
  name: string,
  snapshot: string,
  code: string,
) {
  const { stage, bench } = yield* benchOf(name);
  if (Option.isNone(bench)) return Option.none();
  const template = yield* templateName(snapshot, code, nameOf(stage));
  return Option.some(yield* keepTemplate(stage, bench.value, template, snapshot));
});
