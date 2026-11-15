// The blueprint's layout, locked (docs/design/blueprint.md, part 13): every file under src/ is where the layout puts
// it, and markdown lives only in generated/ and docs/. A file that does not fit fails here, so new work lands in place
// without anyone deciding where. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

const ROOT = new URL("../", import.meta.url);
/** Every file under `folder` of the package, by its path from there (a folder's name holds no dot). */
const filesUnder = (folder: string): ReadonlyArray<string> =>
  Arr.filter(readdirSync(new URL(folder, ROOT), { recursive: true, encoding: "utf8" }), (path) =>
    /\.[a-z]+$/.test(path),
  );

/** The files a thing's folder may hold beside its verbs; `examples.ts` until stage 2b folds it into the verbs. */
const THING_FILES = ["values.ts", "events.ts", "refusals.ts", "lifecycle.ts", "examples.ts"];

/** The fixed files of src/, by folder. `things/` and `generated/` are checked by their own rules. */
const FIXED: { readonly [folder: string]: ReadonlyArray<string> } = {
  "": ["index.ts", "glossary.ts"],
  "common/": ["values.ts", "ids.ts", "refusals.ts", "site.ts", "chain/chain.ts", "chain/logs.ts", "chain/reads.ts"],
  "starting-points/": ["points.ts", "facts.ts"],
  "protocol/": ["paths.ts", "headers.ts", "sign-in.ts", "trace.ts"],
};

/** Why a file under src/ does not fit the layout, or null when it does. */
const misfit = (file: string): string | null => {
  const text = (): string => readFileSync(new URL(`src/${file}`, ROOT), "utf8");
  if (Str.startsWith("things/")(file)) {
    const parts = Str.split(file, "/");
    if (parts.length !== 3) return "a thing is one folder of files, things/<thing>/<file>";
    const name = parts[2] ?? "";
    if (Arr.contains(THING_FILES, name)) return null;
    if (!/^[a-z][a-z-]*\.ts$/.test(name)) return "a verb's file is named by its verb, in lower case";
    return Str.split(text(), "Rpc.make(").length === 2 ? null : "a verb's file declares exactly one operation";
  }
  if (Str.startsWith("generated/")(file))
    return /^generated\/[a-z-]+\.ts$/.test(file) && Str.startsWith("// Generated")(text())
      ? null
      : "src/generated/ holds only files `pnpm generate` writes, each saying so in its first line";
  for (const [folder, names] of Rec.toEntries(FIXED))
    if (Str.startsWith(folder)(file) && Arr.contains(names, Str.slice(folder.length)(file))) return null;
  return "src/ holds index.ts, glossary.ts, things/, common/, starting-points/, protocol/ and generated/, each with its own files";
};

test("every file under src/ fits the layout", () => {
  const misfits = Arr.flatMap(filesUnder("src/"), (file) => {
    const why = misfit(file);
    return why === null ? [] : [`src/${file}: ${why}`];
  });
  assert.deepEqual(misfits, []);
});

test("markdown lives only in generated/ and docs/, besides the README", () => {
  const markdown = Arr.filter(
    [...filesUnder("src/"), ...Arr.map(filesUnder("test/"), (file) => `test/${file}`)],
    (file) => Str.endsWith(".md")(file),
  );
  assert.deepEqual(markdown, []);
  const top = Arr.filter(readdirSync(ROOT), (name) => Str.endsWith(".md")(name));
  assert.deepEqual(top, ["README.md"]);
});

test("the layout's own folders are all there", () => {
  const folders = Arr.dedupe(Arr.map(filesUnder("src/"), (file) => Str.split(file, "/")[0] ?? ""));
  for (const folder of ["index.ts", "things", "common", "starting-points", "protocol", "generated"])
    assert.ok(Arr.contains(folders, folder), `src/${folder} is missing`);
});
