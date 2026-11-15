// The layout of src/ (docs/design/world.md): fails any file that lands outside it. A folder says what kind of thing
// lives in it, every thing has its own folder with the same files, and nothing but index.ts is loose at the root.
import * as assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";

const SRC = join(import.meta.dirname, "..", "src");
const files = Arr.map(
  Arr.filter(readdirSync(SRC, { recursive: true, withFileTypes: true }), (entry) => entry.isFile()),
  (entry) => Arr.join(Str.split(relative(SRC, join(entry.parentPath, entry.name)), sep), "/"),
);

/** The kinds of folder at the root of src/, and the one file allowed there. */
const KINDS = ["things", "parts", "account", "stack", "cli", "common", "proofs"];
const ROOT_FILES = ["index.ts"];

/** The files every thing folder may hold beside its verbs. */
const THING_FILES = ["values.ts", "stage.ts", "client.ts", "store.ts"];

/** The verbs a thing's file may be named for (the glossary's, until the blueprint's glossary exports them: 3.8). */
const VERBS = [
  "create",
  "destroy",
  "list",
  "show",
  "use",
  "reset",
  "renew",
  "sweep",
  "keep",
  "reserve",
  "save",
  "restore",
];

/**
 * Files in a thing folder that are neither one of its files nor one verb. Each folds into a file above; the list may
 * only shrink (a ratchet, like the blueprint's), and a new file is never added to it.
 */
const UNFOLDED = [
  "things/world/bring-up.ts", // into create.ts
  "things/world/take-down.ts", // into destroy.ts and keep.ts
  "things/world/expiry.ts", // into values.ts
  "things/world/names.ts", // into values.ts
  "things/world/handle.ts", // into client.ts
  "things/world/kept.ts", // into client.ts
  "things/world/cast.ts", // into create.ts
  "things/cluster/registration.ts", // into values.ts
  "things/cluster/idle.ts", // into client.ts
  "things/site/bench.ts", // into client.ts and create.ts
  "things/site/snapshot.ts", // into save.ts and restore.ts
];
const UNFOLDED_COUNT = 11;

const kebab = /^[a-z][a-z0-9-]*$/;

/** Why a file does not fit the layout, or nothing when it does. */
const misfit = (file: string): string | undefined => {
  const [kind, ...rest] = Str.split(file, "/");
  if (Str.endsWith(".md")(file)) return "markdown lives in docs/ or generated/, never in src/";
  if (rest.length === 0)
    return Arr.contains(ROOT_FILES, file) ? undefined : "only index.ts is loose at the root of src/";
  if (!Arr.contains(KINDS, kind)) return `"${kind}/" is not a kind of folder: ${Arr.join(KINDS, ", ")}`;
  if (kind === "things" || kind === "parts") {
    const [folder = "", name = ""] = rest;
    if (rest.length !== 2)
      return `${kind}/ holds one folder per ${kind === "things" ? "thing" : "part"}, and files in it`;
    if (!kebab.test(folder)) return `"${folder}" is not a folder name in kebab case`;
    if (kind === "parts") return undefined;
    const fits =
      Arr.contains(THING_FILES, name) ||
      Arr.contains(VERBS, Str.replace(/\.ts$/, "")(name)) ||
      Arr.contains(UNFOLDED, file);
    return fits
      ? undefined
      : `a thing folder holds ${Arr.join(THING_FILES, ", ")} and one file per verb (${Arr.join(VERBS, ", ")})`;
  }
  if (kind === "proofs") {
    const fits = rest.length === 1 || (rest.length === 2 && Arr.contains(["cases", "support"], rest[0] ?? ""));
    return fits ? undefined : "proofs/ holds cases/, support/ and cases.ts";
  }
  return rest.length === 1 ? undefined : `${kind}/ holds files, not folders`;
};

test("every file under src/ is where the layout says", () => {
  const misfits = Arr.flatMap(files, (file) => {
    const why = misfit(file);
    return why === undefined ? [] : [`${file}: ${why}`];
  });
  assert.deepEqual(misfits, []);
});

test("the README is one screen", () => {
  const lines = Str.split(readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8"), "\n").length - 1;
  assert.ok(lines <= 60, `README.md has ${lines} lines; one screen is 60 (docs/design/blueprint.md, part 7)`);
});

test("the unfolded files only shrink, and each still exists", () => {
  assert.ok(UNFOLDED.length <= UNFOLDED_COUNT, "a file was added to UNFOLDED; give it a place instead");
  assert.deepEqual(
    Arr.filter(UNFOLDED, (file) => !Arr.contains(files, file)),
    [],
    "a folded file is gone: remove it from UNFOLDED and lower the count",
  );
});
