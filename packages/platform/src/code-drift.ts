// Which lines of `docker diff` are code changed by hand. Pure, so the tests can feed it any listing.
//
// `docker diff` lists every path changed in a container since it was created from its image, directories included,
// as `A /path` (added), `C /path` (changed) or `D /path` (deleted). Only leaves count (a directory is listed whenever a
// file under it changed), only paths that hold code (the site door, the bench's apps and its Python environment), and
// never Python's compiled caches, which the bench writes as it runs.
import * as Arr from "effect/Array";
import * as Str from "effect/String";

export const CODE_ROOTS: ReadonlyArray<string> = [
  "/opt/door/",
  "/home/frappe/frappe-bench/apps/",
  "/home/frappe/frappe-bench/env/",
];
const IGNORED = /(__pycache__|\.pyc$)/;
const ENTRY = /^[ACD] \//;

export const codeChanges = (listing: string): Array<string> => {
  const entries = Arr.filter(Arr.map(Str.split(listing, "\n"), Str.trim), (line) => ENTRY.test(line));
  const paths = Arr.map(entries, (line) => Str.slice(2)(line));
  const isLeaf = (path: string) => !Arr.some(paths, (other) => Str.startsWith(`${path}/`)(other));
  return Arr.filter(entries, (line) => {
    const path = Str.slice(2)(line);
    return Arr.some(CODE_ROOTS, (root) => Str.startsWith(root)(path)) && !IGNORED.test(path) && isLeaf(path);
  });
};
