// Every package has a map, `packages/<name>/generated/index.md`, written by `pnpm generate` (docs/design/docs.md,
// section 0, item 3): one line per file under its src/ and page under its docs/. Pure, like shape.ts.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Str from "effect/String";

/** Where a package's map lives, inside the package. */
export const MAP = "generated/index.md";

/**
 * The packages with no map yet, each by its path. The list may only shrink: a package on it that now has a map must
 * come off it, and test/maps.test.ts caps the list's length. `pnpm generate` writes a map for every other package but
 * the blueprint, whose map is its own (packages/blueprint/generated/index.md).
 */
export const UNMAPPED: ReadonlyArray<string> = [
  // No TypeScript under src/ and no docs/: the map reads only those.
  "packages/bench-image",
  "packages/status-feed",
  // The blueprint lead's: its map comes when that lead takes it off this list.
  "packages/blueprint-tools",
];

const packagesOf = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    Arr.filter(files, (file) => Str.startsWith("packages/")(file) && Str.split(file, "/").length > 2),
    Arr.map((file) => Arr.join(Arr.take(Str.split(file, "/"), 2), "/")),
    Arr.dedupe,
  );

/** Every package with no map and not on UNMAPPED, and every package on UNMAPPED that has one. */
export const mapProblems = (files: ReadonlyArray<string>): Array<string> => {
  const mapped = (pkg: string): boolean => Arr.contains(files, `${pkg}/${MAP}`);
  return [
    ...Arr.map(
      Arr.filter(packagesOf(files), (pkg) => !mapped(pkg) && !Arr.contains(UNMAPPED, pkg)),
      (pkg) => `map: "${pkg}" has no ${MAP}; run \`pnpm generate\` and commit it`,
    ),
    ...Arr.map(
      Arr.filter(UNMAPPED, mapped),
      (pkg) => `map: "${pkg}" has its ${MAP}; take it off UNMAPPED in packages/lint/src/maps.ts`,
    ),
  ];
};
