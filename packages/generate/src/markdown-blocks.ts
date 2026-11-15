// Blocks inside hand-written Markdown files: the lines between `<!-- generated:<name> start -->` and
// `<!-- generated:<name> end -->` are the generator's, everything else is the file's own (docs/design/docs.md,
// section 5). Pure: the entry (main.ts) gives a way to read a file and list a folder, and settles what comes back.
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { GATE, PACKAGES, RULES } from "@capxul/lint";
import { renderDesignIndex, renderGate, renderPackages, renderRules } from "./docs-render.ts";
import { BLOCKS, type BlockName, DESIGN_INDEX } from "./sources.ts";

/** The two markers of a block. */
export const markers = (name: string) =>
  ({ start: `<!-- generated:${name} start -->`, end: `<!-- generated:${name} end -->` }) as const;

/** A file's text with one block's lines replaced, or why it cannot be. */
export type Replaced =
  | { readonly _tag: "Replaced"; readonly text: string }
  | { readonly _tag: "Unplaced"; readonly why: string };

const count = (text: string, marker: string): number => Str.split(text, marker).length - 1;

/**
 * The text with the lines between the block's markers replaced by a note naming its owner and the body. Each marker
 * must stand once, on a line of its own, the start before the end.
 */
export const replaceBlock = (text: string, name: string, from: string, body: string): Replaced => {
  const { start, end } = markers(name);
  if (count(text, start) !== 1 || count(text, end) !== 1)
    return { _tag: "Unplaced", why: `needs \`${start}\` and \`${end}\` once each, on lines of their own` };
  const [before, rest = ""] = Str.split(text, start);
  const [, after = ""] = Str.split(rest, end);
  if (!Str.includes(end)(rest)) return { _tag: "Unplaced", why: `\`${end}\` comes before \`${start}\`` };
  const note = `<!-- Written by \`pnpm generate\` from ${from}; never edit it. -->`;
  return { _tag: "Replaced", text: `${before}${start}\n${note}\n${body}\n${end}${after}` };
};

/** Each block's body, from its owner. */
const bodies: { readonly [name in BlockName]: string } = {
  packages: renderPackages(PACKAGES),
  gate: renderGate(GATE),
  "lint-rules": renderRules(RULES),
};

/** How the entry gives this module the disk: a file's text, and the names in a folder, by paths from the root. */
export interface Disk {
  readonly read: (path: string) => string;
  readonly list: (folder: string) => ReadonlyArray<string>;
}

/** Every Markdown file the docs' generator writes, whole, with its text; and every block it could not place. */
export const renderDocs = (disk: Disk) => {
  const files = Arr.dedupe(Arr.map(BLOCKS, (block) => block.file));
  const problems: Array<string> = [];
  const written = Arr.map(files, (path) => {
    const text = Arr.reduce(
      Arr.filter(BLOCKS, (block) => block.file === path),
      disk.read(path),
      (sofar, block) => {
        const replaced = replaceBlock(sofar, block.name, block.from, bodies[block.name]);
        if (replaced._tag === "Replaced") return replaced.text;
        problems.push(`${path}: the block "${block.name}" ${replaced.why}`);
        return sofar;
      },
    );
    return [path, text] as const;
  });
  const notes = Arr.filter(
    Arr.sort(disk.list(DESIGN_INDEX.folder), Str.Order),
    (name) => Str.endsWith(".md")(name) && name !== "README.md",
  );
  const index = renderDesignIndex(
    DESIGN_INDEX.from,
    Arr.map(notes, (name) => ({ name, text: disk.read(`${DESIGN_INDEX.folder}/${name}`) })),
  );
  return { written: [...written, [DESIGN_INDEX.path, index] as const], problems };
};
