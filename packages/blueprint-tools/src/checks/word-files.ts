// Which files the count of old words reads (old-words.ts): `packages/`, `AGENTS.md`, `docs/roadmap.md`,
// `docs/decisions.md` and `.github/`. Left out: what is not ours to rename or not a source (`node_modules`, run and proof records, generated
// files, the contracts' vendored libraries, their build output and seeded chain state), the glossary itself, which
// owns the old words, applied migrations (`packages/<name>/migrations/*.sql`, never edited or renamed), and Solidity (a contract's names are on its chain; renaming one is a change of the contracts).
// The design notes under `docs/design/` are not read at all. Markdown's prose is left out where it is read
// (./code-text.ts). Pure: the caller hands it the disk (`Disk`), so the toolkit's door stays free of node:fs.
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import type { File } from "./old-words.ts";

/** Where the count reads, from the repository's root. */
export const ROOTS = ["packages", ".github", "AGENTS.md", "docs/roadmap.md", "docs/decisions.md"];

/** A folder of this name is never read, wherever it is. */
const SKIPPED_FOLDERS = ["node_modules", "records", "generated", ".alchemy", ".wrangler", "__pycache__", "dist"];

/** Paths never read, from the root. */
const SKIPPED_PATHS = [
  "packages/contracts/lib/",
  "packages/contracts/out/",
  "packages/contracts/cache/",
  "packages/contracts/state/",
  "packages/blueprint/src/glossary.ts",
];

/** Whether the count reads the file at `path`, from the repository's root (a folder's path ends in `/`). */
export const isRead = (path: string): boolean =>
  !Arr.some(Str.split(path, "/"), (folder) => Arr.contains(SKIPPED_FOLDERS, folder)) &&
  !Arr.some(SKIPPED_PATHS, (skipped) => Str.startsWith(skipped)(path)) &&
  !Str.endsWith(".sol")(path) &&
  !/^packages\/[^/]+\/migrations\/[^/]+\.sql$/.test(path);

/** The disk, as the count reads it, each path from the repository's root. */
export interface Disk {
  readonly isFolder: (path: string) => boolean;
  readonly names: (folder: string) => ReadonlyArray<string>;
  readonly text: (file: string) => string;
}

/** Every file under `path` the count reads, a folder left out before it is entered, in name order. */
const walk = (disk: Disk, path: string): ReadonlyArray<string> => {
  if (!disk.isFolder(path)) return isRead(path) ? [path] : [];
  if (!isRead(`${path}/`)) return [];
  const names: ReadonlyArray<string> = Arr.sort(disk.names(path), Order.String);
  return Arr.flatMap(names, (name: string) => walk(disk, `${path}/${name}`));
};

/** Every file the count reads, with its text, in a stable order. */
export const wordFiles = (disk: Disk): ReadonlyArray<File> =>
  Arr.map(
    Arr.flatMap(ROOTS, (top) => walk(disk, top)),
    (path) => ({ path, text: disk.text(path) }),
  );
