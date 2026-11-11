// node --experimental-strip-types packages/layout/src/main.ts    (pnpm layout; also part of pnpm test)
//
// Keeps the repository findable. It fails, with a list, when:
//
// - something is at the top level that is not in ALLOWED below (tracked, or untracked and not git-ignored);
// - a source file is over LIMIT lines, unless it is in packages/layout/oversize.json, and those may not grow;
// - a top-level directory or a package has no README.md.
//
// This file is the entry and holds the policy; the rules are pure and live in src/modules/layout.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkLayout, type Allowlist, type Oversize, type Policy, type Tree } from "./modules/layout/service.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Everything that may be at the top level, and why. To add an entry, add its reason; a README row is not enough. */
export const ALLOWED: Allowlist = {
  "README.md": "the front door: what this is and where things are",
  "AGENTS.md": "the rules every agent follows here, the roles and the checks",
  "CLAUDE.md": "a link to AGENTS.md, so Claude reads the same rules",
  "START-HERE.md": "the owner's direction of 9 November 2026; the blueprint cites it as evidence",
  "GROUNDING.md": "what is being built and why, in the owner's words; the blueprint cites it",
  "blueprint": "the design: the blueprint, with the old system's behaviour in baseline/",
  "packages": "the code, one package per component",
  "plan": "the coordinator's plan, its log and the owner's answers",
  "evals": "which check proves which eval of the blueprint",
  "status": "the scoreboard, written only by pnpm evals",
  "spikes": "proven throwaway code, deleted when plan task m2-graduate-spike is done",
  "docs": "written designs, evidence the blueprint cites, generated reports",
  "package.json": "the workspace's scripts",
  "pnpm-lock.yaml": "the lockfile",
  "pnpm-workspace.yaml": "the workspace and the dependency catalog",
  ".gitignore": "git",
  ".github": "the pull request template and issue forms",
  ".claude": "a link to the skills in .agents/skills, for Claude Code",
  ".agents": "Amp's orb setup and resume scripts and the coordinator's skills (decision build.amp)",
  ".amp": "Amp's orb services: the book served from the coordinator's orb",
};

export const LIMIT = 300;

const policyOf = (oversize: Oversize): Policy => ({
  allowed: ALLOWED,
  limit: LIMIT,
  sourceExtensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh", ".sol"],
  // designs and evidence; dead material; generated code; vendored libraries
  sizeExempt: ["blueprint/", "docs/", "/generated/", "packages/contracts/lib/", "/node_modules/"],
  oversize,
});

const git = (...args: string[]): string[] =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter((l) => l !== "");
const first = (path: string): string => path.split("/")[0]!;
const isDir = (path: string): boolean => { try { return statSync(join(ROOT, path)).isDirectory(); } catch { return false; } };
const linesOf = (path: string): number => {
  try { const text = readFileSync(join(ROOT, path), "utf8"); return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0); }
  catch { return 0; }   // deleted in the working tree but still in the index
};

const main = (): number => {
  const tracked = git("ls-files", "-z"), untracked = git("ls-files", "-z", "--others", "--exclude-standard");
  const files = [...tracked, ...untracked], topLevel = [...new Set(files.map(first))];
  const tree: Tree = {
    topLevel, topLevelDirs: topLevel.filter(isDir), files, linesOf,
    packages: [...new Set(files.filter((p) => p.startsWith("packages/") && p.split("/").length > 2).map((p) => p.split("/")[1]!))],
  };
  const oversize = JSON.parse(readFileSync(join(ROOT, "packages/layout/oversize.json"), "utf8")) as Oversize;
  const problems = checkLayout(tree, policyOf(oversize));
  for (const p of problems) console.error(`${p.rule}  ${p.at}: ${p.why}`);
  if (problems.length > 0) { console.error(`check-layout: ${problems.length} problem${problems.length === 1 ? "" : "s"}`); return 1; }
  console.log(`check-layout: ${topLevel.length} top-level entries, all allowed; no source file over ${LIMIT} lines beyond the ${Object.keys(oversize).length} recorded; every directory and package has a README`);
  return 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
