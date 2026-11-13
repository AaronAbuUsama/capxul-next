// node --experimental-strip-types packages/generate/src/main.ts [--check]
//   (pnpm generate; pnpm generate:check, which pnpm test runs)
//
// Writes every target from the records into packages/<package>/src/generated/, and deletes any other file there, so
// the folders hold exactly what the records generate (tooling.facts-derivation). With --check it writes nothing: it
// renders in memory, compares with the files on disk and names each one that differs, is missing or no target writes,
// then compiles every package a target is in (sys:generated). It reads the checkout it lives in, so running a
// commit's own copy in a clean checkout of that commit checks that commit.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./targets.ts";
import { compare, isGenerated } from "./modules/writer/service.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const check = process.argv.includes("--check");

/** Every file under a src/generated/ folder on disk, tracked or not, so a stray file is seen before it is committed. */
const onDisk = (): string[] => {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\0").filter(Boolean);
  const files = existsSync(join(root, ".git")) ? [...git("ls-files", "-z", "packages"), ...git("ls-files", "-z", "--others", "--exclude-standard", "packages")] : [];
  return [...new Set(files)].filter((p) => isGenerated(p) && existsSync(join(root, p))).sort();
};

const rendered = await render(root);
const tree = { files: onDisk(), read: (p: string) => readFileSync(join(root, p), "utf8") };
const differences = compare(rendered, tree);

if (check) {
  for (const d of differences) console.error(`generate:check  ${d.path}: ${d.why}`);
  if (differences.length) {
    console.error(`generate:check: ${differences.length} file${differences.length === 1 ? "" : "s"} not as the records generate them; run pnpm generate`);
    process.exitCode = 1;
  } else console.log(`generate:check: ${rendered.size} generated file${rendered.size === 1 ? " matches" : "s match"} the records`);
  // The generated packages compile: each package a target is in, with the workspace's TypeScript.
  const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
  for (const pkg of [...new Set([...rendered.keys()].map((p) => p.split("/").slice(0, 2).join("/")))].sort()) {
    try {
      execFileSync(process.execPath, [tsc, "-p", join(root, pkg)], { cwd: root, encoding: "utf8", stdio: "pipe" });
      console.log(`generate:check: ${pkg} compiles`);
    } catch (e) {
      const out = (e as { stdout?: string }).stdout ?? String(e);
      console.error(`generate:check  ${pkg}: does not compile\n${out.trimEnd()}`);
      process.exitCode = 1;
    }
  }
} else {
  for (const d of differences) {
    const path = join(root, d.path);
    if (d.why === "not generated") rmSync(path);
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, rendered.get(d.path)!); }
    console.log(`generate  ${d.path}: ${d.why === "not generated" ? "deleted" : "written"}`);
  }
  console.log(`generate: ${rendered.size} target${rendered.size === 1 ? "" : "s"}, ${differences.length} changed`);
}
