// node --experimental-strip-types packages/contracts/abi-check/export-abi.ts   → writes packages/contracts/abi/abi.json
//
// What `packages/contracts/abi-check/main.ts` compares the blueprint against: the ABI of every contract that has code in
// `packages/contracts/src/` (a build of it, in `out/`), with the hash of the source it was built from. The export is
// committed, so the check needs no build (about 100 s); the check recomputes the hash and fails when the source moved on and
// this was not run again. Run `pnpm contracts:export-abi` after any change to a contract (it runs `forge build` first).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { sourceHash } from "./source-hash.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PKG = join(ROOT, "packages/contracts");
const OUT_FILE = join(PKG, "abi/abi.json");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".sol") ? [p] : [];
  });

execFileSync("forge", ["build"], { cwd: PKG, stdio: "inherit" });

type Artifact = {
  abi: unknown[];
  deployedBytecode: { object: string };
  metadata: { settings: { compilationTarget: Record<string, string> }; compiler: { version: string } };
};

const contracts: Record<string, { source: string; kind: "contract" | "library"; abi: unknown[] }> = {};
let compiler = "";
for (const file of sourceFiles(join(PKG, "src"))) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dir = join(PKG, "out", base);
  if (!existsSync(dir)) continue;
  for (const n of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const art = JSON.parse(readFileSync(join(dir, n), "utf8")) as Artifact;
    const target = art.metadata?.settings?.compilationTarget ?? {};
    const name = n.slice(0, -5);
    const rel = relative(PKG, file);
    // Only what the file itself defines and what has code: not interfaces, not libraries without external functions.
    if (target[rel] !== name || art.deployedBytecode.object === "0x") continue;
    const kind = new RegExp(`^library\\s+${name}\\b`, "m").test(readFileSync(file, "utf8")) ? "library" : "contract";
    contracts[name] = { source: rel, kind, abi: art.abi };
    compiler = art.metadata.compiler.version;
  }
}

const sorted = Object.fromEntries(Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b)));
const lines = Object.entries(sorted).map(
  ([name, c]) =>
    `  ${JSON.stringify(name)}: { "source": ${JSON.stringify(c.source)}, "kind": ${JSON.stringify(c.kind)}, "abi": [\n${(c.abi as unknown[])
      .map((e) => `    ${JSON.stringify(e)}`)
      .join(",\n")}\n  ] }`,
);
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(
  OUT_FILE,
  `{\n "sourceHash": ${JSON.stringify(sourceHash(PKG))},\n "compiler": ${JSON.stringify(compiler)},\n "contracts": {\n${lines.join(",\n")}\n }\n}\n`,
);
console.log(`wrote ${relative(ROOT, OUT_FILE)}: ${Object.keys(sorted).length} contracts with code`);
