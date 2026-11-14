// A world's company sites kept as a bench template, by the world's name (roadmap 1.17 and 1.18; src/site/Points.ts):
// a runner that keeps one world for its run makes each starting world in it once, saves it as a snapshot and keeps
// its sites as the bench's template of the starting world's name, so a later reset whose point lost its sites claims
// them ready instead of building them. The template is the bench's, not the world's: its destroy leaves it, so the
// runner drops it at its end.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { dropTemplate, keepTemplate } from "../site/Points.ts";
import { recordedOutput } from "../stack/engine.ts";
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

/** Keeps world `name`'s sites as the bench's template `template`; nothing for a world with no bench or no site. */
export const keepSitesAsTemplate = Effect.fn("world.template.keep")(function* (name: string, template: string) {
  const { stage, bench } = yield* benchOf(name);
  if (Option.isNone(bench)) return Option.none();
  return Option.some(yield* keepTemplate(stage, bench.value, template));
});

/** Drops the bench's template `template`, as world `name` on its bench; nothing for a world with no bench. */
export const dropSitesTemplate = Effect.fn("world.template.drop")(function* (name: string, template: string) {
  const { stage, bench } = yield* benchOf(name);
  if (Option.isNone(bench)) return;
  yield* dropTemplate(stage, bench.value, template);
});
