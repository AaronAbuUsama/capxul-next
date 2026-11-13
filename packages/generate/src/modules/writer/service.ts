// The shared writer every generated file goes through (tooling.generated-header), and the comparison that proves a
// tree holds exactly what the records generate (sys:generated, tooling.facts-derivation). Pure: no file system.

import { createHash } from "node:crypto";

export const HEADER = "// Generated from blueprint by packages/generate. Do not edit.";

/** The file as it is written: the header, with the sha256 of everything after its line, then the body. */
export const withHeader = (body: string): string => {
  const text = body.endsWith("\n") ? body : `${body}\n`;
  return `${HEADER} sha256:${createHash("sha256").update(text).digest("hex")}\n${text}`;
};

/** Every generated folder is the generator's: any src/generated/, at any depth in the repository. */
export const isGenerated = (path: string): boolean => /(^|\/)src\/generated\//.test(path);

export interface Difference {
  readonly path: string;
  readonly why: "differs" | "missing" | "not generated";
}

/** Compares what the records generate with a tree: each target must be there byte for byte, and no other file may be
 * under a src/generated/ folder, because regenerating into a clean tree would not write it. */
export const compare = (
  rendered: ReadonlyMap<string, string>,
  tree: { readonly files: readonly string[]; readonly read: (path: string) => string },
): Difference[] => {
  const present = new Set(tree.files);
  const out: Difference[] = [];
  for (const [path, text] of [...rendered].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!present.has(path)) out.push({ path, why: "missing" });
    else if (tree.read(path) !== text) out.push({ path, why: "differs" });
  }
  for (const path of [...present].filter(isGenerated).sort()) if (!rendered.has(path)) out.push({ path, why: "not generated" });
  return out;
};
