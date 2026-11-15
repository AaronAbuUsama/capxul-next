// The text of the blueprint's pipeline index (packages/blueprint/src/generated/pipeline.ts): every verb that is work
// no door serves, from its thing's folder as the toolkit reads it (`layoutOf`), and the names of the things that do
// only such work. Pure: main.ts writes the file. Written as oxfmt would format it.
import type { Exports, Layout } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import { exportFrom, first, key, moduleName, partOf, record } from "./blueprint-text.ts";

const exporting = (each: { readonly path: string; readonly exports: Exports }): ReadonlyArray<string> => [
  ...(each.exports.values.length > 0 ? [exportFrom(each.exports.values, `../things/${each.path}`)] : []),
  ...(each.exports.types.length > 0
    ? [
        exportFrom(
          Arr.map(each.exports.types, (type) => `type ${type}`),
          `../things/${each.path}`,
        ),
      ]
    : []),
];

export const pipelineHub = (layout: Layout): string => {
  const works = Arr.flatMap(layout.things, (thing) => thing.works);
  const own = Arr.filter(layout.things, (thing) => thing.works.length > 0 && thing.verbs.length === 0);
  const values = Arr.flatMap(own, (thing) => Option.toArray(partOf(thing, "values")));
  return Arr.join(
    [
      first("packages/blueprint/src/things") +
        "// The pipeline's own work (docs/design/blueprint.md, part 8): every verb that is work no door serves, by its\n" +
        "// name, and every name its things export for the package. No Rpc group holds any of it, so nothing serves it\n" +
        "// at run time and the API needs no handler for it.",
      ...Arr.map(works, (each) => `import * as ${moduleName(each.path)} from "../things/${each.path}";`),
      "",
      ...Arr.flatMap(values, exporting),
      ...Arr.flatMap(works, exporting),
      "",
      "/** Every piece of work no door serves, by its name. */",
      `export const work = ${record(Arr.map(works, (each) => [key(each.name), `${moduleName(each.path)}.${each.declaration}`]))} as const;`,
      "",
      "export type WorkName = keyof typeof work;",
      "",
    ],
    "\n",
  );
};
