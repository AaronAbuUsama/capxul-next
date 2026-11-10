// The hash the ABI export is stamped with: every `.sol` file under `src/` (path and bytes), the deploy manifest and
// foundry.toml, so any change to a contract, to what is deployed or to how it is built makes the export stale.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
    });

export const sourceHash = (pkgDir: string): string => {
  const h = createHash("sha256");
  const files = [...walk(join(pkgDir, "src")), join(pkgDir, "deploy/manifest.json"), join(pkgDir, "foundry.toml")];
  for (const f of files) {
    h.update(relative(pkgDir, f));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
};
