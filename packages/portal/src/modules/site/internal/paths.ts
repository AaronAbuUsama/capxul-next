/**
 * Where a page's three files live. A page id is `index`, `review`, or `<kind>/<id>`; every link between files is
 * relative, so the site works from a folder on disk and from any static host.
 */
import { posix } from "node:path";

export const htmlFile = (page: string): string => (page === "index" ? "index.html" : `${page}/index.html`);
export const mdFile = (page: string): string => `${page}.md`;
export const jsonFile = (page: string): string => `data/${page}.json`;

/** The link from one file of the site to another. */
export const relative = (fromFile: string, toFile: string): string =>
  posix.relative(posix.dirname(fromFile), toFile) || posix.basename(toFile);
