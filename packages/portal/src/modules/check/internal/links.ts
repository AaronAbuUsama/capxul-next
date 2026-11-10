/** Links: every relative link in every HTML, Markdown and text file lands on a file, and every anchor on an id. */
import { posix } from "node:path";

const ID = /\sid="([^"]+)"/g;
const HTML_LINK = /\s(?:href|src)="([^"]*)"/g;
const MD_LINK = /\]\(([^)\s]+)\)/g;
/** A link with a scheme leaves the site; the check does not follow it. */
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

const all = (text: string, shape: RegExp): readonly string[] => [...text.matchAll(shape)].map((m) => m[1] ?? "");
const decode = (s: string): string => s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** The file a link written in `file` points at. An empty path is the file itself; a folder is its index page. */
const targetOf = (file: string, path: string): string => {
  if (path === "") return file;
  const at = posix.normalize(posix.join(posix.dirname(file), path));
  return path.endsWith("/") ? `${at.replace(/\/$/, "")}/index.html` : at;
};

export const links = (files: ReadonlyMap<string, string>): readonly string[] => {
  const failures: string[] = [];
  const ids = new Map<string, ReadonlySet<string>>();
  for (const [file, text] of files) {
    if (!file.endsWith(".html")) continue;
    const found = all(text, ID).map(decode);
    const held = new Set(found);
    if (held.size !== found.length) {
      const twice = found.filter((id, i) => found.indexOf(id) !== i);
      failures.push(`${file}: the id "${twice[0] ?? ""}" is used more than once`);
    }
    ids.set(file, held);
  }
  for (const [file, text] of files) {
    const html = file.endsWith(".html");
    if (!html && !file.endsWith(".md") && !file.endsWith(".txt")) continue;
    for (const raw of new Set(all(text, html ? HTML_LINK : MD_LINK))) {
      const href = html ? decode(raw) : raw;
      if (EXTERNAL.test(href)) continue;
      const cut = href.indexOf("#");
      const path = cut < 0 ? href : href.slice(0, cut);
      const anchor = cut < 0 ? "" : href.slice(cut + 1);
      const target = targetOf(file, path);
      if (!files.has(target)) failures.push(`${file}: "${href}" points at no file (${target})`);
      else if (anchor !== "" && !(ids.get(target)?.has(anchor) ?? false)) failures.push(`${file}: "${href}" points at no id in ${target}`);
    }
  }
  return failures;
};
